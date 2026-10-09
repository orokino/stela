/** The five permission modes. The set is fixed; only their behavior lives in the gate. */
export const PERMISSION_MODES = ["manual", "acceptEdits", "plan", "auto", "bypassPermissions"] as const;

export type PermissionMode = (typeof PERMISSION_MODES)[number];

export const DEFAULT_PERMISSION_MODE: PermissionMode = "manual";

export const PERMISSION_MODE_LABELS: Record<PermissionMode, string> = {
	manual: "manual",
	acceptEdits: "accept edits",
	plan: "plan",
	auto: "auto",
	bypassPermissions: "bypass permissions",
};

export const PERMISSION_MODE_DESCRIPTIONS: Record<PermissionMode, string> = {
	manual: "ask before edits, shell commands, and MCP tools",
	acceptEdits: "auto-approve file edits in the workspace",
	plan: "read-only; investigate and propose a plan",
	auto: "a classifier approves routine actions",
	bypassPermissions: "no prompts; deny rules still apply",
};

/** What makes the gated modes available. */
export interface PermissionModeAvailability {
	/** A classifier model is configured (`permissions.auto.model`) and auto is not disabled. */
	autoAvailable: boolean;
	/** Bypass was allowed at launch (`--allow-bypass-permissions` or setting) and is not disabled. */
	bypassAvailable: boolean;
}

/** Parse a mode ID. `default` is accepted as an alias for `manual`. */
export function parsePermissionMode(value: string): PermissionMode | undefined {
	if (value === "default") return "manual";
	return (PERMISSION_MODES as readonly string[]).includes(value) ? (value as PermissionMode) : undefined;
}

/** Why a mode cannot be selected, or undefined when it can. */
export function getModeUnavailableReason(
	mode: PermissionMode,
	availability: PermissionModeAvailability,
): string | undefined {
	if (mode === "auto" && !availability.autoAvailable) {
		return "set permissions.auto.model to enable auto mode";
	}
	if (mode === "bypassPermissions" && !availability.bypassAvailable) {
		return "start with --allow-bypass-permissions to enable bypass";
	}
	return undefined;
}

/** Next mode in the cycle manual → acceptEdits → plan → auto → bypassPermissions → manual, skipping unavailable modes. */
export function nextPermissionMode(current: PermissionMode, availability: PermissionModeAvailability): PermissionMode {
	const start = PERMISSION_MODES.indexOf(current);
	for (let step = 1; step <= PERMISSION_MODES.length; step++) {
		const candidate = PERMISSION_MODES[(start + step) % PERMISSION_MODES.length];
		if (getModeUnavailableReason(candidate, availability) === undefined) return candidate;
	}
	return current;
}
