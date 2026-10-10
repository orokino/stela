import { type Component, visibleWidth } from "@earendil-works/pi-tui";
import { theme } from "../theme/theme.ts";
import { keyText } from "./keybinding-hints.ts";

export interface ComposerHintSegment {
	keybinding: Parameters<typeof keyText>[0];
	label: string;
}

/**
 * Contextual persistent hint row beneath the composer (S2). Composed live from
 * the keybinding table so hints can never go stale; segments whose action is
 * unbound are skipped. Max 3 segments; the whole row drops below ~56 cols.
 */
export class ComposerHintRowComponent implements Component {
	private segments: ComposerHintSegment[] = [];
	private hasDraft = false;

	setSegments(segments: ComposerHintSegment[]): void {
		this.segments = segments;
	}

	setHasDraft(hasDraft: boolean): void {
		this.hasDraft = hasDraft;
	}
	invalidate(): void {}

	/** Live hint segments after unbound-aware skip. Exported for tests. */
	visibleSegments(): ComposerHintSegment[] {
		const base = this.segments.filter((s) => keyText(s.keybinding) !== "");
		if (!this.hasDraft) return base.filter((s) => s.label !== "send" && s.label !== "newline");
		return base;
	}

	render(width: number): string[] {
		if (width < 56) return [];
		const visible = this.visibleSegments().slice(0, 3);
		if (visible.length === 0) return [];
		const joiner = "   |   ";
		const asciiJoiner = " | ";
		const plain = visible.map((s) => `${keyText(s.keybinding)}:${s.label}`).join(joiner);
		const rendered = visible.map((s) => composerHintSegment(s)).join(joiner);
		if (visibleWidth(plain) > width) {
			const ascii = visible.map((s) => `${keyText(s.keybinding)}:${s.label}`).join(asciiJoiner);
			if (visibleWidth(ascii) > width) return [];
			return [asciiRendered(visible, asciiJoiner)];
		}
		return [rendered];
	}
}

function composerHintSegment(segment: ComposerHintSegment): string {
	return theme.fg("dim", keyText(segment.keybinding)) + theme.fg("muted", `:${segment.label}`);
}

function asciiRendered(visible: ComposerHintSegment[], joiner: string): string {
	return visible
		.map((s) => theme.fg("dim", keyText(s.keybinding)) + theme.fg("muted", `:${s.label}`))
		.join(theme.fg("muted", joiner));
}
