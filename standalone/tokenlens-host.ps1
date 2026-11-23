# TokenLens standalone host: 启动/连接 Codex 的调试端口，注入插件并常驻。
[CmdletBinding()]
param(
  [int]$Port = 9229,
  [int]$PollMs = 40,
  [switch]$Restart,
  [switch]$NoLaunch
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSCommandPath
$repo = Split-Path -Parent $root
$pluginPath = Join-Path $repo "tokenlens.js"
$shimPath = Join-Path $root "tokenlens-shim.js"
$logPath = Join-Path $root "tokenlens-host.log"
$sessionsRoot = Join-Path $env:USERPROFILE ".codex\sessions"

function Write-Log([string]$message) {
  $line = "[{0}] {1}" -f (Get-Date).ToString("yyyy-MM-dd HH:mm:ss"), $message
  Write-Host $line
  try { Add-Content -LiteralPath $logPath -Value $line -Encoding UTF8 } catch { }
}

function Get-CodexExe {
  $pkg = Get-AppxPackage -Name "OpenAI.Codex" -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($pkg) {
    $candidate = Join-Path $pkg.InstallLocation "app\Codex.exe"
    if (Test-Path -LiteralPath $candidate) { return $candidate }
  }
  $cmd = Get-Command "Codex.exe" -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }
  return $null
}

function Test-Port {
  $client = New-Object System.Net.Sockets.TcpClient
  try {
    $task = $client.ConnectAsync("127.0.0.1", $Port)
    if (-not $task.Wait(400)) { return $false }
    return $client.Connected
  } catch {
    return $false
  } finally {
    $client.Dispose()
  }
}

function Stop-Codex {
  Get-Process -Name "Codex", "ChatGPT" -ErrorAction SilentlyContinue | ForEach-Object {
    Write-Log ("stop {0} ({1})" -f $_.ProcessName, $_.Id)
    try { $_.CloseMainWindow() | Out-Null } catch { }
  }
  Start-Sleep -Milliseconds 1200
  Get-Process -Name "Codex", "ChatGPT" -ErrorAction SilentlyContinue | ForEach-Object {
    try { Stop-Process -Id $_.Id -Force } catch { }
  }
  Start-Sleep -Milliseconds 800
}

function Start-Codex {
  $exe = Get-CodexExe
  if (-not $exe) { throw "找不到 Codex.exe（Get-AppxPackage OpenAI.Codex 为空）" }
  $launchArgs = @("--remote-debugging-port=$Port")
  Write-Log ("launch {0} {1}" -f $exe, ($launchArgs -join " "))
  Start-Process -FilePath $exe -ArgumentList $launchArgs | Out-Null
}

function Wait-CodexPort {
  $deadline = (Get-Date).AddSeconds(45)
  while ((Get-Date) -lt $deadline) {
    if (Test-Port) { return $true }
    Start-Sleep -Milliseconds 500
  }
  return $false
}

function Get-PageTarget {
  try {
    $targets = Invoke-RestMethod -Uri ("http://127.0.0.1:{0}/json/list" -f $Port) -TimeoutSec 5
  } catch {
    return $null
  }
  return $targets | Where-Object { $_.type -eq "page" -and $_.url -like "app://-*" } | Select-Object -First 1
}

$script:ws = $null
$script:nextId = 0
$script:bindings = New-Object System.Collections.Queue
$script:shim = [IO.File]::ReadAllText($shimPath, [Text.Encoding]::UTF8)
$script:plugin = [IO.File]::ReadAllText($pluginPath, [Text.Encoding]::UTF8)

function Receive-Cdp([int]$timeoutMs) {
  if ($null -eq $script:ws) { return $null }
  $buffer = New-Object byte[] 262144
  $segment = New-Object "System.ArraySegment[byte]" -ArgumentList @(, $buffer)
  $cts = New-Object System.Threading.CancellationTokenSource
  $cts.CancelAfter($timeoutMs)
  try {
    $task = $script:ws.ReceiveAsync($segment, $cts.Token)
    if (-not $task.Wait($timeoutMs)) { return $null }
    $result = $task.Result
  } catch {
    return $null
  } finally {
    $cts.Dispose()
  }
  if ($result.MessageType -eq [System.Net.WebSockets.WebSocketMessageType]::Close) { throw "CDP 连接已关闭" }
  $text = [Text.Encoding]::UTF8.GetString($buffer, 0, $result.Count)
  while (-not $result.EndOfMessage) {
    $cts2 = New-Object System.Threading.CancellationTokenSource
    $cts2.CancelAfter(5000)
    $more = $script:ws.ReceiveAsync($segment, $cts2.Token).Result
    $cts2.Dispose()
    $text += [Text.Encoding]::UTF8.GetString($buffer, 0, $more.Count)
    $result = $more
  }
  if (-not $text.Trim()) { return $null }
  return $text | ConvertFrom-Json
}

