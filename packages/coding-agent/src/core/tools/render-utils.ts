import * as os from "node:os";
import { pathToFileURL } from "node:url";
import type { ImageContent, TextContent } from "@earendil-works/pi-ai";
import { getCapabilities, getImageDimensions, hyperlink, imageFallback, pickSymbol } from "@earendil-works/pi-tui";
import type { Theme } from "../../modes/interactive/theme/theme.ts";
import { stripAnsi } from "../../utils/ansi.ts";
import { resolvePath } from "../../utils/paths.ts";
import { sanitizeBinaryOutput } from "../../utils/shell.ts";

export function shortenPath(path: unknown): string {
	if (typeof path !== "string") return "";
	const home = os.homedir();
	if (path.startsWith(home)) {
		return `~${path.slice(home.length)}`;
	}
	return path;
}

/**
 * S6 truncate-start: keep the tail (filename) visible when a path overflows its
 * budget, cutting from the front with an ellipsis. ASCII falls back to `...`.
 */
export function truncatePathStart(path: string, maxChars: number): string {
	if (maxChars <= 0) return path;
	if (path.length <= maxChars) return path;
	const ellipsis = pickSymbol("…", "...");
	return `${ellipsis}${path.slice(path.length - (maxChars - ellipsis.length))}`;
}

export function linkPath(styledText: string, rawPath: string, cwd: string): string {
	if (!getCapabilities().hyperlinks) return styledText;
	const absolutePath = resolvePath(rawPath, cwd);
	return hyperlink(styledText, pathToFileURL(absolutePath).href);
}

export function str(value: unknown): string | null {
	if (typeof value === "string") return value;
	if (value == null) return "";
	return null;
}

export function replaceTabs(text: string): string {
	return text.replace(/\t/g, "   ");
}

export function normalizeDisplayText(text: string): string {
	return text.replace(/\r/g, "");
}

export function getTextOutput(
	result: { content: Array<{ type: string; text?: string; data?: string; mimeType?: string }> } | undefined,
	showImages: boolean,
): string {
	if (!result) return "";

	const textBlocks = result.content.filter((c) => c.type === "text");
	const imageBlocks = result.content.filter((c) => c.type === "image");

	let output = textBlocks.map((c) => sanitizeBinaryOutput(stripAnsi(c.text || "")).replace(/\r/g, "")).join("\n");

	const caps = getCapabilities();
	if (imageBlocks.length > 0 && (!caps.images || !showImages)) {
		const imageIndicators = imageBlocks
			.map((img) => {
				const mimeType = img.mimeType ?? "image/unknown";
				const dims =
					img.data && img.mimeType ? (getImageDimensions(img.data, img.mimeType) ?? undefined) : undefined;
				return imageFallback(mimeType, dims);
			})
			.join("\n");
		output = output ? `${output}\n${imageIndicators}` : imageIndicators;
	}

	return output;
}

export type ToolRenderResultLike<TDetails> = {
	content: (TextContent | ImageContent)[];
	details: TDetails;
};

const COLLAPSED_ARGS_CHARS = 100;

/**
 * Shared tool-card head: status glyph + verb + dim primary argument + meta, one line.
 * The glyph carries the state so it survives without colour; meta words (`exit N`, durations)
 * carry the detail. Statuses: running `●`, ok `✓`, failed `✗`.
 */
export function formatToolHead(options: {
	theme: Theme;
	status: "running" | "ok" | "error";
	verb: string;
	primaryArg?: string;
	meta?: string;
}): string {
	const { theme, status, verb, primaryArg, meta } = options;
	const glyph = pickSymbol(
		status === "running" ? "●" : status === "ok" ? "✓" : "✗",
		status === "running" ? "o" : status === "ok" ? "ok" : "fail",
	);
	const color = status === "running" ? "accent" : status === "ok" ? "success" : "error";
	let head = `${theme.fg(color, glyph)} ${theme.fg("toolTitle", theme.bold(verb))}`;
	if (primaryArg) head += ` ${theme.fg("muted", primaryArg)}`;
	if (meta) head += ` ${theme.fg("dim", meta)}`;
	return head;
}

/** Card status from the render context: streaming or pre-start reads as running. */
export function toolHeadStatus(context: {
	isPartial: boolean;
	executionStarted: boolean;
	argsComplete: boolean;
	isError: boolean;
	resultDetails?: unknown;
	durationMs?: number;
}): "running" | "ok" | "error" {
	if (context.isPartial) return "running";
	if (context.resultDetails !== undefined || context.durationMs !== undefined) return context.isError ? "error" : "ok";
	if (!context.executionStarted && !context.argsComplete) return "running";
	return context.isError ? "error" : "ok";
}

/**
 * Generic tool call header: the title followed by the arguments. Collapsed, they are `key=value`
 * pairs on the title line, cut to {@link COLLAPSED_ARGS_CHARS}. Expanded, each is a `key: value`
 * line below the title, with strings shown raw and continuation lines indented.
 */
export function formatToolCallWithArgs(
	title: string,
	args: unknown,
	theme: Theme,
	expanded: boolean,
	status: "running" | "ok" | "error" = "running",
): string {
	const header = formatToolHead({ theme, status, verb: title });
	if (args == null) return header;
	const entries =
		typeof args === "object" && !Array.isArray(args)
			? Object.entries(args)
			: ([["args", args]] as [string, unknown][]);
	if (entries.length === 0) return header;
	if (expanded) {
		const lines = entries.map(([key, value]) => {
			const text = typeof value === "string" ? value : (JSON.stringify(value, null, 2) ?? String(value));
			return `  ${key}: ${replaceTabs(text).replace(/\r/g, "").split("\n").join("\n    ")}`;
		});
		return `${header}\n${theme.fg("muted", lines.join("\n"))}`;
	}
	const pairs = entries.map(([key, value]) => `${key}=${JSON.stringify(value) ?? String(value)}`).join(" ");
	const preview = pairs.length > COLLAPSED_ARGS_CHARS ? `${pairs.slice(0, COLLAPSED_ARGS_CHARS - 3)}...` : pairs;
	return `${header} ${theme.fg("muted", preview)}`;
}

export function invalidArgText(theme: Theme): string {
	return theme.fg("error", "[invalid arg]");
}

export function renderToolPath(
	rawPath: string | null,
	theme: Theme,
	cwd: string,
	options?: { emptyFallback?: string; maxChars?: number },
): string {
	if (rawPath === null) return invalidArgText(theme);
	const value = rawPath || options?.emptyFallback;
	if (!value) return theme.fg("toolOutput", "...");
	const shortened = shortenPath(value);
	const display = options?.maxChars !== undefined ? truncatePathStart(shortened, options.maxChars) : shortened;
	return linkPath(theme.fg("accent", display), value, cwd);
}
