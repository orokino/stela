import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { minimatch } from "minimatch";
import { Language, type Node, Parser } from "web-tree-sitter";
import { getBashGrammarWasmPath, getTreeSitterWasmPath } from "../../config.ts";
import type { ShellAnalysis, ShellAnalyzer, ShellSegment } from "./gate.ts";

/**
 * Shell analysis for the permission gate (D5).
 *
 * Bash is parsed with tree-sitter-bash. Every simple command becomes a segment, including commands inside
 * `$( )`, backticks, process substitution, subshells, and control flow. Anything the analyzer cannot reason
 * about is `opaque` and the gate asks:
 * - parse errors, function definitions, arithmetic `for`, unsupported syntax;
 * - a command name that is not a static word (`$cmd args`);
 * - environment prefixes or assignments outside a small safe list (`LD_PRELOAD=x ls`, `PATH=...`);
 * - a dynamic redirect target or `cd` target.
 *
 * Wrappers (`timeout`, `nice`, `ionice`, `env`, `stdbuf`) are removed before matching, so a rule for `npm test`
 * also covers `timeout 60 npm test`. Redirect targets are reported as writes (`/dev/null` and fd duplication are
 * benign); file arguments of read-only commands are reported as reads. Paths are resolved against the session cwd,
 * following static `cd` within the line.
 *
 * PowerShell is not parsed: a command is one segment, and any separator, pipe, substitution or redirect makes it
 * opaque.
 */

let bashParser: Promise<Parser> | undefined;

function loadBashParser(): Promise<Parser> {
	bashParser ??= (async () => {
		await Parser.init({ wasmBinary: readFileSync(getTreeSitterWasmPath()) });
		const language = await Language.load(readFileSync(getBashGrammarWasmPath()));
		const parser = new Parser();
		parser.setLanguage(language);
		return parser;
	})();
	return bashParser;
}

/**
 * Load the parser once and return the analyzer. If the parser cannot load, every bash command is opaque,
 * so the gate fails closed (asks) instead of trusting unparsed input.
 */
export async function loadShellAnalyzer(): Promise<ShellAnalyzer> {
	let parser: Parser | undefined;
	let loadError: string | undefined;
	try {
		parser = await loadBashParser();
	} catch (error) {
		loadError = error instanceof Error ? error.message : String(error);
	}
	return (command, tool, cwd) => {
		if (tool === "powershell") return analyzePowerShell(command);
		if (!parser) return { kind: "opaque", reason: `shell parser unavailable: ${loadError ?? "not loaded"}` };
		return analyzeBash(parser, command, cwd);
	};
}

