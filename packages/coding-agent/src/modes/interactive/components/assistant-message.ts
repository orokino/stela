import type { AssistantMessage } from "@earendil-works/pi-ai";
import {
	animationsAllowed,
	Container,
	Markdown,
	type MarkdownTheme,
	MouseRegion,
	SPINNER_INTERVAL_MS,
	Spacer,
	spinnerFrames,
	Text,
} from "@earendil-works/pi-tui";
import type { MarkdownTransformer } from "../../../core/extensions/types.ts";
import { getMarkdownTheme, theme } from "../theme/theme.ts";
import { keyText } from "./keybinding-hints.ts";
import { createMarkdownTransform } from "./markdown-transform.ts";
import {
	formatThinkingLive,
	formatThoughtCollapsed,
	formatThoughtCollapsedDuration,
	formatTurnMetaLine,
} from "./message-glyphs.ts";

const OSC133_ZONE_START = "\x1b]133;A\x07";
const OSC133_ZONE_END = "\x1b]133;B\x07";
const OSC133_ZONE_FINAL = "\x1b]133;C\x07";

/** Live thinking row ticks with the shared spinner cadence. */
const THINKING_TICK_MS = SPINNER_INTERVAL_MS;
/**
 * Component that renders a complete assistant message
 */
export class AssistantMessageComponent extends Container {
	private contentContainer: Container;
	private hideThinkingBlock: boolean;
	private markdownTheme: MarkdownTheme;
	private outputPad: number;
	private markdownTransformers: readonly MarkdownTransformer[];
	private lastMessage?: AssistantMessage;
	private hasToolCalls = false;
	private isStreaming = false;
	private thinkingVisibilityOverrides = new Map<number, boolean>();
	private thinkingStartedAt?: number;
	private thinkingTick?: NodeJS.Timeout;
	private thinkingLiveLabel?: Text;
	private invalidateLiveRow?: () => void;
	private thinkingAnimations = true;

	constructor(
		message?: AssistantMessage,
		hideThinkingBlock = false,
		markdownTheme: MarkdownTheme = getMarkdownTheme(),
		outputPad = 1,
		markdownTransformers: readonly MarkdownTransformer[] = [],
	) {
		super();

		this.hideThinkingBlock = hideThinkingBlock;
		this.markdownTheme = markdownTheme;
		this.outputPad = outputPad;
		this.markdownTransformers = markdownTransformers;

		// Container for text/thinking content
		this.contentContainer = new Container();
		this.addChild(this.contentContainer);

		if (message) {
			this.updateContent(message);
		}
	}

	override invalidate(): void {
		super.invalidate();
		if (this.lastMessage) {
			this.updateContent(this.lastMessage);
		}
	}

	setHideThinkingBlock(hide: boolean): void {
		this.hideThinkingBlock = hide;
		this.thinkingVisibilityOverrides.clear();
		if (this.lastMessage) {
			this.updateContent(this.lastMessage);
		}
	}

	/**
	 * S8: per-run expand/collapse for the global ctrl+o transcript toggle (which
	 * sweeps every Expandable child). Sets each run's override explicitly so the
	 * toggle direction wins over the hideThinkingBlock default.
	 */
	setExpanded(expanded: boolean): void {
		const runs = this.thinkingVisibilityOverrides.size;
		if (this.lastMessage) {
			let runCount = 0;
			let inRun = false;
			for (const c of this.lastMessage.content) {
				if (c.type === "thinking") {
					if (!inRun) {
						inRun = true;
						runCount++;
					}
				} else {
					inRun = false;
				}
			}
			for (let i = 0; i < Math.max(runCount, runs); i++) {
				this.thinkingVisibilityOverrides.set(i, !expanded);
			}
			this.updateContent(this.lastMessage);
		}
	}

	/** Monotonic start of the current thinking run; set by the interactive mode on thinking_start. */
	setThinkingStartedAt(startedAt: number | undefined): void {
		this.thinkingStartedAt = startedAt;
	}

	/**
	 * Redraw hook for the live thinking row's elapsed clock. The interactive mode wires
	 * `ui.requestRender`; without it the row still updates on every streamed delta.
	 */
	setThinkingLiveInvalidator(invalidate: (() => void) | undefined): void {
		this.invalidateLiveRow = invalidate;
	}

	/** False freezes the live row on its first frame (reduced motion); deltas still repaint it. */
	setThinkingAnimations(enabled: boolean): void {
		this.thinkingAnimations = enabled;
	}

