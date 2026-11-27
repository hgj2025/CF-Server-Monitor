// 安全加固：禁用外部第三方主题商店拉取，仅使用内置主题。
export async function handleTheme() {
  return {
    ok: true,
    themeStore: { schema: 1, themes: [], disabled: true },
    cached: true
  };
}
