import { describe, expect, it } from "vitest";
import { TRUNCATION_TABLE } from "../src/core/tools/truncation-table.ts";

describe("truncation table", () => {
	it("pins every surface budget", () => {
		expect(TRUNCATION_TABLE).toEqual({
			bodyCollapsed: 3,
			bodyExpanded: 12,
			outputCollapsed: 3,
			outputExpanded: 10,
			shellCollapsed: 10,
			listCollapsed: 10,
			searchCollapsed: 15,
			findCollapsed: 20,
			fallbackCollapsed: 10,
			diffHunks: 8,
			diffLines: 40,
		});
	});
});