	setOutputPad(padding: number): void {
		this.outputPad = padding;
		if (this.lastMessage) {
			this.updateContent(this.lastMessage);
		}
	}

	override render(width: number): string[] {
		const lines = super.render(width);
		if (this.hasToolCalls || lines.length === 0) {
			return lines;
		}

		lines[0] = OSC133_ZONE_START + lines[0];
		lines[lines.length - 1] = OSC133_ZONE_END + OSC133_ZONE_FINAL + lines[lines.length - 1];
		return lines;
	}

	updateContent(message: AssistantMessage, isStreaming = this.isStreaming): void {
		this.lastMessage = message;
		this.isStreaming = isStreaming;

		// Clear content container
		this.contentContainer.clear();
		this.thinkingLiveLabel = undefined;

		const hasVisibleContent = message.content.some(
			(c) => (c.type === "text" && c.text.trim()) || (c.type === "thinking" && c.thinking.trim()),
		);

		if (hasVisibleContent) {
			this.contentContainer.addChild(new Spacer(1));
		}

		// Render content in order
		let thinkingRunIndex = 0;
		for (let i = 0; i < message.content.length; i++) {
			const content = message.content[i];
			if (content.type === "text" && content.text.trim()) {
				// Assistant text messages with no background - trim the text
				// Set paddingY=0 to avoid extra spacing before tool executions
				this.contentContainer.addChild(
					new Markdown(content.text.trim(), this.outputPad, 0, this.markdownTheme, undefined, {
						transform: createMarkdownTransform("assistant", this.isStreaming, this.markdownTransformers),
					}),
				);
			} else if (content.type === "thinking") {
				// A live run renders its spinner row from thinking_start on, even before the first
				// non-empty delta arrives; otherwise the row appears only once thinking is done.
				const thinkingBlocks: string[] = [];
				for (; i < message.content.length; i++) {
					const thinkingContent = message.content[i];
					if (thinkingContent.type !== "thinking") {
						break;
					}
					const thinking = thinkingContent.thinking.trim();
					if (thinking) {
						thinkingBlocks.push(thinking);
					}
				}
				i--;

				// While streaming, only the last thinking run is still live; earlier runs already ended.
				const isLiveRun =
					this.isStreaming &&
					this.thinkingStartedAt !== undefined &&
					!message.content.slice(i + 1).some((c) => c.type === "thinking");
				const runIndex = thinkingRunIndex++;

				if (thinkingBlocks.length === 0 && !isLiveRun) {
					continue;
				}

				// Add spacing only when another visible assistant content block follows.
				// This avoids a superfluous blank line before separately-rendered tool execution blocks.
				const hasVisibleContentAfter = message.content
					.slice(i + 1)
					.some((c) => (c.type === "text" && c.text.trim()) || (c.type === "thinking" && c.thinking.trim()));

				const hidden = this.thinkingVisibilityOverrides.get(runIndex) ?? this.hideThinkingBlock;
				if (isLiveRun && hidden) {
					this.renderLiveThinkingRow(runIndex);
				} else if (hidden) {
					// S8 one-line collapse: `+ Thought · <duration> · <N> lines · <key>
					// to expand`. Count + key are CU's affordance (cursor-agent.md U3)
					// grafted onto OC's one-line shape (opencode.md U3) — synthesis,
					// uniform on all durations including <1s. Key is live-resolved so
					// the hint can never go stale.
					const hiddenLines = thinkingBlocks.join("\n").split("\n").length;
					const label = formatThoughtCollapsed(
						formatThoughtCollapsedDuration(message.durationMs),
						hiddenLines,
						keyText("app.tools.expand"),
					);
					const thinkingComponent = new Text(theme.fg("dim", label), this.outputPad, 0);
					this.contentContainer.addChild(
						new MouseRegion(thinkingComponent, (event) => {
							if (event.type !== "click" || event.button !== "left") return undefined;
							this.thinkingVisibilityOverrides.set(runIndex, !hidden);
							if (this.lastMessage) this.updateContent(this.lastMessage);
							return { handled: true };
						}),
					);
				} else {
					const thinkingComponent = new Markdown(
						thinkingBlocks.join("\n\n"),
						this.outputPad,
						0,
						this.markdownTheme,
						{
							color: (text: string) => theme.fg("thinkingText", text),
							italic: true,
						},
						{
							transform: createMarkdownTransform(
								"assistant-thinking",
								this.isStreaming,
								this.markdownTransformers,
							),
						},
					);
					this.contentContainer.addChild(
						new MouseRegion(thinkingComponent, (event) => {
							if (event.type !== "click" || event.button !== "left") return undefined;
							this.thinkingVisibilityOverrides.set(runIndex, !hidden);
							if (this.lastMessage) this.updateContent(this.lastMessage);
							return { handled: true };
						}),
					);
				}
				if (hasVisibleContentAfter) {
					this.contentContainer.addChild(new Spacer(1));
				}
			}
		}

		// S7 transcript tail: muted meta line (`duration · tok/s`, no model — the
		// composer border owns it), then a muted `· interrupted` for aborts (never
		// error colour: an interrupt is a user action, not a failure).
		const hasToolCalls = message.content.some((c) => c.type === "toolCall");
		this.hasToolCalls = hasToolCalls;
		if (message.stopReason === "length") {
			this.contentContainer.addChild(new Spacer(1));
			this.contentContainer.addChild(
				new Text(theme.fg("error", "Response was truncated before completion."), this.outputPad, 0),
			);
		} else if (!hasToolCalls) {
			if (message.stopReason === "aborted") {
				// S7: muted `· interrupted`, never red. Custom abort reasons (retry
				// counts) still surface, but plain cancels collapse to the literal.
				const customAbort =
					message.errorMessage &&
					message.errorMessage !== "Request was aborted" &&
					message.errorMessage !== "Operation aborted"
						? ` · ${message.errorMessage}`
						: "";
				this.contentContainer.addChild(new Spacer(1));
				this.contentContainer.addChild(
					new Text(
						theme.fg(
							"dim",
							`${formatTurnMetaLine(message.durationMs, message.usage?.totalTokens)} · interrupted${customAbort}`,
						),
						this.outputPad,
						0,
					),
				);
			} else if (message.stopReason === "error") {
				const errorMsg = message.errorMessage || "Unknown error";
				this.contentContainer.addChild(new Spacer(1));
				this.contentContainer.addChild(new Text(theme.fg("error", `Error: ${errorMsg}`), this.outputPad, 0));
			} else if (!isStreaming && message.usage && hasVisibleContent && !hasToolCalls) {
				this.contentContainer.addChild(new Spacer(1));
				this.contentContainer.addChild(
					new Text(
						theme.fg("dim", formatTurnMetaLine(message.durationMs, message.usage?.totalTokens)),
						this.outputPad,
						0,
					),
				);
			}
		}
		// A finished or fully visible turn owns no live row; stop its clock.
		if (!isStreaming || this.thinkingLiveLabel === undefined) {
			this.stopThinkingTick();
		}
	}

