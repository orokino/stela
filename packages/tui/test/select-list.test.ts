import assert from "node:assert";
import { afterEach, describe, it } from "node:test";
import {
	pickSymbol,
	SELECT_MARKER,
	SelectList,
	selectCurrentMark,
	selectListHeight,
	selectListOverflow,
	selectMarker,
	setSymbolPreset,
} from "../src/components/select-list.ts";
import { visibleWidth } from "../src/utils.ts";

const testTheme = {
	selectedPrefix: (text: string) => text,
	selectedText: (text: string) => text,
	description: (text: string) => text,
	scrollInfo: (text: string) => text,
	noMatch: (text: string) => text,
};

const visibleIndexOf = (line: string, text: string): number => {
	const index = line.indexOf(text);
	assert.notEqual(index, -1);
	return visibleWidth(line.slice(0, index));
};

describe("SelectList", () => {
	afterEach(() => setSymbolPreset("unicode"));

	it("normalizes multiline descriptions to single line", () => {
		const items = [
			{
				value: "test",
				label: "test",
				description: "Line one\nLine two\nLine three",
			},
		];

		const list = new SelectList(items, 5, testTheme);
		const rendered = list.render(100);

		assert.ok(rendered.length > 0);
		assert.ok(!rendered[0].includes("\n"));
		assert.ok(rendered[0].includes("Line one Line two Line three"));
	});

	it("keeps descriptions aligned when the primary text is truncated", () => {
		const items = [
			{ value: "short", label: "short", description: "short description" },
			{
				value: "very-long-command-name-that-needs-truncation",
				label: "very-long-command-name-that-needs-truncation",
				description: "long description",
			},
		];

		const list = new SelectList(items, 5, testTheme);
		const rendered = list.render(80);

		assert.equal(visibleIndexOf(rendered[0], "short description"), visibleIndexOf(rendered[1], "long description"));
	});

	it("uses the configured minimum primary column width", () => {
		const items = [
			{ value: "a", label: "a", description: "first" },
			{ value: "bb", label: "bb", description: "second" },
		];

		const list = new SelectList(items, 5, testTheme, {
			minPrimaryColumnWidth: 12,
			maxPrimaryColumnWidth: 20,
		});
		const rendered = list.render(80);

		assert.equal(rendered[0].indexOf("first"), 14);
		assert.equal(rendered[1].indexOf("second"), 14);
	});

	it("uses the configured maximum primary column width", () => {
		const items = [
			{
				value: "very-long-command-name-that-needs-truncation",
				label: "very-long-command-name-that-needs-truncation",
				description: "first",
			},
			{ value: "short", label: "short", description: "second" },
		];

		const list = new SelectList(items, 5, testTheme, {
			minPrimaryColumnWidth: 12,
			maxPrimaryColumnWidth: 20,
		});
		const rendered = list.render(80);

		assert.equal(visibleIndexOf(rendered[0], "first"), 22);
		assert.equal(visibleIndexOf(rendered[1], "second"), 22);
	});

	it("allows overriding primary truncation while preserving description alignment", () => {
		const items = [
			{
				value: "very-long-command-name-that-needs-truncation",
				label: "very-long-command-name-that-needs-truncation",
				description: "first",
			},
			{ value: "short", label: "short", description: "second" },
		];

		const list = new SelectList(items, 5, testTheme, {
			minPrimaryColumnWidth: 12,
			maxPrimaryColumnWidth: 12,
			truncatePrimary: ({ text, maxWidth }) => {
				if (text.length <= maxWidth) {
					return text;
				}

				return `${text.slice(0, Math.max(0, maxWidth - 1))}…`;
			},
		});
		const rendered = list.render(80);

		assert.ok(rendered[0].includes("…"));
		assert.equal(visibleIndexOf(rendered[0], "first"), visibleIndexOf(rendered[1], "second"));
	});

	it("marks selection with the shared marker and overflows with counts", () => {
		assert.strictEqual(SELECT_MARKER, "❯");
		const items = Array.from({ length: 10 }, (_, i) => ({ value: `item-${i}`, label: `item-${i}` }));
		const list = new SelectList(items, 5, testTheme);
		const rendered = list.render(80);
		assert.ok(rendered[0].startsWith("❯ "));
		assert.ok(rendered.join("\n").includes("↓ 5 more"));
		assert.strictEqual(selectListOverflow(0, 5, 5), "");
		assert.strictEqual(selectListOverflow(2, 7, 10), "  ↑ 2 more · ↓ 3 more");
	});

	it("clamps height to half the screen between 6 and rows-3", () => {
		assert.strictEqual(selectListHeight(40), 20);
		assert.strictEqual(selectListHeight(24), 12);
		assert.strictEqual(selectListHeight(10), 6);
	});

	it("filters fuzzily and names empty states", () => {
		const items = [
			{ value: "stela", label: "stela" },
			{ value: "settings", label: "settings" },
		];
		const list = new SelectList(items, 5, testTheme);
		list.setFilter("stl");
		assert.ok(list.render(80).join("\n").includes("stela"));
		list.setFilter("zzz");
		assert.ok(list.render(80).join("\n").includes("No matching items"));
		const empty = new SelectList([], 5, testTheme);
		assert.ok(empty.render(80).join("\n").includes("No items"));
	});

	it("caps the description column at 40 percent", () => {
		const items = [{ value: "a", label: "a", description: "d".repeat(100) }];
		const list = new SelectList(items, 5, testTheme);
		const rendered = list.render(100);
		const desc = rendered[0].slice(rendered[0].indexOf("d"));
		assert.ok(visibleWidth(desc) <= 40);
	});

	it("resolves glyphs to the active symbol preset", () => {
		assert.strictEqual(pickSymbol("❯", ">"), "❯");
		assert.strictEqual(selectMarker(), "❯");
		assert.strictEqual(selectCurrentMark(), "✔");
		assert.strictEqual(selectListOverflow(2, 7, 10), "  ↑ 2 more · ↓ 3 more");
		setSymbolPreset("ascii");
		assert.strictEqual(pickSymbol("❯", ">"), ">");
		assert.strictEqual(selectMarker(), ">");
		assert.strictEqual(selectCurrentMark(), "*");
		assert.strictEqual(selectListOverflow(2, 7, 10), "  ^ 2 more / v 3 more");
		const items = Array.from({ length: 10 }, (_, i) => ({ value: `item-${i}`, label: `item-${i}` }));
		const rendered = new SelectList(items, 5, testTheme).render(80).join("\n");
		assert.ok(rendered.startsWith("> "));
		assert.ok(rendered.includes("^") === false);
	});
});
