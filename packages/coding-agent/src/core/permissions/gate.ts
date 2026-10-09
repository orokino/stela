import { dirname, relative } from "node:path";
import { classifyToolCall } from "./classify-tool.ts";
import type { PermissionMode } from "./modes.ts";
import {
	getProtectedPathKind,
	isPathWithin,
	isWithinScope,
	realpathAllowMissing,
	resolvePermissionPath,
} from "./paths.ts";
import { describeRule, findRule, isExactShellRule, type PermissionRule, type PermissionTarget } from "./rules.ts";

/** One simple command of a shell line, after wrappers and safe env prefixes are removed. */
export interface ShellSegment {
	/** Normalized command text that rules match against, e.g. `git status`. */
	command: string;
	/** True when the command only reads (read-only fast path). */
	readOnly: boolean;
	/** Absolute paths this segment writes through redirects. `/dev/null` and fd duplication are not listed. */
	writes: string[];
	/** Absolute paths a read-only segment reads; checked like `read` tool paths (scope, secrets). */
	reads: string[];
	/** Why the command is dangerous, e.g. "deletes recursively or forcibly". Only an exact allow rule allows it. */
	danger?: string;
}

/** A parsed shell line, or `opaque` when it cannot be analyzed safely (it then always asks). */
export type ShellAnalysis = { kind: "parsed"; segments: ShellSegment[] } | { kind: "opaque"; reason: string };

/** Analyze a shell line. Relative paths are resolved against `cwd`. */
export type ShellAnalyzer = (command: string, tool: string, cwd: string) => ShellAnalysis;

export interface GateContext {
	mode: PermissionMode;
	/** Union of every rule source, including session grants. */
	rules: readonly PermissionRule[];
	cwd: string;
	/** Workspace directories (real paths): cwd plus added directories. */
	scope: readonly string[];
	agentDir: string;
	analyzeShell: ShellAnalyzer;
	/** The one file plan mode may edit, if any (real path). */
	planFilePath?: string;
}

export type PermissionDecision =
	| { action: "allow"; reason: string }
	| { action: "deny"; reason: string }
	| {
			action: "ask";
			reason: string;
			/** Auto mode may hand this call to the classifier; false for protected paths and ask rules. */
			classifiable: boolean;
			/** Rules that would allow this call, offered by the dialog's "always" options. */
			suggestedRules: string[];
			/**
			 * When exactly one rule is suggested: that rule, then wider rules the user may save instead
			 * (`Bash(npm run build)`, `Bash(npm run:*)`, `Bash(npm:*)`). Empty otherwise and for dangerous commands.
			 */
			ruleChoices: string[];
	  };

/**
 * Decide one tool call. Order:
 * 1. deny rules (any target) deny, in every mode;
 * 2. plan mode denies writes, non-read-only shell and protected paths;
 * 3. protected paths ask (not in bypass);
 * 4. ask rules ask (bypass allows);
 * 5. bypass allows;
 * 6. allowed when every target is allowed by a rule or by the mode's own scope;
 * 7. otherwise ask.
 */