function Send-Cdp([string]$method, $params) {
  $script:nextId += 1
  $id = $script:nextId
  $payload = @{ id = $id; method = $method }
  if ($null -ne $params) { $payload.params = $params }
  $json = ConvertTo-Json -InputObject $payload -Compress -Depth 32
  $bytes = [Text.Encoding]::UTF8.GetBytes($json)
  $segment = New-Object "System.ArraySegment[byte]" -ArgumentList @(, $bytes)
  $script:ws.SendAsync($segment, [System.Net.WebSockets.WebSocketMessageType]::Text, $true, [Threading.CancellationToken]::None).Wait()
  return $id
}

function Invoke-Cdp([string]$method, $params, [int]$timeoutMs = 15000) {
  $id = Send-Cdp $method $params
  $deadline = (Get-Date).AddMilliseconds($timeoutMs)
  while ((Get-Date) -lt $deadline) {
    $message = Receive-Cdp 200
    if ($null -eq $message) { continue }
    if ($message.id -eq $id) {
      if ($message.error) { throw ("{0}: {1}" -f $method, ($message.error.message)) }
      return $message.result
    }
    if ($message.method) { Handle-CdpEvent $message }
  }
  throw ("CDP 超时: " + $method)
}

function Send-PageEvent([string]$method, $params) {
  $envelope = @{ method = $method; params = $params } | ConvertTo-Json -Compress -Depth 32
  $expression = "window.postMessage(" + $envelope + ", '*');"
  Invoke-Cdp "Runtime.evaluate" @{ expression = $expression; returnByValue = $true } | Out-Null
}

function Invoke-HttpBridge([string]$rawPayload) {
  $request = $rawPayload | ConvertFrom-Json
  $status = 502
  $body = '{"error":"bridge failure"}'
  try {
    $response = Invoke-WebRequest -UseBasicParsing -Uri $request.url -Method $request.method -TimeoutSec 20
    $status = [int]$response.StatusCode
    $body = [string]$response.Content
  } catch {
    $status = 502
    $body = '{"error":' + (ConvertTo-Json -InputObject ([string]$_.Exception.Message) -Compress) + '}'
  }
  $idLiteral = ConvertTo-Json -InputObject ([string]$request.id) -Compress
  $bodyLiteral = ConvertTo-Json -InputObject $body -Compress
  $expression = "window.__tokenlensHttpResult($idLiteral, $status, $bodyLiteral);"
  Invoke-Cdp "Runtime.evaluate" @{ expression = $expression; returnByValue = $true } | Out-Null
}

function Get-HistoryRows([string]$threadId) {
  $rows = New-Object System.Collections.ArrayList
  if (-not $threadId) { return $rows }
  $file = Get-ChildItem -LiteralPath $sessionsRoot -Recurse -File -Filter ("*" + $threadId + ".jsonl") -ErrorAction SilentlyContinue | Select-Object -First 1
  if (-not $file) { return $rows }
  foreach ($line in [IO.File]::ReadLines($file.FullName, [Text.Encoding]::UTF8)) {
    if ($line.IndexOf('"token_count"') -lt 0) { continue }
    try { $entry = $line | ConvertFrom-Json } catch { continue }
    $payload = $entry.payload
    if ($null -eq $payload -or $payload.type -ne "token_count") { continue }
    $info = $payload.info
    if ($null -eq $info -or $null -eq $info.total_token_usage) { continue }
    $total = $info.total_token_usage
    $rows.Add(@{
      turn_id = [string]$payload.turn_id
      observed_at = [string]$entry.timestamp
      usage = @{
        input_tokens = [int64]$total.input_tokens
        cached_input_tokens = [int64]$total.cached_input_tokens
        output_tokens = [int64]$total.output_tokens
        total_tokens = [int64]$total.total_tokens
        context_used = [int64]$total.total_tokens
        context_limit = [int64]$info.model_context_window
      }
    }) | Out-Null
    if ($rows.Count -ge 2000) { break }
  }
  return $rows
}

