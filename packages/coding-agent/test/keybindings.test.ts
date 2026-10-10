import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { KEYBINDINGS, KeybindingsManager, RESERVED_KEYS, useWindowsKeybindings } from "../src/core/keybindings.ts";

describe("Windows keybinding defaults", () => {
	it("uses Windows keybindings on native Windows", () => {
		expect(useWindowsKeybindings("win32", {})).toBe(true);
	});

	it("uses Windows keybindings in WSL without relying on Windows Terminal detection", () => {
		expect(useWindowsKeybindings("linux", { WSL_DISTRO_NAME: "Ubuntu" })).toBe(true);
		expect(useWindowsKeybindings("linux", { WSL_INTEROP: "/run/WSL/123_interop" })).toBe(true);
	});

	it("does not use Windows keybindings from WT_SESSION alone", () => {
		expect(useWindowsKeybindings("linux", { WT_SESSION: "session" })).toBe(false);
	});

	it("keeps non-Windows defaults on other platforms", () => {
		expect(useWindowsKeybindings("linux", {})).toBe(false);
		expect(useWindowsKeybindings("darwin", {})).toBe(false);
	});

	it("applies the detected defaults consistently", () => {
		const windowsKeybindings = useWindowsKeybindings();
		const nativeWindows = process.platform === "win32";

		expect(KEYBINDINGS["app.clipboard.pasteImage"].defaultKeys).toBe(windowsKeybindings ? "alt+v" : "ctrl+v");
		expect(KEYBINDINGS["tui.altScreen.search"].defaultKeys).toBe(windowsKeybindings ? "ctrl+f" : "ctrl+shift+f");
		expect(KEYBINDINGS["app.message.followUp"].defaultKeys).toEqual(
			windowsKeybindings ? ["ctrl+q", "ctrl+enter"] : ["alt+enter", "ctrl+enter"],
		);
		expect(KEYBINDINGS["app.model.cycleBackward"].defaultKeys).toBe(windowsKeybindings ? "alt+p" : "shift+ctrl+p");
		expect(KEYBINDINGS["tui.editor.undo"].defaultKeys).toBe(
			nativeWindows ? "ctrl+z" : windowsKeybindings ? "alt+z" : "ctrl+-",
		);
		expect(KEYBINDINGS["tui.altScreen.previousPrompt"].defaultKeys).toEqual(
			windowsKeybindings ? "ctrl+up" : ["ctrl+shift+up", "ctrl+up"],
		);
		expect(KEYBINDINGS["tui.altScreen.nextPrompt"].defaultKeys).toEqual(
			windowsKeybindings ? "ctrl+down" : ["ctrl+shift+down", "ctrl+down"],
		);
		expect(KEYBINDINGS["app.message.dequeue"].defaultKeys).toEqual(
			windowsKeybindings ? ["alt+q", "shift+up"] : ["alt+up", "shift+up"],
		);
	});
});

describe("reserved keys", () => {
	it("lists the keys rebinding cannot take", () => {
		expect([...RESERVED_KEYS]).toEqual([
			"ctrl+c",
			"ctrl+d",
			"ctrl+v",
			"shift+tab",
			"escape",
			"alt+left",
			"alt+right",
			"alt+up",
			"alt+down",
		]);
	});

	it("refuses reserved keys from user files but keeps the rest", () => {
		const dir = mkdtempSync(join(tmpdir(), "stela-keys-"));
		writeFileSync(
			join(dir, "keybindings.json"),
			JSON.stringify({ "app.model.select": "ctrl+c", "app.tools.expand": "ctrl+e" }),
		);
		const manager = KeybindingsManager.create(dir);
		expect(manager.getKeys("app.model.select")).not.toContain("ctrl+c");
		expect(manager.getKeys("app.tools.expand")).toContain("ctrl+e");
	});
});