export function analyzePowerShell(command: string): ShellAnalysis {
	if (/[;|&`<>\r\n]|\$\(/.test(command)) {
		return { kind: "opaque", reason: "PowerShell command with separators, pipes, substitution or redirects" };
	}
	return { kind: "parsed", segments: [{ command: command.trim(), readOnly: false, writes: [], reads: [] }] };
}

class OpaqueError extends Error {}

/** Variables that may prefix a command or be assigned without changing what runs. */
const SAFE_ENV_VARS = new Set([
	"CI",
	"NODE_ENV",
	"RUST_BACKTRACE",
	"RUST_LOG",
	"DEBUG",
	"NO_COLOR",
	"FORCE_COLOR",
	"TERM",
	"LANG",
	"LC_ALL",
	"TZ",
	"PAGER",
	"GIT_PAGER",
	"PYTHONUNBUFFERED",
	"PYTHONDONTWRITEBYTECODE",
]);

interface Word {
	text: string;
	dynamic: boolean;
}

interface Walk {
	segments: ShellSegment[];
	/** Effective cwd for relative paths; undefined after a `cd` that cannot be resolved statically. */
	cwd: string | undefined;
}

export function analyzeBash(parser: Parser, command: string, cwd: string): ShellAnalysis {
	const tree = parser.parse(command);
	if (!tree) return { kind: "opaque", reason: "parse failed" };
	try {
		if (tree.rootNode.hasError) throw new OpaqueError("parse error");
		const walk: Walk = { segments: [], cwd };
		visitStatement(tree.rootNode, walk, []);
		if (walk.segments.length === 0) throw new OpaqueError("no command found");
		return { kind: "parsed", segments: walk.segments };
	} catch (error) {
		if (error instanceof OpaqueError) return { kind: "opaque", reason: error.message };
		throw error;
	} finally {
		tree.delete();
	}
}

const CONTAINERS = new Set([
	"program",
	"list",
	"pipeline",
	"subshell",
	"compound_statement",
	"negated_command",
	"do_group",
	"if_statement",
	"elif_clause",
	"else_clause",
	"while_statement",
	"case_item",
]);

function visitStatement(node: Node, walk: Walk, writes: readonly string[]): void {
	if (CONTAINERS.has(node.type)) {
		for (const child of node.namedChildren) {
			if (child.type === "comment") continue;
			// Case patterns and the like are words, not statements; they can still run substitutions.
			if (isWordNode(child.type)) visitSubstitutions(child, walk);
			else visitStatement(child, walk, writes);
		}
		return;
	}
	switch (node.type) {
		case "comment":
			return;
		case "redirected_statement": {
			const own = [...writes];
			for (const redirect of node.childrenForFieldName("redirect")) collectRedirect(redirect, walk, own);
			const body = node.childForFieldName("body");
			if (!body) throw new OpaqueError("redirect without a command");
			visitStatement(body, walk, own);
			return;
		}
		case "command":
			visitCommand(node, walk, writes);
			return;
		case "variable_assignment":
			checkAssignment(node, walk);
			return;
		case "declaration_command":
		case "unset_command": {
			for (const child of node.namedChildren) {
				if (child.type === "variable_assignment") checkAssignment(child, walk);
				else visitSubstitutions(child, walk);
			}
			walk.segments.push({
				command: node.text.trim(),
				readOnly: false,
				writes: resolvePaths(writes, walk),
				reads: [],
			});
			return;
		}
		case "test_command":
			visitSubstitutions(node, walk);
			return;
		case "for_statement": {
			const variable = node.childForFieldName("variable");
			if (variable && !SAFE_ENV_VARS.has(variable.text) && isEnvSensitive(variable.text)) {
				throw new OpaqueError(`loop assigns ${variable.text}`);
			}
			for (const value of node.childrenForFieldName("value")) visitSubstitutions(value, walk);
			const body = node.childForFieldName("body");
			if (body) visitStatement(body, walk, writes);
			return;
		}
		case "case_statement":
			for (const child of node.namedChildren) {
				if (child.type === "case_item") visitStatement(child, walk, writes);
				else visitSubstitutions(child, walk);
			}
			return;
		default:
			throw new OpaqueError(`unsupported shell syntax (${node.type})`);
	}
}

function visitCommand(node: Node, walk: Walk, inheritedWrites: readonly string[]): void {
	const writes = [...inheritedWrites];
	for (const child of node.namedChildren) {
		if (child.type === "variable_assignment") {
			checkAssignment(child, walk);
		} else if (child.type.endsWith("_redirect")) {
			collectRedirect(child, walk, writes);
		}
	}
	const nameNode = node.childForFieldName("name");
	if (!nameNode) throw new OpaqueError("command without a name");
	const name = wordOf(nameNode, walk);
	if (name.dynamic) throw new OpaqueError("the command name is not a static word");
	const args = node.childrenForFieldName("argument").map((arg) => wordOf(arg, walk));
	const argv = peelWrappers([name, ...args]);
	const text = argv.map((word) => word.text).join(" ");

	const program = argv[0].text;
	if (program === "cd" || program === "pushd" || program === "popd") {
		walk.cwd = changeDirectory(argv, walk.cwd);
	}
	const readOnly = argv.every((word) => !word.dynamic) && isReadOnlyCommand(argv.map((word) => word.text));
	const reads = readOnly
		? readPaths(
				argv.map((word) => word.text),
				walk,
			)
		: [];
	walk.segments.push({ command: text, readOnly, writes: resolvePaths(writes, walk), reads });
}

function checkAssignment(node: Node, walk: Walk): void {
	const name = node.childForFieldName("name")?.text ?? "";
	if (!SAFE_ENV_VARS.has(name) && isEnvSensitive(name)) throw new OpaqueError(`assignment to ${name}`);
	const value = node.childForFieldName("value");
	if (value) visitSubstitutions(value, walk);
}

/** Uppercase names can change how programs run (PATH, LD_PRELOAD, GIT_SSH_COMMAND, ...); lowercase shell locals do not. */
function isEnvSensitive(name: string): boolean {
	return name !== name.toLowerCase();
}

function collectRedirect(node: Node, walk: Walk, writes: string[]): void {
	if (node.type === "heredoc_redirect" || node.type === "herestring_redirect") {
		visitSubstitutions(node, walk);
		return;
	}
	if (node.type !== "file_redirect") throw new OpaqueError(`unsupported redirect (${node.type})`);
	const destinationNode = node.childForFieldName("destination");
	if (!destinationNode) throw new OpaqueError("redirect without a target");
	const operator = node.children.find((child) => !child.isNamed)?.text ?? "";
	const destination = wordOf(destinationNode, walk);
	// fd duplication and closing: 2>&1, >&2, <&0, 2>&-
	if ((operator === ">&" || operator === "<&") && /^(\d+|-)$/.test(destination.text)) return;
	if (destination.dynamic) throw new OpaqueError("redirect target is not static");
	if (operator.startsWith("<") && operator !== "<>") return;
	if (/^\/dev\/(null|stdout|stderr)$/.test(destination.text)) return;
	writes.push(destination.text);
}

/** Visit every command substitution under a word-like node so the commands it runs become segments. */
function visitSubstitutions(node: Node, walk: Walk): void {
	if (node.type === "command_substitution" || node.type === "process_substitution") {
		for (const child of node.namedChildren) visitStatement(child, walk, []);
		return;
	}
	for (const child of node.namedChildren) visitSubstitutions(child, walk);
}

function isWordNode(type: string): boolean {
	return (
		type === "word" ||
		type === "string" ||
		type === "raw_string" ||
		type === "concatenation" ||
		type === "number" ||
		type === "simple_expansion" ||
		type === "expansion" ||
		type === "command_substitution" ||
		type === "process_substitution"
	);
}

/** Static text of a word, or its source text marked dynamic when it depends on expansion at run time. */
function wordOf(node: Node, walk: Walk): Word {
	visitSubstitutions(node, walk);
	switch (node.type) {
		case "command_name": {
			const inner = node.firstNamedChild;
			return inner ? wordOf(inner, walk) : { text: node.text, dynamic: false };
		}
		case "word":
			return { text: node.text.replace(/\\(.)/gs, "$1"), dynamic: false };
		case "number":
			return { text: node.text, dynamic: false };
		case "raw_string":
			return { text: node.text.slice(1, -1), dynamic: false };
		case "string": {
			if (node.namedChildren.some((child) => child.type !== "string_content")) {
				return { text: node.text, dynamic: true };
			}
			return { text: node.text.slice(1, -1).replace(/\\([$`"\\\n])/g, "$1"), dynamic: false };
		}
		case "concatenation": {
			const parts = node.namedChildren.map((child) => wordOf(child, walk));
			return { text: parts.map((part) => part.text).join(""), dynamic: parts.some((part) => part.dynamic) };
		}
		default:
			return { text: node.text, dynamic: true };
	}
}

