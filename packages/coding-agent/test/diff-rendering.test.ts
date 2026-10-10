import chalk from "chalk";
import { beforeAll, describe, expect, it } from "vitest";
import {
	countDiffLines,
	DIFF_COLLAPSED_HUNKS,
	DIFF_COLLAPSED_LINES,
	renderDiff,
} from "../src/modes/interactive/components/diff.ts";
import { initTheme } from "../src/modes/interactive/theme/theme.ts";
import { stripAnsi } from "../src/utils/ansi.ts";

describe("diff rendering", () => {
	beforeAll(() => initTheme("dark"));

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
});
