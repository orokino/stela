#!/usr/bin/env node
import { setupCli } from "./cli/setup.ts";
import { APP_NAME } from "./config.ts";
import { main } from "./main.ts";

setupCli();
process.title = `${APP_NAME}-rpc`;

main(["--mode", "rpc", ...process.argv.slice(2)]);
