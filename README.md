# TokenLens for Codex

在 Codex++ 底栏显示实时 `tok/s`，悬停查看本轮吞吐、工具分类、Token 与缓存，以及 Codex 会话的累计消耗。

![TokenLens for Codex](preview.png)  <img width="317" height="63" alt="image" src="https://github.com/user-attachments/assets/17839c8b-4598-4f0f-83bd-a196938642f4" />



## 功能

- 底栏显示实时 `tok/s` 和缓存命中
- 查看上下文占用、输入、输出、缓存读取与缓存命中
- 查看单次调用柱状图、最近调用与单次最大输出 TOP 3
- 显示本轮平均速度、调用次数与轮数
- 工具执行按记忆库、Skills、MCP、Hook、命令执行等类别汇总
- 支持任务、今天、昨天、近 7 天和自定义区间消耗
- 支持亮色、暗色主题切换
- 单文件外置脚本，无需重新构建 Codex++

## 吞吐量计算

TokenLens 只读取 Codex 本地事件与用量通知，不读取或上传会话正文。吞吐量按当前轮次计算，新轮次开始后重置。

### 实时速度

主速度衡量模型真正产出 token 的时间，不把首 token 等待和工具执行算进分母：

```text
模型窗口时长 = 本轮已用时长 - 首 token 等待时长 - 工具执行时长
原始速度     = 本轮输出 token / (模型窗口时长 / 1000)
显示速度     = min(原始速度, 400 tok/s)
```

- 首 token 等待从本轮开始计到第一个非空助手或推理增量。
- 工具执行时长按所有工具区间的并集计算，重叠区间不会重复扣除；进行中的工具也会实时扣除。
- 宿主提供工具实测时长时优先使用该时长，否则使用本地事件起点。
- 已知模型真实峰值约为 `400 tok/s`。统计窗口被工具事件截得过短时会得到异常大的除数，因此显示值统一按 `400 tok/s` 封顶。
- 缺少可用解码窗口时，回退到已结算调用的输出 token 与解码时长。
- 历史回填轮次缺少事件时间轴时不伪造速度，显示 `-- tok/s`。

### 平均速度

平均速度不是“总 token 除以整轮耗时”，而是对每次已结算调用的吞吐速率做去极值平均：

```text
单次速率 = 单次输出 token / (单次解码时长 / 1000)
有效样本 = 单次速率不超过 400 tok/s
平均速度 = 有效样本超过 2 个时，去掉一个最高值和一个最低值后取算术平均
```

- 只有输出 token 与解码时长都有效的调用才进入样本。
- 用量通知晚于解码结束时，仍与刚结束的解码区间配对，通知延迟不计入解码时长。
- 超过 `400 tok/s` 的样本视为事件截断产生的失真值，不进入平均速度。
- 有效样本不超过 2 个时直接取这些样本的算术平均；没有有效样本时显示 `--`。

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

数据来自 Codex 本地事件、会话记录与每日消耗数据，不上传会话内容。页面刷新后，状态栏会在下一次模型或工具事件到达时恢复。跨会话历史以每日数据源实际保留的日期为准；覆盖不足时，消耗标签会显示可用天数。

## 许可证

[MIT](LICENSE)
