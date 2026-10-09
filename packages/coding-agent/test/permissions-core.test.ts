import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { decidePermission, type GateContext, type ShellAnalyzer } from "../src/core/permissions/gate.ts";
import {
	getModeUnavailableReason,
	nextPermissionMode,
	type PermissionMode,
	parsePermissionMode,
} from "../src/core/permissions/modes.ts";
import {
	createPathScope,
	getProtectedPathKind,
	matchesPathPattern,
	resolvePermissionPath,
} from "../src/core/permissions/paths.ts";
import {
	matchesShellPattern,
	type PermissionRule,
	parseRule,
	parseRules,
	type RuleAction,
} from "../src/core/permissions/rules.ts";

// Minimal stand-in for the real bash analyzer: splits on && and ;, treats a few commands as read-only,
// and reports `> file` redirects. The real parser is tested separately.
const READ_ONLY = new Set(["ls", "cat", "pwd", "git status"]);
const testAnalyzer: ShellAnalyzer = (command, _tool, cwd) => {
	if (command.includes("$(") || command.includes("`")) return { kind: "opaque", reason: "substitution" };
	const segments = command.split(/&&|;/).map((part) => {
		const [text, target] = part.split(">").map((piece) => piece.trim());
		return { command: text, readOnly: READ_ONLY.has(text), writes: target ? [join(cwd, target)] : [], reads: [] };
	});
	return { kind: "parsed", segments };
};

function rules(spec: Partial<Record<RuleAction, string[]>>, source: PermissionRule["source"] = "user") {
	const errors: string[] = [];
	const result = [
		...parseRules(spec.deny, "deny", source, errors),
		...parseRules(spec.ask, "ask", source, errors),
		...parseRules(spec.allow, "allow", source, errors),
	];
	expect(errors).toEqual([]);
	return result;
}

describe("permission modes", () => {
	const all = { autoAvailable: true, bypassAvailable: true };
	const none = { autoAvailable: false, bypassAvailable: false };

	test("parses IDs and the default alias", () => {
		expect(parsePermissionMode("default")).toBe("manual");
		expect(parsePermissionMode("acceptEdits")).toBe("acceptEdits");
		expect(parsePermissionMode("yolo")).toBeUndefined();
	});

	test("cycles manual → acceptEdits → plan → auto → bypass → manual", () => {
		const seen: PermissionMode[] = [];
		let mode: PermissionMode = "manual";
		for (let i = 0; i < 5; i++) {
			mode = nextPermissionMode(mode, all);
			seen.push(mode);
		}
		expect(seen).toEqual(["acceptEdits", "plan", "auto", "bypassPermissions", "manual"]);
	});

	test("skips gated modes and explains why", () => {
		expect(nextPermissionMode("plan", none)).toBe("manual");
		expect(getModeUnavailableReason("auto", none)).toContain("permissions.auto.model");
		expect(getModeUnavailableReason("bypassPermissions", none)).toContain("--allow-bypass-permissions");
		expect(getModeUnavailableReason("plan", none)).toBeUndefined();
	});
});

describe("permission rule grammar", () => {
	test("parses tool and specifier", () => {
		expect(parseRule("Bash(git status)", "allow", "user").rule).toMatchObject({
			tool: "Bash",
			specifier: "git status",
		});
		expect(parseRule("mcp__github__*", "allow", "user").rule).toMatchObject({ tool: "mcp__github__*" });
	});

	test("rejects malformed rules", () => {
		expect(parseRule("Bash(git", "allow", "user").error).toContain('missing ")"');
		expect(parseRule("Bash()", "allow", "user").error).toContain("empty specifier");
		expect(parseRule("mcp__x__y(foo)", "allow", "user").error).toContain("does not take a specifier");
		expect(parseRule("WebFetch(example.com)", "allow", "user").error).toContain("domain:");
	});

	test("shell prefixes respect word boundaries and exact matches stay exact", () => {
		expect(matchesShellPattern("git:*", "git status")).toBe(true);
		expect(matchesShellPattern("git:*", "git")).toBe(true);
		expect(matchesShellPattern("git:*", "gitx status")).toBe(false);
		expect(matchesShellPattern("npm run test *", "npm run test -- --watch")).toBe(true);
		expect(matchesShellPattern("git status", "git status --short")).toBe(false);
		expect(matchesShellPattern("echo *", "echo hi")).toBe(true);
	});
});

