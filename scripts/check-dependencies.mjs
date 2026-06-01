import { readFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const packageFiles = [
  "package.json",
  "apps/api/package.json",
  "apps/web/package.json",
  "packages/shared/package.json"
];

const blockedLifecycleScripts = new Set([
  "preinstall",
  "install",
  "postinstall",
  "prepublish",
  "prepare"
]);

const buildOnlyPackages = new Set(["vite", "@vitejs/plugin-react"]);
let failed = false;

for (const file of packageFiles) {
  const manifest = JSON.parse(await readFile(path.join(root, file), "utf8"));
  for (const scriptName of Object.keys(manifest.scripts ?? {})) {
    if (blockedLifecycleScripts.has(scriptName)) {
      console.error(`${file}: blocked lifecycle script "${scriptName}"`);
      failed = true;
    }
  }

  for (const dependencyName of Object.keys(manifest.dependencies ?? {})) {
    if (buildOnlyPackages.has(dependencyName)) {
      console.error(`${file}: build tool "${dependencyName}" must be in devDependencies`);
      failed = true;
    }
  }
}

if (failed) {
  process.exit(1);
}

console.log("Dependency manifest checks passed.");
