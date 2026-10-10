import { pickSymbol } from "@earendil-works/pi-tui";
import * as Diff from "diff";
import { theme } from "../theme/theme.ts";

/**
 * Parse diff line to extract prefix, line number, and content.
 * Format: "+123 content" or "-123 content" or " 123 content" or "     ..."
 */
function parseDiffLine(line: string): { prefix: string; lineNum: string; content: string } | null {
	const match = line.match(/^([+-\s])(\s*\d*)\s(.*)$/);
	if (!match) return null;
	return { prefix: match[1], lineNum: match[2], content: match[3] };
}

/**
 * Replace tabs with spaces for consistent rendering.
 */
function replaceTabs(text: string): string {
	return text.replace(/\t/g, "   ");
}

/**
 * Fraction of the longer line that changed, from the word diff. Above the gate the rewrite is too
 * noisy for intra-line highlighting and both lines render whole-coloured instead.
 */
function changedFraction(oldContent: string, newContent: string): number {
	const longer = Math.max(oldContent.length, newContent.length);
	if (longer === 0) return 0;
	let changed = 0;
	for (const part of Diff.diffWords(oldContent, newContent)) {
		if (part.added || part.removed) changed += part.value.length;
	}
	return changed / longer;
}

/**
 * Compute word-level diff and render with inverse on changed parts.
 * Uses diffWords which groups whitespace with adjacent words for cleaner highlighting.
 * Strips leading whitespace from inverse to avoid highlighting indentation.
 * Returns undefined when the pair changed too much (CC drops past 40%, CU past 50%).
 */
function renderIntraLineDiff(
	oldContent: string,
	newContent: string,
): { removedLine: string; addedLine: string } | undefined {
	if (changedFraction(oldContent, newContent) > 0.4) return undefined;
	const wordDiff = Diff.diffWords(oldContent, newContent);

	let removedLine = "";
	let addedLine = "";
	let isFirstRemoved = true;
	let isFirstAdded = true;

	for (const part of wordDiff) {
		if (part.removed) {
			let value = part.value;
			// Strip leading whitespace from the first removed part
			if (isFirstRemoved) {
				const leadingWs = value.match(/^(\s*)/)?.[1] || "";
				value = value.slice(leadingWs.length);
				removedLine += leadingWs;
				isFirstRemoved = false;
			}
			if (value) {
				removedLine += theme.inverse(value);
			}
		} else if (part.added) {
			let value = part.value;
			// Strip leading whitespace from the first added part
			if (isFirstAdded) {
				const leadingWs = value.match(/^(\s*)/)?.[1] || "";
				value = value.slice(leadingWs.length);
				addedLine += leadingWs;
				isFirstAdded = false;
			}
			if (value) {
				addedLine += theme.inverse(value);
			}
		} else {
			removedLine += part.value;
			addedLine += part.value;
		}
	}

	return { removedLine, addedLine };
}

export interface RenderDiffOptions {
	/** File path (unused, kept for API compatibility) */
	filePath?: string;
	/** Maximum diff rows before the `… N more lines` collapse (OMP: 40 lines / 8 hunks). */
	maxLines?: number;
}

/** OMP's collapsed-diff budget: 8 hunks / 40 lines, then the standard expand affordance. */
export const DIFF_COLLAPSED_LINES = 40;
export const DIFF_COLLAPSED_HUNKS = 8;

function paintAdded(text: string): string {
	const line = theme.fg("toolDiffAdded", text);
	return theme.getColorMode() === "truecolor" ? theme.bg("toolDiffAddedBg", line) : line;
}

function paintRemoved(text: string): string {
	const line = theme.fg("toolDiffRemoved", text);
	return theme.getColorMode() === "truecolor" ? theme.bg("toolDiffRemovedBg", line) : line;
}

/**
 * Render a diff string with colored lines and intra-line change highlighting.
 * - Context lines: dim/gray
 * - Removed lines: red, with inverse on changed tokens
 * - Added lines: green, with inverse on changed tokens
 *
 * Shape per the U5 pick: sign gutter + padded per-side line numbers (OC), word-level highlight
 * only for 1↔1 pairs under the 40% similarity gate (CC), dim `⋮` between hunks, per-file `+N/-M`
 * counted by the caller, collapse past 40 lines / 8 hunks (OMP). Add/remove backgrounds apply in
 * truecolor only; signs carry the meaning everywhere else.
 */