function Invoke-RpcBridge([string]$rawPayload) {
  $request = $rawPayload | ConvertFrom-Json
  $ok = $true
  $result = $null
  switch ($request.route) {
    "/settings/get" { $result = @{ codexAppUsageStatusLine = $true } }
    "/thread-usage-history" {
      $threadId = [string]$request.args.session_id
      $result = @{ history = @(Get-HistoryRows $threadId) }
    }
    default { $ok = $false; $result = ("standalone: 不支持的宿主路由 " + $request.route) }
  }
  $idLiteral = ConvertTo-Json -InputObject ([string]$request.id) -Compress
  $payloadLiteral = ConvertTo-Json -InputObject $result -Compress -Depth 12
  $flag = if ($ok) { "true" } else { "false" }
  $expression = "window.__tokenlensCallResult($idLiteral, $flag, $payloadLiteral);"
  Invoke-Cdp "Runtime.evaluate" @{ expression = $expression; returnByValue = $true } | Out-Null
}

function Handle-CdpEvent($message) {
  if ($message.method -eq "Runtime.bindingCalled") {
    $script:bindings.Enqueue($message.params)
  } elseif ($message.method -eq "Runtime.executionContextCreated") {
    # 新的执行上下文（页面重载）会重新执行 addScriptToEvaluateOnNewDocument。
  }
}

function Drain-Bindings {
  while ($script:bindings.Count -gt 0) {
    $call = $script:bindings.Dequeue()
    try {
      switch ($call.name) {
        "__tokenlensHttp" { Invoke-HttpBridge $call.payload }
        "__tokenlensCall" { Invoke-RpcBridge $call.payload }
      }
    } catch {
      Write-Log ("binding error: " + $_.Exception.Message)
    }
  }
}

function Connect-Cdp($target) {
  $socket = New-Object System.Net.WebSockets.ClientWebSocket
  $socket.ConnectAsync([Uri]$target.webSocketDebuggerUrl, [Threading.CancellationToken]::None).Wait()
  $script:ws = $socket
}

function Initialize-Plugin {
  Invoke-Cdp "Runtime.enable" @{} | Out-Null
  Invoke-Cdp "Page.enable" @{} | Out-Null
  Invoke-Cdp "Runtime.addBinding" @{ name = "__tokenlensHttp" } | Out-Null
  Invoke-Cdp "Runtime.addBinding" @{ name = "__tokenlensCall" } | Out-Null
  $source = $script:shim + "`n" + $script:plugin
  Invoke-Cdp "Page.addScriptToEvaluateOnNewDocument" @{ source = $source } | Out-Null
  Invoke-Cdp "Runtime.evaluate" @{ expression = $source; returnByValue = $true } | Out-Null
  Write-Log "plugin injected"
}

function Get-EventThreadId([string]$filePath) {
  $match = [regex]::Match($filePath, "([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$")
  if ($match.Success) { return $match.Groups[1].Value }
  return ""
}

function ConvertTo-Ms([string]$timestamp) {
  try { return [int64]([datetime]::Parse($timestamp, [Globalization.CultureInfo]::InvariantCulture, [Globalization.DateTimeStyles]::AdjustToUniversal).ToUniversalTime() - [datetime]::new(1970, 1, 1, 0, 0, 0, [DateTimeKind]::Utc)).TotalMilliseconds } catch { return [int64]0 }
}