/** Options that take a separate value, per wrapper. */
const WRAPPER_VALUE_OPTIONS: Record<string, Set<string>> = {
	timeout: new Set(["-s", "--signal", "-k", "--kill-after"]),
	nice: new Set(["-n", "--adjustment"]),
	ionice: new Set(["-c", "--class", "-n", "--classdata"]),
	stdbuf: new Set(["-i", "-o", "-e", "--input", "--output", "--error"]),
	env: new Set(["-u", "--unset"]),
};

/** Remove `timeout`, `nice`, `ionice`, `env` and `stdbuf` prefixes so rules match the command they run. */
function peelWrappers(argv: Word[]): Word[] {
	let current = argv;
	for (;;) {
		const rest = peelWrapper(current);
		if (rest === current || rest.length === 0) return current;
		current = rest;
	}
}

function peelWrapper(argv: Word[]): Word[] {
	const program = argv[0].text;
	const valueOptions = WRAPPER_VALUE_OPTIONS[program];
	if (!valueOptions) return argv;
	let index = 1;
	for (; index < argv.length; index++) {
		const word = argv[index];
		if (word.dynamic) throw new OpaqueError(`dynamic ${program} argument`);
		const text = word.text;
		if (text === "--") {
			index++;
			break;
		}
		const isNiceLevel = program === "nice" && /^-\d+$/.test(text);
		if (!text.startsWith("-") && !isNiceLevel) break;
		if (program === "env" && /^(-C|-S|--chdir|--split-string)/.test(text)) {
			throw new OpaqueError("env changes directory or splits a command string");
		}
		// `ionice -p PID` adjusts another process instead of running a command.
		if (program === "ionice" && /^(-[pPu]|--(pid|pgid|uid))/.test(text)) return argv;
		if (valueOptions.has(text)) index++;
	}
	if (program === "timeout") index++;
	if (program === "env") {
		for (; index < argv.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(argv[index].text); index++) {
			const name = argv[index].text.slice(0, argv[index].text.indexOf("="));
			if (!SAFE_ENV_VARS.has(name) && isEnvSensitive(name)) throw new OpaqueError(`env sets ${name}`);
		}
	}
	return argv.slice(index);
}

