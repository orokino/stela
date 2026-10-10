import { Box, Container, Markdown, type MarkdownTheme, MouseRegion, Spacer, Text } from "@earendil-works/pi-tui";
import type { CompactionSummaryMessage } from "../../../core/messages.ts";
import { getMarkdownTheme, theme } from "../theme/theme.ts";
import { keyText } from "./keybinding-hints.ts";

/**
 * S7 compaction divider: a full-width dim rule with a `compaction · Nk in · Mk
 * out` token summary, expanding to the summary body on click / ctrl+o. CU tint
 * untouched (customMessageBg stays); the divider shape is OC's
 * (opencode.md U3), the token summary is the audit's pick.
 */
export class CompactionSummaryMessageComponent extends Box {
	private expanded = false;
	private message: CompactionSummaryMessage;
	private markdownTheme: MarkdownTheme;
	private outputPad: number;

	constructor(message: CompactionSummaryMessage, markdownTheme: MarkdownTheme = getMarkdownTheme(), outputPad = 1) {
		// CU tint untouched (S7): the divider shape is new, the surface is not.
		super(outputPad, 1, (t) => theme.bg("customMessageBg", t));
		this.message = message;
		this.markdownTheme = markdownTheme;
		this.outputPad = outputPad;
		this.updateDisplay();
	}

	setExpanded(expanded: boolean): void {
		this.expanded = expanded;
		this.updateDisplay();
	}

	setOutputPad(outputPad: number): void {
		this.outputPad = outputPad;
		this.setPaddingX(outputPad);
	}

	override invalidate(): void {
		super.invalidate();
		this.updateDisplay();
	}

	private dividerLabel(): string {
		const summary = formatCompactionSummary(this.message.tokensBefore);
		return `─── compaction · ${summary} ───`;
	}

	private updateDisplay(): void {
		this.clear();
		const content = new Container();

		const tokenStr = this.message.tokensBefore.toLocaleString();
		if (this.expanded) {
			content.addChild(new Text(theme.fg("customMessageLabel", "─── compaction"), this.outputPad, 0));
			content.addChild(new Spacer(1));
			const header = `**Compacted from ${tokenStr} tokens**\n\n`;
			content.addChild(
				new Markdown(header + this.message.summary, this.outputPad, 0, this.markdownTheme, {
					color: (text: string) => theme.fg("customMessageText", text),
				}),
			);
		} else {
			// Collapsed: the divider rule itself (full-width via the Box shell),
			// plus the existing expand affordance on the next row.
			content.addChild(new Text(theme.fg("dim", this.dividerLabel()), 0, 0));
			content.addChild(
				new Text(
					theme.fg("customMessageText", `Compacted from ${tokenStr} tokens (`) +
						theme.fg("dim", keyText("app.tools.expand")) +
						theme.fg("customMessageText", " to expand)"),
					0,
					0,
				),
			);
		}

		this.addChild(
			new MouseRegion(content, (event) => {
				if (event.type !== "click" || event.button !== "left") return undefined;
				this.setExpanded(!this.expanded);
				return { handled: true };
			}),
		);
	}
}

/** Compact `12k in · 3k out` style summary; only `in` is known today (out TBD). */
export function formatCompactionSummary(tokensBefore: number, tokensAfter?: number): string {
	const compact = (n: number): string =>
		n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1).replace(/\.0$/, "")}k` : `${n}`;
	return tokensAfter === undefined
		? `${compact(tokensBefore)} in`
		: `${compact(tokensBefore)} in · ${compact(tokensAfter)} out`;
}
