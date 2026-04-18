#!/usr/bin/env node
import { spawn } from "node:child_process";
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = ".test-build/src";

function collect(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) collect(full, out);
    else if (full.endsWith(".test.js")) out.push(full);
  }
  return out;
}

const files = collect(ROOT).sort();
if (files.length === 0) {
  console.error(`No .test.js files under ${ROOT}`);
  process.exit(1);
}

const child = spawn(
  process.execPath,
  ["--test", "--test-concurrency=1", "--experimental-test-isolation=none", ...files],
  { stdio: "inherit" },
);
child.on("exit", (code) => process.exit(code ?? 1));
