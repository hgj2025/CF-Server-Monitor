import assert from 'node:assert/strict';
import test from 'node:test';

import worker from '../src/index.js';
import { handleAdminAPI } from '../src/handlers/admin.js';
import { handleTheme } from '../src/handlers/theme.js';
import { generateToken, checkAuth } from '../src/middleware/auth.js';
import { buildCspHeader, buildBackgroundStyle } from '../src/utils/csp.js';

function makeRateLimitDb() {
  const rateLimits = new Map();
  const settings = new Map();
  return {
    rateLimits,
    settings,
    prepare(sql) {
      return {
        bind(...params) {
          return {
            async first() {
              if (sql.includes('FROM login_rate_limits')) {
                return rateLimits.get(params[0]) || null;
              }
              if (sql.includes('FROM settings')) {
                const v = settings.get(params[0]);
                return v !== undefined ? { value: v } : null;
              }
              return null;
            },
            async run() {
              if (sql.includes('INSERT INTO login_rate_limits')) {
                rateLimits.set(params[0], { ip: params[0], attempts: 1, window_start: params[1] });
              } else if (sql.includes('UPDATE login_rate_limits')) {
                const row = rateLimits.get(params[0]);
                if (row) row.attempts += 1;
              } else if (sql.includes('DELETE FROM login_rate_limits')) {
                rateLimits.delete(params[0]);
              } else if (sql.includes('INSERT INTO settings')) {
                settings.set(params[0], params[1]);
              }
              return { success: true };
            },
            async all() {
              return { results: [] };
            }
          };
        },
        async first() {
          if (sql.includes("'site_options'")) {
            const v = settings.get('site_options');
            return v !== undefined ? { value: v } : null;
          }
          return null;
        },
        async run() {
          return { success: true };
        },
        async all() {
          return { results: [] };
        }
      };
    }
  };
}

test('第三方主题商店已禁用且不发起外连', async () => {
  const res = await handleTheme();
  assert.equal(res.ok, true);
  assert.equal(res.themeStore.disabled, true);
  assert.deepEqual(res.themeStore.themes, []);
});

test('密码登录支持按 IP 限流防爆破（连续失败 5 次返回 429）', async () => {
  const db = makeRateLimitDb();
  const env = { DB: db, API_SECRET: 'super-secret-value-1234567890' };
  const sys = { username: 'admin', password: '' };

  for (let i = 0; i < 5; i += 1) {
    const res = await handleAdminAPI(
      new Request('https://monitor.example.com/admin/api', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'CF-Connecting-IP': '198.51.100.42'
        },
        body: JSON.stringify({ action: 'login', username: 'admin', password: 'wrong' })
      }),
      env,
      sys
    );
    assert.equal(res.status, 401);
  }

  const blocked = await handleAdminAPI(
    new Request('https://monitor.example.com/admin/api', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'CF-Connecting-IP': '198.51.100.42'
      },
      body: JSON.stringify({ action: 'login', username: 'admin', password: 'super-secret-value-1234567890' })
    }),
    env,
    sys
  );
  assert.equal(blocked.status, 429);
});

test('start_theme_preview 与保存第三方 theme_url 均返回 403', async () => {
  const db = makeRateLimitDb();
  const env = { DB: db, API_SECRET: 'super-secret-value-1234567890' };
  const sys = { username: 'admin', password: 'hashed-password', jwt_secret: 'a'.repeat(64) };
  const token = await generateToken(env, sys);

  const previewRes = await handleAdminAPI(
    new Request('https://monitor.example.com/admin/api', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ action: 'start_theme_preview', theme_url: 'https://github.com/evil/theme/tree/main' })
    }),
    env,
    sys
  );
  assert.equal(previewRes.status, 403);

  const saveRes = await handleAdminAPI(
    new Request('https://monitor.example.com/admin/api', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ action: 'save_settings', settings: { theme_url: 'https://github.com/evil/theme/tree/main' } })
    }),
    env,
    sys
  );
  assert.equal(saveRes.status, 403);
});

test('修改管理员密码自动轮换 jwt_secret 并吊销旧令牌', async () => {
  const db = makeRateLimitDb();
  const env = { DB: db, API_SECRET: 'super-secret-value-1234567890' };
  const oldJwtSecret = 'b'.repeat(64);
  const sys = { username: 'admin', password: 'old-hash', jwt_secret: oldJwtSecret };
  const oldToken = await generateToken(env, sys);

  const res = await handleAdminAPI(
    new Request('https://monitor.example.com/admin/api', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${oldToken}` },
      body: JSON.stringify({ action: 'save_settings', settings: { password: 'NewStrongPassword!2026' } })
    }),
    env,
    sys
  );
  assert.equal(res.status, 200);
  assert.notEqual(sys.jwt_secret, oldJwtSecret, '修改密码后应轮换 jwt_secret');
  assert.match(res.headers.get('set-cookie') || '', /cfsm_auth=/, '应下发新会话 Cookie');

  const oldStillValid = await checkAuth(
    new Request('https://monitor.example.com/admin/api', {
      headers: { Authorization: `Bearer ${oldToken}` }
    }),
    env,
    sys
  );
  assert.equal(oldStillValid, false, '旧令牌必须立即失效');
});

test('/__do/health 未认证时返回 401', async () => {
  const db = makeRateLimitDb();
  const env = { DB: db, API_SECRET: 'super-secret-value-1234567890' };
  const res = await worker.fetch(new Request('https://monitor.example.com/__do/health'), env, { waitUntil() {} });
  assert.equal(res.status, 401);
});

test('CSP 收紧且背景 CSS URL 转义尖括号', () => {
  const csp = buildCspHeader();
  assert.equal(csp.includes('raw.githubusercontent.com'), false);
  assert.equal(csp.includes('api.github.com'), false);
  const style = buildBackgroundStyle('https://example.com/bg</style><script>alert(1)</script>');
  assert.equal(style.includes('</style><script>'), false);
});
