# Run Stela on Android with Termux

Stela runs on Android through [Termux](https://termux.dev/), a terminal emulator and Linux environment. Text input, file tools, and shell commands are supported. Stela can copy and paste text through the Android clipboard with Termux:API. Clipboard image paste is not supported.

## Before you begin

Install Termux from [GitHub or F-Droid](https://github.com/termux/termux-app#installation). Do not use the deprecated Google Play build.

[Termux:API](https://github.com/termux/termux-api#installation) is optional. Install it only when you want Stela to copy or paste Android clipboard text, or when shell commands need Android device APIs.

## Install Stela

1. Update Termux packages:

   ```bash
   pkg update && pkg upgrade
   ```

2. Install Node.js and the tools used by the checkout setup:

   ```bash
   pkg install nodejs git curl coreutils
   ```

   Stela requires Node.js 22.19 or newer. Confirm the version before continuing:

   ```bash
   node --version
   ```

3. Clone Stela and enter the checkout:

   ```bash
   git clone https://github.com/orokino/stela.git "$HOME/stela"
   cd "$HOME/stela"
   ```

   Keep this checkout in place; the installed command links to it. The bootstrap below follows the [checkout setup](../../../README.md#run-stela-from-this-checkout), though Termux-specific compatibility has not been verified.

4. Install checkout dependencies and hydrate model data:

   ```bash
   npm ci --ignore-scripts --no-audit --no-fund
   mkdir -p .artifacts/stela-bootstrap
   curl -fL 'https://pi.dev/api/models/revisions/sha256-439c53478c84ed27a58f8b54e1c3bd45810e5a969515b4e3666a3898d51ee22f?types=chat,image,classifier' \
     -o .artifacts/stela-bootstrap/models.all.json
   printf '%s  %s\n' '439c53478c84ed27a58f8b54e1c3bd45810e5a969515b4e3666a3898d51ee22f' \
     '.artifacts/stela-bootstrap/models.all.json' | sha256sum -c -
   node packages/ai/scripts/hydrate-model-catalog.ts .artifacts/stela-bootstrap/models.all.json
   npm run check:model-data
   ```

5. Link the checkout launcher into Termux's command directory and verify it:

   ```bash
   node scripts/install-stela.mjs --bin-dir "$PREFIX/bin"
   stela --version
   ```

6. Open the folder you want to work in and start Stela:

   ```bash
   cd /path/to/working-folder
   stela
   ```

Continue with the main [Quickstart](quickstart.md#3-choose-a-model) to connect a model and run your first task.

## Access Android shared storage

Termux cannot access shared Android storage until you grant permission. Run this once:

```bash
termux-setup-storage
```

After approval, Android shared storage is available under `/storage/emulated/0` and through the links Termux creates under `~/storage/`.

Only grant this permission when Stela should be able to access those files. Commands and tools running in Termux use the same storage permissions as the Termux process.

## Use clipboard commands

Stela uses `termux-clipboard-set` to copy text and `termux-clipboard-get` for its clipboard-paste shortcut. Shell commands can use both commands directly. Install the Termux:API app and its command-line package:

```bash
pkg install termux-api
```

Verify the integration:

```bash
printf 'Stela clipboard test' | termux-clipboard-set
termux-clipboard-get
```

The second command should print `Stela clipboard test`.

The Termux clipboard API supports text only. Stela's clipboard-paste shortcut inserts that text into the editor but cannot attach clipboard images.

## Add Termux-specific instructions

Stela detects that it is running in Termux, but it cannot infer how you want it to interact with Android. Add only the environment details relevant to your work to `~/.stela/agent/AGENTS.md`:

````markdown
# Termux environment

- Stela runs in Termux on Android.
- Shared Android storage is under `/storage/emulated/0`.
- Open URLs with `termux-open-url "https://example.com"`.
- Open files with `termux-open <path>`.
- Do not access shared storage unless the task requires it.
````

Run `/reload` after changing the file during an active session.

## Troubleshooting

### Clipboard integration fails

Confirm that you installed both components:

1. The Termux:API Android app from the same source as Termux
2. The `termux-api` command-line package

Then run the clipboard verification commands above outside Stela. If they fail there, fix the Termux:API installation before retrying Stela's copy command.

### Shared storage reports permission denied

Run `termux-setup-storage`, approve the Android permission request, and retry the path under `~/storage/` or `/storage/emulated/0`.

### Stela is not found after installation

Check that the installer created the link and that Termux's command directory is on `PATH`:

```bash
ls -l "$PREFIX/bin/stela"
printf '%s\n' "$PATH"
command -v stela
```

The link should point into the checkout, and `$PREFIX/bin` should appear in `PATH`. If the link is missing, run the installer again from the checkout. It refuses to replace an unrelated existing command; resolve that path conflict before retrying.
