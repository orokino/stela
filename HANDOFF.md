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

Subagent preference (2026-10-10): **muse spark 1.3 contributor** (user choice; replaces DeepSeek V4.1
Flash). Orca model id `opencode-go/muse-spark-1.3-contributor` (matches this workstation's own model
string; confirm the exact id and any thinking-level suffix from Orca before launching). Check
`launch.effective` in the receipt and report if model or thinking level differ; never substitute
another model silently. Earlier workers in this handoff used `gpt-6-luna`, then
`opencode-go/deepseek-v4.1-flash:max`.

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

**Implementation: steps 1–7 of `docs/research/permissions/PLAN.md` are done and pushed (2026-10-09).**
- Commits:
  - `4799266e8`: gate, rules, workspace scope and protected paths, tree-sitter bash analyzer, `PermissionController`,
    approval dialog, `permissions.*` settings, flags `--permission-mode`, `--allow-bypass-permissions`, `--add-dir`.
    The `plan-mode` example extension was removed.
  - `72e2111fc`: Shift+Tab mode cycle (thinking moved to Alt+T), `/permissions` picker, `/plan`, footer indicator.
  - `95d0f3f36`: `exit_plan_mode` (declared only in plan mode; implement in accept edits / manual / auto, or keep
    planning) and the plan file `<agentDir>/plans/<session-id>.md`.
  - `acbfc22bd`: auto mode classifier (`core/permissions/auto-decider.ts`): one call to `permissions.auto.model`,
    fail-to-ask (deny headless), timeout clamp 1–120 s, 3 consecutive / 20 total denial breaker.
  - `9d993606b`: extension API `ctx.permissions.getMode()/setMode()` and the `permission_mode_change` event.
  - `f97e647ca`: `packages/coding-agent/docs/permissions.md` (user docs) and `test/rpc-permissions.test.ts`.
- Code: `packages/coding-agent/src/core/permissions/`. The gate is an SDK option (`createAgentSession({ permissions })`);
  the Stela CLI always enables it, and SDK callers without it behave as before.
- Tests: 76 in `test/permissions-{core,bash,ui}.test.ts`, `test/suite/agent-session-{permissions,auto-mode}.test.ts`
  and `test/rpc-permissions.test.ts`. `npm run check` is clean.
- Verified live with the bundled CLI (`npm run build:offline`; same as `build` minus the network model regeneration):
  both wasm files load from the checkout and from an `npm pack` copy; an RPC run and a tmux TUI run covered plan
  handoff, bash approval and auto mode (allow, deny, uncertain, Esc). Tools and how to rerun them:
  `docs/research/permissions/smoke/README.md` (git-ignored).
- Bun binary wasm paths verified in 5.7 below.
- `./test.sh` (2026-10-09, after cleanup commits `1d98f6bd0` and `ac98f5a68`): coding-agent rename leftovers fixed
  (tests use `APP_NAME`), and the #5943 rebind regression from the permission footer subscription fixed. Remaining
  failures, all environmental: `find` tool tests (10; no system `fd`, and the download inside the isolated test
  home fails), `packages/env` (5 files; the Rust `pi-env` daemon is not built), 2 pi-ai model-metadata tests
  (catalog older than test expectations; refreshing needs the network model regeneration), and the flaky
  `auth-storage` coalesced-reload test.
- Follow-ups 5.1–5.6 of `PLAN.md` "Remaining" are done (2026-10-09), one commit each: `0228b8f75` plan mode denies
  protected paths (user: deny); `e33591165` dangerous-command risk list, allowed only by an exact rule (user: enforce
  at rule matching); `9f7639edb` approval dialog reported as OSC 7501 `kind=permission` with only its first title
  line; `1e9646ff1` "Save which rule?" picker to widen a grant (user: picker, no free text); `1a8f50090` `.pi` paths
  in MCP messages and docs; `6bb6773e4` only the built-in `exit_plan_mode` skips the gate (user: identity check).
- Live checks run from source with `./stela` (no build needed): print/json, tmux TUI (`pipe-pane` captures OSC 7501),
  and `rpc-smoke.mjs` with `./stela` as the CLI path.
