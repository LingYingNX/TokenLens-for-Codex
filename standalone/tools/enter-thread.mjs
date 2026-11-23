// 辅助脚本：点开侧栏第一个线程，让 Codex 停在线程页。
// 状态栏只在有 threadId 时渲染（tokenlens.js 的原有行为），验证前先跑这个。
import { findPage, Cdp } from "./cdp.mjs";
const page = await findPage(9229);
if (!page) { console.log("no page"); process.exit(2); }
const cdp = await Cdp.connect(page.webSocketDebuggerUrl);
const expr = `(async () => {
  const item = document.querySelector('[data-app-action-sidebar-thread-id]');
  if (item) (item.querySelector("button") || item).click();
  await new Promise((r) => setTimeout(r, 4000));
  return { placement: document.querySelector("[data-codex-composer-root]")?.getAttribute("data-composer-placement") || null };
})()`;
console.log(JSON.stringify(await cdp.evaluate(expr)));
process.exit(0);
