import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CONFIG_DIR_NAME } from "../../config.ts";
import type { SettingsManager } from "../settings-manager.ts";
import { loadShellAnalyzer } from "./bash-analyzer.ts";
import { decidePermission, type PermissionDecision, type ShellAnalyzer } from "./gate.ts";
import {
	DEFAULT_PERMISSION_MODE,
	getModeUnavailableReason,
	nextPermissionMode,
	PERMISSION_MODE_LABELS,
	type PermissionMode,
	type PermissionModeAvailability,
	parsePermissionMode,
} from "./modes.ts";
import { createPathScope } from "./paths.ts";
import { type PermissionRule, parseRules, type RuleAction, type RuleSource } from "./rules.ts";

/** Project-local grants written by "Always in this project", next to project settings. */
export const PERMISSIONS_LOCAL_FILE = "permissions.local.json";

export interface PermissionPrompt {
	toolName: string;
	/** One-line summary of what the call does, e.g. the command or path. */
	summary: string;
	/** Why the gate asks. */
	reason: string;
	/** Rules the "for this session" and "always in this project" answers would add. */
	suggestedRules: string[];
	/** Whether "always in this project" is offered (the project is trusted). */
	canSaveToProject: boolean;
	/** Whether "accept edits for this session" is offered (a file edit in manual mode). */
	canAcceptEdits: boolean;
}

export type PermissionAnswer =
	| { kind: "once" }
	| { kind: "session" }
	| { kind: "project" }
	| { kind: "acceptEdits" }
	| { kind: "deny"; feedback?: string };

/** Asks the user; resolves undefined when the prompt was cancelled (Esc or abort). */
export type PermissionPrompter = (
	prompt: PermissionPrompt,
	signal?: AbortSignal,
) => Promise<PermissionAnswer | undefined>;

export interface PermissionCheckResult {
	block: boolean;
	reason?: string;
	/** The user refused without explanation: the caller should stop the turn and give control back. */
	abortTurn?: boolean;
}

export interface PermissionControllerOptions {
	cwd: string;
	agentDir: string;
	settingsManager: SettingsManager;
	/** `--permission-mode`; otherwise `permissions.defaultMode`. */
	initialMode?: PermissionMode;
	/** `--allow-bypass-permissions`. */
	allowBypass?: boolean;
	/** `--add-dir`. */
	additionalDirectories?: string[];
	/** Injected in tests; defaults to the tree-sitter analyzer. */
	analyzeShell?: ShellAnalyzer;
}

export type PermissionModeListener = (mode: PermissionMode, previous: PermissionMode) => void;

/**
 * Owns the permission mode and session grants, assembles rules from every source, and decides each tool call.
 * Sources are unioned and labelled; the gate applies deny > ask > allow regardless of source. Project and
 * project-local rules apply only when the project is trusted, because a cloned repository could ship them.
 */
export class PermissionController {
	private readonly cwd: string;
	private readonly agentDir: string;
	private readonly settingsManager: SettingsManager;
	private readonly cliAllowBypass: boolean;
	private readonly cliDirectories: string[];
	private readonly sessionRules: PermissionRule[] = [];
	private readonly listeners = new Set<PermissionModeListener>();
	private analyzer: Promise<ShellAnalyzer>;
	private currentMode: PermissionMode;
	/** Set when the requested starting mode was unavailable and manual was used instead. */
	readonly startupWarning: string | undefined;

