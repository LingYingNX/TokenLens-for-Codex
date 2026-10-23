# TokenLens for Codex

在 Codex++ 底栏显示实时 `tok/s`，悬停查看本轮吞吐、工具分类、Token 与缓存，以及 Codex 会话的累计消耗。

在我血亏各种token，是别人的5倍以上用量，各种多余的消耗之后做了这个监控插件，单次输出的量太大的时候，是时候重开会话了
有好的想法建议可以提，后续打算会增加更为详细的数据，比如有用信息结构权重（不清楚能不能实现），平均速度为档次轮次的平均，下一轮次重新计算

<img width="269" height="492" alt="image" src="https://github.com/user-attachments/assets/f84acf38-c05f-44ee-b4b9-4812832675df" />  <img width="214" height="64" alt="image" src="https://github.com/user-attachments/assets/4e0ab2d4-9ada-41ed-bdb6-06a06bce29d5" />

## 功能

- 底栏显示实时 `tok/s` 和缓存命中
- 查看上下文占用、输入、输出、缓存读取与缓存命中
- 查看单次调用柱状图、最近调用与单次最大输出 TOP 3
- 显示本轮平均速度、调用次数与轮数
- 工具执行按记忆库、Skills、MCP、Hook、命令执行等类别汇总
- 支持任务、今天、昨天、近 7 天和自定义区间消耗
- 支持亮色、暗色主题切换
- 单文件外置脚本，无需重新构建 Codex++

## 安装

### Windows

在 PowerShell 中运行：

```powershell
New-Item -ItemType Directory -Force "$env:APPDATA\Codex++\user_scripts" | Out-Null
Invoke-WebRequest "https://raw.githubusercontent.com/LingYingNX/TokenLens-for-Codex/main/tokenlens.js" -OutFile "$env:APPDATA\Codex++\user_scripts\tokenlens.js"
```

### macOS

```bash
mkdir -p "$HOME/.config/Codex++/user_scripts"
curl -fsSL "https://raw.githubusercontent.com/LingYingNX/TokenLens-for-Codex/main/tokenlens.js" -o "$HOME/.config/Codex++/user_scripts/tokenlens.js"
```

安装后重启 Codex++，或在 Codex++ 的「拓展」页面执行热重载。

## 说明

数据来自 Codex 本地事件、会话记录与每日消耗数据，不上传会话内容。页面刷新后，状态栏会在下一次模型或工具事件到达时恢复。跨会话历史以每日数据源实际保留的日期为准；覆盖不足时，消耗标签会显示可用天数。

## 许可证

[MIT](LICENSE)
