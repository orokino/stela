import assert from "node:assert";
import { afterEach, beforeEach, describe, it } from "node:test";
import { animationsAllowed, Loader, SPINNER_PRESETS } from "../src/components/loader.ts";
import type { TUI } from "../src/index.ts";

const silentTui = { requestRender: () => {} } as unknown as TUI;
const identity = (text: string): string => text;

describe("spinner presets and suppression", () => {
	const savedTerm = process.env.TERM;

	beforeEach(() => {
		process.env.TERM = "xterm-256color";
	});

	afterEach(() => {
		if (savedTerm === undefined) delete process.env.TERM;
		else process.env.TERM = savedTerm;
	});

	it("ships Cursor's two-cell braille as the unicode preset at 250 ms", () => {
		assert.deepStrictEqual(SPINNER_PRESETS.unicode.frames, ["⠈⠞", "⠠⠜", "⠰⠰", "⠘⠤", "⠘⠆", "⠘⠣", "⠰⠳", "⠠⠛"]);
		assert.strictEqual(SPINNER_PRESETS.unicode.intervalMs, 250);
		assert.deepStrictEqual(SPINNER_PRESETS.ascii.frames, ["|", "/", "-", "\\"]);
		assert.ok(!("nerd" in SPINNER_PRESETS));
	});

	it("renders the ascii preset frame in the indicator", () => {
		const loader = new Loader(silentTui, identity, identity, "Working", { preset: "ascii" });
		try {
			assert.ok(loader.render(40).join("\n").includes("| Working"));
		} finally {
			loader.stop();
		}
	});

	it("falls back to unicode frames for the deleted nerd preset", () => {
		const loader = new Loader(silentTui, identity, identity, "Working", {
			preset: "nerd" as "unicode",
		});
		try {
			assert.ok(loader.render(40).join("\n").includes("⠈⠞ Working"));
		} finally {
			loader.stop();
		}
	});

	it("freezes animation without a TTY, on TERM=dumb, or with animations=false", () => {
		assert.strictEqual(animationsAllowed(false), false);
		process.env.TERM = "dumb";
		assert.strictEqual(animationsAllowed(true), false);
		process.env.TERM = "xterm-256color";
		// The test runner owns no TTY, so the gate stays closed here.
		assert.strictEqual(process.stdout.isTTY === true, false);
		assert.strictEqual(animationsAllowed(true), false);
	});

	it("starts no interval while suppressed", () => {
		const loader = new Loader(silentTui, identity, identity, "Working", { animations: false });
		try {
			const first = loader.render(40).join("\n");
			assert.strictEqual(loader.render(40).join("\n"), first);
		} finally {
			loader.stop();
		}
	});
});