	constructor(options: PermissionControllerOptions) {
		this.cwd = options.cwd;
		this.agentDir = options.agentDir;
		this.settingsManager = options.settingsManager;
		this.cliAllowBypass = options.allowBypass ?? false;
		this.cliDirectories = options.additionalDirectories ?? [];
		this.analyzer = options.analyzeShell ? Promise.resolve(options.analyzeShell) : loadShellAnalyzer();
		const configured = parsePermissionMode(this.settingsManager.getSettings().permissions?.defaultMode ?? "");
		const initial = options.initialMode ?? configured ?? DEFAULT_PERMISSION_MODE;
		// An unavailable starting mode (e.g. bypass without the flag) falls back to manual, the safe default.
		const unavailable = getModeUnavailableReason(initial, this.getAvailability());
		if (unavailable) {
			this.startupWarning = `Starting in manual mode: ${PERMISSION_MODE_LABELS[initial]} is unavailable (${unavailable}).`;
		}
		this.currentMode = unavailable ? DEFAULT_PERMISSION_MODE : initial;
	}

	get mode(): PermissionMode {
		return this.currentMode;
	}

	getAvailability(): PermissionModeAvailability {
		const settings = this.settingsManager.getSettings().permissions ?? {};
		const userSettings = this.settingsManager.getGlobalSettings().permissions ?? {};
		return {
			autoAvailable: !settings.disableAuto && !!settings.auto?.model,
			bypassAvailable: !settings.disableBypass && (this.cliAllowBypass || userSettings.allowBypass === true),
		};
	}

	setMode(mode: PermissionMode): void {
		const unavailable = getModeUnavailableReason(mode, this.getAvailability());
		if (unavailable) throw new Error(`${PERMISSION_MODE_LABELS[mode]} is unavailable: ${unavailable}`);
		const previous = this.currentMode;
		if (previous === mode) return;
		this.currentMode = mode;
		for (const listener of this.listeners) listener(mode, previous);
	}

	cycleMode(): PermissionMode {
		this.setMode(nextPermissionMode(this.currentMode, this.getAvailability()));
		return this.currentMode;
	}

	onModeChange(listener: PermissionModeListener): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	/** Rules from every source, with errors from malformed entries. */
	getRules(): { rules: PermissionRule[]; errors: string[] } {
		const errors: string[] = [];
		const rules: PermissionRule[] = [];
		const add = (source: RuleSource, lists: Partial<Record<RuleAction, string[]>> | undefined) => {
			for (const action of ["deny", "ask", "allow"] as const) {
				rules.push(...parseRules(lists?.[action], action, source, errors));
			}
		};
		add("user", this.settingsManager.getGlobalSettings().permissions);
		if (this.settingsManager.isProjectTrusted()) {
			add("project", this.settingsManager.getProjectSettings().permissions);
			add("local", this.readLocalGrants(errors));
		}
		rules.push(...this.sessionRules);
		return { rules, errors };
	}

	/** Decide a call without prompting. */
	async decide(toolName: string, args: unknown): Promise<PermissionDecision> {
		const settings = this.settingsManager.getSettings().permissions ?? {};
		const directories = [...(settings.additionalDirectories ?? []), ...this.cliDirectories];
		return decidePermission(toolName, args, {
			mode: this.currentMode,
			rules: this.getRules().rules,
			cwd: this.cwd,
			scope: createPathScope(this.cwd, directories),
			agentDir: this.agentDir,
			analyzeShell: await this.analyzer,
		});
	}