function Handle-RolloutLine([string]$line, [string]$threadId) {
  if ($line.IndexOf('"type":"event_msg"') -lt 0) { return }
  if (-not $threadId) { return }
  try { $entry = $line | ConvertFrom-Json } catch { return }
  $payload = $entry.payload
  if ($null -eq $payload) { return }
  $turnId = [string]$payload.turn_id
  if (-not $turnId) { $turnId = [string]$payload.turnId }
  $ms = ConvertTo-Ms ([string]$entry.timestamp)
  switch ($payload.type) {
    "task_started" {
      Send-PageEvent "turn/started" @{ threadId = $threadId; turnId = $turnId; turn = @{ id = $turnId; startedAt = ($ms / 1000) } }
    }
    "task_complete" {
      Send-PageEvent "turn/completed" @{ threadId = $threadId; turnId = $turnId; turn = @{ id = $turnId; status = "completed"; completedAt = ($ms / 1000) } }
    }
    "token_count" {
      $info = $payload.info
      if ($null -eq $info -or $null -eq $info.total_token_usage) { return }
      Send-PageEvent "thread/tokenUsage/updated" @{
        threadId = $threadId
        turnId = $turnId
        tokenUsage = @{
          total = $info.total_token_usage
          last = $info.last_token_usage
          modelContextWindow = $info.model_context_window
        }
      }
      # 下一次调用先记一个解码起点，让下一次 token_count 结算出窗口速度。
      Send-PageEvent "item/agentMessage/delta" @{ threadId = $threadId; turnId = $turnId; delta = "x" }
    }
    "item_completed" {
      $item = $payload.item
      if ($null -eq $item) { return }
      $started = $payload.started_at_ms
      $completed = $payload.completed_at_ms
      $duration = $null
      if ($null -ne $started -and $null -ne $completed) { $duration = [int64]$completed - [int64]$started }
      Send-PageEvent "item/completed" @{
        threadId = $threadId
        turnId = $turnId
        item = @{ id = [string]$item.id; type = [string]$item.type; durationMs = $duration }
      }
    }
  }
}

function Watch-Rollout {
  $currentFile = $null
  $stream = $null
  $decoder = [Text.UTF8Encoding]::new($false).GetDecoder()
  $pending = ""
  $buffer = New-Object byte[] 65536
  $chars = New-Object char[] 65536
  while ($true) {
    $newest = Get-ChildItem -LiteralPath $sessionsRoot -Recurse -File -Filter "*.jsonl" -ErrorAction SilentlyContinue |
      Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if ($newest -and ($null -eq $currentFile -or $newest.FullName -ne $currentFile)) {
      if ($stream) { $stream.Dispose() }
      $currentFile = $newest.FullName
      $stream = [IO.File]::Open($currentFile, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::ReadWrite)
      $stream.Seek(0, [IO.SeekOrigin]::End) | Out-Null
      $pending = ""
      Write-Log ("tail " + $currentFile)
      $script:currentThread = Get-EventThreadId $currentFile
    }
    if (-not $stream) { Start-Sleep -Milliseconds 500; continue }
    $read = $stream.Read($buffer, 0, $buffer.Length)
    if ($read -gt 0) {
      $count = $decoder.GetChars($buffer, 0, $read, $chars, 0)
      $pending += [string]::new($chars, 0, $count)
      while (($index = $pending.IndexOf("`n")) -ge 0) {
        $line = $pending.Substring(0, $index).TrimEnd("`r")
        $pending = $pending.Substring($index + 1)
        if ($line) { try { Handle-RolloutLine $line $script:currentThread } catch { Write-Log ("line error: " + $_.Exception.Message) } }
      }
    } else {
      $message = Receive-Cdp $PollMs
      if ($null -ne $message) {
        if ($message.method) { Handle-CdpEvent $message }
      }
      Drain-Bindings
    }
    if ($script:ws.State -ne [System.Net.WebSockets.WebSocketState]::Open) { throw "CDP 连接断开" }
  }
}

Write-Log "TokenLens standalone host starting (port $Port)"
while ($true) {
  try {
    if (-not (Test-Port)) {
      if ($NoLaunch) { throw "调试端口未开启，且指定了 -NoLaunch" }
      if (Get-Process -Name "Codex" -ErrorAction SilentlyContinue) {
        if (-not $Restart) {
          throw "Codex 已在运行但没有调试端口。请用 -Restart 重启，或直接用 start-tokenlens.cmd 启动。"
        }
        Stop-Codex
      }
      Start-Codex
      if (-not (Wait-CodexPort)) { throw "Codex 调试端口未就绪" }
    }
    $target = Get-PageTarget
    if (-not $target) { Start-Sleep -Milliseconds 500; continue }
    Connect-Cdp $target
    Write-Log ("attached " + $target.url)
    Initialize-Plugin
    Watch-Rollout
  } catch {
    Write-Log ("host error: " + $_.Exception.Message)
    if ($script:ws) { try { $script:ws.Dispose() } catch { } ; $script:ws = $null }
    Start-Sleep -Seconds 2
  }
}