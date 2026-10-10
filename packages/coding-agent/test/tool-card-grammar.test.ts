import type { TUI } from "@earendil-works/pi-tui";
import { beforeAll, describe, expect, it } from "vitest";
import { formatToolHead, toolHeadStatus } from "../src/core/tools/render-utils.ts";
import { ExploredGroupComponent, isGroupableToolName } from "../src/modes/interactive/components/explored-group.ts";
import { ToolExecutionComponent } from "../src/modes/interactive/components/tool-execution.ts";
import { initTheme, theme } from "../src/modes/interactive/theme/theme.ts";
import { stripAnsi } from "../src/utils/ansi.ts";

function createFakeTui(): TUI {
	return { requestRender: () => {} } as unknown as TUI;
}

function finishedCard(name: string, id: string): ToolExecutionComponent {
	const card = new ToolExecutionComponent(name, id, {}, {}, undefined, createFakeTui(), process.cwd());
	card.updateResult({ content: [{ type: "text", text: "done" }], isError: false }, false);
	return card;
}

describe("shared tool-card grammar", () => {
	beforeAll(() => initTheme("dark"));

	it("heads every card with status glyph, verb, primary arg, and meta", () => {
		const head = stripAnsi(
			formatToolHead({ theme, status: "ok", verb: "read", primaryArg: "a.ts", meta: "12 lines" }),
		);
		expect(head).toBe("✓ read a.ts 12 lines");
		expect(stripAnsi(formatToolHead({ theme, status: "running", verb: "$", primaryArg: "ls" }))).toBe("● $ ls");
		expect(stripAnsi(formatToolHead({ theme, status: "error", verb: "$", meta: "exit 1" }))).toBe("✗ $ exit 1");
	});

	it("reads running from streaming or pre-start contexts", () => {
		const base = { executionStarted: false, argsComplete: false, isError: false };
		expect(toolHeadStatus({ ...base, isPartial: true })).toBe("running");
		expect(toolHeadStatus({ ...base, isPartial: false })).toBe("running");
		expect(
			toolHeadStatus({ ...base, isPartial: false, executionStarted: true, resultDetails: { exitCode: 0 } }),
		).toBe("ok");
		expect(toolHeadStatus({ ...base, isPartial: false, executionStarted: true, isError: true })).toBe("error");
	});

	it("groups only read and search tools", () => {
		expect(isGroupableToolName("read")).toBe(true);
		expect(isGroupableToolName("grep")).toBe(true);
		expect(isGroupableToolName("find")).toBe(true);
		expect(isGroupableToolName("ls")).toBe(true);
		expect(isGroupableToolName("bash")).toBe(false);
		expect(isGroupableToolName("edit")).toBe(false);
	});

	it("collapses a run to one Explored line and expands to the cards", () => {
		const cards = [finishedCard("read", "g1"), finishedCard("grep", "g2"), finishedCard("read", "g3")];
		const group = new ExploredGroupComponent(cards, 1, false);
		const collapsed = stripAnsi(group.render(80).join("\n"));
		expect(collapsed).toContain("Explored — 2 reads, 1 search");

		group.setExpanded(true);
		const expanded = stripAnsi(group.render(80).join("\n"));
		expect(expanded).toContain("read");
		expect(expanded).toContain("grep");
	});
});