export function decidePermission(tool: string, args: unknown, ctx: GateContext): PermissionDecision {
	const call = classifyToolCall(tool, args, ctx.cwd);
	const realCwd = realpathAllowMissing(ctx.cwd);
	const targets: PermissionTarget[] = [];
	const readOnlySegments = new Set<PermissionTarget>();
	let opaqueReason: string | undefined;

	switch (call.kind) {
		case "readOnly":
			for (const path of call.paths) targets.push({ kind: "read", tool, path });
			break;
		case "edit":
			for (const path of call.paths) targets.push({ kind: "edit", tool, path });
			break;
		case "shell": {
			const analysis = ctx.analyzeShell(call.command, tool, ctx.cwd);
			if (analysis.kind === "opaque") {
				opaqueReason = analysis.reason;
				targets.push({ kind: "shell", tool, command: call.command.trim() });
				break;
			}
			for (const segment of analysis.segments) {
				const target: PermissionTarget = { kind: "shell", tool, command: segment.command, danger: segment.danger };
				targets.push(target);
				if (segment.readOnly && segment.writes.length === 0) readOnlySegments.add(target);
				for (const read of segment.reads) {
					targets.push({ kind: "read", tool, path: resolvePermissionPath(read, ctx.cwd) });
				}
				for (const write of segment.writes) {
					targets.push({ kind: "edit", tool, path: resolvePermissionPath(write, ctx.cwd) });
				}
			}
			break;
		}
		case "fetch":
			targets.push({ kind: "fetch", tool, host: call.host });
			break;
		case "other":
			targets.push({ kind: "tool", tool });
			break;
	}

	for (const target of targets) {
		const rule = findRule(ctx.rules, "deny", target, ctx.cwd);
		if (rule) return { action: "deny", reason: `Denied by permission rule ${describeRule(rule)}.` };
	}

	if (ctx.mode === "plan") {
		const denial = planModeDenial(targets, readOnlySegments, opaqueReason, ctx.planFilePath, realCwd);
		if (denial) return { action: "deny", reason: denial };
	}

	if (ctx.mode !== "bypassPermissions") {
		const protectedPath = findProtectedPath(targets, ctx.agentDir, ctx.planFilePath);
		if (protectedPath && ctx.mode === "plan") {
			return {
				action: "deny",
				reason: `Plan mode does not access protected paths: ${displayPath(protectedPath, realCwd)}. ${PLAN_MODE_SUFFIX}`,
			};
		}
		if (protectedPath) {
			return {
				action: "ask",
				reason: `This call touches a protected path: ${displayPath(protectedPath, realCwd)}.`,
				classifiable: false,
				suggestedRules: [],
				ruleChoices: [],
			};
		}
	}

	for (const target of targets) {
		const rule = findRule(ctx.rules, "ask", target, ctx.cwd);
		if (rule && ctx.mode !== "bypassPermissions") {
			return {
				action: "ask",
				reason: `Permission rule ${describeRule(rule)} requires approval.`,
				classifiable: false,
				suggestedRules: [],
				ruleChoices: [],
			};
		}
	}

	if (ctx.mode === "bypassPermissions") return { action: "allow", reason: "Bypass permissions mode." };

	if (opaqueReason !== undefined) {
		return {
			action: "ask",
			reason: `The command could not be analyzed safely (${opaqueReason}).`,
			classifiable: ctx.mode === "auto",
			suggestedRules: [],
			ruleChoices: [],
		};
	}

	const unallowed = targets.filter((target) => !isTargetAllowed(target, readOnlySegments, ctx));
	if (unallowed.length === 0) return { action: "allow", reason: "Allowed by permission rules and mode." };

	const suggestedRules = [...new Set(unallowed.map((target) => suggestRule(target, realCwd)))];
	const widenable = suggestedRules.length === 1 && unallowed.every((target) => !isDangerous(target));
	const wider = widenable ? widerRules(unallowed[0], realCwd) : [];
	return {
		action: "ask",
		reason: describeAsk(unallowed, ctx.scope, realCwd),
		classifiable: ctx.mode === "auto",
		suggestedRules,
		ruleChoices: wider.length > 0 ? [suggestedRules[0], ...wider] : [],
	};
}

function isDangerous(target: PermissionTarget): boolean {
	return target.kind === "shell" && target.danger !== undefined;
}

/** Wider rules covering the target, narrowest first. */
function widerRules(target: PermissionTarget, cwd: string): string[] {
	switch (target.kind) {
		case "shell": {
			// Word prefixes of up to two words: `npm run build` → `npm run:*`, `npm:*`. A `*` would turn into a glob.
			const words = target.command.split(" ");
			const toolName = target.tool === "powershell" ? "PowerShell" : "Bash";
			const rules: string[] = [];
			for (let count = Math.min(2, words.length); count >= 1; count--) {
				const prefix = words.slice(0, count).join(" ");
				if (!prefix.includes("*")) rules.push(`${toolName}(${prefix}:*)`);
			}
			return rules;
		}
		case "read":
		case "edit": {
			// Up to three parent directories, stopping at the working directory or the filesystem root.
			const toolName = target.kind === "read" ? "Read" : "Edit";
			const rules: string[] = [];
			let dir = dirname(target.path);
			for (let level = 0; level < 3 && dir !== dirname(dir); level++) {
				if (!isPathWithin(dir, cwd) && isPathWithin(cwd, dir)) break;
				rules.push(`${toolName}(${dir === cwd ? "./" : `${rulePath(dir, cwd)}/`}**)`);
				if (dir === cwd) break;
				dir = dirname(dir);
			}
			return rules;
		}
		case "fetch": {
			// `docs.api.example.com` → `*.api.example.com`, `*.example.com`.
			const labels = target.host.split(".");
			const rules: string[] = [];
			for (let start = 1; labels.length - start >= 2; start++) {
				rules.push(`WebFetch(domain:*.${labels.slice(start).join(".")})`);
			}
			return rules;
		}
		case "tool": {
			const server = /^(mcp__.+?__)./.exec(target.tool);
			return server ? [`${server[1]}*`] : [];
		}
	}
}

