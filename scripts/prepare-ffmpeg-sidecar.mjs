import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { chmod, copyFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const binariesDir = path.join(repoRoot, "src-tauri", "binaries");

const platformTargets = new Map([
  ["win32:x64", "x86_64-pc-windows-msvc"],
  ["darwin:x64", "x86_64-apple-darwin"],
  ["darwin:arm64", "aarch64-apple-darwin"],
  ["linux:x64", "x86_64-unknown-linux-gnu"],
]);

const expectedHashes = new Map([
  ["x86_64-pc-windows-msvc", "04e1307997530f9cf2fe35cba2ca7e8875ca91da02f89d6c7243df819c94ad00"],
  ["x86_64-apple-darwin", "ebdddc936f61e14049a2d4b549a412b8a40deeff6540e58a9f2a2da9e6b18894"],
  ["aarch64-apple-darwin", "a90e3db6a3fd35f6074b013f948b1aa45b31c6375489d39e572bea3f18336584"],
  ["x86_64-unknown-linux-gnu", "e7e7fb30477f717e6f55f9180a70386c62677ef8a4d4d1a5d948f4098aa3eb99"],
]);

const hostKey = `${process.platform}:${process.arch}`;
const hostTarget = platformTargets.get(hostKey);
const target = process.env.TOOLDOCK_TARGET_TRIPLE || process.argv[2] || hostTarget;

if (!target || !expectedHashes.has(target)) {
  throw new Error(`Unsupported ToolDock FFmpeg target: ${target || hostKey}`);
}

if (hostTarget !== target) {
  throw new Error(
    `The installed ffmpeg-static binary is for ${hostTarget || hostKey}, not ${target}. Build this target on a matching runner.`,
  );
}

const ffmpegPath = require("ffmpeg-static");
if (!ffmpegPath) {
  throw new Error(`ffmpeg-static does not provide a binary for ${hostKey}`);
}

const binary = await readFile(ffmpegPath);
const actualHash = createHash("sha256").update(binary).digest("hex");
const expectedHash = expectedHashes.get(target);
if (actualHash !== expectedHash) {
  throw new Error(
    `FFmpeg SHA-256 mismatch for ${target}. Expected ${expectedHash}, received ${actualHash}.`,
  );
}

await mkdir(binariesDir, { recursive: true });
const extension = target.includes("windows") ? ".exe" : "";
const destination = path.join(binariesDir, `ffmpeg-${target}${extension}`);
await copyFile(ffmpegPath, destination);
if (!extension) {
  await chmod(destination, 0o755);
}

for (const suffix of [".LICENSE", ".README"]) {
  const source = `${ffmpegPath}${suffix}`;
  const destinationNotice = path.join(binariesDir, `ffmpeg-${target}${suffix}`);
  await copyFile(source, destinationNotice);
}

console.log(`Prepared verified FFmpeg sidecar for ${target}: ${actualHash}`);
