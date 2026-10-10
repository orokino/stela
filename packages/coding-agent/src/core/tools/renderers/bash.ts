/**
 * Presentation for the shell tools.
 *
 * Renderers live apart from the implementation so a process that only displays tool output does not
 * load the execution path or its typebox parameter schema. `bash.ts` spreads these into the shell
 * tool definition, so the tool's public shape is unchanged.
 */

import { Container, Spacer, Text } from "@earendil-works/pi-tui";
import { keyHint } from "../../../modes/interactive/components/keybinding-hints.ts";
import { VisualLinePreview } from "../../../modes/interactive/components/visual-truncate.ts";
import { theme } from "../../../modes/interactive/theme/theme.ts";
import type { ToolDefinition, ToolRenderResultOptions } from "../../extensions/types.ts";
import type { BashToolDetails } from "../bash.ts";
import { formatToolHead, getTextOutput, invalidArgText, str, toolHeadStatus } from "../render-utils.ts";
import { DEFAULT_MAX_BYTES, formatSize } from "../truncate.ts";
import { TRUNCATION_TABLE } from "../truncation-table.ts";

const BASH_PREVIEW_LINES = TRUNCATION_TABLE.outputCollapsed;
export const BASH_UPDATE_THROTTLE_MS = 100;
export const BASH_LIVE_TICK_MS = 100;
/**
 * Signal number to name for 128+N shell exit codes (S6: `exit N (signal)` status
 * words). Only the signals a shell plausibly reports; unknown numbers render as
 * bare `exit N` so the head never claims a precision the wait status lacks.
 */
export function signalNameForExitCode(exitCode: number): string | undefined {
	const signals: Record<number, string> = {
		1: "SIGHUP",
		2: "SIGINT",
		3: "SIGQUIT",
		4: "SIGILL",
		5: "SIGTRAP",
		6: "SIGABRT",
		7: "SIGBUS",
		8: "SIGFPE",
		9: "SIGKILL",
		10: "SIGUSR1",
		11: "SIGSEGV",
		12: "SIGUSR2",
		13: "SIGPIPE",
		14: "SIGALRM",
		15: "SIGTERM",
	};
	return exitCode > 128 && exitCode <= 128 + 15 ? signals[exitCode - 128] : undefined;
}
function formatDuration(ms: number): string {
	const seconds = ms / 1000;
	if (seconds < 60) return `${seconds.toFixed(1)}s`;

	const totalSeconds = Math.floor(seconds);
	const minutes = Math.floor(totalSeconds / 60);
	const remainder = totalSeconds % 60;
	if (minutes < 60) return `${minutes}m ${remainder}s`;

	return `${Math.floor(minutes / 60)}h ${minutes % 60}m ${remainder}s`;
}
function formatShellCall(
	args: { command?: string; timeout?: number } | undefined,
	prompt: string,
	theme: Parameters<typeof formatToolHead>[0]["theme"],
	status: "running" | "ok" | "error",
	meta?: string,
): string {
	const command = str(args?.command);
	const timeout = args?.timeout as number | undefined;
	const timeoutSuffix = timeout ? ` (timeout ${timeout}s)` : "";
	const commandDisplay = command === null ? invalidArgText(theme) : command ? command : theme.fg("toolOutput", "...");
	return formatToolHead({
		theme,
		status,
		verb: prompt,
		primaryArg: `${commandDisplay}${timeoutSuffix}`,
		meta,
	});
}
function rebuildBashResultRenderComponent(
	component: Container,
	result: {
		content: Array<{ type: string; text?: string; data?: string; mimeType?: string }>;
		details?: BashToolDetails;
	},
	options: ToolRenderResultOptions,
	showImages: boolean,
	startedAt: number | undefined,
	endedAt: number | undefined,
): void {
	component.clear();

	let output = getTextOutput(result as any, showImages).trim();
	const truncation = result.details?.truncation;
	const fullOutputPath = result.details?.fullOutputPath;
	if (!options.isPartial && truncation?.truncated && fullOutputPath && output.endsWith("]")) {
		const footerStart = output.lastIndexOf("\n\n[");
		if (footerStart !== -1 && output.slice(footerStart).includes(fullOutputPath)) {
			output = output.slice(0, footerStart).trimEnd();
		}
	}

	if (output) {
		const styledOutput = output
			.split("\n")
			.map((line) => theme.fg("toolOutput", line))
			.join("\n");

		if (options.expanded) {
			component.addChild(new Text(`\n${styledOutput}`, 0, 0));
		} else {
			component.addChild(new Spacer(1));
			component.addChild(
				new VisualLinePreview({
					text: styledOutput,
					maxVisualLines: BASH_PREVIEW_LINES,
					keep: "end",
					formatHint: (hidden) =>
						theme.fg("muted", `... (${hidden} earlier lines,`) +
						` ${keyHint("app.tools.expand", "to expand")}${theme.fg("muted", ")")}`,
				}),
			);
		}
	}

	if (truncation?.truncated || fullOutputPath) {
		const warnings: string[] = [];
		if (fullOutputPath) {
			warnings.push(`Full output: ${fullOutputPath}`);
		}
		if (truncation?.truncated) {
			// S6 explicit tails on STELA's TRUNCATION_TABLE numbers: the fence is the
			// status glyph PLUS the words (never colour alone), and the numbers name the
			// surface budget the output actually hit.
			if (truncation.truncatedBy === "lines") {
				warnings.push(`Truncated: showing ${truncation.outputLines} of ${truncation.totalLines} lines`);
			} else {
				warnings.push(
					`Truncated: ${truncation.outputLines} lines shown (${formatSize(truncation.maxBytes ?? DEFAULT_MAX_BYTES)} limit)`,
				);
			}
		}
		component.addChild(new Text(`\n${theme.fg("warning", `[${warnings.join(". ")}]`)}`, 0, 0));
	}

	// Duration lives in the head meta; the body keeps only a live elapsed line while the command runs.
	if (options.isPartial && startedAt !== undefined) {
		component.addChild(
			new Text(`\n${theme.fg("muted", `Elapsed ${formatDuration((endedAt ?? Date.now()) - startedAt)}`)}`, 0, 0),
		);
	}
}

