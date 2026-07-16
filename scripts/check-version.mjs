import { readFile } from "node:fs/promises";

const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
const tauriConfig = JSON.parse(
  await readFile(new URL("../src-tauri/tauri.conf.json", import.meta.url), "utf8"),
);
const cargoToml = await readFile(new URL("../src-tauri/Cargo.toml", import.meta.url), "utf8");

const packageSection = cargoToml.match(/\[package\]([\s\S]*?)(?:\n\[|$)/)?.[1];
const cargoVersion = packageSection?.match(/^\s*version\s*=\s*"([^"]+)"/m)?.[1];
const versions = {
  "package.json": packageJson.version,
  "src-tauri/tauri.conf.json": tauriConfig.version,
  "src-tauri/Cargo.toml": cargoVersion,
};

const uniqueVersions = new Set(Object.values(versions));
if (uniqueVersions.size !== 1 || uniqueVersions.has(undefined)) {
  console.error("Application versions do not match:");
  for (const [file, version] of Object.entries(versions)) {
    console.error(`  ${file}: ${version ?? "missing"}`);
  }
  process.exit(1);
}

const version = packageJson.version;
const releaseTag = process.env.RELEASE_TAG;
if (releaseTag && releaseTag !== `v${version}`) {
  console.error(`Release tag ${releaseTag} does not match application version v${version}.`);
  process.exit(1);
}

console.log(`Version check passed: ${version}`);

