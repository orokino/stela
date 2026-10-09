import { realpathSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, sep } from "node:path";
import { minimatch } from "minimatch";
import { CONFIG_DIR_NAME } from "../../config.ts";
import { resolveToCwd } from "../tools/path-utils.ts";

/**
 * Resolve a tool path the way the tools do, then follow symlinks through its longest existing ancestor.
 * A new file inside a symlinked directory therefore resolves to where it would really be written.
 */
export function resolvePermissionPath(input: string, cwd: string): string {
	return realpathAllowMissing(resolveToCwd(input, cwd));
}

export function realpathAllowMissing(path: string): string {
	const missing: string[] = [];
	let current = path;
	for (;;) {
		try {
			return join(realpathSync(current), ...missing.reverse());
		} catch {
			const parent = dirname(current);
			if (parent === current) return path;
			missing.push(basename(current));
			current = parent;
		}
	}
}

export function isPathWithin(path: string, dir: string): boolean {
	const rel = relative(dir, path);
	return rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}

/** Directories the agent may read and edit without leaving the workspace: cwd plus added directories, all real paths. */
export function createPathScope(cwd: string, additionalDirectories: readonly string[]): string[] {
	const dirs = [cwd, ...additionalDirectories.map((dir) => resolveToCwd(dir, cwd))];
	return [...new Set(dirs.map(realpathAllowMissing))];
}

export function isWithinScope(path: string, scope: readonly string[]): boolean {
	return scope.some((dir) => isPathWithin(path, dir));
}

/**
 * Protected paths ask even when a mode or rule would allow the call (except in bypass; denied in plan).
 * - `secret`: credentials and keys. Reads and writes are protected.
 * - `config`: repository, agent, editor, and shell configuration. Only writes are protected, so the agent
 *   cannot widen its own permissions or plant hooks without asking.
 */
export type ProtectedPathKind = "secret" | "config";

const SHELL_RC_FILES = new Set([
	".bashrc",
	".bash_profile",
	".bash_login",
	".profile",
	".zshrc",
	".zshenv",
	".zprofile",
	".zlogin",
	".cshrc",
	".tcshrc",
]);

export function getProtectedPathKind(path: string, agentDir: string): ProtectedPathKind | undefined {
	const segments = path.split(/[\\/]/);
	const name = segments[segments.length - 1] ?? "";
	if (
		segments.includes(".ssh") ||
		name === ".env" ||
		name.startsWith(".env.") ||
		/\.(pem|key|p12|pfx)$/i.test(name) ||
		(/^id_[a-z0-9]+$/i.test(name) && !name.endsWith(".pub"))
	) {
		return "secret";
	}
	if (
		segments.includes(".git") ||
		segments.includes(CONFIG_DIR_NAME) ||
		segments.includes(".vscode") ||
		segments.includes(".idea") ||
		SHELL_RC_FILES.has(name) ||
		isPathWithin(path, realpathAllowMissing(agentDir))
	) {
		return "config";
	}
	return undefined;
}

const GLOB_CHARS = /[*?[\]{}]/;

/**
 * Match a path rule specifier against a resolved path.
 * - `~/x` is home-relative; `/x` and `//x` are absolute (`//` is accepted for rule files written for other tools).
 * - `x/y` and `./x` are relative to cwd.
 * - A pattern without `/` (`.env`, `*.log`, `dist`) matches any path component below cwd, like gitignore,
 *   and only the file name outside cwd.
 * - `*` and `?` do not cross `/`; `**` is recursive. A pattern without glob characters also matches everything below it.
 */
export function matchesPathPattern(pattern: string, path: string, cwd: string): boolean {
	const target = toSlashes(path);
	let normalized = pattern.startsWith("//") ? pattern.slice(1) : pattern;
	if (!normalized.includes("/")) {
		// Like gitignore: match any component below cwd, or only the file name outside it.
		const realCwd = realpathAllowMissing(cwd);
		const components = isPathWithin(path, realCwd)
			? toSlashes(relative(realCwd, path)).split("/")
			: [basename(target)];
		return components.some((component) => minimatch(component, normalized, { dot: true }));
	}
	if (normalized.startsWith("~/")) {
		normalized = join(homedir(), normalized.slice(2));
	} else if (!isAbsolute(normalized)) {
		normalized = join(realpathAllowMissing(cwd), normalized);
	}
	const absolutePattern = toSlashes(normalized).replace(/\/+$/, "");
	if (!GLOB_CHARS.test(absolutePattern)) {
		return target === absolutePattern || target.startsWith(`${absolutePattern}/`);
	}
	return minimatch(target, absolutePattern, { dot: true });
}

function toSlashes(path: string): string {
	return sep === "\\" ? path.replace(/\\/g, "/") : path;
}