- 5.7 done (2026-10-09): Bun 1.3.14 (the CI pin) installed to `~/.bun/bin` from the GitHub release, checksum
  verified. Built with `npm run build:offline` plus the `bun build --compile` and `copy-binary-assets` steps of
  `build:binary` (which would otherwise regenerate models over the network). A copy of `dist/pi` with its assets
  outside the repo parses `ls && cat a.txt | wc -l` (allowed) and flags `git push --force`; without
  `tree-sitter-bash.wasm` it fails closed with "shell parser unavailable". Permission modes work is complete.

**Docs rename (2026-10-09), done and pushed.** Two gpt-6-luna workers (effort max) through Orca run
`run_60b7ec66159d`; both settled, released, nothing reclaimable.
- `284ce3a23` (worker): "Pi" -> "Stela", `pi` -> `stela`, `~/.pi` -> `~/.stela` across 47 coding-agent docs and
  example READMEs. Kept: package names, the `pi.` extension API, hardcoded `PI_*` variables, upstream URLs.
- `d0f8f6734` (review fixes): the worker had dropped or inverted the notes that upstream Pi's
  `PI_CODING_AGENT_DIR`/`PI_CODING_AGENT_SESSION_DIR`/`PI_PACKAGE_DIR` do not select Stela state; and
  `quickstart.md` said "Install Stela" over upstream Pi's installer, npm package and Nix flake. It now documents
  `node scripts/install-stela.mjs` and its uninstall.
- `d6e4a3959` (worker) and `6e7e49351`: `containerization.md` (`Dockerfile.stela`, clones
  `https://github.com/orokino/stela.git`, which is public) and `termux.md` use the checkout bootstrap copied
  verbatim from "Verified checkout setup" above. **Not executed:** the Docker build and the Termux steps.
- Lesson: review rename diffs for meaning, not just strings; a blanket "Pi" -> "Stela" inverts sentences that
  contrast Stela with upstream Pi, and leaves install commands that still fetch Pi.

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

Next session (user's choice): **UI/UX, with RE of the other CLIs' TUIs, scoped like the permission-modes RE.** Reuse the Phase 1
approach from permission modes: one capability-scoped question list, the 7 targets' existing reports and REA/Ghidra
tooling (capped toolkit, one heavy worker at a time), then decisions, then implementation with the frozen visual
tokens. Test cleanup is done (see above); executing the new Docker/Termux docs is still open.

Suggested opening prompt (UI/UX):

> Stela. Read HANDOFF.md ("Agreed direction", "Frozen visual tokens", "Current work") and
> docs/research/permissions/ for how the permission-modes RE was scoped. Propose a UI/UX-only question
> list for reverse engineering the other CLIs' TUIs (claude-code, codex, opencode, cursor-agent, omp,
> grok, devin) and ask me to approve it before starting any worker. Workers: DeepSeek V4.1 Flash (max) via
> OpenCode Go in OMP (see "Subagent preference"), one heavy worker at a time. Do not overload the machine.

## Current work — UI/UX phase 1 (done 2026-10-10, commit `37c92ab45`)

All 15 steps of `docs/research/uiux/PLAN.md` are implemented, live-verified in tmux, and pushed to
`origin/main` (105 files, +2864/−456). Phase-1 RE covered 7 targets (claude-code, codex, opencode,
omp, cursor-agent, grok, devin) with reports in `docs/research/uiux/<target>.md` (git-ignored);
`DECISIONS.md` records the approved picks, `PLAN.md` the per-step evidence. `npm run check` is clean.
Nothing after `37c92ab45` is committed.

Shipped, per step: (1) colour-depth ladder truecolor/256/16/nocolor + `stela` theme; (2) framed
startup card with provisional mark; (3) notice glyphs `ⓘ`/`⚠`/`■`, tinted user block,
`+ Thought · <dur>` collapse + ticking live row; (4) shared tool-card head + `Explored` grouping;
(5) diff grammar (40% word gate, `⋮` breaks, `+N/-M`, 40/8 collapse, truecolor-only backgrounds);
(6) footer `◫ pct/window` + drop order + streaming slot; (7) Cursor spinner + presets + suppression;
(8) select-list grammar (`❯`/`✔`, `↑/↓ N more`, fuzzy, 40% descriptions); (9) paste collapse,
`ctrl+r` history search, queue dock, 8-row popups, `alt+enter`; (10) reserved keys + fullscreen-mouse
opt-in; (11) opt-in OSC 9/BEL notifications + state-word titles; (12) ASCII symbol preset;
(13) truncation table + frame budget + `Rebuilding…`; (14) task HUD for `!` shells (strip/tray
deferred: no todo/subagent tool exists); (15) inline TUI default with fullscreen opt-in.

