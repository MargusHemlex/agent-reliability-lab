import { z } from "zod";
import { format } from "prettier";
import { readFile, writeFile } from "node:fs/promises";
import { LiveReportSchema } from "./live-report.ts";
const path = new URL("./live-report.schema.json", import.meta.url);
const serialized = await format(
  JSON.stringify(z.toJSONSchema(LiveReportSchema)),
  { parser: "json" },
);
if (process.argv.includes("--write")) await writeFile(path, serialized);
else if ((await readFile(path, "utf8")) !== serialized)
  throw new Error("Generated live report schema is stale");