describe("permission paths", () => {
	let root: string;
	let cwd: string;

	beforeEach(() => {
		root = realpathSync(mkdtempSync(join(tmpdir(), "stela-perm-paths-")));
		cwd = join(root, "project");
		mkdirSync(join(cwd, "src"), { recursive: true });
	});
	afterEach(() => rmSync(root, { recursive: true, force: true }));

	test("matches gitignore-style patterns", () => {
		const file = join(cwd, "src", "a", "b.ts");
		expect(matchesPathPattern("src/**", file, cwd)).toBe(true);
		expect(matchesPathPattern("./src/*.ts", file, cwd)).toBe(false);
		expect(matchesPathPattern("*.ts", file, cwd)).toBe(true);
		expect(matchesPathPattern("src", file, cwd)).toBe(true);
		expect(matchesPathPattern(`/${file.slice(1)}`, file, cwd)).toBe(true);
		expect(matchesPathPattern(`/${file}`, file, cwd)).toBe(true);
	});

	test("resolves symlinks so a link cannot escape the workspace", () => {
		const outside = join(root, "outside");
		mkdirSync(outside);
		symlinkSync(outside, join(cwd, "link"));
		const resolved = resolvePermissionPath("link/new-file.txt", cwd);
		expect(resolved).toBe(join(outside, "new-file.txt"));
	});

	test("classifies protected paths", () => {
		const agentDir = join(root, "agent");
		expect(getProtectedPathKind(join(cwd, ".env.local"), agentDir)).toBe("secret");
		expect(getProtectedPathKind(join(root, ".ssh", "config"), agentDir)).toBe("secret");
		expect(getProtectedPathKind(join(root, "id_ed25519"), agentDir)).toBe("secret");
		expect(getProtectedPathKind(join(root, "id_ed25519.pub"), agentDir)).toBeUndefined();
		expect(getProtectedPathKind(join(cwd, ".git", "hooks", "pre-commit"), agentDir)).toBe("config");
		expect(getProtectedPathKind(join(cwd, ".stela", "settings.json"), agentDir)).toBe("config");
		expect(getProtectedPathKind(join(agentDir, "auth.json"), agentDir)).toBe("config");
		expect(getProtectedPathKind(join(cwd, ".gitignore"), agentDir)).toBeUndefined();
	});
});

