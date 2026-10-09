# Stela — clean Pi-fork handoff

## Start here

The fork decision is made. This workspace is the source checkout for
[orokino/stela](https://github.com/orokino/stela), a public GitHub fork of
[earendil-works/pi](https://github.com/earendil-works/pi). Begin the next session from this fork,
then reverse engineer selected capabilities and implement them cleanly. Do not restart the
prototype eval or automatically port `claudeish-pi`.

The Claude-compatible prototype is **only a proof of concept**. Preserve its findings and evidence
privately for later use; it is not Stela's implementation or a dependency to inline into this fork.
No recovered proprietary code, prompts, strings, or assets have been added to the fork's tracked files.

## Baseline

- Forked upstream `main` at `6fb2e7815167e6b19006fc526d1a5d0f5f998787`
  (`fix: support npm 12 pack JSON output (#10680)`). The coding-agent package is **1.1.0**;
  this is upstream main, not the `v1.1.0` release-tag checkout.
- Branch: `main`. `origin`: `git@github.com:orokino/stela.git`.
  `upstream`: `https://github.com/earendil-works/pi.git`. Upstream history, MIT license, and
  attribution are retained. Keep a small, ordered Stela patch stack.
- The first runtime cutover provides a Node-based `stela` command and isolated default
  `~/.stela/agent` state. Internal package names and persistence formats remain upstream.
  No Stela theme or self-contained native binary release exists yet.
- Entry points: `packages/coding-agent/` (CLI, tools, session integration, docs),
  `packages/agent/` (agent runtime), `packages/ai/` (providers/model data),
  `packages/tui/` (terminal UI). `./stela` launches the regular CLI from source.
  `node scripts/install-stela.mjs` installs its checkout link at `~/.local/bin/stela`.
  `./pi-test.sh` retains the experimental source entry; a plain `pi` command launches
  the separate globally installed upstream package.

## Agreed direction

Stela is a model-agnostic coding agent: CLI/TUI first, desktop GUI later. Select the best behavior
from the studied harnesses, rather than reproducing an entire upstream personality.
**No runtime personas:** one behavior per capability, with source, rationale, and rejected alternatives
recorded; adjudicate conflicts once in writing.

The fork is for ownership of the runtime and UI, not a startup-speed claim. Intended packaging is
one native executable with its own `~/.stela/agent` state. The Node-based command is the
first step, not the native package. Keep inherited persistence initially; defer a Stela
SQLite migration, the desktop GUI, and the seven-target reverse-engineering sweep.

Subagent preference: **`gpt-6-luna`**. Select it when the orchestration interface supports a model
override; otherwise disclose the limitation rather than silently substituting another model.

### Frozen visual tokens — shared by eventual TUI and GUI

Near-black canvas; greyscale carries structure; color is rationed to action and status.

```text
surface-0 #0B0B0C   surface-1 #111114   surface-2 #17171B   hairline #26262C (1px, no glow)
fg #E8E8EA   muted #9A9AA2   dim #6A6A73
accent.base #6E76FF   hover #858DFF   pressed #5860E8   border #5157A8   ghost #181A30 + 1px accent bar
on-accent #0B0B0C            (white on #6E76FF is 3.7:1 and fails AA)
status: success #3FB950   warning #D29922   error #F85149   diff-add #2EA043   diff-del #DA3633
focus ring: 1px accent + 1px #0B0B0C separator (mandatory inside diff rows), no halo
rule: accent for ACTIONS only (caret, active tool, focus ring, primary button); status colours only for state
```

Aster Iris base has 5.34:1 contrast on the canvas. `accent.ghost` is not enough by itself:
use its accent bar or reverse video. Terminal fallback: ANSI 69 base, 60 border;
truecolor only when `$COLORTERM` indicates `truecolor` or `24bit`.

## Verified checkout setup

Dependencies installed with `npm ci --ignore-scripts --no-audit --no-fund` on Node 22.23.2 / npm 12.0.2.
A fresh checkout lacks `packages/ai/src/providers/data/.manifest.json`; it must hydrate model data
before the source launcher can run. The smoke used the immutable catalog pinned by
`nix/model-catalog.json`, verified its SHA-256, then ran the existing catalog hydrator.
No source or dependency-lock change was needed.

Reproduce the same setup from the repository root:

```bash
npm ci --ignore-scripts --no-audit --no-fund
mkdir -p .artifacts/stela-bootstrap
curl -fL 'https://pi.dev/api/models/revisions/sha256-439c53478c84ed27a58f8b54e1c3bd45810e5a969515b4e3666a3898d51ee22f?types=chat,image,classifier' \
  -o .artifacts/stela-bootstrap/models.all.json
printf '%s  %s\n' '439c53478c84ed27a58f8b54e1c3bd45810e5a969515b4e3666a3898d51ee22f' \
  '.artifacts/stela-bootstrap/models.all.json' | sha256sum -c -
node packages/ai/scripts/hydrate-model-catalog.ts .artifacts/stela-bootstrap/models.all.json
npm run check:model-data
./stela --version
./stela --help
```

Original baseline verification, before the identity cutover: model-data check passed; source version printed `1.1.0`; help printed successfully.
An offline RPC smoke with a temporary `PI_CODING_AGENT_DIR`, `--no-session`, disabled discovery,
and no project approval passed `get_state` → real `bash` execution of `printf stela-fork-smoke` →
updated context (`messageCount=1`) → orderly stdin-close shutdown. No model call or personal-state
migration was performed. Local smoke output: `.artifacts/stela-bootstrap/rpc-smoke.json`.
No standalone build, full test suite, or interactive TUI verification was performed in this setup session.

Known upstream setup warnings: Gondolin's example dependency wants Node >=23.6.0; autoevals asks for
pnpm. npm installation completed despite those engine warnings. Experimental source tooling emits
Node's experimental SQLite warning; the regular `stela` source entry avoids loading that experimental
server path at startup. Do not suppress or reinterpret the warning as a new Stela persistence implementation.

## Stela CLI cutover — verified

- Installed `~/.local/bin/stela` as a checkout link. The launcher preserves arguments, the caller's
  working directory, exit codes, and termination signals. Reinstallation is idempotent; unrelated
  executables and dangling symlinks are not overwritten. The existing global `pi` executable was unchanged.
- Exercised the live TUI in tmux: Stela startup identity, a local faux-provider response, and shell execution.
  Offline `fd` availability and tmux extended-key warnings remain visible; no theme redesign was performed.
- Exercised the actual RPC CLI with a temporary home: default `~/.stela/agent` storage, credentials and
  project settings not inherited from Pi, session naming and conversation persistence, resumed session
  identity/content, persisted settings, Stela directory overrides, and `--session-dir` precedence.
  Pi-state sentinel hashes were unchanged. All model turns used a local faux provider; no paid API calls.
- Exercised upstream self-update rejection, including `--all`, before network/package changes.
  Stela does not clean Pi managed-install staging. Extension/model updates remain inherited.
- Refreshed command lockfile metadata without lifecycle scripts. Native packaging, prototype migration,
  targeted reverse engineering, and visual-token application remain next-session work.
- `npm run check` passed. The focused affected-test run passed 386 tests across 22 files; the 18
  credential-gated RPC tests were skipped with Anthropic credentials unset. RPC behavior was instead
  exercised through the actual CLI with the local faux provider. The full test suite was not run.
  Source-only test bootstrap now includes durable-package aliases and the native plugin source resolver.

## Private Claude findings and proof-of-concept archive

Private backup directory: **`/home/claudio/stela-private-20261008.yW4Lf5/`** (mode 0700).
Its `README.md` indexes the evidence and safe recovery commands; `SHA256SUMS` records the digest of
`claude-proof-of-concept.tar.zst` (mode 0600). Archive integrity and comparison against original files
passed before this handoff replaced the old one. The old, detailed handoff is in that archive.
Dependency installations and Git metadata are excluded; original working files remain in place.

| Original local location | Retained information |
|---|---|
| `/home/claudio/projects/claudeish-pi/` | Proof-of-concept source/tests, recovered data, extraction scripts, `docs/PARITY.md`, `docs/FEATURES.md`, `docs/INTERFACES.md`, ten per-surface specs in `docs/re/` |
| `/home/claudio/projects/test/claude-code-harness-re/` | Claude Code report, provenance, behavior specifications, asset index |
| `/home/claudio/cc-re/` | Extraction toolchain, recovered file trees and manifests, assets, runtime captures, supporting indices |
| Local `docs/research/` and `eval/` | Visual-design research, spike/eval documentation, task fixtures, results, and raw captures |

Root `eval/`, `docs/research/`, and `graphify-out/` are local-only and ignored by Git.
Do not stage them or publish the private archive. Proprietary material remains private until its
redistribution rights are reviewed; provenance is not permission. Future implementations should use
reviewed behavioral specifications, not copied recovered implementations or prompt tables.

Historical measurement takeaways, not benchmarks of this new source checkout:

- Installed Pi 1.1.0 startup: bare 313 ms; prototype via loader 481 ms; matched inlined variant 422 ms
  (about 57 ms saved). The old ~660 ms empty-extension premise did not reproduce.
- The proof of concept exercised tool execution, streaming, cancellation, and session resume.
  Its headless runs required `bypassPermissions`; none of that code is imported into this fork.
- Eval results are qualified evidence, not SOTA proof. A paid-model batch inherited ambient context;
  two free-preview stock/Step runs read a hidden verifier. Preserve these caveats with the captures.
  Do not spend the next session re-running the same small set; fix visibility boundaries before any
  future held-out comparison.

## Current work — permission modes (started 2026-10-08)

First capability: core permission modes. The 5 modes are fixed by the user: bypass permissions, auto, manual, accept edits, plan. Scope:
- the tool-approval gate;
- allow/ask/deny rules;
- the inline TUI approval dialog;
- the mode cycle key, `/permissions` picker and footer indicator.

The approved plan, with phase details, decision ledger and implementation outline, is
`~/.claude/plans/stela-read-handoff-md-first-glistening-galaxy.md`.

**Phase 1 (permission-only RE of 7 CLIs) is done, including the follow-ups (2026-10-09).**
- Reports are in `docs/research/permissions/<target>.md` (git-ignored) for claude-code, codex, opencode, cursor-agent, omp, grok and devin.
- Evidence strength:
  - code-level: claude-code, codex, opencode, cursor-agent, omp;
  - grok and devin: full Ghidra analyses plus a pseudocode review. Code confirms only a few points: grok's mode resolver and classifier timeout, and devin's CLI default mode. The rest is documented behavior.
- Follow-ups ran one at a time through Orca run `run_763155b8c450`; this session's coordinator terminal is bound with `run-use`. The queue is `~/.cache/stela-rea/specs/queue.txt`; all items are done.

**Phase 2 is done:** `docs/research/permissions/DECISIONS.md` has the follow-ups folded in, and no pick changed.

**Implementation: steps 1–4 of `docs/research/permissions/PLAN.md` are committed (2026-10-09).**
- `4799266e8`: the gate, rules, workspace scope and protected paths, the tree-sitter bash analyzer, the
  `PermissionController`, the approval dialog, `permissions.*` settings, and the flags `--permission-mode`,
  `--allow-bypass-permissions` and `--add-dir`. The `plan-mode` example extension was removed.
- `72e2111fc`: Shift+Tab mode cycle (thinking moved to Alt+T), the `/permissions` picker, `/plan`, and the footer
  mode indicator.
- Code: `packages/coding-agent/src/core/permissions/`. The gate is an SDK option (`createAgentSession({ permissions })`);
  the Stela CLI always enables it, and SDK callers without it behave as before.
- Tests: `test/permissions-{core,bash,ui}.test.ts` and `test/suite/agent-session-permissions.test.ts`, 52 in total.
  A live tmux run with a scripted faux provider passed. `npm run check` is clean.
- `./test.sh` has failures that are not from this work: `fd` tests offline, tests still expecting pi names after the
  Stela cutover, unbuilt artifacts (pi-ai entry, chord, env daemon), a flaky `auth-storage` test, and 4 pi-ai
  model-metadata tests.
- Not verified: the npm bundle and Bun binary wasm paths (`npm run build` was not run).
- Next: step 5 (`exit_plan_mode`), step 6 (auto classifier), the D14 extension API, then step 7 (docs, RPC smoke
  test, build verification). Details and small follow-ups are under "Remaining" in `PLAN.md`.

**Operational lessons (see also Claude memory `rea-reliability`):**
- **Load:**
  - Run one heavy worker at a time; the Orca server crashed when 7 ran in parallel.
  - Close finished worker terminals: `step.sh` does it; release alone leaves them retained.
  - Claude Code reaps its own background shells under memory pressure. Do not rely on them for safety.
- **REA JavaScript analyzer:** the MCP call fails with "Invalid string length" because the result is huge (574 MB for Cursor). Run the REA CLI to a file and query it with jq or a streaming script.
- **REA Ghidra:** use the capped toolkit `~/.cache/stela-rea/ghidra/` (see its README.md), never REA `open_binary` or a direct `analyzeHeadless` on large native targets. `ghidra-run.sh` checks the guard, at least 8 GB available, and a single instance. It runs in an 8 GB / no-swap systemd scope, verifies the cap on the JVM cgroup, logs memory, and keeps `java.io.tmpdir` off the `/tmp` tmpfs. `StringXrefs.java` maps tokens to functions, including inside packed Rust strings. `ExportDecompiled.java` writes pseudocode or an `.asm` fallback. Workers must read the code: string xrefs alone gave three wrong labels in grok.
  - The guard `stela-ghidra-guard` (`~/.cache/stela-rea/ghidra-guard.sh`, log `guard.log`) has a 10 h limit; it was renewed at 10:26 on 2026-10-09. It kills uncapped Ghidra JVMs, and any Ghidra when available memory drops below 2.5 GB.
- **Codex update prompt:** Codex 0.160.0 shows an update prompt on startup. "Skip until next version" was chosen once to keep the RE target version fixed.

## Next session — reverse engineering and building

1. Start from this checkout and this handoff. Stela identity/launch/state isolation is implemented;
   see the root README for installation and discovery boundaries. Choose the first concrete
   capability and inspect its inherited runtime path. Keep package names and persistence formats.
2. Reverse engineer only the selected missing behavior, using private Claude findings where relevant
   and a pinned, licensed source target such as Codex or Opencode for comparison. Record evidence,
   uncertainty, redistribution status, and the chosen behavior; do not start a seven-target sweep.
3. Implement the chosen behavior cleanly in the fork, update callers and relevant docs, and exercise
   the actual CLI/TUI path. Apply the frozen visual tokens when UI work begins. No automatic prototype
   port, recovered prompt import, extension inlining, GUI launch, or SQLite migration.

Suggested opening prompt (permission modes, in progress):

> Stela. Read HANDOFF.md "Current work — permission modes" and the "Remaining" list in
> docs/research/permissions/PLAN.md. Steps 1–4 are committed. Continue with step 5 (exit_plan_mode),
> then step 6 (auto-mode classifier with fail-to-ask, timeout and breaker), then the D14 extension
> API, each with tests and npm run check, and commit each step. Ask me before running npm run build
> for step 7. Do not overload the machine.