function changeDirectory(argv: Word[], cwd: string | undefined): string | undefined {
	if (argv[0].text !== "cd" || cwd === undefined) return undefined;
	const target = argv.slice(1).filter((word) => word.text !== "--");
	if (target.length === 0) return homedir();
	if (target.length > 1 || target[0].dynamic || target[0].text === "-") return undefined;
	return resolve(cwd, expandHome(target[0].text));
}

function expandHome(path: string): string {
	if (path === "~") return homedir();
	return path.startsWith("~/") ? join(homedir(), path.slice(2)) : path;
}

function resolvePaths(paths: readonly string[], walk: Walk): string[] {
	return paths.map((path) => {
		const expanded = expandHome(path);
		if (expanded.startsWith("/")) return expanded;
		if (walk.cwd === undefined) throw new OpaqueError("relative path after a cd that cannot be resolved");
		return resolve(walk.cwd, expanded);
	});
}

const ALWAYS_READ_ONLY = new Set([
	"cat",
	"head",
	"tail",
	"wc",
	"pwd",
	"echo",
	"printf",
	"ls",
	"grep",
	"egrep",
	"fgrep",
	"which",
	"whoami",
	"file",
	"stat",
	"du",
	"df",
	"cut",
	"tr",
	"basename",
	"dirname",
	"realpath",
	"readlink",
	"diff",
	"cmp",
	"true",
	"false",
	"test",
	"[",
	"id",
	"uname",
	"type",
	"jq",
	"od",
	"nl",
	"column",
	"printenv",
	"cd",
]);

const GIT_READ_ONLY = new Set([
	"status",
	"log",
	"diff",
	"show",
	"rev-parse",
	"ls-files",
	"ls-tree",
	"blame",
	"describe",
	"shortlog",
	"cat-file",
	"grep",
]);

/** Read-only fast path: commands that only read, excluding flags that write or run other programs. */
function isReadOnlyCommand(argv: string[]): boolean {
	const [program, ...args] = argv;
	const has = (...flags: string[]) =>
		args.some((arg) => flags.some((flag) => arg === flag || arg.startsWith(`${flag}=`)));
	switch (program) {
		case "find":
			return !has("-exec", "-execdir", "-ok", "-okdir", "-delete", "-fprint", "-fprint0", "-fprintf", "-fls");
		case "sort":
			return !has("-o", "--output") && !args.some((arg) => /^-[a-zA-Z]*o/.test(arg) && !arg.startsWith("--"));
		case "tree":
			return !has("-o");
		case "rg":
			return !has("--pre", "--pre-glob");
		case "date":
			return !has("-s", "--set");
		case "hostname":
			return args.every((arg) => arg.startsWith("-"));
		case "env":
			return args.length === 0;
		case "git":
			return isReadOnlyGit(args);
		default:
			return ALWAYS_READ_ONLY.has(program);
	}
}

