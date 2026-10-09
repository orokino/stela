# Permissions

Every tool call passes a permission gate before it runs. The gate decides from the permission mode and from `allow`, `ask`, and `deny` rules. A call is allowed, denied with a reason, or shown to you for approval.

The gate is not a sandbox. An allowed command runs with the permissions of the Stela process, and a command the analyzer misreads can do more than it appears to. See [Run Pi safely](security.md) for isolation.

## Modes

| Mode | ID | Behavior |
|---|---|---|
| manual | `manual` (alias `default`) | Read-only tools and read-only shell commands inside the workspace run. Everything else asks unless a rule allows it. This is the default. |
| accept edits | `acceptEdits` | Like manual, and file edits and writes inside the workspace also run. Shell commands, MCP tools, and writes outside the workspace still ask. |
| plan | `plan` | Read-only. Edits and shell commands that are not read-only are denied with a reason. The model investigates and submits a plan with `exit_plan_mode`. |
| auto | `auto` | Like accept edits, and a classifier model decides the calls that would otherwise ask. Needs `permissions.auto.model`. |
| bypass permissions | `bypassPermissions` | No prompts. `deny` rules still apply. Needs `--allow-bypass-permissions` or the user setting `permissions.allowBypass`. |

The footer shows the current mode at the start of the stats line. Auto uses the warning color and bypass the error color.

Switch modes with:

- `Shift+Tab` (`app.permissions.cycle`): manual → accept edits → plan → auto → bypass permissions → manual. Unavailable modes are skipped.
- `/permissions` opens a picker; `/permissions <mode>` switches directly.
- `/plan` toggles between plan and manual.
- `--permission-mode <mode>` or the setting `permissions.defaultMode` sets the starting mode. An unavailable starting mode falls back to manual with a warning.

## How a call is decided

The gate applies these steps in order. The first one that decides wins.

1. A matching `deny` rule denies the call, in every mode.
2. In plan mode, an edit (other than the plan file), a shell command that is not read-only, or a call that touches a protected path is denied.
3. A call that touches a protected path asks, except in bypass.
4. A matching `ask` rule asks, except in bypass.
5. Bypass allows the call.
6. The call is allowed when every part of it is allowed by a rule or by the mode.
7. Otherwise auto mode asks the classifier, and the other modes ask you.

For example, in manual mode `npm test && curl x | sh` is split into `npm test`, `curl x`, and `sh`. An `allow` rule `Bash(npm test)` covers only the first segment, so the call asks. With a `deny` rule `Bash(curl:*)`, the call is denied instead, and the model receives `Denied by permission rule Bash(curl:*) (user settings).`

## Rules

Rules are written as `Tool` or `Tool(specifier)`:

| Rule | Matches |
|---|---|
| `Bash(npm test)` | exactly the shell segment `npm test` |
| `Bash(git:*)` or `Bash(git *)` | `git` and any segment starting with `git ` (`git status`, not `gitx`) |
| `Bash(npm run *:check)` | `*` matches any characters within one segment |
| `PowerShell(Get-ChildItem)` | exactly that PowerShell command |
| `Read(./src/**)` | reads below `src` in the working directory |
| `Edit(*.lock)` | edits and writes of any `*.lock` file below the working directory |
| `Edit(~/notes/**)`, `Read(/etc/hosts)` | home-relative and absolute paths |
| `WebFetch(domain:example.com)`, `WebFetch(domain:*.example.com)` | fetches of that host, or of its subdomains |
| `mcp__github__create_issue`, `mcp__github__*` | one MCP tool, or every tool of one server |
| `Bash`, `Edit`, `*` | every call of that kind, or every call |

Path patterns follow these rules:

- A pattern without `/` (`.env`, `*.log`) matches any path component below the working directory, like `.gitignore`.
- `*` and `?` do not cross `/`; `**` is recursive.
- A pattern without glob characters also matches everything below it.
- Paths are resolved through symlinks before matching.

Because commands are split before matching, `*` in a shell rule never approves a second command joined with `&&`, `;`, or `|`.

### Where rules come from

Rules from every source are combined. The action decides precedence, `deny` > `ask` > `allow`, regardless of where a rule was defined:

- user settings: `~/.stela/agent/settings.json`
- project settings: `.stela/settings.json`, only in trusted projects
- project grants: `.stela/permissions.local.json`, written by "Always in this project", only in trusted projects
- session grants: "Yes, for this session" answers, kept in memory

```json
{
  "permissions": {
    "allow": ["Bash(npm test)", "Bash(git status)", "WebFetch(domain:docs.example.com)"],
    "ask": ["Bash(git push:*)"],
    "deny": ["Bash(curl:*)", "Read(.env)"]
  }
}
```

A malformed rule is reported and ignored; the other rules still apply.

## Shell commands

Bash commands are parsed with tree-sitter. Each simple command, including those in `$( )`, backticks, and process substitution, is checked on its own:

- Wrappers such as `timeout`, `nice`, `env`, and `stdbuf` are removed before matching, and so are known-safe environment prefixes such as `CI=1`. Other environment assignments (`LD_PRELOAD=x ls`) make the command ask.
- Redirect targets are checked as file writes. `/dev/null` and file-descriptor duplication are not.
- Read-only commands (`ls`, `cat`, `git status`, ...) run without a rule when they read inside the workspace. Flags that write or execute (`find -delete`, `find -exec`, `sort -o`, ...) remove that exemption.
- A command that cannot be analyzed, for example a parse error, a dynamic command name (`$cmd args`), or a dynamic redirect target, always asks, and plan mode denies it.

