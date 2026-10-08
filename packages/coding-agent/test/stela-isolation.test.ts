import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { shouldRunFirstTimeSetup } from "../src/cli/startup-ui.ts";
import { getAgentDir, getPackageDir } from "../src/config.ts";
import { AuthStorage } from "../src/core/auth-storage.ts";
import { SessionManager } from "../src/core/session-manager.ts";
import { SettingsManager } from "../src/core/settings-manager.ts";
import { cleanupManagedInstall, handlePackageCommand } from "../src/package-manager-cli.ts";

let directory: string;
let originalExitCode: typeof process.exitCode;

beforeEach(() => {
	directory = mkdtempSync(join(tmpdir(), "stela-isolation-"));
	originalExitCode = process.exitCode;
	vi.stubEnv("HOME", directory);
	vi.stubEnv("USERPROFILE", directory);
	vi.stubEnv("STELA_CODING_AGENT_DIR", "");
	vi.stubEnv("STELA_PACKAGE_DIR", "");
	vi.stubEnv("PI_CODING_AGENT_DIR", join(directory, ".pi", "agent"));
	vi.stubEnv("PI_PACKAGE_DIR", join(directory, "private-pi-package"));
});

afterEach(() => {
	process.exitCode = originalExitCode;
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
	vi.unstubAllEnvs();
	rmSync(directory, { recursive: true, force: true });
});

describe("Stela state isolation", () => {
	test("reads and writes Stela settings without inheriting Pi settings or credentials", async () => {
		const project = join(directory, "project");
		const piAgent = join(directory, ".pi", "agent");
		const stelaAgent = join(directory, ".stela", "agent");
		mkdirSync(piAgent, { recursive: true });
		mkdirSync(stelaAgent, { recursive: true });
		mkdirSync(join(project, ".pi"), { recursive: true });
		mkdirSync(join(project, ".stela"), { recursive: true });
		const piSettings = JSON.stringify({ theme: "private-pi-theme" });
		const piAuth = JSON.stringify({ openai: { type: "api_key", key: "private-pi-key" } });
		writeFileSync(join(piAgent, "settings.json"), piSettings);
		writeFileSync(join(piAgent, "auth.json"), piAuth);
		writeFileSync(join(project, ".pi", "settings.json"), JSON.stringify({ theme: "private-project-theme" }));
		writeFileSync(join(stelaAgent, "settings.json"), JSON.stringify({ theme: "stela-global-theme" }));

		const settings = SettingsManager.create(project);
		expect(settings.getTheme()).toBe("stela-global-theme");
		expect(await AuthStorage.create().read("openai")).toBeUndefined();
		writeFileSync(join(project, ".stela", "settings.json"), JSON.stringify({ theme: "stela-project-theme" }));
		expect(SettingsManager.create(project).getTheme()).toBe("stela-project-theme");
		settings.setTheme("stela-new-theme");
		await settings.flush();
		expect(JSON.parse(readFileSync(join(stelaAgent, "settings.json"), "utf8")).theme).toBe("stela-new-theme");
		expect(readFileSync(join(piAgent, "settings.json"), "utf8")).toBe(piSettings);
		expect(readFileSync(join(piAgent, "auth.json"), "utf8")).toBe(piAuth);
	});

	test("persists and continues a conversation under Stela despite inherited Pi directory overrides", () => {
		const project = join(directory, "project");
		mkdirSync(project);
		const session = SessionManager.create(project);
		session.appendMessage({ role: "user", content: "stela session", timestamp: Date.now() });
		const resumed = SessionManager.continueRecent(project);
		expect(resumed.getSessionId()).toBe(session.getSessionId());
		expect(resumed.buildSessionContext().messages).toContainEqual(
			expect.objectContaining({ role: "user", content: "stela session" }),
		);
		expect(session.getSessionFile()?.startsWith(`${join(getAgentDir(), "sessions")}/`)).toBe(true);
		expect(existsSync(join(directory, ".pi", "agent", "sessions"))).toBe(false);
	});

	test("does not redirect package assets or official Pi onboarding through Pi overrides", () => {
		vi.stubEnv("PI_EXPERIMENTAL", "1");
		expect(getPackageDir()).not.toBe(process.env.PI_PACKAGE_DIR);
		expect(shouldRunFirstTimeSetup(join(directory, "settings.json"))).toBe(false);
	});

	test.each([{ args: ["--self"] }, { args: ["--all"] }])(
		"rejects upstream self-update before network or package mutation: $args",
		async ({ args }) => {
			const fetch = vi.fn();
			vi.stubGlobal("fetch", fetch);
			vi.spyOn(console, "error").mockImplementation(() => {});
			process.exitCode = undefined;
			expect(await handlePackageCommand(["update", ...args])).toBe(true);
			expect(process.exitCode).toBe(1);
			expect(fetch).not.toHaveBeenCalled();
			expect(existsSync(getAgentDir())).toBe(false);
		},
	);

	test("does not clean inherited Pi managed-install staging even when assets are inside its releases", () => {
		const root = join(directory, "pi-managed");
		const release = join(root, "releases", "1.1.0", "node_modules", "@earendil-works", "pi-coding-agent");
		const staging = join(root, "staging", "update-private", "sentinel");
		mkdirSync(release, { recursive: true });
		mkdirSync(join(root, "staging", "update-private"), { recursive: true });
		writeFileSync(staging, "private Pi update");
		writeFileSync(
			join(root, "managed-install.json"),
			JSON.stringify({ kind: "pi-managed-install", schemaVersion: 1, layout: "releases-v1" }),
		);
		vi.stubEnv("PI_MANAGED_INSTALL_ROOT", root);
		vi.stubEnv("STELA_PACKAGE_DIR", release);
		cleanupManagedInstall();
		expect(readFileSync(staging, "utf8")).toBe("private Pi update");
	});
});
