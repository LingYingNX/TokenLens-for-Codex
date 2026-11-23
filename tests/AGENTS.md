<!-- FOR AI AGENTS - Human readability is a side effect, not a goal -->
<!-- Managed by agent: keep sections and order; edit content, not structure -->
<!-- Last updated: 2026-11-23 | Last verified: 2026-11-23 -->

# AGENTS.md — tests/

**Precedence:** the closest `AGENTS.md` wins. This file narrows the root rules for the test suite.

## Overview
Tests pin the contracts of `tokenlens.js` (rendering, events, history, analytics, theme) and of the standalone host,
without a browser: `helpers.js` extracts named functions from the single source file by text, and each `*.test.js`
exercises them under `node:test`. 147 tests, ~3 s.

## Key Files
| Path | Responsibility |
|------|----------------|
| `helpers.js` | Extracts named functions from `tokenlens.js`; the only seam between source and tests |
| `artifact-sync.test.js` | Pins `artifacts/codex-plus-throughput-statusline.js` to the body of `tokenlens.js` |
| `standalone-host.test.js` | Host contract: no-kill, no-self-launch, idempotent injection, per-session binding, windowless VBS, env-var names, UTF-8 BOM |
| `rollout-history.test.js` | Per-call usage reconstruction from rollout JSONL (fresh `mkdtempSync` per test) |
| `style-install.test.js`, `placement-grace.test.js` | Style survives a `loading` document; no flash on thread switches |
| `analytics`, `usage-sources`, `chart-scale`, `calendar`, `tool-categories`, … | Calculation and seam coverage |

## Setup & environment
- Node.js (host `v26.13.1`) with the built-in `node:test`; no `package.json`, no dependencies, nothing to install.
- Tests never touch a browser, a live Codex, the real `~/.codex` tree or the network: every path is a temp dir and every
  network seam is stubbed.

## Commands
| Task | Command |
|------|---------|
| Full suite | `node --test tests/*.test.js` |
| Single file | `node --test tests/analytics.test.js` |
| After a `tokenlens.js` edit | `node --test tests/artifact-sync.test.js` first, then the full suite |

## Conventions
- Tests extract named functions from `tokenlens.js`; if a name or signature changes, update the matching `extract()`.
- Usage changes cover adjacent/out-of-order replay, normal growth, missing cumulative values and live samples.
- Speed changes cover per-call weighting, the 3s window, `1000 ms`/`30` token rejection, the `400 tok/s` cap, `--`.
- Chart changes preserve scale thresholds, chronological order, the latest-200 window and full-sample TOP ranking; the y-axis follows the newest 20 calls (`codexPlusUsageChartAxisWindow`).
- Range-calendar changes cover the month grid (Beijing boundaries, leading blanks, leap month), month shifting, click-range extension and the disabled `day has no usage` state.
- Source-seam changes cover first-available-source-wins, no request to later sources, per-source errors, and one broken source not breaking the others.
- `placement-grace.test.js` pins the no-flash behaviour on thread switches.
- No DOM automation; DOM-level truth comes from `node standalone/tools/check.mjs` against a live Codex.

## Security
- Never point a test at the real session store, a real port or the real Magpie endpoint: fixtures are synthetic and local.
- Do not embed session text, thread titles or tokens in expectations; assert on shape and numbers.
- `mkdtempSync` dirs stay under the OS temp root and are removed by the test.

## Checklist
- [ ] `node --test tests/*.test.js` prints `pass` with `fail 0`.
- [ ] A new behaviour ships with the test that would fail without it; a fixed bug ships with the test that reproduces it.
- [ ] `extract()` calls match the current function names and signatures.
- [ ] Host or adapter edits also re-run `node standalone/tools/check.mjs` against a live Codex.

## Examples
```js
const { extract } = require("./helpers.js");
const fn = extract("codexPlusUsageSomething");   // text-level seam, not a module import
assert.equal(fn(input), expected);              // assert behaviour, not the implementation shape
```

## When stuck
- `extract()` returns `undefined`: the function was renamed, moved or wrapped — grep `tokenlens.js` for the new name and update the seam.
- A test passes alone but fails in the suite: shared module-level state in the source or a reused temp path; make each test own its fixture.
- `artifact-sync` fails after an edit: regenerate `artifacts/codex-plus-throughput-statusline.js` from the body marker; never hand-edit the copy.
