<!-- FOR AI AGENTS - Human readability is a side effect, not a goal -->
<!-- Managed by agent: keep sections and order; edit content, not structure -->
<!-- Last updated: 2026-11-23 | Last verified: 2026-11-23 -->

# AGENTS.md

**Precedence:** the closest `AGENTS.md` to the files you are changing wins. This root file holds repo-wide rules.

## Project

TokenLens for Codex: a single-file user script rendering live throughput below the Codex composer, plus a popover
with cache, context, tool timing, per-call charts, TOP 3 output calls, round averages, theme and local usage totals.

| Fact | Value |
|---|---|
| Runtime | browser JS in one IIFE on `app://-/` |
| Language | plain JavaScript; no build, modules or dependencies |
| Verification | Node.js (host `v26.13.1`) + built-in `node:test` |
| Distribution | this repo + `standalone/` host; the market copy lives on a separate branch |

The Codex++ user-script host was deleted on 2026-10-22. `standalone/` injects the same `tokenlens.js` into the
official Codex desktop app over CDP; the script stays host-agnostic and `standalone/tokenlens-host-adapter.js`
supplies only the two routes the official app lacks (`codexPlus.call`, `__codexSessionDeleteBridge`).

## Commands

| Task | Command |
|------|---------|
| Syntax check | `node --check tokenlens.js` |
| Test (full) | `node --test tests/*.test.js` |
| Test (single) | `node --test tests/analytics.test.js` |
| Install host (official Codex) | `pwsh -ExecutionPolicy Bypass -File .\standalone\install.ps1` |
| Uninstall host | the same command with `-Uninstall` |
| Live check | `node .\standalone\tools\check.mjs` (needs a running Codex with the debug port) |
| Enter a thread | `node .\standalone\tools\enter-thread.mjs` (the status line only renders there) |

There is no `package.json`, build, lint, format or dependency-install step. Do not invent one.

## File Map

| Path | Responsibility |
|------|----------------|
| `tokenlens.js` | Only source: UserScript header + all rendering, event, history, analytics, theme logic |
| `artifacts/codex-plus-throughput-statusline.js` | Header-less distribution copy; must equal the body of `tokenlens.js` |
| `standalone/tokenlens-host.mjs` | Node host: waits for the debug port, attaches, injects over CDP, serves host routes |
| `standalone/tokenlens-host-adapter.js` | Renderer adapter supplying the host routes the official app lacks |
| `standalone/tokenlens-host.vbs` | Windowless launcher; `wscript` starts node with window style 0 |
| `standalone/rollout-history.mjs` | Rebuilds thread usage history from rollout files (per-call amounts) |
| `standalone/install.ps1` / `setup-env.ps1` | Install/uninstall the host; set/clear the env vars that open the port |
| `standalone/start-tokenlens.cmd` | Manual host start (delegates to the VBS) |
| `standalone/tools/check.mjs` | End-to-end check against a live Codex (8 assertions) |
| `tests/helpers.js`, `tests/*.test.js` | Contract and calculation tests; `helpers.js` extracts functions from `tokenlens.js` |

## File Sync

`tokenlens.js` is the 8-line UserScript header, one blank line, then the body starting at `/* Codex++ external extension:`.
After editing it:

1. Regenerate `artifacts/codex-plus-throughput-statusline.js` from that marker (byte-identical body).
2. Keep the header `@version` as the only version source.
3. Run `node --test tests/artifact-sync.test.js`, then the full suite before committing.
4. The market copy in `LingYingNX/CodexPlusPlusScriptMarket` must match the **full** `tokenlens.js` (header included)
   in both `index.json` `version` and `sha256`; never publish the header-less copy.

## Code Conventions

