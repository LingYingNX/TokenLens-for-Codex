<!-- FOR AI AGENTS - Human readability is a side effect, not a goal -->
<!-- Managed by agent: keep sections and order; edit content, not structure -->
<!-- Last updated: 2026-11-23 | Last verified: 2026-11-23 -->

# AGENTS.md — standalone/

**Precedence:** the closest `AGENTS.md` wins. This file narrows the root rules for the CDP host only.

## Overview
The host attaches to the official Codex desktop renderer over CDP, injects `tokenlens.js` unchanged and serves the
two routes the official app lacks (`codexPlus.call`, `__codexSessionDeleteBridge`). It never launches or terminates
Codex: the user starts the app and the host waits for the debug port, attaches, and re-attaches after reloads.

## Key Files
| Path | Responsibility |
|------|----------------|
| `tokenlens-host.mjs` | Node host: waits for the debug port, attaches, injects over CDP, serves host routes |
| `tokenlens-host-adapter.js` | Renderer adapter supplying the host routes the official app lacks |
| `tokenlens-host.vbs` | Windowless launcher; `wscript` starts node with window style 0 |
| `rollout-history.mjs` | Rebuilds thread usage history from rollout files (per-call amounts) |
| `install.ps1` / `setup-env.ps1` | Install/uninstall the host; set/clear the env vars that open the port |
| `start-tokenlens.cmd` | Manual host start (delegates to the VBS) |
| `tools/check.mjs`, `tools/enter-thread.mjs` | Live end-to-end check (8 assertions); enter a thread so the status line renders |

## Setup & environment
- The debug port comes from `BUILD_FLAVOR=dev` + `CODEX_ELECTRON_CHROMIUM_SWITCHES` (`setup-env.ps1`). The app reads that variable only in the Dev flavor (`if (buildFlavor !== Dev || !a) return []`); values must be strings.
- Accepted cost (2026-11-23): Dev is absent from the updater whitelist `[Nightly, InternalAlpha, PublicBeta, Prod]`, so `enableUpdater=false`. Store updates still work. State this plainly; never hide it.
- Environment variables are read at process start, so a Codex already running before `setup-env.ps1` keeps running without the debug port until it is fully restarted.
- `*.ps1` here must be UTF-8 with BOM (PowerShell 5.1 reads BOM-less UTF-8 as ANSI, garbles Chinese and breaks quote pairing). `install.ps1` prefers `pwsh` over `powershell.exe`.

## Examples
Good — heal a half-injection instead of re-running the script:
```js
const state = await cdp.evaluate("({ runtime: !!window.__codexPlusThroughputStatusLineRuntime, style: !!globalThis.__codexPlusThroughputStatusLineStyleText })");
if (state.runtime && !state.style) injectStyleOnly(cdp);   // patch the style, keep the single listener set
else if (!state.runtime) injectAll(cdp);                    // first attach or after a reload
```
Bad — kill and relaunch Codex to force the port open:
```js
spawn(exe, ["--remote-debugging-port=9229"]);              // the host never launches Codex; and Codex.exe ignores switches
if (!(await waitPort(9229, 45_000))) stopAll("ChatGPT");   // this is the loop that made Codex "crash" in 2026-11-22
```

## Conventions
- Injection must be idempotent: check `window.__codexPlusThroughputStatusLineRuntime` **and** the style tag. A runtime without its style is a half-injection — patch the style, do not re-run the script (that adds a second listener set).
- `Runtime.addBinding` and `Page.addScriptToEvaluateOnNewDocument` are per CDP session; re-register on every reattach or the renderer loses the host bridge.
- Never let the scheduled task run `node.exe` directly — it leaves a console window. Go through `wscript.exe //B tokenlens-host.vbs`, which starts node with window style 0.
- Do not go back to command-line switches on the `chatgpt-desktop.exe` alias: AUMID activation (Start menu, taskbar, `codex://`) drops arguments, and mixing both entry points spawns a second instance (10 → 20 processes).
- `NODE_OPTIONS=--require` cannot patch the Electron main process: `EnableNodeOptionsEnvironmentVariable` is disabled.
- Do not overwrite `window.electronBridge`: it rejects raw fetches ("HTTP requests must use the HTTP fetch service.").

## Commands
| Task | Command |
|------|---------|
| Install host | `pwsh -ExecutionPolicy Bypass -File .\standalone\install.ps1` |
| Uninstall host | the same command with `-Uninstall` |
| Manual start | `standalone\start-tokenlens.cmd` |
| Live check | `node .\standalone\tools\check.mjs` (needs a running Codex with the debug port) |
| Enter a thread | `node .\standalone\tools\enter-thread.mjs` (the status line only renders there) |

## Security
- The debug port binds to `127.0.0.1` only. Never widen the address: CDP then admits any local same-user process, and `--remote-allow-origins` exists purely so the local page can connect.
- Rollout JSONL under `~/.codex/sessions` is read-only input (`rollout-history.mjs` only calls `readFile`/`readdir`/`stat`); the host never writes there and never opens the app database.
- No credentials, tokens or cookies are stored, logged or forwarded; `tokenlens-host.log` holds attach/route events only, and the log is gitignored.
- The only network traffic is the local CDP connection plus the script's own local Magpie GET; do not add endpoints, telemetry or updaters here.

## Checklist
- [ ] `node --check tokenlens.js` green and `node --test tests/*.test.js` green (host contract tests included).
- [ ] `node .\standalone\tools\check.mjs` 8/8 against a live Codex after any host or adapter edit.
- [ ] No new kill/launch path: `tests/standalone-host.test.js` still asserts no-kill and no-self-launch.
- [ ] `.ps1` files still carry the BOM; `.vbs` stays BOM-less UTF-8 with CRLF.

## When stuck
- Port refuses connections: Codex started before `setup-env.ps1`, or the app is not in the Dev flavor — restart Codex fully, then re-run `check.mjs`.
- Status line shows bare stacked text: half-injection (runtime without style); reconnect so the host patches the style, do not re-run the script.
- Routes answer `{"error":"standalone: 宿主桥接未就绪"}`: the per-session binding was lost on reattach; the host must re-register on every connection.
- Everything 404s after an app update: re-read `app.asar` asset names; hashed bundles move, the webpack module id `GaA7` may change.
