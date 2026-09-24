import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { CliWorker } from "../src/schema.js";
import { MAX_ARGV_PROMPT, TASK_FILE, runCliWorker } from "../src/workers/cli.js";
import { parseNpmCmdShim, resolveCommand } from "../src/workers/resolve-command.js";

// Exact output of npm's cmd-shim@9 for `commandcode` (the shim npm writes on Windows).
const SHIM = `@ECHO off
GOTO start
:find_dp0
SET dp0=%~dp0
EXIT /b
:start
SETLOCAL
CALL :find_dp0

IF EXIST "%dp0%\\node.exe" (
  SET "_prog=%dp0%\\node.exe"
) ELSE (
  SET "_prog=node"
)

endLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & set PATHEXT=%PATHEXT:;.JS;=;% & "%_prog%"  "%dp0%\\node_modules\\command-code\\dist\\index.mjs" %*
`;
const OLD_SHIM = `@IF EXIST "%~dp0\\node.exe" (\r\n  "%~dp0\\node.exe"  "%~dp0\\node_modules\\x\\bin\\x.js" %*\r\n) ELSE (\r\n  node  "%~dp0\\node_modules\\x\\bin\\x.js" %*\r\n)`;

test("parses current and legacy npm cmd shims", () => {
  assert.equal(parseNpmCmdShim(SHIM, "/npm"), join("/npm", "node_modules", "command-code", "dist", "index.mjs"));
  assert.equal(parseNpmCmdShim(OLD_SHIM, "/npm"), join("/npm", "node_modules", "x", "bin", "x.js"));
  assert.equal(parseNpmCmdShim("@echo hi", "/npm"), null);
});

test("on Windows, npm shims run their script with node directly (exact argv, no cmd.exe)", () => {
  const dir = mkdtempSync(join(tmpdir(), "gt-win-"));
  mkdirSync(join(dir, "node_modules/command-code/dist"), { recursive: true });
  writeFileSync(join(dir, "node_modules/command-code/dist/index.mjs"), "");
  writeFileSync(join(dir, "commandcode.cmd"), SHIM);
  writeFileSync(join(dir, "commandcode"), "#!/bin/sh"); // the sh shim npm also writes; not runnable on Windows
  const env = { PATH: `C:\\nope;${dir}`, PATHEXT: ".COM;.EXE;.BAT;.CMD" };
  const r = resolveCommand("commandcode", env, "win32");
  assert.equal(r.file, process.execPath);
  assert.deepEqual(r.prefixArgs, [join(dir, "node_modules/command-code/dist/index.mjs")]);
  writeFileSync(join(dir, "other.bat"), "@echo off\necho hi");
  assert.throws(() => resolveCommand("other", env, "win32"), /batch file/);
  assert.deepEqual(resolveCommand("commandcode", env, "linux"), { file: "commandcode", prefixArgs: [] });
});

test("long prompts go through a task file instead of argv, and it is cleaned up", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "gt-long-"));
  const script = `const fs=require("fs");const a=process.argv[1];console.log(JSON.stringify({type:"result",result:a.includes("${TASK_FILE}")+":"+fs.readFileSync("${TASK_FILE}","utf8").length}))`;
  const w = CliWorker.parse({ type: "cli", command: [process.execPath, "-e", script, "{prompt}"], output: "ndjson" });
  const prompt = "x".repeat(MAX_ARGV_PROMPT + 1);
  const r = await runCliWorker("long", w, { prompt, cwd });
  assert.equal(r.text, `true:${prompt.length}`);
  const { existsSync } = await import("node:fs");
  assert.equal(existsSync(join(cwd, TASK_FILE)), false);
});
