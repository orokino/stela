import { setSymbolPreset } from "@earendil-works/pi-tui";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import {
	formatThinkingLive,
	formatThoughtCollapsed,
	formatThoughtCollapsedDuration,
	formatThoughtDuration,
	formatTurnMetaLine,
	MESSAGE_GLYPHS,
	MESSAGE_GLYPHS_ASCII,
	messageGlyph,
} from "../src/modes/interactive/components/message-glyphs.ts";
import { UserMessageComponent } from "../src/modes/interactive/components/user-message.ts";
import { initTheme } from "../src/modes/interactive/theme/theme.ts";

const visible = (line: string) => line.replace(/\x1b\[[0-9;]*m/g, "").replace(/\x1b\]133;[ABC]\x07/g, "");

describe("message glyphs", () => {
	beforeAll(() => initTheme(undefined, false));
	afterEach(() => setSymbolPreset("unicode"));

	it("names one glyph per notice kind in both alphabets", () => {
		expect(Object.keys(MESSAGE_GLYPHS).sort()).toEqual(Object.keys(MESSAGE_GLYPHS_ASCII).sort());
		expect(messageGlyph("warning")).toBe("⚠");
		setSymbolPreset("ascii");
		expect(messageGlyph("warning")).toBe("!");
		expect(messageGlyph("error")).toBe("x");
		expect(messageGlyph("notice")).toBe("i");
	});

	it("renders user rows as a plain tinted block with no gutter", () => {
		const component = new UserMessageComponent("hello");
		const lines = component.render(40).map(visible);
		expect(lines.length).toBeGreaterThan(0);
		for (const line of lines) expect(line.startsWith("│")).toBe(false);
		expect(lines.join("\n")).toContain("hello");
	});

	it("labels finished thinking with its duration", () => {
		expect(formatThoughtDuration(undefined)).toBe("Thought");
		expect(formatThoughtDuration(400)).toBe("Thought · <1s");
		expect(formatThoughtDuration(3200)).toBe("Thought · 3s");
		expect(formatThoughtDuration(125000)).toBe("Thought · 2m 05s");
	});

	it("labels live thinking with elapsed time", () => {
		expect(formatThinkingLive(0)).toBe("Thinking… 0s");
		expect(formatThinkingLive(7000)).toBe("Thinking… 7s");
		expect(formatThinkingLive(61000)).toBe("Thinking… 1m 01s");
	});

	it("collapses thinking to duration, count, and key on one line", () => {
		expect(formatThoughtCollapsed("3s", 12, "ctrl+o")).toBe("+ Thought · 3s · 12 lines · ctrl+o to expand");
		expect(formatThoughtCollapsed("<1s", 1, "ctrl+o")).toBe("+ Thought · <1s · 1 line · ctrl+o to expand");
		expect(formatThoughtCollapsedDuration(3200)).toBe("3s");
		setSymbolPreset("ascii");
		try {
			expect(formatThoughtCollapsed("3s", 2, "ctrl+o")).toContain("to expand");
		} finally {
			setSymbolPreset("unicode");
		}
	});

	it("formats the transcript meta line as duration and tok/s without a model", () => {
		expect(formatTurnMetaLine(3600, 27)).toBe("3.6s · 7.5 tok/s");
		expect(formatTurnMetaLine(3200, undefined)).toBe("3.2s");
		expect(formatTurnMetaLine(undefined, 100)).toBe("--");
		expect(formatTurnMetaLine(3600, 27)).not.toContain("gpt");
	});
});