	/**
	 * Decide a call and, when it asks, prompt through `prompter`. Without a prompter (print and json modes) a
	 * call that needs approval is denied with a reason, and the turn continues so the model can report it.
	 */
	async check(
		toolName: string,
		args: unknown,
		prompter: PermissionPrompter | undefined,
		signal?: AbortSignal,
	): Promise<PermissionCheckResult> {
		const decision = await this.decide(toolName, args);
		if (decision.action === "allow") return { block: false };
		if (decision.action === "deny") return { block: true, reason: decision.reason };
		if (!prompter) {
			return {
				block: true,
				reason: `${decision.reason} Approval is required, but no one can approve tool calls in this mode. Add a permissions.allow rule or choose another --permission-mode.`,
			};
		}

		const isEdit = toolName === "edit" || toolName === "write";
		const answer = await prompter(
			{
				toolName,
				summary: summarizeCall(args),
				reason: decision.reason,
				suggestedRules: decision.suggestedRules,
				canSaveToProject: decision.suggestedRules.length > 0 && this.settingsManager.isProjectTrusted(),
				canAcceptEdits: isEdit && this.currentMode === "manual",
			},
			signal,
		);
		if (!answer) return { block: true, reason: "The user cancelled this tool call.", abortTurn: true };
		switch (answer.kind) {
			case "once":
				return { block: false };
			case "session":
				this.grantForSession(decision.suggestedRules);
				return { block: false };
			case "project":
				this.grantForProject(decision.suggestedRules);
				return { block: false };
			case "acceptEdits":
				this.setMode("acceptEdits");
				return { block: false };
			case "deny":
				if (!answer.feedback) return { block: true, reason: "The user declined this tool call.", abortTurn: true };
				return { block: true, reason: `The user declined this tool call: ${answer.feedback}` };
		}
	}

	grantForSession(rules: readonly string[]): void {
		const errors: string[] = [];
		this.sessionRules.push(...parseRules(rules, "allow", "session", errors));
		if (errors.length > 0) throw new Error(errors.join("\n"));
	}

	/** Append allow rules to `.stela/permissions.local.json` and keep that file out of git. */
	grantForProject(rules: readonly string[]): void {
		const dir = join(this.cwd, CONFIG_DIR_NAME);
		const file = join(dir, PERMISSIONS_LOCAL_FILE);
		const errors: string[] = [];
		const current = this.readLocalGrants(errors) ?? {};
		if (errors.length > 0) throw new Error(`Cannot update ${file}: ${errors.join("; ")}`);
		const allow = [...(current.allow ?? [])];
		for (const rule of rules) if (!allow.includes(rule)) allow.push(rule);
		mkdirSync(dir, { recursive: true });
		writeFileSync(file, `${JSON.stringify({ ...current, allow }, null, "\t")}\n`);
		ensureGitignored(dir, PERMISSIONS_LOCAL_FILE);
	}

	private readLocalGrants(errors: string[]): Partial<Record<RuleAction, string[]>> | undefined {
		const file = join(this.cwd, CONFIG_DIR_NAME, PERMISSIONS_LOCAL_FILE);
		if (!existsSync(file)) return undefined;
		try {
			const parsed: unknown = JSON.parse(readFileSync(file, "utf8"));
			if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new Error("not an object");
			const grants: Partial<Record<RuleAction, string[]>> = {};
			for (const action of ["allow", "ask", "deny"] as const) {
				const list = (parsed as Record<string, unknown>)[action];
				if (list === undefined) continue;
				if (!Array.isArray(list) || !list.every((entry) => typeof entry === "string")) {
					throw new Error(`"${action}" must be an array of strings`);
				}
				grants[action] = list;
			}
			return grants;
		} catch (error) {
			errors.push(`${file}: ${error instanceof Error ? error.message : String(error)}`);
			return undefined;
		}
	}
}

function ensureGitignored(dir: string, name: string): void {
	const gitignore = join(dir, ".gitignore");
	const existing = existsSync(gitignore) ? readFileSync(gitignore, "utf8") : "";
	if (existing.split(/\r?\n/).some((line) => line.trim() === name || line.trim() === `/${name}`)) return;
	const separator = existing === "" || existing.endsWith("\n") ? "" : "\n";
	writeFileSync(gitignore, `${existing}${separator}${name}\n`);
}

function summarizeCall(args: unknown): string {
	const input = typeof args === "object" && args !== null ? (args as Record<string, unknown>) : {};
	if (typeof input.command === "string") return input.command;
	if (typeof input.path === "string") return input.path;
	if (typeof input.url === "string") return input.url;
	const json = JSON.stringify(args) ?? "";
	return json.length > 200 ? `${json.slice(0, 200)}…` : json;
}
