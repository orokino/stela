import assert from "node:assert";
import { describe, it } from "node:test";
import {
	backgroundAnsi,
	colorToHex,
	colorToOkhsl,
	colorToRgb,
	foregroundAnsi,
	indexedColor,
	okhslColor,
	oklchColor,
	parseColor,
	rgbColor,
	styleText,
} from "../src/index.ts";

describe("colors", () => {
	it("parses hex and OKLCH colors and rejects everything else", () => {
		assert.deepStrictEqual(parseColor("#abc"), { kind: "rgb", r: 170, g: 187, b: 204 });
		assert.deepStrictEqual(parseColor("oklch(62% 0.1 200)"), { kind: "oklch", l: 0.62, c: 0.1, h: 200 });
		assert.throws(() => parseColor(""), /Invalid color value/);
		assert.throws(() => parseColor("red"), /Invalid color value/);
	});

	it("gamut-maps OKLCH to sRGB, including the lightness limits", () => {
		assert.deepStrictEqual(colorToRgb(oklchColor(0.627955, 0.257683, 29.2339)), { r: 255, g: 0, b: 0 });
		assert.deepStrictEqual(colorToRgb(oklchColor(1, 0.3, 150)), { r: 255, g: 255, b: 255 });
		assert.deepStrictEqual(colorToRgb(oklchColor(0, 0.3, 150)), { r: 0, g: 0, b: 0 });
	});

	it("parses OKHSL colors and round-trips them", () => {
		// Full saturation at the red cusp is pure sRGB red.
		assert.deepStrictEqual(parseColor("okhsl(29.23 100% 56.8%)"), rgbColor(255, 0, 0));
		assert.deepStrictEqual(parseColor("OKHSL(250deg 60% 55%)"), okhslColor(250, 0.6, 0.55));
		assert.throws(() => parseColor("okhsl(250 160% 55%)"), /s must be between 0 and 1/);
		for (const hex of ["#4f8eb3", "#20242a", "#f8f9fa"]) {
			const { h, s, l } = colorToOkhsl(parseColor(hex));
			assert.strictEqual(colorToHex(okhslColor(h, s, l)), hex);
		}
	});

	it("styles text and closes sequences in reverse order", () => {
		assert.strictEqual(
			styleText("Ready", { fg: rgbColor(18, 52, 86), bg: indexedColor(9), bold: true, italic: true }, "truecolor"),
			"\x1b[38;2;18;52;86m\x1b[48;5;9m\x1b[1m\x1b[3mReady\x1b[23m\x1b[22m\x1b[49m\x1b[39m",
		);
		assert.match(styleText("Ready", { fg: rgbColor(18, 52, 86) }, "256color"), /^\x1b\[38;5;\d+mReady\x1b\[39m$/);
	});

	it("maps the frozen palette to the basic ANSI colours by hue and brightness", () => {
		// accent #6E76FF is blue-dominant and bright, not grey (nearest-RGB would pick silver).
		assert.strictEqual(foregroundAnsi(rgbColor(0x6e, 0x76, 0xff), "16color"), "\x1b[94m");
		assert.strictEqual(backgroundAnsi(rgbColor(0x6e, 0x76, 0xff), "16color"), "\x1b[104m");
		// success #3FB950, warning #D29922, error #F85149.
		assert.strictEqual(foregroundAnsi(rgbColor(0x3f, 0xb9, 0x50), "16color"), "\x1b[92m");
		assert.strictEqual(foregroundAnsi(rgbColor(0xd2, 0x99, 0x22), "16color"), "\x1b[93m");
		assert.strictEqual(foregroundAnsi(rgbColor(0xf8, 0x51, 0x49), "16color"), "\x1b[91m");
		// Near-greys go to bright black, silver and bright white by luminance.
		assert.strictEqual(foregroundAnsi(rgbColor(0x9a, 0x9a, 0xa2), "16color"), "\x1b[90m");
		assert.strictEqual(foregroundAnsi(rgbColor(0x6a, 0x6a, 0x73), "16color"), "\x1b[90m");
		assert.strictEqual(foregroundAnsi(rgbColor(0xe8, 0xe8, 0xea), "16color"), "\x1b[97m");
		assert.strictEqual(foregroundAnsi(rgbColor(0x0b, 0x0b, 0x0c), "16color"), "\x1b[30m");
		// A non-bright saturated colour stays in the normal half.
		assert.strictEqual(foregroundAnsi(rgbColor(0x80, 0x20, 0x20), "16color"), "\x1b[31m");
		// Indexed colours are mapped too, not passed through.
		assert.strictEqual(foregroundAnsi(indexedColor(196), "16color"), "\x1b[91m");
	});

	it("drops colour at nocolor but keeps weight and reverse video", () => {
		assert.strictEqual(foregroundAnsi(rgbColor(255, 0, 0), "nocolor"), "");
		assert.strictEqual(backgroundAnsi(rgbColor(255, 0, 0), "nocolor"), "");
		assert.strictEqual(foregroundAnsi(indexedColor(9), "nocolor"), "");
		assert.strictEqual(
			styleText("Ready", { fg: rgbColor(255, 0, 0), bold: true }, "nocolor"),
			"\x1b[1mReady\x1b[22m",
		);
		assert.strictEqual(
			styleText("Ready", { bg: rgbColor(255, 0, 0), inverse: true, underline: true }, "nocolor"),
			"\x1b[4m\x1b[7mReady\x1b[27m\x1b[24m",
		);
	});
});
