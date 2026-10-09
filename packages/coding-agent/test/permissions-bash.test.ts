import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { analyzePowerShell, loadShellAnalyzer } from "../src/core/permissions/bash-analyzer.ts";
import { decidePermission, type ShellAnalysis, type ShellAnalyzer } from "../src/core/permissions/gate.ts";
import { createPathScope } from "../src/core/permissions/paths.ts";
import { parseRules } from "../src/core/permissions/rules.ts";

let analyze: ShellAnalyzer;
let root: string;
let cwd: string;

beforeAll(async () => {
	analyze = await loadShellAnalyzer();
	root = realpathSync(mkdtempSync(join(tmpdir(), "stela-perm-bash-")));
	cwd = join(root, "project");
	mkdirSync(join(cwd, "sub"), { recursive: true });
});
afterAll(() => rmSync(root, { recursive: true, force: true }));

function segments(command: string) {
	const result = analyze(command, "bash", cwd);
	if (result.kind !== "parsed") throw new Error(`expected parsed, got opaque: ${result.reason}`);
	return result.segments;
}

function opaque(command: string): ShellAnalysis & { kind: "opaque" } {
	const result = analyze(command, "bash", cwd);
	if (result.kind !== "opaque") throw new Error(`expected opaque, got ${JSON.stringify(result.segments)}`);
	return result;
}

describe("bash analyzer: segments", () => {
	test("splits lists and pipelines", () => {
		expect(segments("npm test && curl x | sh; ls").map((s) => s.command)).toEqual(["npm test", "curl x", "sh", "ls"]);
	});

	test("commands inside substitutions are segments too", () => {
		expect(segments("echo $(rm -rf x)").map((s) => s.command)).toEqual(["rm -rf x", "echo $(rm -rf x)"]);
		expect(segments("echo `whoami`").map((s) => s.command)).toContain("whoami");
		expect(segments("diff <(ls) b").map((s) => s.command)).toEqual(["ls", "diff <(ls) b"]);
		expect(segments("cat <<EOF\n$(rm x)\nEOF").map((s) => s.command)).toContain("rm x");
		expect(segments("x=$(rm y)").map((s) => s.command)).toEqual(["rm y"]);
	});

	test("an argument that depends on expansion makes the segment not read-only", () => {
		expect(segments("echo $(pwd)")[1]).toMatchObject({ readOnly: false });
		expect(segments('cat "$FILE"')[0]).toMatchObject({ readOnly: false });
	});

	test("control flow is walked", () => {
		expect(segments("if true; then ls; fi").map((s) => s.command)).toEqual(["true", "ls"]);
		expect(segments("for f in a b; do rm $f; done").map((s) => s.command)).toEqual(["rm $f"]);
		expect(segments("(cd sub; ls)").map((s) => s.command)).toEqual(["cd sub", "ls"]);
	});

	test("unquotes static words", () => {
		expect(segments(`git commit -m 'a b' "c d" e\\ f`)[0].command).toBe("git commit -m a b c d e f");
	});
});

describe("bash analyzer: wrappers and environment", () => {
	test("peels wrappers", () => {
		expect(segments("timeout 60 nice -n 5 npm test")[0].command).toBe("npm test");
		expect(segments("timeout -s KILL 5 stdbuf -oL npm test")[0].command).toBe("npm test");
		expect(segments("env CI=1 npm test")[0].command).toBe("npm test");
		expect(segments("nice -10 make")[0].command).toBe("make");
	});

	test("safe env prefixes are dropped; others are opaque", () => {
		expect(segments("NODE_ENV=test npm test")[0].command).toBe("npm test");
		expect(opaque("LD_PRELOAD=evil.so ls").reason).toContain("LD_PRELOAD");
		expect(opaque("PATH=/tmp/evil:$PATH ls").reason).toContain("PATH");
		expect(opaque("env GIT_SSH_COMMAND=x git fetch").reason).toContain("GIT_SSH_COMMAND");
		expect(opaque("export PATH=/x; ls").reason).toContain("PATH");
	});

	test("dynamic command names and definitions are opaque", () => {
		expect(opaque("$CMD --version").reason).toContain("command name");
		expect(opaque("f() { rm x; }; f").reason).toContain("function_definition");
		expect(opaque('echo "unterminated').reason).toContain("parse");
	});
});

