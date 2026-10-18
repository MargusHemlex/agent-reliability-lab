import { defineTool } from "eve/tools";
import { always } from "eve/tools/approval";
import { z } from "zod";
import { appendFileSync, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

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
    const invocationId = randomUUID();
    const record = (phase: "started" | "completed") =>
      appendFileSync(
        join(dir, "attempts.jsonl"),
        JSON.stringify({
          sessionId: ctx.session.id,
          invocationId,
          pid: process.pid,
          monotonicNs: process.hrtime.bigint().toString(),
          phase,
        }) + "\n",
      );
    record("started");
    if (
      process.env.ARL_SPIKE_BARRIER === "tool_started" &&
      !existsSync(join(dir, "release"))
    ) {
      writeFileSync(join(dir, "barrier"), "tool_started");
      // A live step can be released without a restart. This test barrier
      // deliberately outlives the investigated lease; it is not a business timeout.
      while (!existsSync(join(dir, "release"))) {
        await new Promise<void>((resolve) => setTimeout(resolve, 50));
      }
    }
    record("completed");
    return { marker: "probe-result" };
  },
});
