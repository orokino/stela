import { pickSymbol } from "@earendil-works/pi-tui";

/**
 * Transcript row glyphs. The shape carries the row kind so notices, warnings, and errors survive a
 * no-colour terminal; colour only reinforces them. User rows are a tinted block (Cursor: CU U3);
 * assistant text stays plain. Matches the phase-1 study.
 */
export const MESSAGE_GLYPHS = {
	notice: "ⓘ",
	warning: "⚠",
	error: "■",
} as const;

export type MessageKind = keyof typeof MESSAGE_GLYPHS;

/** ASCII stand-ins for terminals without the Unicode glyphs. */
export const MESSAGE_GLYPHS_ASCII: Record<MessageKind, string> = {
	notice: "i",
	warning: "!",
	error: "x",
};

/** Row glyph in the active symbol preset. */
export function messageGlyph(kind: MessageKind): string {
	return pickSymbol(MESSAGE_GLYPHS[kind], MESSAGE_GLYPHS_ASCII[kind]);
}

/**
 * Duration label for a finished thinking run, in the `Thought · <duration>`
 * collapse. Whole seconds below a minute, `Xm Ys` above; sub-second runs show
 * `<1s` so the label never claims a precision the clock cannot give.
 */
export function formatThoughtDuration(durationMs: number | undefined): string {
	if (durationMs === undefined || durationMs < 0) return "Thought";
	if (durationMs < 1000) return "Thought · <1s";
	const totalSeconds = Math.floor(durationMs / 1000);
	const minutes = Math.floor(totalSeconds / 60);
	const seconds = totalSeconds % 60;
	if (minutes === 0) return `Thought · ${seconds}s`;
	return `Thought · ${minutes}m ${seconds.toString().padStart(2, "0")}s`;
}

/** Live thinking row while a run is still streaming: `Thinking… <elapsed>`. */
export function formatThinkingLive(elapsedMs: number): string {
	const totalSeconds = Math.max(0, Math.floor(elapsedMs / 1000));
	const minutes = Math.floor(totalSeconds / 60);
	const seconds = totalSeconds % 60;
	if (minutes === 0) return `Thinking… ${seconds}s`;
	return `Thinking… ${minutes}m ${seconds.toString().padStart(2, "0")}s`;
}
