import { theme } from "../theme/theme.ts";

/**
 * Stela's startup card: a 1px hairline frame with the mark on the left, the name and version, a
 * one-line tagline, and the four session commands with right-aligned hints. The mark is the only
 * accent on the screen; every element degrades (mark, then frame, then the whole card) and no row is
 * reserved when the card does not fit.
 *
 * Mark: "A. Rubbing" from the logo round (17x8 cells), pending the wordmark revisit.
 */
const MARK_UNICODE = [
	" ░░░░▒░░░░░░░░░  ",
	"░▒▒▒▒▒▛▀▀▀▜▒▒▒▒▒░",
	" ▒▒▒▒▒     ▒▒▒▒▒░",
	"░▒▒▒▒▒▌    ▒▒▒▒▒░",
	"░▒▒▒▒▒▌    ▒▒▒▒▒▒",
	"░▒▒▒▒▒     ▒▒▒▒▒ ",
	"░▒▒▒▒▒▄▄▄▄▄▒▒▒▒▒░",
	" ░░░░░░░▒░░░░░░░ ",
];

/** ASCII form of the same mark, for terminals without Unicode box drawing. */
const MARK_ASCII = [
	" ....:.........  ",
	'.:::::/"""\\:::::.',
	" :::::     :::::.",
	".:::::|    :::::.",
	".:::::|    ::::::",
	".:::::     ::::: ",
	".:::::_____:::::.",
	" .......:....... ",
];

/**
 * Colour class per mark cell: `L` muted, `D` dim, `A` accent, `.` unpainted (shows the canvas).
 * The void inside the tablet stays unpainted on purpose: the stela is the part you do not see.
 */
const MARK_PAINT = [
	".DDDDLDDDDDDDDD..",
	"DLLLLLLLLDDDDDDDD",
	".LLLLL.....DDDDDD",
	"DLLLLLA....DDDDDD",
	"DLLLLLA....DDDDDD",
	"DLLLLL.....DDDDD.",
	"DLLLLLLLLDDDDDDDD",
	".DDDDDDDLDDDDDDD.",
];

/** Mark cell classes the accent may use; everything else is greyscale structure. */
function paintMarkLine(line: string, paint: string): string {
	let out = "";
	for (let index = 0; index < line.length; index++) {
		const glyph = line[index] ?? " ";
		if (glyph === " ") {
			out += " ";
			continue;
		}
		const painted =
			paint[index] === "A"
				? theme.fg("accent", glyph)
				: paint[index] === "L"
					? theme.fg("muted", glyph)
					: theme.fg("dim", glyph);
		out += painted;
	}
	return out;
}

/** The startup menu: real slash commands, because the keys users expect are taken by other actions. */
export const STELA_STARTUP_MENU: readonly { label: string; hint: string }[] = [
	{ label: "New session", hint: "/new" },
	{ label: "Resume session", hint: "/resume" },
	{ label: "Settings", hint: "/settings" },
	{ label: "Quit", hint: "/quit" },
];

export interface StelaCardOptions {
	/** Name and version line, e.g. `Stela  1.1.0`. */
	title: string;
	tagline: string;
	/** Menu rows: label plus the right-aligned hint (a slash command or a key). */
	menu: readonly { label: string; hint: string }[];
	/** Terminal columns; the frame is 78 wide and is not drawn below 60. */
	columns: number;
	/** Terminal rows; the card needs 12 and is skipped below that. */
	rows: number;
	/** Use the ASCII mark (no Unicode box drawing available). */
	ascii?: boolean;
}

const CARD_WIDTH = 78;
const MARK_WIDTH = 17;
const MARK_INDENT = 4;
const TEXT_COLUMN = MARK_INDENT + MARK_WIDTH + 3;
/** Framed card needs >=90 cols AND >=25 rows (GK U2); the compact form covers everything else. */
export const STELA_CARD_MIN_COLUMNS = 90;
export const STELA_CARD_MIN_ROWS = 25;

