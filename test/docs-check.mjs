import { readdir, readFile, access } from "node:fs/promises";
import { resolve, dirname } from "node:path";
const root = resolve(import.meta.dirname, "..");
const required = [
  "README.md",
  "SECURITY.md",
  "CONTRIBUTING.md",
  "LICENSE",
  "docs/QUICKSTART.md",
  "docs/FIVE-MINUTE-WALKTHROUGH.md",
  "docs/ARCHITECTURE.md",
  "docs/THREAT-MODEL.md",
  "docs/TESTING.md",
  "docs/LIMITATIONS.md",
  "docs/THIRD-PARTY-NOTICES.md",
  "docs/PUBLICATION-REVIEW.md",
];
for (const file of required) await access(resolve(root, file));
const files = required.filter((f) => f.endsWith(".md"));
async function walk(dir) {
  for (const e of await readdir(resolve(root, dir), { withFileTypes: true })) {
    const path = dir + "/" + e.name;
    if (e.isDirectory()) await walk(path);
    else if (e.name.endsWith(".md")) files.push(path);
  }
}
await walk("docs");
const scripts = JSON.parse(
  await readFile(resolve(root, "package.json"), "utf8"),
).scripts;
let links = 0;
for (const file of new Set(files)) {
  const text = await readFile(resolve(root, file), "utf8");
  for (const match of text.matchAll(/!?\[[^\]]*\]\(([^)]+)\)/g)) {
    const target = match[1].replace(/^<|>$/g, "").split(' "')[0];
    if (/^[a-z]+:|^#/i.test(target)) continue;
    const path = decodeURIComponent(target.split("#")[0]);
    if (path) {
      await access(resolve(dirname(resolve(root, file)), path));
      links++;
    }
  }
  for (const match of text.matchAll(/npm run ([a-z][a-z0-9:-]*)/g))
    if (!Object.hasOwn(scripts, match[1]))
      throw new Error(`Unknown npm script in ${file}: ${match[1]}`);
}
console.log(
  JSON.stringify({
    documentationFiles: new Set(files).size,
    localLinkTargets: links,
    requiredDeliverables: required.length,
    status: "pass",
    scope:
      "existing local targets and npm script names; not external URLs or Markdown anchors",
  }),
);
