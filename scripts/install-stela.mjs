import { lstatSync, mkdirSync, realpathSync, symlinkSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

try {
	if (process.platform === "win32") {
		throw new Error("Windows installation is not supported. Run the checkout launcher with Node instead.");
	}

	const args = process.argv.slice(2);
	let binDir = join(homedir(), ".local", "bin");
	if (args.length !== 0) {
		if (args.length !== 2 || args[0] !== "--bin-dir" || !args[1] || args[1].startsWith("--")) {
			throw new Error("Usage: node scripts/install-stela.mjs [--bin-dir <directory>]");
		}
		binDir = resolve(args[1]);
	}

	const root = dirname(dirname(realpathSync(fileURLToPath(import.meta.url))));
	const target = realpathSync(join(root, "stela"));
	const destination = join(binDir, "stela");
	mkdirSync(binDir, { recursive: true });

	let existing;
	try {
		existing = lstatSync(destination);
	} catch (error) {
		if (error.code !== "ENOENT") throw error;
	}
	if (existing) {
		let sameTarget = false;
		if (existing.isSymbolicLink()) {
			try {
				sameTarget = realpathSync(destination) === target;
			} catch (error) {
				if (error.code !== "ENOENT" && error.code !== "ELOOP") throw error;
			}
		}
		if (!sameTarget) throw new Error(`Refusing to overwrite existing path: ${destination}`);
		console.log(`Already installed: ${destination} -> ${target}`);
	} else {
		symlinkSync(target, destination);
		console.log(`Installed: ${destination} -> ${target}`);
	}

	console.log("Requires Node >=22.19 and checkout dependencies (npm ci --ignore-scripts in the checkout).");
	console.log(`Add ${JSON.stringify(binDir)} to PATH if needed, then run stela from your project directory.`);
	console.log("No shell configuration or existing pi installation was changed.");
} catch (error) {
	console.error(`stela install: ${error.message}`);
	process.exitCode = 1;
}