/** Whether the framed card fits: 90 cols AND 25 rows, else the narrow form. */
export function stelaCardFits(columns: number, rows: number): boolean {
	return columns >= STELA_CARD_MIN_COLUMNS && rows >= STELA_CARD_MIN_ROWS;
}

/** The narrow fallback: one accent glyph, the name, and the menu without the frame. */
export function stelaNarrowLines(
	title: string,
	menu: readonly { label: string; hint: string }[],
	ascii = false,
): string[] {
	const caret = ascii ? "|" : "▌";
	const lines = [`${theme.fg("accent", caret)} ${theme.fg("text", title)}`];
	for (const item of menu) {
		lines.push(`${item.label}  ${theme.fg("dim", item.hint)}`);
	}
	return lines;
}

/**
 * The framed startup card, or the narrow form when the frame does not fit. Lines are plain strings that
 * already carry their SGR sequences; callers join them with newlines.
 */
export function stelaCardLines(options: StelaCardOptions): string[] {
	const { title, tagline, menu, columns, rows, ascii } = options;
	if (!stelaCardFits(columns, rows)) return stelaNarrowLines(title, menu, ascii);

	const mark = ascii ? MARK_ASCII : MARK_UNICODE;
	// The frame never exceeds the terminal: it shrinks to columns - 2, and the narrow form is used
	// when that would be too tight for the mark column plus the menu.
	const cardWidth = Math.min(CARD_WIDTH, columns - 2);
	const inner = cardWidth - 2;
	// Tail builders return only the text column (inner - TEXT_COLUMN cells) and pad on visible width,
	// because the styled strings already carry SGR sequences that must not count as cells.
	const width = inner - TEXT_COLUMN;
	const text = (line: string) => line + " ".repeat(Math.max(0, width - stripAnsiLength(line)));
	const menuLine = (item: { label: string; hint: string }) => {
		const hint = theme.fg("dim", item.hint);
		const label = theme.fg("text", item.label);
		const gap = Math.max(1, width - item.label.length - item.hint.length - 3);
		return (
			label + " ".repeat(gap) + hint + " ".repeat(Math.max(0, width - item.label.length - gap - item.hint.length))
		);
	};

	// Centred like the Grok Build card: the header block adds one cell of indent, so it is subtracted.
	const leftPad = " ".repeat(Math.max(0, Math.floor((columns - cardWidth) / 2) - 1));
	const lines: string[] = [
		`${leftPad}${theme.fg("border", `╭${"─".repeat(inner)}╮`)}`,
		`${leftPad}│${" ".repeat(inner)}│`,
	];
	for (let index = 0; index < mark.length; index++) {
		const markLine = " ".repeat(MARK_INDENT) + paintMarkLine(mark[index] ?? "", MARK_PAINT[index] ?? "");
		let tail = "";
		if (index === 0)
			tail = text(`${theme.fg("text", title.split("  ")[0] ?? "")}  ${theme.fg("dim", title.split("  ")[1] ?? "")}`);
		else if (index === 1) tail = text(theme.fg("border", "─".repeat(24)));
		else if (index === 2) tail = text(theme.fg("muted", tagline));
		else if (index >= 4 && index - 4 < menu.length) tail = menuLine(menu[index - 4] ?? { label: "", hint: "" });
		else tail = " ".repeat(width);
		// The mark column is padded to its fixed width so the text column never shifts.
		const padded = markLine + " ".repeat(Math.max(0, TEXT_COLUMN - stripAnsiLength(markLine)));
		lines.push(`${leftPad}│${padded}${tail}│`);
	}
	lines.push(`${leftPad}│${" ".repeat(inner)}│`, `${leftPad}${theme.fg("border", `╰${"─".repeat(inner)}╯`)}`);
	return lines;
}

/** Visible width of a line that already carries SGR sequences. */
function stripAnsiLength(line: string): number {
	return line.replace(/\x1b\[[0-9;]*m/g, "").length;
}
