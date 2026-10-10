import { setKeybindings } from "@earendil-works/pi-tui";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { KeybindingsManager } from "../src/core/keybindings.ts";
import { SelectSubmenu } from "../src/modes/interactive/components/settings-submenu.ts";
import { initTheme } from "../src/modes/interactive/theme/theme.ts";
import { stripAnsi } from "../src/utils/ansi.ts";

describe("SelectSubmenu live footer and clamp", () => {
	beforeAll(() => {
		initTheme("dark");
	});
	beforeEach(() => {
		setKeybindings(new KeybindingsManager());
	});

	it("composes the footer from live keybindings", () => {
		const menu = new SelectSubmenu(
			"Title",
			"Description",
			[
				{ value: "a", label: "a" },
				{ value: "b", label: "b" },
			],
			"a",
			() => {},
			() => {},
		);
		expect(stripAnsi(menu.render(80).join("\n"))).toContain("enter select");
		expect(stripAnsi(menu.render(80).join("\n"))).toContain("go back");
	});

	it("follows rebinding in the footer", () => {
		setKeybindings(new KeybindingsManager({ "tui.select.confirm": "ctrl+m" }));
		const menu = new SelectSubmenu(
			"Title",
			"Description",
			[{ value: "a", label: "a" }],
			"a",
			() => {},
			() => {},
		);
		expect(stripAnsi(menu.render(80).join("\n"))).toContain("ctrl+m select");
	});

	it("clamps tall option lists with selectListHeight", () => {
		const options = Array.from({ length: 40 }, (_, i) => ({ value: `v${i}`, label: `label-${i}` }));
		const menu = new SelectSubmenu(
			"Title",
			"Description",
			options,
			"v0",
			() => {},
			() => {},
			undefined,
			{
				terminalRows: 24,
			},
		);
		const output = stripAnsi(menu.render(80).join("\n"));
		const rowCount = output.split("\n").filter((line) => line.includes("label-")).length;
		expect(rowCount).toBe(12);
		expect(output).toContain("more");
	});
});
