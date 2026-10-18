import { readFile } from "node:fs/promises";
import {
  LiveReportSchema,
  liveSourceSnapshot,
  renderLiveReport,
} from "./live-report.ts";
const [path, ...flags] = process.argv.slice(2);
if (!path || flags.some((v) => !["--fresh", "--markdown"].includes(v)))
  throw new Error(
    "Usage: node evaluation/live-validate.mjs REPORT [--fresh] [--markdown]",
  );
const report = LiveReportSchema.parse(JSON.parse(await readFile(path, "utf8")));
if (flags.includes("--fresh")) {
  const current = await liveSourceSnapshot(process.cwd());
  const { configurationHash, ...source } = report.source;
  if (JSON.stringify(current) !== JSON.stringify(source))
    throw new Error("Live report source is stale");
}
if (flags.includes("--markdown")) {
  const markdown = path.replace(/\.json$/, ".md");
  if (
    markdown === path ||
    (await readFile(markdown, "utf8")) !== renderLiveReport(report)
  )
    throw new Error("Live report Markdown is stale");
}
console.log(
  JSON.stringify({
    valid: true,
    mode: report.mode,
    overall: report.overall,
    samples: report.summary.samples,
  }),
);