export function renderDiff(diffText: string, options: RenderDiffOptions = {}): string {
	const lines = diffText.split("\n");
	const result: string[] = [];
	let hunks = 0;

	let i = 0;
	while (i < lines.length) {
		const line = lines[i];
		const parsed = parseDiffLine(line);

		if (!parsed) {
			result.push(theme.fg("toolDiffContext", line));
			i++;
			continue;
		}

		if (parsed.prefix === "-") {
			// Collect consecutive removed lines
			const removedLines: { lineNum: string; content: string }[] = [];
			while (i < lines.length) {
				const p = parseDiffLine(lines[i]);
				if (!p || p.prefix !== "-") break;
				removedLines.push({ lineNum: p.lineNum, content: p.content });
				i++;
			}

			// Collect consecutive added lines
			const addedLines: { lineNum: string; content: string }[] = [];
			while (i < lines.length) {
				const p = parseDiffLine(lines[i]);
				if (!p || p.prefix !== "+") break;
				addedLines.push({ lineNum: p.lineNum, content: p.content });
				i++;
			}
			hunks++;

			// Only do intra-line diffing when there's exactly one removed and one added line
			// (indicating a single line modification) under the similarity gate. Otherwise,
			// show lines as-is.
			const pair =
				removedLines.length === 1 && addedLines.length === 1
					? renderIntraLineDiff(replaceTabs(removedLines[0].content), replaceTabs(addedLines[0].content))
					: undefined;
			if (pair) {
				result.push(paintRemoved(`-${removedLines[0].lineNum} ${pair.removedLine}`));
				result.push(paintAdded(`+${addedLines[0].lineNum} ${pair.addedLine}`));
			} else {
				// Show all removed lines first, then all added lines
				for (const removed of removedLines) {
					result.push(paintRemoved(`-${removed.lineNum} ${replaceTabs(removed.content)}`));
				}
				for (const added of addedLines) {
					result.push(paintAdded(`+${added.lineNum} ${replaceTabs(added.content)}`));
				}
			}
		} else if (parsed.prefix === "+") {
			// Standalone added line
			hunks++;
			result.push(paintAdded(`+${parsed.lineNum} ${replaceTabs(parsed.content)}`));
			i++;
		} else {
			// Context line; a bare `...` separator renders as a dim hunk break.
			if (parsed.content.trim() === "...") {
				result.push(theme.fg("dim", ` ${parsed.lineNum} ${pickSymbol("⋮", ":")}`));
			} else {
				result.push(theme.fg("toolDiffContext", ` ${parsed.lineNum} ${replaceTabs(parsed.content)}`));
			}
			i++;
		}
	}

	const maxLines = options.maxLines ?? Number.MAX_SAFE_INTEGER;
	if (result.length <= maxLines && hunks <= DIFF_COLLAPSED_HUNKS) {
		return result.join("\n");
	}
	const shown = result.slice(0, maxLines);
	const hiddenLines = result.length - shown.length;
	const hiddenHunks = Math.max(0, hunks - DIFF_COLLAPSED_HUNKS);
	const parts: string[] = [];
	if (hiddenHunks > 0) parts.push(`${hiddenHunks} more hunk${hiddenHunks === 1 ? "" : "s"}`);
	if (hiddenLines > 0) parts.push(`${hiddenLines} more line${hiddenLines === 1 ? "" : "s"}`);
	shown.push(theme.fg("dim", `… (${parts.join(", ")})`));
	return shown.join("\n");
}

/** Per-file add/remove counts for the `+N/-M` header suffix. */
export function countDiffLines(diffText: string): { added: number; removed: number } {
	let added = 0;
	let removed = 0;
	for (const line of diffText.split("\n")) {
		const parsed = parseDiffLine(line);
		if (parsed?.prefix === "+") added++;
		else if (parsed?.prefix === "-") removed++;
	}
	return { added, removed };
}
