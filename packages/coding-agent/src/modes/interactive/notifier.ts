import type { Terminal } from "@earendil-works/pi-tui";

/** Attention events that notify: needs-input, turn-complete, error (U11 pick). */
export type NotificationEvent = "needs-input" | "turn-complete" | "error";

/**
 * Desktop attention signals: OSC 9 with BEL fallback, focus-gated. One notification per turn
 * (coalesced); never while focused unless opted in (DV `smart`, CX `unfocused`). Off by default.
 */
export class Notifier {
	private readonly getTerminal: () => Terminal;
	private readonly getMode: () => "off" | "auto" | "bell";
	private readonly getNotifyWhenFocused: () => boolean;
	private notifiedThisTurn = false;

	constructor(
		getTerminal: () => Terminal,
		getMode: () => "off" | "auto" | "bell",
		getNotifyWhenFocused: () => boolean,
	) {
		this.getTerminal = getTerminal;
		this.getMode = getMode;
		this.getNotifyWhenFocused = getNotifyWhenFocused;
	}

	/** A new turn started; the next event may notify again. */
	turnStarted(): void {
		this.notifiedThisTurn = false;
	}

	notify(event: NotificationEvent, detail?: string): void {
		const mode = this.getMode();
		if (mode === "off" || this.notifiedThisTurn) return;
		const terminal = this.getTerminal();
		const focused =
			"isTerminalFocused" in terminal && typeof terminal.isTerminalFocused === "function"
				? (terminal.isTerminalFocused as () => boolean)()
				: true;
		if (focused && !this.getNotifyWhenFocused()) return;
		this.notifiedThisTurn = true;
		const label = event === "needs-input" ? "Stela needs input" : event === "error" ? "Stela error" : "Stela done";
		const message = detail ? `${label}: ${detail}` : label;
		if (mode === "bell") {
			process.stdout.write("\x07");
		} else {
			terminal.notify(message);
		}
	}
}