	private renderLiveThinkingRow(runIndex: number): void {
		const label = new Text("", this.outputPad, 0);
		this.thinkingLiveLabel = label;
		this.paintLiveThinkingRow(label);
		this.contentContainer.addChild(
			new MouseRegion(label, (event) => {
				if (event.type !== "click" || event.button !== "left") return undefined;
				this.thinkingVisibilityOverrides.set(runIndex, false);
				if (this.lastMessage) this.updateContent(this.lastMessage);
				return { handled: true };
			}),
		);
		if (this.thinkingTick === undefined && animationsAllowed(this.thinkingAnimations)) {
			this.thinkingTick = setInterval(() => {
				if (this.thinkingLiveLabel === undefined || this.thinkingStartedAt === undefined) {
					this.stopThinkingTick();
					return;
				}
				this.paintLiveThinkingRow(this.thinkingLiveLabel);
				this.invalidateLiveRow?.();
			}, THINKING_TICK_MS);
			this.thinkingTick.unref?.();
		}
	}

	private paintLiveThinkingRow(label: Text): void {
		const elapsed = performance.now() - (this.thinkingStartedAt ?? performance.now());
		const frames = spinnerFrames();
		const frame = frames[Math.floor(elapsed / THINKING_TICK_MS) % frames.length];
		label.setText(theme.fg("dim", `${frame} ${formatThinkingLive(elapsed)}`));
	}

	private stopThinkingTick(): void {
		if (this.thinkingTick !== undefined) {
			clearInterval(this.thinkingTick);
			this.thinkingTick = undefined;
		}
		this.thinkingLiveLabel = undefined;
	}
}
