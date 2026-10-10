import { beforeAll, describe, expect, it } from "vitest";
import {
	stelaCardFits,
	stelaCardLines,
	stelaNarrowLines,
} from "../src/modes/interactive/components/stela-startup-card.ts";
import { initTheme } from "../src/modes/interactive/theme/theme.ts";

const MENU = [
	{ label: "New session", hint: "/new" },
	{ label: "Resume session", hint: "/resume" },
	{ label: "Settings", hint: "/settings" },
	{ label: "Quit", hint: "/quit" },
];
const card = (columns: number, rows: number) =>
	stelaCardLines({ title: "Stela  1.1.0", tagline: "A model-agnostic coding agent.", menu: MENU, columns, rows });
const visible = (line: string) => line.replace(/\x1b\[[0-9;]*m/g, "");

describe("stela startup card", () => {
	beforeAll(() => initTheme(undefined, false));

	it("draws a 78-cell frame with the mark, title and menu", () => {
		const lines = card(120, 40);
		expect(lines).toHaveLength(12);
		// Centred: every line carries the same left indent and the frame is 78 cells.
		const indents = lines.map((line) => (visible(line).match(/^ */) ?? [""])[0].length);
		expect(indents.every((indent) => indent === indents[0])).toBe(true);
		for (const line of lines) expect(visible(line).trimEnd()).toHaveLength(78 + indents[0]);
		expect(visible(lines[0] ?? "").trimEnd()).toMatch(/^ *╭─+╮$/);
		expect(visible(lines[11] ?? "").trimEnd()).toMatch(/^ *╰─+╯$/);
		expect(visible(lines[2] ?? "")).toContain("Stela");
		expect(visible(lines[2] ?? "")).toContain("1.1.0");
		const text = lines.map(visible).join("\n");
		for (const item of MENU) expect(text).toContain(item.hint);
		// Menu hints share one right edge: every menu line's content ends at the same column.
		const ends = lines
			.map(visible)
			.map((line) => line.trimEnd())
			.filter((line) => /\/(new|resume|settings|quit)\s*│$/.test(line))
			.map((line) => line.replace(/\s*│$/, "").length);
		expect(ends).toHaveLength(MENU.length);
		expect(ends.every((end) => end === ends[0])).toBe(true);
	});

	it("falls back to the narrow form when the frame does not fit", () => {
		expect(stelaCardFits(57, 40)).toBe(false);
		expect(stelaCardFits(120, 11)).toBe(false);
		expect(stelaCardFits(60, 12)).toBe(true);
		expect(stelaCardFits(120, 12)).toBe(true);
		const narrow = card(50, 40).map(visible);
		expect(narrow[0]).toMatch(/^[|▌] Stela {2}1\.1\.0$/);
		expect(narrow.join("\n")).not.toContain("╭");
		expect(narrow).toEqual(stelaNarrowLines("Stela  1.1.0", MENU).map(visible));
	});

	it("uses the ASCII mark and no colour sequences when the terminal cannot show them", () => {
		const asciiLines = stelaCardLines({
			title: "Stela  1.1.0",
			tagline: "A model-agnostic coding agent.",
			menu: MENU,
			columns: 120,
			rows: 40,
			ascii: true,
		}).map(visible);
		expect(asciiLines.join("\n")).not.toContain("░");
		expect(asciiLines.join("\n")).toContain(":::::");
		const narrowAscii = stelaNarrowLines("Stela  1.1.0", MENU, true).map(visible);
		expect(narrowAscii[0]).toBe("| Stela  1.1.0");
	});
});