- One IIFE in one file; distribution requires a single file, so do not split into modules.
- Insert dynamic text with `textContent`. Never build `innerHTML` from session data.
- Read current-thread history through `window.codexPlus.call("/thread-usage-history", ...)`.
- Only allowed network calls: TokenLens-own Magpie `GET`s under `http://127.0.0.1:3425/v1/magpie/usage/requests` (`period=30d|today`, plus `7d&q=<threadId>`) via the official `appServices.httpFetch`; never reuse another plugin's cache.
- Add a usage source only through `codexPlusUsageDataSources()`; the first source returning snapshots wins and sources are never merged.
- Usage deltas use the `last` bucket of `thread/tokenUsage/updated`; history dedupe keys on cumulative `contextUsed`.
- History rows carry **per-call** amounts: `token_usage_record.usage` is per call, `thread_token_usage` is cumulative and belongs in `contextUsed` only. Passing cumulative totals as per-call amounts makes TOP 3 show thread-wide sums.
- The context window lives in `token_count.info.model_context_window` and can appear after the matching usage record, so read it in a separate pass.
- `/thread-usage-live` reports the **per-call** token count as context usage; the cumulative total pins occupancy at 100%.
- Throughput uses token-weighted settled per-call decode windows (whole-turn only as fallback); batches under `1000 ms` or `30` output tokens are ignored; cap is `400 tok/s`.
- `data-codex-plus-ext` marks this script's own DOM so `codexPlusUsageObserve` skips its mutations.
- `codexPlusUsageInstallStyle()` must not assume `document.head` exists: under `Page.addScriptToEvaluateOnNewDocument` the script runs while `readyState === "loading"`, so `document.head?.appendChild` silently fails and the status line degrades to stacked bare text. Install on `DOMContentLoaded` and expose the style text so the host can heal a half-injected page.
- Placement uses a grace period (`codexPlusUsagePlacementGraceMs`): switching threads rebuilds the composer, so hiding on the first missing `card`/`threadId` makes the status line flash; stay visible and re-probe fast (`codexPlusUsagePlacementProbeMs`).
- The status line renders only on thread pages; hiding it on the home page is intended (2026-11-23). Do not "fix" it by showing the last thread's usage.
- Mark known limits with `shortcut: <limit>, <when to upgrade>`.

## Boundaries

- Do not modify Codex++ itself; the standalone host uses only official surfaces.
- Keep this repository separate from the market submission branch.
- The repo root `tokenlens.js` is the Codex++ install entry point (README installs from its `main` raw URL). Never delete, rename, relocate or header-strip it, and never force-push `main` in a way that drops it.
- Before any push run `git ls-tree -r origin/main --name-only` and confirm every install-referenced file exists: `tokenlens.js`, `artifacts/codex-plus-throughput-statusline.js`, `artifacts/codex-plus-throughput-preview.png`, `preview.png`, `README.md`, `LICENSE`.
- Never change the UserScript `@version` or market `version` without explicit user approval.
- Pushing and releasing require explicit user approval.

## Known Limits

- `/thread-usage-history` reads rollout files per thread, so split segments and sub-agent sessions are not counted.
- Magpie is optional and local (`http://127.0.0.1:3425`); without it the usage area is empty.
- Daily usage has finite retention; the UI shows `available/total` coverage when dates are missing.
- The range calendar disables days with no usage on purpose, so a growing range keeps the same total.
- Magpie totals are filtered to the `codex` agent; `cache_write` is not part of the daily series.
- The call chart renders at most the latest 200 calls; TOP 3 ranks the complete merged sample set.
- In-memory state keeps at most 32 threads and 512 live call samples.
- Environment variables are read at process start, so a Codex already running before `setup-env.ps1` keeps running without the debug port until it is fully restarted.

## Index of scoped AGENTS.md
<!-- AGENTS-GENERATED:START scope-index -->
- `./standalone/AGENTS.md` — CDP host: attach, inject, host routes, scheduled task, security, troubleshooting
- `./tests/AGENTS.md` — contract tests: extraction seam, coverage map, artifact sync, live check
<!-- AGENTS-GENERATED:END scope-index -->
