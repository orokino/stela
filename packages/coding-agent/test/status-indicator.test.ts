import { setSymbolPreset, type TUI, visibleWidth } from "@earendil-works/pi-tui";
import { afterEach, describe, expect, it, vi } from "vitest";
import { KeybindingsManager } from "../src/core/keybindings.ts";
import { CustomEditor } from "../src/modes/interactive/components/custom-editor.ts";
import {
	BranchSummaryStatusIndicator,
	CompactionStatusIndicator,
	formatWorkingElapsed,
	IdleStatus,
	RetryStatusIndicator,
	stallLadderSuffix,
	WorkingStatusIndicator,
	workingStatusMessage,
} from "../src/modes/interactive/components/status-indicator.ts";
import { getEditorTheme, initTheme, theme } from "../src/modes/interactive/theme/theme.ts";
import { stripAnsi } from "../src/utils/ansi.ts";

describe("status indicators", () => {
	afterEach(() => {
		vi.useRealTimers();
	});

	it("keeps idle status at the same height as standalone status indicators", () => {
		const idleStatus = new IdleStatus();

		const lines = idleStatus.render(20);
		expect(lines).toHaveLength(2);
		expect(lines).toEqual([" ".repeat(20), " ".repeat(20)]);
	});

	it("keeps the top border unchanged unless the editor opts in", () => {
		initTheme("dark");
		const tui = {
			requestRender: vi.fn(),
			terminal: { rows: 10 },
		} as unknown as TUI;
		const editor = new CustomEditor(tui, getEditorTheme(), KeybindingsManager.create());
		const indicator = new WorkingStatusIndicator(tui, "Working");
		editor.setWorkingStatusIndicator(indicator);

		expect(stripAnsi(editor.render(20)[0]!)).toBe("─".repeat(20));
		const standaloneLine = indicator.render(20)[1]!;
		expect(standaloneLine).toContain(theme.getFgAnsi("accent"));
		expect(standaloneLine).toContain(theme.getFgAnsi("muted"));
		indicator.dispose();
	});

	it("embeds the working indicator when the editor opts in", () => {
		initTheme("dark");
		const tui = {
			requestRender: vi.fn(),
			terminal: { rows: 10 },
		} as unknown as TUI;
		const editor = new CustomEditor(tui, getEditorTheme(), KeybindingsManager.create(), {
			embedWorkingStatus: true,
		});
		expect(editor.embedWorkingStatus).toBe(true);
		editor.borderColor = theme.getThinkingBorderColor("high");
		const indicator = new WorkingStatusIndicator(tui, "Working", undefined, (text) => editor.borderColor(text));
		editor.setWorkingStatusIndicator(indicator);

		const topBorder = editor.render(20)[0]!;
		expect(stripAnsi(topBorder)).toBe("── ⠈⠞ Working ──────");
		expect(visibleWidth(topBorder)).toBe(20);
		expect(topBorder).toContain(theme.getFgAnsi("thinkingHigh"));
		indicator.dispose();
	});

	it("embeds compaction, summary, and retry labels within the border width", () => {
		initTheme("dark");
		vi.useFakeTimers();
		const tui = { requestRender: vi.fn(), terminal: { rows: 10 } } as unknown as TUI;
		const editor = new CustomEditor(tui, getEditorTheme(), KeybindingsManager.create(), {
			embedWorkingStatus: true,
		});
		const indicators = [
			new CompactionStatusIndicator(tui, "manual"),
			new CompactionStatusIndicator(tui, "threshold"),
			new CompactionStatusIndicator(tui, "overflow"),
			new BranchSummaryStatusIndicator(tui),
			new RetryStatusIndicator(tui, 1, 3, 3000),
		];
		try {
			for (const indicator of indicators) {
				editor.setWorkingStatusIndicator(indicator);
				const label = stripAnsi(indicator.render(120)[1]!).trim();
				expect(stripAnsi(editor.render(120)[0]!)).toContain(`── ${label} `);
				for (const width of [1, 4, 10, 20, 80, 120]) {
					expect(visibleWidth(editor.render(width)[0]!)).toBe(width);
				}
			}
			vi.advanceTimersByTime(1000);
			expect(stripAnsi(editor.render(120)[0]!)).toContain("Retrying (1/3) in 2s");
			editor.setWorkingStatusIndicator(undefined);
			expect(stripAnsi(editor.render(120)[0]!)).toBe("─".repeat(120));
		} finally {
			for (const indicator of indicators) indicator.dispose();
		}
	});

	it("disposes retry countdown updates", () => {
		initTheme("dark");
		vi.useFakeTimers();
		const requestRender = vi.fn();
		const tui = { requestRender } as unknown as TUI;
		const indicator = new RetryStatusIndicator(tui, 1, 3, 1000);
		const callsBeforeDispose = requestRender.mock.calls.length;

		indicator.dispose();
		vi.advanceTimersByTime(2000);

		expect(requestRender).toHaveBeenCalledTimes(callsBeforeDispose);
	});

	it("climbs the stall ladder with words only, no new motion", () => {
		expect(formatWorkingElapsed(3_000)).toBe("3s");
		expect(formatWorkingElapsed(72_000)).toBe("1m12s");
		expect(formatWorkingElapsed(312_000)).toBe("5m12s");
		expect(stallLadderSuffix(9_999)).toBe("");
		expect(stallLadderSuffix(10_000)).toContain("still working");
		expect(stallLadderSuffix(45_000)).toContain("still checking");
		expect(stallLadderSuffix(300_000)).toContain("still alive");
	});

	it("names the running tool after the 2 s line, with ASCII parity", () => {
		const before = workingStatusMessage({
			elapsedMs: 5_000,
			interruptHint: "esc",
			toolName: "read",
			toolElapsedMs: 1_999,
		});
		expect(before).not.toContain("running read");
		expect(
			workingStatusMessage({ elapsedMs: 12_000, interruptHint: "esc", toolName: "read", toolElapsedMs: 12_000 }),
		).toContain("running read for 12s");
		expect(
			workingStatusMessage({ elapsedMs: 47_000, interruptHint: "esc", toolName: "read", toolElapsedMs: 47_000 }),
		).toContain("still checking");
		setSymbolPreset("ascii");
		try {
			expect(
				workingStatusMessage({ elapsedMs: 12_000, interruptHint: "esc", toolName: "read", toolElapsedMs: 12_000 }),
			).toContain("running read for 12s");
			expect(workingStatusMessage({ elapsedMs: 5_000, interruptHint: "esc" })).not.toContain("·");
		} finally {
			setSymbolPreset("unicode");
		}
	});
});
