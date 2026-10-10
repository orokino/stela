import { type Component, Loader, pickSymbol, type TUI, truncateToWidth } from "@earendil-works/pi-tui";
import type { WorkingIndicatorOptions } from "../../../core/extensions/index.ts";
import { theme } from "../theme/theme.ts";
import { CountdownTimer } from "./countdown-timer.ts";
import { keyText } from "./keybinding-hints.ts";

/** Stall ladder (CC U6 `Un=[1e4,45000,300000]`): words change with elapsed time, zero new motion. */
export const STALL_LADDER_10_S = 10_000;
export const STALL_LADDER_45_S = 45_000;
export const STALL_LADDER_300_S = 300_000;
/** A tool running this long earns its own transcript-live line (CC U6, 2 s). */
export const RUNNING_TOOL_LINE_MS = 2_000;

/** Format elapsed ms as `Ns` below a minute, else `MmSSs` (CC U6 `Jt(e,t)` shape, words only). */
export function formatWorkingElapsed(elapsedMs: number): string {
	const totalSeconds = Math.max(0, Math.floor(elapsedMs / 1000));
	if (totalSeconds < 60) return `${totalSeconds}s`;
	const minutes = Math.floor(totalSeconds / 60);
	const seconds = totalSeconds % 60;
	return `${minutes}m${String(seconds).padStart(2, "0")}s`;
}

/**
 * Stall-ladder suffix for the working row: nothing below 10 s, then the three CC words.
 * Pure information on the existing row; the spinner frames and cadence never change.
 */
export function stallLadderSuffix(elapsedMs: number): string {
	const dash = pickSymbol(" — ", " - ");
	const dots = pickSymbol("…", "...");
	if (elapsedMs >= STALL_LADDER_300_S) return `${dash}still alive`;
	if (elapsedMs >= STALL_LADDER_45_S) return `${dash}still checking${dots}`;
	if (elapsedMs >= STALL_LADDER_10_S) return `${dash}still working${dots}`;
	return "";
}

/**
 * Working-row message with elapsed time and the stall ladder. The 2 s running-tool line names
 * the tool in the transcript live row once it has run that long (`running read for 12s`).
 */
export function workingStatusMessage(options: {
	toolName?: string;
	toolElapsedMs?: number;
	elapsedMs: number;
	interruptHint: string;
}): string {
	const elapsed = formatWorkingElapsed(options.elapsedMs);
	if (
		options.toolName !== undefined &&
		options.toolElapsedMs !== undefined &&
		options.toolElapsedMs >= RUNNING_TOOL_LINE_MS
	) {
		const toolElapsed = formatWorkingElapsed(options.toolElapsedMs);
		return `Working ${pickSymbol("·", "/")} running ${options.toolName} for ${toolElapsed}${stallLadderSuffix(options.elapsedMs)} (${options.interruptHint} to interrupt)`;
	}
	return `Working (${options.interruptHint} to interrupt) ${pickSymbol("·", "/")} ${elapsed}${stallLadderSuffix(options.elapsedMs)}`;
}

export type StatusIndicatorKind = "working" | "retry" | "compaction" | "branchSummary";

export class StatusIndicator extends Loader {
	readonly kind: StatusIndicatorKind;

	constructor(
		kind: StatusIndicatorKind,
		ui: TUI,
		spinnerColorFn: (str: string) => string,
		messageColorFn: (str: string) => string,
		message: string,
		indicator?: WorkingIndicatorOptions,
	) {
		super(ui, spinnerColorFn, messageColorFn, message, indicator);
		this.kind = kind;
	}

	renderInBorder(width: number): string {
		const line = super.render(width + 2)[1] ?? "";
		return truncateToWidth(line.startsWith(" ") ? line.slice(1).trimEnd() : line.trimEnd(), width, "");
	}

	renderSpinnerInBorder(width: number): string {
		return truncateToWidth(this.getRenderedIndicator(), width, "");
	}

	dispose(): void {
		this.stop();
	}
}