describe("permission gate", () => {
	let root: string;
	let cwd: string;
	let base: GateContext;

	beforeEach(() => {
		root = realpathSync(mkdtempSync(join(tmpdir(), "stela-perm-gate-")));
		cwd = join(root, "project");
		mkdirSync(cwd, { recursive: true });
		writeFileSync(join(cwd, "a.ts"), "");
		base = {
			mode: "manual",
			rules: [],
			cwd,
			scope: createPathScope(cwd, []),
			agentDir: join(root, "agent"),
			analyzeShell: testAnalyzer,
		};
	});
	afterEach(() => rmSync(root, { recursive: true, force: true }));

	const decide = (tool: string, args: unknown, ctx: Partial<GateContext> = {}) =>
		decidePermission(tool, args, { ...base, ...ctx });

	test("manual: reads in the workspace run, edits and unknown shell ask", () => {
		expect(decide("read", { path: "a.ts" }).action).toBe("allow");
		expect(decide("grep", { pattern: "x" }).action).toBe("allow");
		expect(decide("edit", { path: "a.ts", edits: [] })).toMatchObject({
			action: "ask",
			suggestedRules: ["Edit(./a.ts)"],
		});
		expect(decide("bash", { command: "ls" }).action).toBe("allow");
		expect(decide("bash", { command: "npm test" })).toMatchObject({
			action: "ask",
			suggestedRules: ["Bash(npm test)"],
		});
	});

	test("manual: reads outside the workspace ask", () => {
		expect(decide("read", { path: join(root, "elsewhere.txt") })).toMatchObject({
			action: "ask",
			reason: expect.stringContaining("outside the workspace"),
		});
	});

	test("accept edits: edits inside the workspace run; outside and shell still ask", () => {
		expect(decide("write", { path: "new.ts", content: "" }, { mode: "acceptEdits" }).action).toBe("allow");
		expect(decide("write", { path: join(root, "x.ts"), content: "" }, { mode: "acceptEdits" }).action).toBe("ask");
		expect(decide("bash", { command: "npm test" }, { mode: "acceptEdits" }).action).toBe("ask");
	});

	test("plan: denies edits and non-read-only shell, including redirects", () => {
		expect(decide("edit", { path: "a.ts", edits: [] }, { mode: "plan" }).action).toBe("deny");
		expect(decide("bash", { command: "npm test" }, { mode: "plan" }).action).toBe("deny");
		expect(decide("bash", { command: "ls > out.txt" }, { mode: "plan" }).action).toBe("deny");
		expect(decide("bash", { command: "echo $(rm -rf x)" }, { mode: "plan" }).action).toBe("deny");
		expect(decide("bash", { command: "git status" }, { mode: "plan" }).action).toBe("allow");
		const planFile = join(cwd, "PLAN.md");
		expect(decide("write", { path: "PLAN.md", content: "" }, { mode: "plan", planFilePath: planFile }).action).toBe(
			"allow",
		);
	});

	test("plan: denies protected reads instead of asking", () => {
		expect(decide("read", { path: ".env" }, { mode: "plan" })).toMatchObject({
			action: "deny",
			reason: expect.stringContaining("Plan mode does not access protected paths: .env."),
		});
		expect(decide("read", { path: ".env" }, { mode: "manual" }).action).toBe("ask");
		expect(decide("read", { path: ".git/config" }, { mode: "plan" }).action).toBe("allow");
	});

	test("bypass: no prompts, but deny rules still block", () => {
		const denyRm = rules({ deny: ["Bash(rm:*)"] });
		expect(decide("bash", { command: "npm test" }, { mode: "bypassPermissions" }).action).toBe("allow");
		expect(decide("write", { path: ".env", content: "" }, { mode: "bypassPermissions" }).action).toBe("allow");
		expect(decide("bash", { command: "rm -rf build" }, { mode: "bypassPermissions", rules: denyRm }).action).toBe(
			"deny",
		);
	});

	test("auto: leftover calls are classifiable; protected paths and ask rules are not", () => {
		expect(decide("bash", { command: "npm test" }, { mode: "auto" })).toMatchObject({
			action: "ask",
			classifiable: true,
		});
		expect(decide("edit", { path: "a.ts", edits: [] }, { mode: "auto" }).action).toBe("allow");
		expect(decide("write", { path: ".env", content: "" }, { mode: "auto" })).toMatchObject({ classifiable: false });
		const askNpm = rules({ ask: ["Bash(npm:*)"] });
		expect(decide("bash", { command: "npm test" }, { mode: "auto", rules: askNpm })).toMatchObject({
			classifiable: false,
		});
	});

	test("severity beats source: a project allow cannot override a user deny", () => {
		const combined = [...rules({ deny: ["Bash(curl:*)"] }, "user"), ...rules({ allow: ["Bash(*)"] }, "project")];
		expect(decide("bash", { command: "curl example.com" }, { rules: combined })).toMatchObject({
			action: "deny",
			reason: expect.stringContaining("Bash(curl:*) (user settings)"),
		});
	});

	test("compound commands: one denied segment denies, allow needs every segment", () => {
		const r = rules({ allow: ["Bash(npm test)"], deny: ["Bash(rm:*)"] });
		expect(decide("bash", { command: "npm test" }, { rules: r }).action).toBe("allow");
		expect(decide("bash", { command: "npm test && curl x" }, { rules: r })).toMatchObject({
			action: "ask",
			suggestedRules: ["Bash(curl x)"],
		});
		expect(decide("bash", { command: "npm test; rm -rf /" }, { rules: r }).action).toBe("deny");
		expect(decide("bash", { command: "npm test && echo `rm -rf /`" }, { rules: r }).action).toBe("ask");
	});

	test("a broad shell allow cannot approve a joined command", () => {
		const r = rules({ allow: ["Bash(echo *)"] });
		expect(decide("bash", { command: "echo ok && touch x" }, { rules: r }).action).toBe("ask");
	});

	test("redirect targets are checked as writes, including protected paths", () => {
		const r = rules({ allow: ["Bash(echo hi)"] });
		expect(decide("bash", { command: "echo hi > notes.txt" }, { rules: r }).action).toBe("ask");
		expect(decide("bash", { command: "echo hi > notes.txt" }, { rules: r, mode: "acceptEdits" }).action).toBe(
			"allow",
		);
		expect(decide("bash", { command: "echo hi > .git/config" }, { rules: r, mode: "acceptEdits" })).toMatchObject({
			action: "ask",
			reason: expect.stringContaining("protected path"),
		});
	});

	test("protected paths ask even when a rule allows them", () => {
		const r = rules({ allow: ["Edit(**)", "Read(**)"] });
		expect(decide("edit", { path: ".stela/settings.json", edits: [] }, { rules: r }).action).toBe("ask");
		expect(decide("read", { path: ".env" }, { rules: r }).action).toBe("ask");
		expect(decide("read", { path: ".git/config" }, { rules: r }).action).toBe("allow");
	});

	test("MCP and unknown tools ask unless a rule allows them", () => {
		expect(decide("mcp__github__list_issues", {}).action).toBe("ask");
		expect(decide("mcp__github__list_issues", {}, { rules: rules({ allow: ["mcp__github__*"] }) }).action).toBe(
			"allow",
		);
	});

	test("web fetch matches by domain", () => {
		const r = rules({ allow: ["WebFetch(domain:*.example.com)"] });
		expect(decide("webfetch", { url: "https://docs.example.com/x" }, { rules: r }).action).toBe("allow");
		expect(decide("webfetch", { url: "https://evil.test/" }, { rules: r })).toMatchObject({
			action: "ask",
			suggestedRules: ["WebFetch(domain:evil.test)"],
		});
	});
});
