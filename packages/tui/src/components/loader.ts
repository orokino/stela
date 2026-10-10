import type { TUI } from "../tui.ts";
import { getSymbolPreset } from "./select-list.ts";
import { Text } from "./text.ts";

export interface LoaderIndicatorOptions {
	/** Animation frames. Use an empty array to hide the indicator. */
	frames?: string[];
	/** Frame interval in milliseconds for animated indicators. */
	intervalMs?: number;
	/** Glyph preset; explicit frames win over the preset. */
	preset?: SpinnerPreset;
	/** False freezes the spinner on its first frame (reduced motion). */
	animations?: boolean;
}

/** Spinner glyph preset: Cursor's two-cell braille or ASCII (OMP U6 shape, CU U6 art). */
export type SpinnerPreset = "unicode" | "ascii";

export const SPINNER_PRESETS: Record<SpinnerPreset, { frames: string[]; intervalMs: number }> = {
	unicode: { frames: ["⠈⠞", "⠠⠜", "⠰⠰", "⠘⠤", "⠘⠆", "⠘⠣", "⠰⠳", "⠠⠛"], intervalMs: 250 },
	ascii: { frames: ["|", "/", "-", "\\"], intervalMs: 250 },
};

/** Cursor's spinner: 8 frames of two braille cells at 250 ms (CU U6). One definition, used everywhere. */
export const SPINNER_FRAMES = SPINNER_PRESETS.unicode.frames;
export const SPINNER_INTERVAL_MS = SPINNER_PRESETS.unicode.intervalMs;

/** Spinner frames in the active symbol preset (ASCII `|/-\` under ASCII). */
export function spinnerFrames(): string[] {
	return getSymbolPreset() === "ascii" ? SPINNER_PRESETS.ascii.frames : SPINNER_FRAMES;
}

/**
 * Whether animation frames may run. False when stdout is not a TTY, on TERM=dumb, or when the
 * caller passes animations=false (CX's `tui.animations` switch, CX U6); frozen spinners render
 * their first frame statically instead.
 */
export function animationsAllowed(animations = true): boolean {
	if (!animations) return false;
	if (process.env.TERM === "dumb") return false;
	return process.stdout.isTTY === true;
}

const DEFAULT_FRAMES = SPINNER_FRAMES;
const DEFAULT_INTERVAL_MS = SPINNER_INTERVAL_MS;

/**
 * Loader component that updates with an optional spinning animation.
 */
export class Loader extends Text {
	private frames = [...DEFAULT_FRAMES];
	private intervalMs = DEFAULT_INTERVAL_MS;
	private currentFrame = 0;
	private intervalId: NodeJS.Timeout | null = null;
	private ui: TUI | null = null;
	private renderIndicatorVerbatim = false;
	private animationsEnabled = true;
	private spinnerColorFn: (str: string) => string;
	private messageColorFn: (str: string) => string;
	private message: string = "Loading...";

	constructor(
		ui: TUI,
		spinnerColorFn: (str: string) => string,
		messageColorFn: (str: string) => string,
		message: string = "Loading...",
		indicator?: LoaderIndicatorOptions,
	) {
		super("", 1, 0);
		this.ui = ui;
		this.spinnerColorFn = spinnerColorFn;
		this.messageColorFn = messageColorFn;
		this.message = message;
		this.setIndicator(indicator);
	}

	render(width: number): string[] {
		return ["", ...super.render(width)];
	}

	start(): void {
		this.updateDisplay();
		this.restartAnimation();
	}

	stop(): void {
		if (this.intervalId) {
			clearInterval(this.intervalId);
			this.intervalId = null;
		}
	}

	setMessage(message: string): void {
		this.message = message;
		this.updateDisplay();
	}

	override invalidate(): void {
		super.invalidate();
		this.updateDisplay();
	}

	setIndicator(indicator?: LoaderIndicatorOptions): void {
		this.renderIndicatorVerbatim = indicator !== undefined;
		// The deleted `nerd` preset falls back to the unicode frames at runtime.
		const rawPreset = indicator?.preset as SpinnerPreset | "nerd" | undefined;
		const presetKey = rawPreset === "nerd" ? "unicode" : rawPreset;
		const preset = presetKey !== undefined ? SPINNER_PRESETS[presetKey] : undefined;
		this.frames =
			indicator?.frames !== undefined
				? [...indicator.frames]
				: preset !== undefined
					? [...preset.frames]
					: [...spinnerFrames()];
		this.intervalMs =
			indicator?.intervalMs && indicator.intervalMs > 0
				? indicator.intervalMs
				: (preset?.intervalMs ?? DEFAULT_INTERVAL_MS);
		this.animationsEnabled = indicator?.animations ?? true;
		this.currentFrame = 0;
		this.start();
	}

	private restartAnimation(): void {
		this.stop();
		if (this.frames.length <= 1) {
			return;
		}
		if (!animationsAllowed(this.animationsEnabled)) {
			return;
		}
		this.intervalId = setInterval(() => {
			this.currentFrame = (this.currentFrame + 1) % this.frames.length;
			this.updateDisplay();
		}, this.intervalMs);
	}

	protected getRenderedIndicator(): string {
		const frame = this.frames[this.currentFrame] ?? "";
		return this.renderIndicatorVerbatim ? frame : this.spinnerColorFn(frame);
	}

	private updateDisplay(): void {
		const renderedFrame = this.getRenderedIndicator();
		const indicator = renderedFrame.length > 0 ? `${renderedFrame} ` : "";
		this.setText(`${indicator}${this.messageColorFn(this.message)}`);
		if (this.ui) {
			this.ui.requestRender();
		}
	}
}