/** Shell renderers are shared by bash and powershell, which differ only in the prompt they display. */
export function createShellRenderers(prompt: string): Pick<ToolDefinition<any, any>, "renderCall" | "renderResult"> {
	return {
		renderCall(args, callTheme, context) {
			const state = context.state;
			if (context.executionStarted && state.startedAt === undefined) {
				state.startedAt = Date.now();
				state.endedAt = undefined;
			}
			if (!context.isPartial || context.isError) {
				state.endedAt ??= Date.now();
			}
			const text = (context.lastComponent as Text | undefined) ?? new Text("", 0, 0);
			const status = toolHeadStatus(context);
			const details = context.resultDetails as BashToolDetails | undefined;
			const metaParts: string[] = [];
			if (details?.exitCode !== undefined && details.exitCode !== 0) {
				const signal = signalNameForExitCode(details.exitCode);
				metaParts.push(signal ? `exit ${details.exitCode} (${signal})` : `exit ${details.exitCode}`);
			}
			const durationMs =
				context.durationMs ??
				(state.startedAt !== undefined && state.endedAt !== undefined
					? state.endedAt - state.startedAt
					: undefined);
			if (durationMs !== undefined && status !== "running") metaParts.push(formatDuration(durationMs));
			text.setText(
				formatShellCall(
					args as { command?: string; timeout?: number } | undefined,
					prompt,
					callTheme,
					status,
					metaParts.length > 0 ? metaParts.join(" · ") : undefined,
				),
			);
			return text;
		},
		renderResult(result, options, _theme, context) {
			const state = context.state;
			// S6 live 100 ms elapsed timer while the shell runs.
			if (state.startedAt !== undefined && options.isPartial && !state.interval) {
				state.interval = setInterval(() => context.invalidate(), BASH_LIVE_TICK_MS);
			}
			if (!options.isPartial || context.isError) {
				state.endedAt ??= Date.now();
				if (state.interval) {
					clearInterval(state.interval);
					state.interval = undefined;
				}
			}
			const component = (context.lastComponent as Container | undefined) ?? new Container();
			rebuildBashResultRenderComponent(
				component,
				result as any,
				options,
				context.showImages,
				state.startedAt,
				state.endedAt,
			);
			component.invalidate();
			return component;
		},
	};
}
