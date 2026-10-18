import { readFile } from "node:fs/promises";
import { ReportSchema } from "./schemas/report.ts";
import { renderReport, assertSourceFreshness } from "./reporting.ts";
const file = process.argv[2];
if (!file)
  throw new Error(
    "Usage: node evaluation/validate.mjs REPORT.json [--markdown]",
  );
const result = ReportSchema.safeParse(JSON.parse(await readFile(file, "utf8")));
if (!result.success) {
  console.error("Report validation failed");
  process.exitCode = 1;
} else if (process.argv.includes("--fresh")) {
  await assertSourceFreshness(process.cwd(), result.data);
  console.log(
    "Report schema, semantic gates and current source snapshot valid",
  );
} else if (process.argv.includes("--markdown"))
  process.stdout.write(renderReport(result.data));
else console.log("Report schema and semantic gates valid");
