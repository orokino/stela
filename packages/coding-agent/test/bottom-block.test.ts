import { setKeybindings } from "@earendil-works/pi-tui";
import { beforeAll, describe, expect, it } from "vitest";
import { KEYBINDINGS, KeybindingsManager } from "../src/core/keybindings.ts";
import { ComposerHintRowComponent } from "../src/modes/interactive/components/composer-hint-row.ts";
import { ShortcutsOverlayComponent } from "../src/modes/interactive/components/shortcuts-overlay.ts";
import { initTheme } from "../src/modes/interactive/theme/theme.ts";
import { stripAnsi } from "../src/utils/ansi.ts";

describe("batch A bottom block", () => {
	beforeAll(() => {
		initTheme(undefined, false);
		setKeybindings(new KeybindingsManager());
	});

	it("rebinds copy to alt+c, freeing ctrl+x for the shortcuts overlay", () => {
		expect(KEYBINDINGS["app.message.copy"].defaultKeys).toBe("alt+c");
		expect(KEYBINDINGS["app.shortcuts.toggle"].defaultKeys).toContain("ctrl+x");
		expect(KEYBINDINGS["app.shortcuts.toggle"].defaultKeys).toContain("ctrl+.");
	});

	it("adds paste-expand and universal queue/dequeue secondaries", () => {
		const paste = KEYBINDINGS["app.editor.pasteExpand"].defaultKeys;
		expect(Array.isArray(paste) ? paste : [paste]).toContain("ctrl+shift+v");
		const followUp = KEYBINDINGS["app.message.followUp"].defaultKeys;
		expect(Array.isArray(followUp) ? followUp : [followUp]).toContain("ctrl+enter");
		const dequeue = KEYBINDINGS["app.message.dequeue"].defaultKeys;
		expect(Array.isArray(dequeue) ? dequeue : [dequeue]).toContain("shift+up");
	});

	it("drops the whole composer hint row below 56 cols", () => {
		const row = new ComposerHintRowComponent();
		row.setSegments([
			{ keybinding: "app.permissions.cycle", label: "mode" },
			{ keybinding: "app.shortcuts.toggle", label: "shortcuts" },
		]);
		row.setHasDraft(false);
		expect(row.render(55)).toEqual([]);
		expect(stripAnsi(row.render(80)[0] ?? "")).toContain("mode");
	});

	it("shows send/newline hints only with a non-empty draft", () => {
		const row = new ComposerHintRowComponent();
		row.setSegments([
			{ keybinding: "tui.input.submit", label: "send" },
			{ keybinding: "tui.input.newLine", label: "newline" },
			{ keybinding: "app.permissions.cycle", label: "mode" },
		]);
		row.setHasDraft(false);
		expect(row.visibleSegments().map((s) => s.label)).not.toContain("send");
		row.setHasDraft(true);
		expect(row.visibleSegments().map((s) => s.label)).toContain("send");
	});

	it("opens the shortcuts overlay with Essentials expanded and others collapsed", () => {
		const overlay = new ShortcutsOverlayComponent();
		expect(overlay.isExpanded("Essentials")).toBe(true);
		expect(overlay.isExpanded("Input")).toBe(false);
		const text = stripAnsi(overlay.render(72).join("\n"));
		expect(text).toContain("Keyboard Shortcuts");
		expect(text).toContain("Essentials");
		expect(text).toContain("Input");
		expect(text).toContain("Send");
	});

	it("filters the shortcuts overlay with /", () => {
		const overlay = new ShortcutsOverlayComponent();
		overlay.handleInput("/");
		overlay.handleInput("p");
		overlay.handleInput("a");
		overlay.handleInput("s");
		overlay.handleInput("t");
		overlay.handleInput("e");
		const text = stripAnsi(overlay.render(72).join("\n")).toLowerCase();
		expect(text).toContain("paste");
	});
});
