# 验证记录（2026-11-25）

## 自动化

- `node --check tokenlens.js` 通过；`node --test tests/artifact-sync.test.js` 1 项通过；`node --test tests/*.test.js` 194 项全部通过（退出码 0）。
- 新增测试覆盖：多模型按轮次归属、模型冲突/缺失为未知、父子递归与防环、伪造会话拒绝、重复调用去重、跨来源不合并、界面加载/不可用/部分覆盖/安全文本、线程切换与销毁隔离、繁忙退避与自动恢复。

## 实机

- 在不重启 Codex 的前提下，通过调试端口把当前 tokenlens.js 热注入运行中的渲染页：状态栏与弹层各 1 个实例，明细行 280px 弹层内单行显示（行高 19px，名称与数字同一基线），右侧数字不再带 `tokens` 后缀或被换行截断。
- `node ./standalone/tools/check.mjs`：8 项中 6 项通过、2 项跳过（Codex 窗口最小化，事件流与刷新项不执行）。

## 未验证 / 缺口

- 实机只出现单模型一行；多模型分布与真实子代理行（`↳`）由合成测试覆盖，未在实机数据中复现。
- 明细与原任务总数的范围差异只能提示，不能直接核对；该限制在 README 与界面提示中说明。
- 扫描存在文件数/字节预算，超出时标 `partial`/`truncated`，页面只显示覆盖不完整提示。

## 2026-11-25 修正：明细改用 Magpie 逐请求记录

- 用户反馈明细显示的是路由/分组名（如 group/dp、agentied/gpt-6.1-terra），要求只显示模型本身。
- 已核实 Magpie `/v1/magpie/usage/requests?period=7d&agent=codex&limit=500&q=<线程>&offset=N` 的 rows 带 `model`（真实模型名）、`session_role`（main/subagent/unknown）、`in`/`cache_read`/`out`；按 500/页翻页取全后 sum 与任务总数一致（样例 163,840,992 / 163,870,802，差 29,810 是 unknown 角色行）。
- 明细首选该来源，按 (角色, 真实模型) 聚合；Magpie 不可用时回退宿主 rollout 归属（只有路由名）。未匹配/无角色但有 token 的记录跳过并标 `partial`。
- 用真实数据跑聚合函数得到 5 行：主会话 `deepseek-v4.1-flash-1017`、`gpt-6.1-terra`，子代理 `deepseek-v4.1-flash-1017`、`DeepSeek-V4.1-Flash`、`sn-deepseek-v4-1-flash-1017`。
- 限制：unknown 角色行（样例 36 行、29,810 tokens）被排除并标记 partial；Magpie 保留仅 7 天。
- 2026-11-25 用户决定：面板不显示任何描述行，partial 与覆盖范围说明只写入面板的 aria-label；规格同步改成「说明走无障碍标签」。
