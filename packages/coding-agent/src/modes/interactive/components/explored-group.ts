import { Box, Container, MouseRegion, pickSymbol, Spacer, Text } from "@earendil-works/pi-tui";
import { theme } from "../theme/theme.ts";
import type { ToolExecutionComponent } from "./tool-execution.ts";

/**
 * Collapsed view of 3+ consecutive read/search calls: one dim summary line
 * (`Explored — N reads, N searches`) that expands to the full cards on click
 * or when the transcript-wide `ctrl+o` toggle expands tool output. The expanded
 * shell is a padding-only Box (identity bg, no tint — status stays in the head
 * glyph + words).
 */
export class ExploredGroupComponent extends Container {
	private readonly cards: ToolExecutionComponent[];
	private readonly reads: number;
	private readonly searches: number;
	private expanded: boolean;
	private readonly outputPad: number;

	constructor(cards: ToolExecutionComponent[], outputPad = 1, expanded = false) {
		super();
		this.cards = cards;
		this.outputPad = outputPad;
		this.expanded = expanded;
		let reads = 0;
		let searches = 0;
		for (const card of cards) {
			if (card.toolName === "read") reads++;
			else searches++;
		}
		this.reads = reads;
		this.searches = searches;
		this.rebuild();
	}

	setExpanded(expanded: boolean): void {
		this.expanded = expanded;
		this.rebuild();
	}

	get toolCards(): readonly ToolExecutionComponent[] {
		return this.cards;
	}

	private rebuild(): void {
		this.clear();
		this.addChild(new Spacer(1));
		if (this.expanded) {
			const box = new Box(1, 1, (text: string) => text);
			for (const card of this.cards) {
				box.addChild(card);
			}
			this.addChild(box);
			return;
		}
		const parts: string[] = [];
		if (this.reads > 0) parts.push(`${this.reads} read${this.reads === 1 ? "" : "s"}`);
		if (this.searches > 0) parts.push(`${this.searches} search${this.searches === 1 ? "" : "es"}`);
		const label = new Text(
			theme.fg("dim", `Explored ${pickSymbol("—", "-")} ${parts.join(", ")}`),
			this.outputPad,
			0,
		);
		this.addChild(
			new MouseRegion(label, (event) => {
				if (event.type !== "click" || event.button !== "left") return undefined;
				this.setExpanded(true);
				return { handled: true };
			}),
		);
	}
}

export function isGroupableToolName(name: string): boolean {
	return name === "read" || name === "grep" || name === "find" || name === "ls";
}