function isReadOnlyGit(args: string[]): boolean {
	const [sub, ...rest] = args;
	if (sub === undefined || sub.startsWith("-")) return false;
	if (rest.some((arg) => arg.startsWith("--output") || arg === "-O" || arg.startsWith("--open-files-in-pager"))) {
		return false;
	}
	if (GIT_READ_ONLY.has(sub)) return true;
	const flagsOnly = rest.every((arg) => arg.startsWith("-"));
	switch (sub) {
		case "branch":
			return (
				flagsOnly &&
				!rest.some((arg) =>
					/^(-[dDmMcCfu]|--(delete|move|copy|force|set-upstream-to|unset-upstream|edit-description))/.test(arg),
				)
			);
		case "tag":
			return rest.length === 0 || rest.every((arg) => arg === "-l" || arg === "--list" || arg.startsWith("-n"));
		case "remote":
			return rest.length === 0 || (rest.length === 1 && rest[0] === "-v");
		case "config":
			return rest.some((arg) => ["--get", "--get-all", "--get-regexp", "--list", "-l"].includes(arg));
		case "reflog":
			return rest.length === 0 || rest[0] === "show";
		default:
			return false;
	}
}

const PATHLESS = new Set([
	"echo",
	"printf",
	"pwd",
	"true",
	"false",
	"test",
	"[",
	"date",
	"whoami",
	"id",
	"uname",
	"hostname",
	"which",
	"type",
	"env",
	"printenv",
	"tr",
	"git",
	"cd",
]);

/** File arguments of a read-only command, resolved. They are checked like `read` tool paths. */
function readPaths(argv: string[], walk: Walk): string[] {
	const [program, ...args] = argv;
	if (PATHLESS.has(program)) return [];
	const positionals: string[] = [];
	let optionsDone = false;
	let patternGiven = false;
	for (const arg of args) {
		if (!optionsDone && arg === "--") {
			optionsDone = true;
			continue;
		}
		if (!optionsDone && arg.startsWith("-") && arg !== "-") {
			if (/^(-e|--regexp|-f|--file|--from-file)/.test(arg)) patternGiven = true;
			continue;
		}
		positionals.push(arg);
	}
	let paths = positionals;
	if ((program === "grep" || program === "egrep" || program === "fgrep" || program === "rg") && !patternGiven) {
		paths = positionals.slice(1);
	} else if (program === "jq" && !patternGiven) {
		paths = positionals.slice(1);
	} else if (program === "find") {
		paths = [];
		for (const arg of args) {
			if (arg.startsWith("-") || arg === "(" || arg === "!") break;
			paths.push(arg);
		}
	}
	if ((program === "ls" || program === "find" || program === "du" || program === "tree") && paths.length === 0) {
		paths = ["."];
	}
	return resolvePaths(paths.filter((path) => path !== "-").flatMap(globReadTargets), walk);
}

const SECRET_SAMPLES = [".env", ".env.local", "id_rsa", "id_ed25519", "key.pem", "server.key"];

/**
 * A glob read is checked through its directory, plus a sample secret file name when the glob could match one,
 * so `cat .env*` or `cat *.pem` still hits the protected-path check.
 */
function globReadTargets(path: string): string[] {
	if (!/[*?[]/.test(path)) return [path];
	const dir = dirname(path);
	const pattern = basename(path);
	const targets = [/[*?[]/.test(dir) ? "." : dir];
	const secret = SECRET_SAMPLES.find((sample) => minimatch(sample, pattern, { dot: true }));
	if (secret) targets.push(join(targets[0], secret));
	return targets;
}
