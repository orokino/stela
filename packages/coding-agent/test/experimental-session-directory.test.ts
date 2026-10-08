import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import { CONFIG_DIR_NAME, ENV_AGENT_DIR } from "../src/config.ts";
import { ENV_SERVER_DIR, resolveServerDirectory, resolveSessionDirectory } from "../src/experimental/server.ts";

afterEach(() => vi.unstubAllEnvs());

describe("experimental server session directory", () => {
	test("uses the experimental directory under the configured agent directory by default", () => {
		vi.stubEnv(ENV_AGENT_DIR, "/tmp/pi-agent-config");

		expect(resolveSessionDirectory()).toBe("/tmp/pi-agent-config/experimental/sessions");
	});

	test("resolves an explicit relative directory from the current working directory", () => {
		vi.stubEnv(ENV_AGENT_DIR, "/tmp/pi-agent-config");

		expect(resolveSessionDirectory("relative/sessions")).toBe(resolve("relative/sessions"));
	});

	test("expands a tilde in an explicit directory", () => {
		expect(resolveSessionDirectory("~/custom-sessions")).toBe(resolve(homedir(), "custom-sessions"));
	});
});

describe("experimental server state isolation", () => {
	test("ignores Pi's server directory override", () => {
		vi.stubEnv(ENV_SERVER_DIR, "");
		delete process.env[ENV_SERVER_DIR];
		vi.stubEnv("PI_SERVER_DIR", "/tmp/private-pi-server");
		expect(resolveServerDirectory()).toBe(join(homedir(), CONFIG_DIR_NAME, "server"));
	});

	test("uses Stela's directory override with explicit directory precedence", () => {
		vi.stubEnv(ENV_SERVER_DIR, "/tmp/stela-server");
		expect(resolveServerDirectory()).toBe("/tmp/stela-server");
		expect(resolveServerDirectory("explicit-server")).toBe(resolve("explicit-server"));
	});
});