User verdict (2026-10-10): Stela still falls short of the studied CLIs on UI/UX feel. Phase 1
shipped the structure but under-stole the details.

## Next: UI/UX overhaul, phase 2 (not started)

Full-surface overhaul of footer, composer, menus, diffs, telemetry, and every other surface phase 1
touched — steal the best from the 7 RE reports, never invent. Hard gate: the worker MUST present
ranked options per surface and wait for the user's green light before implementing or editing
anything. No code changes, no commits, no live edits until approval lands per surface or per batch,
as the user directs at review time.

How phase 2 runs:

1. **Audit first.** For each surface (footer, composer, menus/pickers, diffs, telemetry, tool cards,
   transcript rows, thinking, spinners/motion, notifications, startup card, task HUD, key hints),
   the worker diffs Stela's current render against the best observed behavior in
   `docs/research/uiux/<target>.md`, citing file + U-section per claim.
2. **Ranked options.** Per surface: a ranked option table (observed options only, pros/cons, sources),
   one recommended pick with reasoning, rejected alternatives. Combinations no single target ships
   must be labelled **(synthesis)** and beat every observed option. Familiarity is never a tie-break;
   ties go to simpler. Same criteria order as QUESTIONS.md (legibility → accessibility).
3. **User review.** Present the tables; the user picks winners, possibly per surface. Only then does
   implementation start, surface by surface, with live tmux proof per surface and `npm run check`
   clean throughout.
4. **Standing rules once approved:** verbatim technique only, never copied art/strings/prompts;
   frozen visual tokens hold; ASCII + no-colour parity for every glyph that carries meaning; no new
   dependencies without the repo-rule review; docs/changelog/schemas in the same step as the code.

Known gaps to include in the audit (all have report anchors; the worker must still re-derive them,
not trust this list blindly):

1. **Startup card ASCII path is dead code.** `MARK_ASCII` exists but `interactive-mode.ts` never
   passes `ascii: true`. Wire `getSymbolPreset()` into the card call (DV U13 shows the same bug
   class). Narrow form never live-captured at 60×20/50×20.
2. **Nerd spinner preset is a copy.** `SPINNER_PRESETS.nerd` reuses unicode braille. OMP U6 ships 12
   private-use nerd frames — steal the art or delete the preset.
3. **`selectListHeight()` exported but called nowhere.** Wire CC U9's clamp into session/model/theme
   selectors (fixed `maxVisible` today).
4. **Paste re-expand key missing.** CC U7 `paste again to expand`; OMP U7 `ctrl+shift+v`. Stela only
   auto-expands on submit.
5. **Cost/tokens never made the footer opt-in.** U8 pick says opt-in; steal CX U8 item vocabulary +
   CU U8 `token% · files edited` row as a toggle.
6. **Tool `Box` is still a tinted slab.** U1 pick says rules + one bottom block, hairlines only
   (CX bottom pane, OMP pinned composer).
7. **Settings UI hides the new knobs.** `terminal.animations`, `terminal.symbols`, `notifications.*`,
   `fullscreenMouse` are settings-file-only (CU U9 pager shell is the pattern).
8. **Working-indicator example doesn't demo presets** (docs drift).
9. **Terminal matrix asserted, not captured.** Confirm OSC 9 `auto` vs `bell` on kitty + wezterm +
   plain xterm (OMP/CU/DV U11 name them).
10. **Stall ladder + `running tool for Xs` skipped** (CC 10s/45s/300s, CX 2s). The evidence of need is
    the user saying the UI feels dead during long runs.

Deferred (need tools/features that don't exist yet, not UI polish): todo strip + tabbed tray (no
todo/subagent tool), full-screen diff viewer (needs `/diff` surface), screen-reader mode (design
recorded in PLAN.md step 12), transcript search, user status-line command. Wordmark revisit still
queued (A. Rubbing provisional).

Worker for phase 2: **muse spark 1.3 contributor** (see "Subagent preference"). One heavy worker at a
time; check `launch.effective`; never overload the machine.
