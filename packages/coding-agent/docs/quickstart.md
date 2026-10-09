# Quickstart

Stela runs in your terminal and works with files on your machine. To use it, you need access to a model through a supported provider. This can be a subscription, an API key, or a local model.

For native Windows setup, read [Windows Setup](windows.md). For Android, read [Termux Setup](termux.md).

## 1. Install Stela

Stela runs from a source checkout; there is no npm package, release installer, or Nix flake for it. Prepare the checkout as described in the repository README (Node.js 22.19 or newer, installed dependencies, hydrated model data), then link the `stela` command:

```bash
node scripts/install-stela.mjs
```

The installer links `~/.local/bin/stela` to the checkout, so keep the checkout in place and put `~/.local/bin` on `PATH`. Use `--bin-dir <directory>` for another location, or run `./stela` from the checkout without installing. It does not modify an existing upstream `pi` installation.

Verify the installation:

```bash
stela --version
```

## 2. Start Stela

Change to the folder you want Stela to work with, then start it:

```bash
cd /path/to/folder
stela
```

The working folder helps Stela discover relevant files, instructions, and configuration. Stela also uses it to group saved sessions.

<p align="center"><img src="images/interactive-mode.png" alt="Stela running in a terminal with a conversation, input editor, and status footer" width="750"></p>

The interface shows your conversation, an editor for prompts and commands, and a footer with the current folder, model, and session status. See [Use Stela in the terminal](usage.md) to learn how to add files, run commands, direct ongoing work, and manage results.

## 3. Choose a model

A **model** generates Stela's responses. A **provider** is the service or account Stela uses to access that model.

In Stela, run:

```text
/login
```

Choose a provider, then follow the prompts to use a subscription or store an API key. Run `/model` afterward if you want to select a different available model.

See [Choose a model and provider](models.md) for supported providers, environment-variable authentication, local models, and custom endpoints.

## 4. Give Stela a task

Stela shows each file read, search, command, and edit it performs. It does not ask before every tool call.

Enter a task that matches your work, for example:

```text
Summarize @meeting-notes.md and save the action items to action-items.md.
```

```text
Explain how this repository is structured and how to run its checks.
```

```text
Compare @previous.csv with @current.csv and summarize the important changes.
```

Type `@` in the editor to search for a file instead of entering its full path. When Stela finishes, review its response and any changed files. Use version control or backups for important work. For untrusted or unattended work, use a container or another sandbox. See [Security](security.md).

## Continue later

Stela saves sessions automatically. Exit Stela, then resume the most recent session for the same working folder with:

```bash
stela --continue
```

Use `/resume` to choose another saved session. See [Continue or branch a session](sessions.md) for session naming, branching, compaction, export, and sharing.

## Next steps

- [Use Stela interactively](usage.md) to learn input, commands, shortcuts, and queued messages.
- [Add instructions](configuration.md#context-files) that Stela should follow whenever it works in a folder.
- [Choose a model and provider](models.md).

<a id="choose-how-to-customize-pi"></a>

### Choose how to customize Stela

Start with the least powerful mechanism that meets your need:

| Need | Start with |
|---|---|
| Give Stela persistent instructions for a folder | [`AGENTS.md`](configuration.md#context-files) |
| Reuse a prompt from the `/` menu | [Prompt template](prompt-templates.md) |
| Add task-specific instructions and supporting files | [Skill](skills.md) |
| Add executable tools, commands, or event handlers | [Extension](extensions.md) |
| Build a custom terminal component | [Terminal UI](tui.md) |
| Connect an unsupported model service | [Custom provider](custom-provider.md) |
| Install or distribute several resources | [Stela package](packages.md) |

## Uninstall Stela

Remove the `stela` link the installer created (`~/.local/bin/stela`, or the `--bin-dir` you chose), then delete the checkout if you no longer need it.

This does not remove configuration, credentials, sessions, or installed Stela packages from `~/.stela/agent/`.
