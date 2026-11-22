<!-- FOR AI AGENTS - Human readability is a side effect, not a goal -->
<!-- Managed by agent: keep sections and order; edit content, not structure -->
<!-- Last updated: 2026-11-22 | Last verified: 2026-11-22 -->

# AGENTS.md

**Precedence:** the closest `AGENTS.md` to the files you are changing wins. This root file holds repo-wide rules.

## Project

TokenLens for Codex is a single-file JavaScript user script for the Codex++ renderer. It renders live throughput below the composer and a popover with cache, context, tool timing, per-call charts, TOP 3 output calls, round averages, theme switching and local usage totals.

- Runtime: Codex++ user-script environment (the `app://-/` renderer page).
- Language: browser JavaScript in one IIFE; no framework and no module build.
- Verification: Node.js 24 with the built-in `node:test` runner.
- Distribution: this standalone repository plus a separate script-market submission branch.

## Commands

| Task | Command |
|------|---------|
| Syntax check | `node --check tokenlens.js` |
| Test | `node --test tests/*.test.js` |
| Single test | `node --test tests/analytics.test.js` |
| Install (manual) | Copy `tokenlens.js` into `%APPDATA%\Codex++\user_scripts\`, then reload the extension |

There is no `package.json`, build, lint, format or dependency-install step. Do not invent one.

## File Map

| Path | Responsibility |
|------|----------------|
| `tokenlens.js` | Only source: UserScript header plus all rendering, event, history, analytics and theme logic |
| `artifacts/codex-plus-throughput-statusline.js` | Header-less distribution copy; must equal the body of `tokenlens.js` |
| `artifacts/codex-plus-throughput-preview.png` | UI preview used by the market entry |
| `tests/helpers.js` | Loads `tokenlens.js` and extracts named functions for focused tests |
| `tests/*.test.js` | Contract and calculation tests for history, live calls, ranking, chart scale, context, global usage, theme and artifact sync |
| `README.md` | Install steps and feature list |
| `preview.png` | Screenshot referenced by the README |
| `LICENSE` | MIT license |

## File Sync

`tokenlens.js` is the UserScript header (8 lines), one blank line, then the body starting at `/* Codex++ external extension:`. `artifacts/codex-plus-throughput-statusline.js` must be exactly that body.

After editing `tokenlens.js`:

1. Regenerate the artifacts copy from the `/* Codex++ external extension:` marker.
2. Keep only the header `@version` as the version source.
3. Run `node --test tests/artifact-sync.test.js` and keep the copy byte-for-byte equal to the body.
4. The market copy lives in `LingYingNX/CodexPlusPlusScriptMarket` on the active TokenLens submission branch; its `index.json` `version` and `sha256` must match the script.
5. The market script must be a byte-for-byte copy of the full `tokenlens.js`, including the `// ==UserScript==` header. Never publish the headerless artifacts copy.
6. Disclose every local or optional data source in the market `index.json` `requirements` / `limitations` and in the PR description. Missing local services need bounded connection retry backoff with test coverage; update the market SHA-256 last.
7. After pushing, confirm `https://raw.githubusercontent.com/LingYingNX/TokenLens-for-Codex/main/tokenlens.js` returns `200` with the full `// ==UserScript==` header and the intended `@version`. That root file is the only Codex++ install entry point.

The market branch is only a submission copy. Do not treat it as the source branch for this standalone plugin repository.

## Code Conventions

- One IIFE in one file. Do not split logic across modules; distribution requires a single file.
- Insert dynamic text with `textContent`. Never build `innerHTML` from session data.
- Read current-thread history through `window.codexPlus.call("/thread-usage-history", ...)`.
- Live ranges use TokenLens's own Codex-only Magpie requests below; never reuse another plugin's cached Magpie usage. The series request asks for Magpie's 30-day window so custom ranges can reach every day Magpie retains. `window.__codexDailyTokenUsage.getSnapshot(dateKey)` is only a fallback for dates outside that window.
- Add a usage data source only through the `codexPlusUsageDataSources()` descriptor table: URL templates plus a series/today/task parser each. Refresh probes sources in order, the first one returning snapshots wins, and multiple sources are never merged, so a second aggregator can be added without touching render or refresh logic.
- Do not read full rollout files directly through internal `workspaceFiles.read`.
- Usage deltas come from `last_token_usage`; history dedupe keys on the cumulative `contextUsed`.
- Throughput uses token-weighted settled per-call decode windows. The whole-turn window is only a fallback when no settled call timeline exists.
- The status-line setting comes from the host; theme preference persists under `tokenlens-theme`.
- Every node this script inserts must carry `data-codex-plus-ext`.
- Mark known limits with `shortcut: <limit>, <when to upgrade>`.

## Tests

- Tests extract named functions from the shipped `tokenlens.js`. If a function name or signature changes, update the matching `extract()` call.
- Usage changes must cover adjacent replay, out-of-order replay, normal growth, missing cumulative values and live per-call samples.
- Speed changes must cover per-call weighting, the 3-second recent window, `1000 ms` / `30` token rejection, the `400 tok/s` cap and `--` fallback.
- Chart changes must preserve scale thresholds, chronological ordering, the latest-200 render window and full-sample TOP ranking. The y-axis is derived from the newest 20 calls (`codexPlusUsageChartAxisWindow`), so an older burst of spikes cannot flatten the current bars; bars above the axis clamp at full height and keep their exact value in the tooltip.
- Chart axis changes must cover the newest-20 window (older spikes must not raise the axis), the small-sample max fallback and the bar height clamp (`tests/chart-scale.test.js`).
- Range-calendar changes must cover the month grid (Beijing day boundaries, leading blanks, leap month), month shifting, click-range extension and the `day has no usage` disabled state (`tests/calendar.test.js`).
- Source-seam changes must cover first-available-source wins, no request to later sources, per-source error reporting and one broken source not breaking the others (`tests/usage-sources.test.js`).
- Run `tests/artifact-sync.test.js` after any `tokenlens.js` edit.
- Market release checks must assert the full UserScript metadata header (`@version`, `@match`, `@run-at`), optional data-source disclosure and manifest SHA-256.
- There is no DOM-level automation. UI changes need manual verification in a running Codex++.

## Scoped AGENTS.md

<!-- AGENTS-GENERATED:START scope-index -->
No scoped `AGENTS.md` files exist. Add one when a directory gains its own rules.
<!-- AGENTS-GENERATED:END scope-index -->

## Boundaries

- Do not modify Codex++ itself; use only its public routes.
- The only allowed network calls are read-only `GET http://127.0.0.1:3425/v1/magpie/usage/requests?period=30d&agent=codex&limit=1`, `GET http://127.0.0.1:3425/v1/magpie/usage/requests?period=today&agent=codex&limit=1`, and the same 7-day request URL with `q=<threadId>` for the current task, through the Codex++ official HTTP fetch service (`appServices.httpFetch`), with the legacy Electron bridge only as an older-host fallback. No other network calls, no session uploads, no API-key access.
- Keep this standalone repository separate from the market submission branch.
- The repo root `tokenlens.js` is the Codex++ install entry point (`README.md` installs from its `main` raw URL). Never delete, rename, relocate or header-strip it, and never force-push or prune `main` in a way that drops it; a push that removes install-referenced files breaks installation even when the history still contains them.
- Before any push, run `git ls-tree -r origin/main --name-only` and confirm every install-referenced file still exists (`tokenlens.js`, `artifacts/codex-plus-throughput-statusline.js`, `artifacts/codex-plus-throughput-preview.png`, `preview.png`, `README.md`, `LICENSE`).
- Never publish the headerless artifact as the market script.
- Never commit a version bump, market hash and script content separately.
- Never change the UserScript `@version` or market `version` without explicit user approval.
- Pushing and releasing require explicit user approval.

## Known Limits

- Prefer the fresh Magpie session bucket for the current task total; the host `/thread-usage-history` route is only a fallback and reads a single rollout file per thread, so split segments and sub-agent sessions are not counted there.
- The daily usage API has finite retention. The UI shows `available/total` coverage when requested dates are missing.
- Magpie supplies 30 daily buckets and is the authoritative live source while fresh; older/custom dates fall back to the daily usage API. Magpie `cache_write` is not present in daily series and is not added to totals.
- The range calendar greys out and disables any day with no usage — a day with no data source coverage or zero tokens is not selectable, so a growing range that adds empty days keeps the same total on purpose.
- Magpie totals are filtered to the `codex` agent and match the Magpie Requests page's Codex view; other agents such as `hindsight` are excluded.
- The call chart renders at most the latest 200 calls; TOP 3 still ranks the complete merged sample set.
- In-memory state keeps at most 32 threads and 512 live call samples.
- Provider batches shorter than `1000 ms` or `30` output tokens are ignored for speed; the status line may briefly show `--` rather than a synthetic peak.
