import { matchesPathPattern } from "./paths.ts";

export type RuleAction = "allow" | "ask" | "deny";

/** Where a rule came from. Every source is unioned; the action decides precedence, never the source. */
export type RuleSource = "user" | "project" | "local" | "cli" | "session";

export interface PermissionRule {
	action: RuleAction;
	/** Tool matcher as written: `Bash`, `Read`, `Edit`, `Write`, `WebFetch`, a tool name, `mcp__server__*`, or `*`. */
	tool: string;
	specifier?: string;
	source: RuleSource;
	/** The rule as written, for messages. */
	text: string;
}

/**
 * One thing a tool call touches, as the rules see it. A call can have several targets, for example
 * one per shell segment.
 */
export type PermissionTarget =
	| { kind: "shell"; tool: string; command: string; danger?: string }
	| { kind: "read"; tool: string; path: string }
	| { kind: "edit"; tool: string; path: string }
	| { kind: "fetch"; tool: string; host: string }
	| { kind: "tool"; tool: string };

export interface RuleParseResult {
	rule?: PermissionRule;
	error?: string;
}

const TOOL_NAME = /^(\*|[A-Za-z0-9_.-]+\*?)$/;

/** Parse `Tool` or `Tool(specifier)`. */
export function parseRule(text: string, action: RuleAction, source: RuleSource): RuleParseResult {
	const trimmed = text.trim();
	const open = trimmed.indexOf("(");
	let tool = trimmed;
	let specifier: string | undefined;
	if (open !== -1) {
		if (!trimmed.endsWith(")")) return { error: `Invalid permission rule "${text}": missing ")"` };
		tool = trimmed.slice(0, open);
		specifier = trimmed.slice(open + 1, -1).trim();
		if (specifier === "") return { error: `Invalid permission rule "${text}": empty specifier` };
	}
	if (!TOOL_NAME.test(tool)) return { error: `Invalid permission rule "${text}": bad tool name` };
	if (specifier !== undefined) {
		const category = toolCategory(tool);
		if (category === undefined || tool.includes("*")) {
			return { error: `Invalid permission rule "${text}": ${tool} does not take a specifier` };
		}
		if (category === "fetch" && !specifier.startsWith("domain:")) {
			return { error: `Invalid permission rule "${text}": use WebFetch(domain:host)` };
		}
	}
	return { rule: { action, tool, specifier, source, text: trimmed } };
}

/** Parse a list of rules, collecting errors instead of throwing so one bad rule does not hide the others. */
export function parseRules(
	texts: readonly string[] | undefined,
	action: RuleAction,
	source: RuleSource,
	errors: string[],
): PermissionRule[] {
	const rules: PermissionRule[] = [];
	for (const text of texts ?? []) {
		const result = parseRule(text, action, source);
		if (result.rule) rules.push(result.rule);
		else if (result.error) errors.push(result.error);
	}
	return rules;
}

type ToolCategory = "bash" | "powershell" | "read" | "edit" | "fetch";

function toolCategory(tool: string): ToolCategory | undefined {
	switch (tool.toLowerCase()) {
		case "bash":
			return "bash";
		case "powershell":
			return "powershell";
		case "read":
			return "read";
		case "edit":
		case "write":
			return "edit";
		case "webfetch":
			return "fetch";
		default:
			return undefined;
	}
}

function matchesTool(rule: PermissionRule, target: PermissionTarget): boolean {
	if (rule.tool === "*") return true;
	switch (toolCategory(rule.tool)) {
		case "bash":
			return target.kind === "shell" && target.tool === "bash";
		case "powershell":
			return target.kind === "shell" && target.tool === "powershell";
		case "read":
			return target.kind === "read";
		case "edit":
			return target.kind === "edit";
		case "fetch":
			return target.kind === "fetch";
	}
	if (rule.tool.endsWith("*")) return target.tool.startsWith(rule.tool.slice(0, -1));
	return target.tool === rule.tool;
}

export function ruleMatches(rule: PermissionRule, target: PermissionTarget, cwd: string): boolean {
	if (!matchesTool(rule, target)) return false;
	if (rule.specifier === undefined) return true;
	switch (target.kind) {
		case "shell":
			return matchesShellPattern(rule.specifier, target.command);
		case "read":
		case "edit":
			return matchesPathPattern(rule.specifier, target.path, cwd);
		case "fetch":
			return matchesDomain(rule.specifier.slice("domain:".length), target.host);
		case "tool":
			return false;
	}
}

/**
 * Match one shell segment.
 * - `cmd:*` and `cmd *` are prefixes on a word boundary: `git:*` matches `git status`, not `gitx`.
 * - Other `*` match any characters within the segment; segments are split before matching, so `*` can never
 *   approve a second command joined with `&&` or `;`.
 * - Anything else must match exactly.
 */
export function matchesShellPattern(pattern: string, command: string): boolean {
	if (pattern.endsWith(":*") || pattern.endsWith(" *")) {
		const prefix = pattern.slice(0, -2).trimEnd();
		return command === prefix || command.startsWith(`${prefix} `);
	}
	if (pattern.includes("*")) {
		const regex = new RegExp(`^${pattern.split("*").map(escapeRegExp).join(".*")}$`, "s");
		return regex.test(command);
	}
	return command === pattern;
}

/** True when the rule names exactly this shell command, compared literally (a `*` in the command is not a glob). */
export function isExactShellRule(rule: PermissionRule, target: PermissionTarget & { kind: "shell" }): boolean {
	return rule.specifier === target.command && matchesTool(rule, target);
}

function matchesDomain(pattern: string, host: string): boolean {
	const normalizedHost = host.toLowerCase();
	const normalizedPattern = pattern.toLowerCase();
	if (normalizedPattern.startsWith("*.")) return normalizedHost.endsWith(normalizedPattern.slice(1));
	return normalizedHost === normalizedPattern;
}

function escapeRegExp(text: string): string {
	return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** First rule with the given action that matches the target. */
export function findRule(
	rules: readonly PermissionRule[],
	action: RuleAction,
	target: PermissionTarget,
	cwd: string,
): PermissionRule | undefined {
	return rules.find((rule) => rule.action === action && ruleMatches(rule, target, cwd));
}

const SOURCE_LABELS: Record<RuleSource, string> = {
	user: "user settings",
	project: "project settings",
	local: "project grants",
	cli: "command-line flags",
	session: "this session",
};

export function describeRule(rule: PermissionRule): string {
	return `${rule.text} (${SOURCE_LABELS[rule.source]})`;
}
