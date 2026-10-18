import { createHash } from "node:crypto";
import { ActionSchema } from "./contracts.ts";

export function fixtureDecision(prompt: unknown) {
  const messages = prompt as Array<{ role: string; content: unknown }>;
  let runId: string | undefined;
  const completed = new Set<string>();
  for (const message of messages) {
    if (message.role === "user" && Array.isArray(message.content))
      for (const part of message.content) {
        if (part.type === "text") {
          try {
            const data = JSON.parse(part.text);
            if (
              typeof data.runId === "string" &&
              /^[A-Za-z0-9_-]{1,128}$/.test(data.runId)
            )
              runId = data.runId;
          } catch {}
        }
      }
    if (message.role === "tool" && Array.isArray(message.content))
      for (const part of message.content) {
        if (
          part.type === "tool-result" &&
          part.output?.type !== "error-text" &&
          part.output?.type !== "error-json"
        )
          completed.add(part.toolName);
      }
  }
  if (!runId) throw new Error("Fixture requires an application-created run");
  const forcedTool = process.env.ARL_FAULT_TOOL_NAME;
  if (
    forcedTool !== undefined &&
    (process.env.ARL_TEST_MODE !== "1" || forcedTool !== "forbidden_tool")
  )
    throw new Error("test_tool_fault_denied");
  const toolName =
    forcedTool ??
    (!completed.has("get_delivery")
      ? "get_delivery"
      : !completed.has("get_resolution_policy")
        ? "get_resolution_policy"
        : "record_resolution");
  const input =
    toolName === "record_resolution"
      ? {
          runId,
          action: ActionSchema.parse({
            deliveryId: "delivery-001",
            kind: "request_update",
            note: "Please provide a delivery update.",
          }),
        }
      : { runId };
  return {
    content: [
      {
        type: "tool-call" as const,
        toolCallId: `fixture-${createHash("sha256").update(JSON.stringify(prompt)).digest("hex").slice(0, 16)}-${toolName}`,
        toolName,
        input: JSON.stringify(input),
      },
    ],
    finishReason: { unified: "tool-calls" as const, raw: undefined },
  };
}

export function assertFixtureTools(tools: unknown) {
  if (!Array.isArray(tools))
    throw new Error("Fixture tool surface unavailable");
  const names = tools
    .map((tool) => (tool?.type === "function" ? tool.name : "unsupported"))
    .sort();
  if (
    JSON.stringify(names) !==
    JSON.stringify([
      "get_delivery",
      "get_resolution_policy",
      "record_resolution",
    ])
  )
    throw new Error("Unexpected fixture tool surface");
}

export function fixtureRunId(prompt: unknown): string {
  let runId: string | undefined;
  for (const message of prompt as Array<{ role: string; content: unknown }>) {
    if (message.role !== "user" || !Array.isArray(message.content)) continue;
    for (const part of message.content)
      if (part.type === "text") {
        try {
          const data = JSON.parse(part.text);
          if (
            typeof data.runId === "string" &&
            /^[A-Za-z0-9_-]{1,128}$/.test(data.runId)
          )
            runId = data.runId;
        } catch {
          /* Fixed application messages only. */
        }
      }
  }
  if (!runId) throw new Error("Fixture requires an application-created run");
  return runId;
}
