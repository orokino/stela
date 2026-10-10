import { Container, MouseRegion, pickSymbol, Spacer, Text } from "@earendil-works/pi-tui";
import { theme } from "../theme/theme.ts";

/** One background shell row: name, elapsed, warning colour after 5 s (OMP U15). */
export interface BackgroundShellRow {
	name: string;
	command: string;
	startedAt: number;
}

/**
 * Pinned task HUD above the composer: background shells, capped at 3 rows with an overflow tail
 * (OMP U15: `… N more — expand`, warn colour after 5 s). Empty renders nothing. Subagent rows and
 * the tabbed tray stay future: Stela ships no subagent/task tool yet, so there is nothing to list.
 */
export class TaskHudComponent extends Container {
	private shells: BackgroundShellRow[] = [];
	private expanded = false;
	private readonly outputPad: number;

	constructor(outputPad = 1) {
		super();
		this.outputPad = outputPad;
	}

	setShells(shells: BackgroundShellRow[]): void {
		this.shells = [...shells];
		this.rebuild();
	}

	setExpanded(expanded: boolean): void {
		this.expanded = expanded;
		this.rebuild();
	}

	override render(width: number): string[] {
		// Rebuild per frame: elapsed clocks tick and the symbol preset can change at runtime.
		this.rebuild();
		return super.render(width);
	}

	private rebuild(): void {
		this.clear();
		if (this.shells.length === 0) return;
		this.addChild(new Spacer(1));
		const shown = this.expanded ? this.shells : this.shells.slice(0, 3);
		for (const shell of shown) {
			const elapsed = Math.max(0, Math.round((Date.now() - shell.startedAt) / 1000));
			const warn = elapsed >= 5;
			const glyph = pickSymbol("⏹", "[bg]");
			const line = `${glyph} ${shell.name} ${shell.command} · ${elapsed}s`;
			this.addChild(new Text(theme.fg(warn ? "warning" : "dim", line), this.outputPad, 0));
		}
		const hidden = this.shells.length - shown.length;
		if (hidden > 0 && !this.expanded) {
			const label = new Text(theme.fg("dim", `… ${hidden} more — expand`), this.outputPad, 0);
			this.addChild(
				new MouseRegion(label, (event) => {
					if (event.type !== "click" || event.button !== "left") return undefined;
					this.setExpanded(true);
					return { handled: true };
				}),
			);
		}
	}
}
