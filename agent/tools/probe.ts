import { defineTool } from "eve/tools";
import { always } from "eve/tools/approval";
import { z } from "zod";
import { appendFileSync, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export default defineTool({
  description: "Record one synthetic probe attempt. No external side effect.",
  inputSchema: z.object({}).strict(),
  approval: always(),
  endsTurn: true,
  async execute(_input, ctx) {
    if (process.env.ARL_SPIKE_TEST !== "1")
      throw new Error("Spike requires explicit test mode");
    const dir = process.env.ARL_SPIKE_DIR;
    if (!dir) throw new Error("Missing isolated spike directory");
    appendFileSync(
      join(dir, "attempts.jsonl"),
      JSON.stringify({ sessionId: ctx.session.id, phase: "started" }) + "\n",
    );
    if (
      process.env.ARL_SPIKE_BARRIER === "tool_started" &&
      !existsSync(join(dir, "release"))
    ) {
      writeFileSync(join(dir, "barrier"), "tool_started");
      await new Promise<void>(() => {});
    }
    appendFileSync(
      join(dir, "attempts.jsonl"),
      JSON.stringify({ sessionId: ctx.session.id, phase: "completed" }) + "\n",
    );
    return { marker: "probe-result" };
  },
});
