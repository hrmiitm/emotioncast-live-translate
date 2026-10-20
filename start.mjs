#!/usr/bin/env node
import { spawn } from "node:child_process";
import electron from "electron";
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(electron, [import.meta.dirname, ...process.argv.slice(2)], {
  cwd: import.meta.dirname,
  env,
  stdio: "inherit",
});
child.on("exit", (code) => process.exit(code ?? 1));
