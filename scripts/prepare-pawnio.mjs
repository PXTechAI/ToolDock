import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const version = "2.2.0";
const expectedSha256 = "1f519a22e47187f70a1379a48ca604981c4fcf694f4e65b734aaa74a9fba3032";
const downloadUrl =
  `https://github.com/namazso/PawnIO.Setup/releases/download/${version}/PawnIO_setup.exe`;
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const target =
  process.env.TOOLDOCK_TARGET_TRIPLE ||
  process.argv[2] ||
  (process.platform === "win32" && process.arch === "x64"
    ? "x86_64-pc-windows-msvc"
    : "");

if (!target.includes("windows")) {
  console.log("Skipping PawnIO on this target.");
  process.exit(0);
}

const binariesDir = path.join(repoRoot, "src-tauri", "binaries");
const destination = path.join(binariesDir, "PawnIO_setup.exe");
await mkdir(binariesDir, { recursive: true });

let binary;
try {
  binary = await readFile(destination);
  if (sha256(binary) === expectedSha256) {
    console.log(`PawnIO ${version} is already prepared.`);
    process.exit(0);
  }
} catch {
  // Download the pinned official installer below.
}

const response = await fetch(downloadUrl, { redirect: "follow" });
if (!response.ok) {
  throw new Error(`Unable to download PawnIO ${version}: HTTP ${response.status}.`);
}
binary = Buffer.from(await response.arrayBuffer());
const actualSha256 = sha256(binary);
if (actualSha256 !== expectedSha256) {
  throw new Error(
    `PawnIO checksum mismatch. Expected ${expectedSha256}, received ${actualSha256}.`,
  );
}

await writeFile(destination, binary);
console.log(`Prepared PawnIO ${version}: ${destination}`);

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}
