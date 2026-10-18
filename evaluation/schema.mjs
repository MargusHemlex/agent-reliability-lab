import { z } from "zod";
import { format } from "prettier";
import { readFile, writeFile } from "node:fs/promises";
import { ReportSchema } from "./schemas/report.ts";
const path = new URL("./schemas/report.schema.json", import.meta.url);
const serialized = await format(JSON.stringify(z.toJSONSchema(ReportSchema)), {
  parser: "json",
});
if (process.argv.includes("--write")) await writeFile(path, serialized);
else if ((await readFile(path, "utf8")) !== serialized)
  throw new Error("Generated report schema is stale");