const PLAN_MODE_SUFFIX = "Investigate and present the plan instead; the user decides when to leave plan mode.";

function planModeDenial(
	targets: readonly PermissionTarget[],
	readOnlySegments: ReadonlySet<PermissionTarget>,
	opaqueReason: string | undefined,
	planFilePath: string | undefined,
	realCwd: string,
): string | undefined {
	const prefix = "Plan mode is read-only:";
	const suffix = PLAN_MODE_SUFFIX;
	if (opaqueReason !== undefined) {
		return `${prefix} shell commands that cannot be analyzed are not allowed (${opaqueReason}). ${suffix}`;
	}
	for (const target of targets) {
		if (target.kind === "edit" && target.path !== planFilePath) {
			return `${prefix} writing ${displayPath(target.path, realCwd)} is not allowed. ${suffix}`;
		}
		if (target.kind === "shell" && !readOnlySegments.has(target)) {
			return `${prefix} \`${target.command}\` is not a read-only command. ${suffix}`;
		}
	}
	return undefined;
}

function findProtectedPath(
	targets: readonly PermissionTarget[],
	agentDir: string,
	planFilePath: string | undefined,
): string | undefined {
	for (const target of targets) {
		if (target.kind !== "read" && target.kind !== "edit") continue;
		// The plan file lives in the agent directory, which is protected; plan mode must still be able to write it.
		if (target.path === planFilePath) continue;
		const kind = getProtectedPathKind(target.path, agentDir);
		if (kind === "secret" || (kind === "config" && target.kind === "edit")) return target.path;
	}
	return undefined;
}

function isTargetAllowed(
	target: PermissionTarget,
	readOnlySegments: ReadonlySet<PermissionTarget>,
	ctx: GateContext,
): boolean {
	// A dangerous command needs an allow rule for exactly this command; prefix, glob and bare-tool rules do not count.
	if (target.kind === "shell" && target.danger !== undefined) {
		return ctx.rules.some((rule) => rule.action === "allow" && isExactShellRule(rule, target));
	}
	if (findRule(ctx.rules, "allow", target, ctx.cwd)) return true;
	switch (target.kind) {
		case "read":
			return isWithinScope(target.path, ctx.scope);
		case "edit":
			if (ctx.mode === "plan") return target.path === ctx.planFilePath;
			return (ctx.mode === "acceptEdits" || ctx.mode === "auto") && isWithinScope(target.path, ctx.scope);
		case "shell":
			return readOnlySegments.has(target);
		case "fetch":
		case "tool":
			return false;
	}
}

function describeAsk(unallowed: readonly PermissionTarget[], scope: readonly string[], realCwd: string): string {
	for (const target of unallowed) {
		if ((target.kind === "read" || target.kind === "edit") && !isWithinScope(target.path, scope)) {
			return `${displayPath(target.path, realCwd)} is outside the workspace.`;
		}
	}
	for (const target of unallowed) {
		if (target.kind === "shell" && target.danger !== undefined) {
			return `\`${target.command}\` ${target.danger}; only an exact rule can allow it.`;
		}
	}
	return "No permission rule allows this call.";
}

function suggestRule(target: PermissionTarget, cwd: string): string {
	switch (target.kind) {
		case "shell":
			return `${target.tool === "powershell" ? "PowerShell" : "Bash"}(${target.command})`;
		case "read":
			return `Read(${rulePath(target.path, cwd)})`;
		case "edit":
			return `Edit(${rulePath(target.path, cwd)})`;
		case "fetch":
			return `WebFetch(domain:${target.host})`;
		case "tool":
			return target.tool;
	}
}

function rulePath(path: string, cwd: string): string {
	return isPathWithin(path, cwd) ? `./${relative(cwd, path).split("\\").join("/")}` : path;
}

function displayPath(path: string, cwd: string): string {
	return isPathWithin(path, cwd) ? relative(cwd, path) || "." : path;
}
