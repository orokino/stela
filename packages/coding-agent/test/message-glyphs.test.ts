import { setSymbolPreset } from "@earendil-works/pi-tui";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import {
	formatThinkingLive,
	formatThoughtDuration,
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
});
