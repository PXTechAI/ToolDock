import { copyFile, mkdir, rm } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const target = process.env.TOOLDOCK_TARGET_TRIPLE || process.argv[2] || (
  process.platform === "win32" && process.arch === "x64"
    ? "x86_64-pc-windows-msvc"
    : ""
);

if (!target.includes("windows")) {
  console.log("Skipping the Windows hardware monitor sidecar on this target.");
  process.exit(0);
}
if (process.platform !== "win32" || process.arch !== "x64") {
  throw new Error("The ToolDock hardware monitor sidecar must be built on Windows x64.");
}

const project = path.join(
  repoRoot,
  "src-tauri",
  "sidecars",
  "hardware-monitor",
  "ToolDock.HardwareMonitor.csproj",
);
const publishDir = path.join(repoRoot, "src-tauri", "target", "hardware-monitor-publish");
const binariesDir = path.join(repoRoot, "src-tauri", "binaries");
const destination = path.join(
  binariesDir,
  `tooldock-hardware-monitor-${target}.exe`,
);

await rm(publishDir, { recursive: true, force: true });
await mkdir(publishDir, { recursive: true });
await mkdir(binariesDir, { recursive: true });

const publish = spawnSync(
  "dotnet",
  [
    "publish",
    project,
    "--configuration",
    "Release",
    "--runtime",
    "win-x64",
    "--self-contained",
    "true",
    "--output",
    publishDir,
    "--nologo",
  ],
  { cwd: repoRoot, encoding: "utf8", stdio: "inherit" },
);
if (publish.error) {
  throw publish.error;
}
if (publish.status !== 0) {
  throw new Error(`Hardware monitor publish failed with exit code ${publish.status}.`);
}

await copyFile(path.join(publishDir, "tooldock-hardware-monitor.exe"), destination);
await copyFile(
  path.join(repoRoot, "src-tauri", "sidecars", "hardware-monitor", "NOTICE.txt"),
  path.join(binariesDir, `tooldock-hardware-monitor-${target}.LICENSE`),
);
console.log(`Prepared ToolDock hardware monitor sidecar: ${destination}`);