export class WorkingStatusIndicator extends StatusIndicator {
	private startedAt = Date.now();
	private toolName: string | undefined = undefined;
	private toolStartedAt: number | undefined = undefined;
	private readonly interruptHint: string;
	private ladderTimer: NodeJS.Timeout | undefined;

	constructor(ui: TUI, message: string, indicator?: WorkingIndicatorOptions, colorFn?: (text: string) => string) {
		super(
			"working",
			ui,
			colorFn ?? ((text) => theme.fg("accent", text)),
			colorFn ?? ((text) => theme.fg("muted", text)),
			message,
			indicator,
		);
		this.interruptHint = keyText("app.interrupt");
	}

	/** Name the running tool in the transcript live row once it passes the 2 s line. */
	setRunningTool(toolName: string | undefined): void {
		this.toolName = toolName;
		this.toolStartedAt = toolName === undefined ? undefined : Date.now();
		this.refreshLadder();
	}

	/** Refresh the elapsed ladder text (called by the render tick while streaming). */
	refreshLadder(): void {
		const now = Date.now();
		this.setMessage(
			workingStatusMessage({
				toolName: this.toolName,
				toolElapsedMs: this.toolStartedAt === undefined ? undefined : now - this.toolStartedAt,
				elapsedMs: now - this.startedAt,
				interruptHint: this.interruptHint,
			}),
		);
		if (this.toolName !== undefined && this.ladderTimer === undefined) {
			this.ladderTimer = setInterval(() => this.refreshLadder(), 1000);
		} else if (this.toolName === undefined && this.ladderTimer !== undefined) {
			clearInterval(this.ladderTimer);
			this.ladderTimer = undefined;
		}
	}

	override dispose(): void {
		if (this.ladderTimer !== undefined) {
			clearInterval(this.ladderTimer);
			this.ladderTimer = undefined;
		}
		super.dispose();
	}
}

export class RetryStatusIndicator extends StatusIndicator {
	private countdown: CountdownTimer | undefined;

	constructor(ui: TUI, attempt: number, maxAttempts: number, delayMs: number) {
		const retryMessage = (seconds: number) =>
			`Retrying (${attempt}/${maxAttempts}) in ${seconds}s... (${keyText("app.interrupt")} to cancel)`;
		super(
			"retry",
			ui,
			(spinner) => theme.fg("warning", spinner),
			(text) => theme.fg("muted", text),
			retryMessage(Math.ceil(delayMs / 1000)),
		);
		this.countdown = new CountdownTimer(
			delayMs,
			ui,
			(seconds) => {
				this.setMessage(retryMessage(seconds));
			},
			() => {
				this.countdown = undefined;
			},
		);
	}

	override dispose(): void {
		this.countdown?.dispose();
		this.countdown = undefined;
		super.dispose();
	}
}

export type CompactionStatusReason = "manual" | "threshold" | "overflow";

export class CompactionStatusIndicator extends StatusIndicator {
	constructor(ui: TUI, reason: CompactionStatusReason) {
		const cancelHint = `(${keyText("app.interrupt")} to cancel)`;
		const label =
			reason === "manual"
				? `Compacting context... ${cancelHint}`
				: `${reason === "overflow" ? "Context overflow detected, " : ""}Auto-compacting... ${cancelHint}`;
		super(
			"compaction",
			ui,
			(spinner) => theme.fg("accent", spinner),
			(text) => theme.fg("muted", text),
			label,
		);
	}
}

export class BranchSummaryStatusIndicator extends StatusIndicator {
	constructor(ui: TUI) {
		super(
			"branchSummary",
			ui,
			(spinner) => theme.fg("accent", spinner),
			(text) => theme.fg("muted", text),
			`Summarizing branch... (${keyText("app.interrupt")} to cancel)`,
		);
	}
}

export class IdleStatus implements Component {
	invalidate(): void {
		// No cached state to invalidate.
	}

	render(width: number): string[] {
		const emptyLine = " ".repeat(width);
		return [emptyLine, emptyLine];
	}
}