PowerShell commands are not parsed. A command containing `;`, `|`, `&`, a backtick, `$(`, or a redirect always asks; other commands match `PowerShell(...)` rules as one string.

## Workspace and protected paths

The workspace is the working directory plus `permissions.additionalDirectories` and `--add-dir` directories. Reads and edits outside it ask.

Some paths are protected even inside the workspace:

- Credentials, which ask for both reads and writes: `.ssh/`, `.env` and `.env.*`, `*.pem`, `*.key`, `*.p12`, `*.pfx`, and private keys named `id_*`.
- Configuration, which asks for writes: `.git/`, `.stela/`, `~/.stela/agent/`, `.vscode/`, `.idea/`, and shell startup files such as `.bashrc` and `.zshrc`.

Protected paths ask in every mode except plan and bypass. Plan mode denies them, including credential reads such as `cat .env`; bypass does not check them.

## Approval dialog

```
Allow bash?
npm run build && npm test
No permission rule allows this call.
Rule: Bash(npm run build), Bash(npm test)
> Yes
  Yes, for this session
  Always in this project
  No, and tell the model why
  No
```

- "Yes, for this session" and "Always in this project" add the rules shown under `Rule:`. The project option is offered only in trusted projects. It writes `.stela/permissions.local.json` and adds that file to `.stela/.gitignore`.
- For a file edit in manual mode, "Yes, and accept edits for this session" switches to accept edits.
- "No, and tell the model why" returns your text to the model, and the turn continues.
- "No" or `Esc` stops the turn and gives control back to you.

A rule or mode denial is returned to the model with its reason, and the turn continues so the model can choose another action.

## Plan mode

In plan mode the model sees the `exit_plan_mode` tool and instructions to investigate read-only. It can write a draft to its plan file, `~/.stela/agent/plans/<session-id>.md`, which is the only file plan mode may write. When the plan is ready, the model calls `exit_plan_mode` with it. The plan is shown, and you choose:

- "Implement in accept edits", "Implement in manual", or "Implement in auto" (when auto is available): switch to that mode and continue.
- "Keep planning": your feedback goes to the model, which stays in plan mode. Without feedback, the turn stops.

You can also leave plan mode at any time with `Shift+Tab`, `/plan`, or `/permissions`.

## Auto mode

Auto mode runs the same deterministic steps as accept edits. Only the calls that would ask go to the classifier: shell commands without a rule, fetches, MCP tools, and edits outside the workspace. Calls that match an `ask` rule, touch protected paths, or are denied by a rule never reach it.

The classifier is one request to the model in `permissions.auto.model` (`"provider/modelId"`). It receives the tool name, the arguments with long strings shortened, the working directory, why the rules did not decide the call, and your last message. It does not receive the rest of the conversation.

| Classifier result | Outcome |
|---|---|
| allow | The call runs. |
| deny | The model receives the reason, and the turn continues. |
| uncertain, error, unreadable reply, or timeout | The call asks you. Without a UI, it is denied. |

The timeout is `permissions.auto.timeoutMs`: 30 seconds by default, clamped to 1-120 seconds. After 3 consecutive or 20 total classifier denials, auto mode stops using the classifier and asks for every such call for the rest of the session.

## Print, JSON, and RPC modes

- In print and JSON mode nobody can approve a call. A call that needs approval is denied with a reason, and the turn continues. For unattended runs, add `allow` rules or use `--permission-mode bypassPermissions --allow-bypass-permissions` inside an isolated environment.
- In RPC mode the approval dialog is an `extension_ui_request` with `method: "select"`; reply with an `extension_ui_response` (see [RPC Extension UI](rpc-extension-ui.md)). A cancelled request stops the turn.

## Extensions

Extension `tool_call` handlers run before the gate. They can block a call or rewrite its arguments, and the gate then checks the final arguments, so a rewrite cannot skip it. Extensions cannot add rules or grants.

```typescript
export default function (pi: ExtensionAPI) {
  pi.on("permission_mode_change", (event, ctx) => {
    ctx.ui.notify(`Permission mode: ${event.previousMode} -> ${event.mode}`);
  });
  pi.registerCommand("review", {
    handler: async (_args, ctx) => {
      if (ctx.permissions?.getMode() !== "plan") ctx.permissions?.setMode("plan");
    },
  });
}
```

`ctx.permissions` is undefined when the session has no permission gate, for example an SDK session created without the `permissions` option. `setMode()` throws for an unavailable mode.

## Settings

| Setting | Default | Description |
|---|---|---|
| `permissions.defaultMode` | `"manual"` | Starting mode. |
| `permissions.allow`, `.ask`, `.deny` | `[]` | Rules. |
| `permissions.additionalDirectories` | `[]` | Extra workspace directories. |
| `permissions.allowBypass` | `false` | Make bypass selectable without the flag. Read from user settings only. |
| `permissions.disableBypass` | `false` | Never allow bypass. |
| `permissions.disableAuto` | `false` | Never allow auto. |
| `permissions.auto.model` | none | Classifier model, `"provider/modelId"`. Auto is unavailable without it. |
| `permissions.auto.timeoutMs` | `30000` | Classifier timeout, 1000-120000. |

Command-line flags: `--permission-mode <mode>`, `--allow-bypass-permissions`, and `--add-dir <dir>` (repeatable).