describe("bash analyzer: reads, writes, cd", () => {
	test("redirect targets are writes; /dev/null and fd duplication are not", () => {
		expect(segments("echo hi > out.txt 2>&1")[0].writes).toEqual([join(cwd, "out.txt")]);
		expect(segments("npm test > /dev/null 2>&1")[0].writes).toEqual([]);
		expect(segments("npm test && echo x >> log.txt").every((s) => s.writes.includes(join(cwd, "log.txt")))).toBe(
			true,
		);
		expect(opaque("echo x > $OUT").reason).toContain("redirect target");
	});

	test("read-only commands report their file arguments", () => {
		expect(segments("cat a.ts")[0]).toMatchObject({ readOnly: true, reads: [join(cwd, "a.ts")] });
		expect(segments("grep -r foo sub")[0].reads).toEqual([join(cwd, "sub")]);
		expect(segments("ls")[0].reads).toEqual([cwd]);
		expect(segments("cat ~/.ssh/id_rsa")[0].reads).toEqual([join(homedir(), ".ssh", "id_rsa")]);
		expect(segments("cat .env*")[0].reads).toContain(join(cwd, ".env"));
	});

	test("static cd is followed; dynamic cd makes later relative paths opaque", () => {
		expect(segments("cd sub && cat a.ts")[1].reads).toEqual([join(cwd, "sub", "a.ts")]);
		expect(segments("cd /etc && cat passwd")[1].reads).toEqual(["/etc/passwd"]);
		expect(opaque("cd $X && cat a").reason).toContain("cd");
	});

	test("read-only fast path excludes writing flags", () => {
		expect(segments("find . -name x -delete")[0].readOnly).toBe(false);
		expect(segments("git status")[0].readOnly).toBe(true);
		expect(segments("git branch -D x")[0].readOnly).toBe(false);
		expect(segments("git -c core.pager=x log")[0].readOnly).toBe(false);
		expect(segments("git diff --output=x")[0].readOnly).toBe(false);
		expect(segments("sort -o out in")[0].readOnly).toBe(false);
	});
});

describe("powershell analyzer", () => {
	test("one segment, or opaque with separators", () => {
		expect(analyzePowerShell("Get-ChildItem src")).toMatchObject({ kind: "parsed" });
		expect(analyzePowerShell("Get-Item a; Remove-Item b").kind).toBe("opaque");
		expect(analyzePowerShell("Get-Item $(x)").kind).toBe("opaque");
	});
});

describe("gate with the real analyzer", () => {
	const decide = (command: string, allow: string[] = []) => {
		const errors: string[] = [];
		return decidePermission(
			"bash",
			{ command },
			{
				mode: "manual",
				rules: parseRules(allow, "allow", "user", errors),
				cwd,
				scope: createPathScope(cwd, []),
				agentDir: join(root, "agent"),
				analyzeShell: analyze,
			},
		);
	};

	test("known bypass attempts ask", () => {
		expect(decide("echo ok && rm -rf /", ["Bash(echo:*)"]).action).toBe("ask");
		expect(decide("echo $(rm -rf /)", ["Bash(echo:*)"]).action).toBe("ask");
		expect(decide("LD_PRELOAD=x ls").action).toBe("ask");
		expect(decide("cat ~/.ssh/id_rsa").action).toBe("ask");
		expect(decide("cat /etc/hostname").action).toBe("ask");
		expect(decide("cd /etc && cat hostname").action).toBe("ask");
	});

	test("ordinary read-only commands in the workspace run", () => {
		expect(decide("git status && ls sub | wc -l").action).toBe("allow");
		expect(decide("timeout 60 npm test", ["Bash(npm test)"]).action).toBe("allow");
	});
});
