import { resetCapabilitiesCache, setCapabilityOverrides, setSymbolPreset } from "@earendil-works/pi-tui";
import chalk from "chalk";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import {
	countDiffLines,
	DIFF_BINARY_HIDDEN_COPY,
	DIFF_COLLAPSED_HUNKS,
	DIFF_COLLAPSED_LINES,
	DIFF_UNRENDERABLE_COPY,
	renderDiff,
} from "../src/modes/interactive/components/diff.ts";
import { getThemeByName, initTheme, setThemeInstance, theme } from "../src/modes/interactive/theme/theme.ts";
import { stripAnsi } from "../src/utils/ansi.ts";

describe("diff rendering", () => {
	beforeAll(() => initTheme("dark"));
	afterEach(() => resetCapabilitiesCache());

	it("drops add/remove backgrounds on Ansi16 while signs keep the signal", () => {
		setCapabilityOverrides({ trueColor: false, colorMode: "16color" });
		setThemeInstance(getThemeByName("dark") ?? theme);
		try {
			const rendered = renderDiff("-1 gone\n+1 brand new");
			expect(theme.getColorMode()).toBe("16color");
			// No 48;2 / 48;5 background escapes: foreground signs carry the meaning.
			expect(rendered).not.toMatch(/\x1b\[48;[25];/);
			expect(stripAnsi(rendered)).toContain("-");
			expect(stripAnsi(rendered)).toContain("+");
		} finally {
			resetCapabilitiesCache();
			setThemeInstance(getThemeByName("dark") ?? theme);
		}
	});

	it("highlights word changes only for similar 1-to-1 pairs", () => {
		chalk.level = 1;
		try {
			const similar = renderDiff("-1 const alpha = 1;\n+1 const alpha = 2;");
			expect(similar).toContain("\x1b[7m");
			const noisy = renderDiff("-1 const alpha = 1;\n+1 something entirely different here yes");
			expect(noisy).not.toContain("\x1b[7m");
		} finally {
			chalk.level = 0;
		}
	});

	it("renders hunk breaks as a dim separator, not a header", () => {
		const rendered = stripAnsi(renderDiff(" 1 first\n   ...\n 9 ninth"));
		expect(rendered).toContain("⋮");
		expect(rendered).not.toContain("...");
	});

	it("collapses past the shared line and hunk budget", () => {
		expect(DIFF_COLLAPSED_LINES).toBe(40);
		expect(DIFF_COLLAPSED_HUNKS).toBe(8);
		const lines = Array.from({ length: 50 }, (_, i) => `+${i + 1} added ${i + 1}`).join("\n");
		const rendered = stripAnsi(renderDiff(lines, { maxLines: DIFF_COLLAPSED_LINES }));
		expect(rendered).toContain("… (");
		expect(rendered).toContain("more line");
		expect(rendered).not.toContain("added 50");
	});

	it("counts per-file additions and removals for the header", () => {
		expect(countDiffLines("-1 old\n+1 new\n 2 same\n+3 extra")).toEqual({ added: 2, removed: 1 });
	});

	it("ends the collapsed tail with a live expand hint", () => {
		const lines = Array.from({ length: 50 }, (_, i) => `+${i + 1} added ${i + 1}`).join("\n");
		expect(stripAnsi(renderDiff(lines, { maxLines: DIFF_COLLAPSED_LINES }))).toContain("to expand");
		setSymbolPreset("ascii");
		try {
			expect(stripAnsi(renderDiff(lines, { maxLines: DIFF_COLLAPSED_LINES }))).toContain("to expand");
		} finally {
			setSymbolPreset("unicode");
		}
	});

	it("keeps edge-state copy as zero-chrome literals", () => {
		expect(DIFF_BINARY_HIDDEN_COPY).toContain("Binary file diff hidden");
		expect(DIFF_BINARY_HIDDEN_COPY).toContain("keep or undo");
		expect(DIFF_UNRENDERABLE_COPY).toContain("keep or undo");
	});

	it("renders the binary literal for NUL-containing diffs", () => {
		const rendered = stripAnsi(renderDiff("-1 EL\0F binary\n+1 EL\0F changed"));
		expect(rendered).toContain("Binary file diff hidden");
		expect(rendered).toContain("keep or undo");
		expect(rendered).not.toContain("EL");
	});
});
