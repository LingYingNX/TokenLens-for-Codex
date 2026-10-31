# TokenLens for Codex

在 Codex++ 底栏显示实时 `tok/s`，悬停查看本轮吞吐、工具分类、Token 与缓存，以及 Codex 会话的累计消耗。

在我血亏各种token，是别人的5倍以上用量，各种多余的消耗之后做了这个监控插件，单次输出的量太大的时候，是时候重开会话了
有好的想法建议可以提，后续打算会增加更为详细的数据，比如有用信息结构权重（不清楚能不能实现），平均速度按当前轮次已结算调用做 token 加权，下一轮次重新计算

<img width="269" height="492" alt="image" src="https://github.com/user-attachments/assets/f84acf38-c05f-44ee-b4b9-4812832675df" />  <img width="214" height="64" alt="image" src="https://github.com/user-attachments/assets/4e0ab2d4-9ada-41ed-bdb6-06a06bce29d5" />

## 功能

- 底栏显示实时 `tok/s` 和缓存命中
- 查看上下文占用、输入、输出、缓存读取与缓存命中
- 查看单次调用柱状图、最近调用与单次最大输出 TOP 3
- 显示本轮平均速度、调用次数与轮数
- 工具执行按记忆库、Skills、MCP、Hook、图像生成、网页搜索、代码审查、等待、上下文压缩与其他工具汇总；命令、文件、图像查看、智能体和动态调用并入其他工具，Skills/MCP 显示来源名
- 支持任务、今天、昨天、近 7 天和自定义区间消耗
- 直接读取 Magpie 的 Codex 实时请求数据，并把每日结果写入 TokenLens 自有本地账本；Magpie 不可用时优先读取账本
- 支持亮色、暗色主题切换
- 单文件外置脚本，无需重新构建 Codex++

## 吞吐量计算

TokenLens 只读取 Codex 本地事件与用量通知，不读取或上传会话正文。吞吐量按当前轮次计算，新轮次开始后重置。

### 实时速度

主速度优先衡量每次模型调用真正产出 token 的时间，不再把后续调用的 TTFT、工具执行和调用间空档算进分母：

```text
解码时长 = 每次调用从首个 token 到调用结束的时长
原始速度 = Σ 输出 token / (Σ 解码时长 / 1000)
显示速度     = min(原始速度, 400 tok/s)
```

- 每次调用的输出 token 与其解码时长成对结算；用量通知延迟不会把通知时间算进解码时长。
- 优先使用最近 3 秒内的有效调用；窗口为空时保持最后一个有效读数，空闲时不会把速度衰减成假值。
- 单次调用至少需要 `1000 ms` 解码时长和 `30` 个输出 token；更短的样本通常是供应商批量推送，不参与速度计算。
- 单次速率超过 `400 tok/s` 的样本静默排除，显示值仍按 `400 tok/s` 封顶。
- 当前轮尚无逐调用时间轴时，才回退到“轮次时长 - 首 token 等待 - 工具执行”的模型窗口。
- 历史回填轮次缺少完整起止时间时不伪造速度，显示 `-- tok/s`。

### 平均速度

平均速度不是逐调用速率的算术平均，而是对有效已结算调用做 token 加权：

```text
有效样本 = 单次解码时长 ≥ 1000 ms、输出 ≥ 30 token、速率 ≤ 400 tok/s
平均速度 = Σ 有效样本输出 token / (Σ 有效样本解码时长 / 1000)
```

- 输出更多、解码更久的调用按 token 量与时长自然获得更高权重。
- 用量通知晚于解码结束时，仍与刚结束的解码区间配对，通知延迟不计入解码时长。
- 短于 `1000 ms`、少于 `30` 个输出 token 或超过 `400 tok/s` 的样本视为批量推送或事件截断失真，不进入平均速度。
- 没有有效样本时显示 `--`，新增提示文字不会出现在状态栏。

只有当前轮尚无已结算调用时，才会用真实起止时间减去 TTFT 与工具耗时得到模型窗口；历史回填或工具覆盖整个窗口时，再退回按轮次墙钟计算的保守均速。这样轮次结束后不会因为宿主漏发 delta 而永久显示 `--`。

速度值大于等于 `10 tok/s` 时显示整数，小于 `10 tok/s` 时保留一位小数。页面热重载会清空当前轮的内存时间线，状态栏会在下一次模型或工具事件到达后恢复。

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

数据来自 Codex 本地事件、会话记录与每日消耗数据，不上传会话内容。检测到本机 Magpie 时，会通过 Codex++ 官方 HTTP fetch 服务只读请求 `http://127.0.0.1:3425/v1/magpie/usage/requests?period=7d&agent=codex&limit=1` 与 `http://127.0.0.1:3425/v1/magpie/usage/requests?period=today&agent=codex&limit=1`，当前任务再按 `q=<threadId>` 取同一 Codex 口径的累计；每 2 秒刷新任务、今天、昨天与近 7 天的明细和总量，旧版宿主才回退到 Electron bridge。TokenLens 不读取其他插件的缓存。汇总只统计 `codex` Agent，Token 合计为 `input + output + cache_read`，排除后台 `hindsight` 等非任务调用。页面刷新后，状态栏会在下一次模型或工具事件到达时恢复。覆盖不足时，消耗标签会显示可用天数。

### 每日账本

每次成功读取 Magpie 后，TokenLens 会把每个北京时间日期的 `input`、`cache_read`、`output`、总量和调用次数写入浏览器 `localStorage` 的 `tokenlens-daily-usage`。账本保留最近 60 天，同一天只增不减，避免某个回退源突然变小或清空历史。Magpie 暂时不可用、宿主升级导致 RPC 资源换名，或旧会话文件被系统清理时，插件直接使用自己的账本，不再扫描所有会话文件重新结算。只有清除 Codex++ 的站点数据或手动删除这个键时，账本才会丢失。

## 许可证

[MIT](LICENSE)
