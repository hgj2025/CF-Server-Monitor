<template>
  <div id="tab-theme-store" class="tab-content" :class="{ active: activeTab === 'themeStore' }">
    <div class="settings-section">
      <div class="section-title"><span>▸</span> {{ trans.themeStore }}</div>
      <div class="warning-box mb-4">
        <div class="flex-center-gap-sm">
          <span class="warning-icon text-xl">🛡️</span>
          <span style="color: var(--accent-yellow); font-weight: 600;">第三方主题商店与外部主题反代已禁用（安全加固）</span>
        </div>
        <p class="text-secondary text-sm mt-2" style="line-height: 1.6;">
          为防止同源外部脚本反代接管管理后台并窃取 API_SECRET / 通知密钥，本分支已彻底禁用第三方主题加载、预览与自定义主题 URL，始终使用内置可信前端资源。
        </p>
      </div>
    </div>
  </div>
</template>

<script setup>
defineProps({
  activeTab: { type: String, required: true },
  trans: { type: Object, required: true },
  currentThemeUrl: { type: String, default: '' },
  selectedApiIndex: { type: Number, default: 0 },
  settings: { type: Object, default: () => ({}) }
})

defineEmits(['theme-applied', 'theme-options-applied', 'alert-message'])
</script>
