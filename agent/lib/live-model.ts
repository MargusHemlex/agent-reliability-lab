import { createHash } from "node:crypto";
import { createGateway } from "ai";
import { z } from "zod";
import { ActionSchema } from "./lab/contracts.ts";
import { assertFixtureTools, fixtureRunId } from "./lab/fixture-model.ts";
import { config, now, store } from "./lab/runtime.ts";

type Model = ReturnType<ReturnType<typeof createGateway>["languageModel"]>;
type Options = Parameters<Model["doGenerate"]>[0];
type Result = Awaited<ReturnType<Model["doGenerate"]>>;

export function safeProviderIdentifier(value: unknown): string | null {
  return typeof value === "string" && /^[A-Za-z0-9_./:-]{1,160}$/.test(value)
    ? value
    : null;
}
export function normalizeUsage(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : null;
}
export const LIVE_PRICE = Object.freeze({
  modelId: "openai/gpt-4o-mini",
  inputMicrousdPerMillionTokens: 150000,
  outputMicrousdPerMillionTokens: 600000,
  priceTableDate: "2026-10-18",
});
export function estimatedUsageCost(
  inputTokens: number | null,
  outputTokens: number | null,
): number | null {
  return inputTokens === null || outputTokens === null
    ? null
    : Math.ceil(
        (inputTokens * LIVE_PRICE.inputMicrousdPerMillionTokens +
          outputTokens * LIVE_PRICE.outputMicrousdPerMillionTokens) /
          1000000,
      );
}
export function liveConfiguration(env: NodeJS.ProcessEnv = process.env) {
  if (env.ARL_LAB_MODE !== "live" || env.ARL_LIVE_OPT_IN !== "1")
    throw new Error("live_opt_in_required");
  const modelId = env.AGENT_MODEL;
  if (!modelId || !/^[a-z0-9-]+\/[A-Za-z0-9_.:-]{1,128}$/.test(modelId))
    throw new Error("live_model_required");
  if (modelId !== LIVE_PRICE.modelId) throw new Error("live_unpriced_model");
  const cap = env.ARL_LIVE_MAX_COST_USD ?? "0.10";
  if (
    !/^(?:0(?:\.[0-9]{1,6})?)$/.test(cap) ||
    Number(cap) <= 0 ||
    Number(cap) > 0.1
  )
    throw new Error("live_invalid_cost_cap");
  const maxCostMicrousd = Math.floor(Number(cap) * 1000000);
  const apiKey = env.AI_GATEWAY_API_KEY;
  if (!apiKey || apiKey.trim() !== apiKey || apiKey.length < 16)
    throw new Error("live_gateway_key_required");
  if (Object.keys(env).some((key) => key.startsWith("ARL_FAULT_")))
    throw new Error("live_fault_hooks_denied");
  return {
    modelId,
    apiKey,
    maxCostMicrousd,
    priceTableDate: LIVE_PRICE.priceTableDate,
  };
}

const ToolInput = z.object({ runId: z.string() }).strict();
const ResolutionInput = ToolInput.extend({ action: ActionSchema }).strict();
function safeContent(content: Result["content"], runId: string) {
  if (
    !Array.isArray(content) ||
    Buffer.byteLength(JSON.stringify(content)) > 16384
  )
    throw new Error("live_invalid_response");
  return content.map((part) => {
    if (part.type === "text") {
      if (typeof part.text !== "string") throw new Error("live_invalid_text");
      return { type: "text" as const, text: part.text };
    }
    if (part.type !== "tool-call" || part.providerExecuted)
      throw new Error("live_unsupported_content");
    if (!safeProviderIdentifier(part.toolCallId))
      throw new Error("live_invalid_tool_identity");
    if (
      !["get_delivery", "get_resolution_policy", "record_resolution"].includes(
        part.toolName,
      )
    )
      throw new Error("live_disallowed_tool");
    const input = (
      part.toolName === "record_resolution" ? ResolutionInput : ToolInput
    ).parse(JSON.parse(part.input));
    if (input.runId !== runId) throw new Error("live_run_binding_denied");
    return {
      type: "tool-call" as const,
      toolCallId: part.toolCallId,
      toolName: part.toolName,
      input: JSON.stringify(input),
    };
  });
}

export function createLiveModel(deps: {
  model: Model;
  modelId: string;
  maxCostMicrousd?: number;
  store: typeof store;
  config: () => { epoch: number };
  now: typeof now;
}): Model {
  const generate = async (options: Options): Promise<Result> => {
    if (options.abortSignal?.aborted) throw new Error("live_timeout_or_abort");
    assertFixtureTools(options.tools);
    const runId = fixtureRunId(options.prompt);
    if (
      Buffer.byteLength(
        JSON.stringify({ prompt: options.prompt, tools: options.tools }),
      ) > 16384
    )
      throw new Error("live_input_limit");
    const epoch = deps.config().epoch;
    const id = createHash("sha256")
      .update(JSON.stringify(options.prompt))
      .digest("hex");
    if (deps.modelId !== LIVE_PRICE.modelId)
      throw new Error("live_unpriced_model");
    const inputBytes = Buffer.byteLength(
      JSON.stringify({ prompt: options.prompt, tools: options.tools }),
    );
    const reservedCostMicrousd = estimatedUsageCost(inputBytes + 8192, 1600)!;
    const reservation = deps.store().reserveModel(runId, {
      id,
      requestedTokens: 1600,
      now: deps.now(),
      epoch,
      singleDispatch: true,
      reservedCostMicrousd,
      live: {
        requestedModelId: deps.modelId,
        maxCostMicrousd: deps.maxCostMicrousd ?? 100000,
        priceTableDate: LIVE_PRICE.priceTableDate,
      },
    });
    // A returned reservation is persisted before the network call. A live replay
    // must be denied by the store, including an unresolved previous dispatch.
    const timeout = Math.min(30000, reservation.deadline - deps.now());
    if (timeout <= 0) {
      deps.store().finishModel(runId, {
        id,
        now: deps.now(),
        epoch,
        outcome: "live_not_dispatched_deadline",
        inputTokens: 0,
        outputTokens: 0,
        estimatedCostMicrousd: 0,
        provider: null,
        returnedModelId: null,
        providerVersion: null,
      });
      throw new Error("live_deadline_exhausted");
    }
    const signal = AbortSignal.any([
      AbortSignal.timeout(timeout),
      ...(options.abortSignal ? [options.abortSignal] : []),
    ]);
    let response: Result | undefined;
    try {
      // Invoke the provider primitive once: no AI SDK retry helper or fallback.
      response = await Promise.race([
        Promise.resolve(
          deps.model.doGenerate({
            ...options,
            maxOutputTokens: 1600,
            abortSignal: signal,
            providerOptions: {},
            headers: undefined,
          }),
        ),
        new Promise<never>((_, reject) => {
          if (signal.aborted) reject(new Error("aborted"));
          else
            signal.addEventListener(
              "abort",
              () => reject(new Error("aborted")),
              { once: true },
            );
        }),
      ]);
      if (signal.aborted) throw new Error("aborted");
      const inputTokens = normalizeUsage(response.usage?.inputTokens?.total);
      const outputTokens = normalizeUsage(response.usage?.outputTokens?.total);
      if (outputTokens !== null && outputTokens > 1600)
        throw new Error("live_output_limit");
      if (!["stop", "tool-calls"].includes(response.finishReason?.unified))
        throw new Error("live_incomplete_response");
      const content = safeContent(response.content, runId);
      if (content.length === 0) throw new Error("live_empty_response");
      deps.store().finishModel(runId, {
        id,
        now: deps.now(),
        epoch,
        inputTokens: normalizeUsage(response.usage?.inputTokens?.total),
        outputTokens: normalizeUsage(response.usage?.outputTokens?.total),
        outcome: "completed",
        provider: "vercel-ai-gateway",
        returnedModelId: safeProviderIdentifier(response.response?.modelId),
        providerVersion: null,
        estimatedCostMicrousd: estimatedUsageCost(inputTokens, outputTokens),
      });
      // Do not pass raw provider bodies, headers, warnings or metadata into eve.
      return {
        content,
        finishReason: {
          unified: response.finishReason.unified,
          raw: undefined,
        },
        usage: {
          inputTokens: {
            total: inputTokens ?? undefined,
            noCache: undefined,
            cacheRead: undefined,
            cacheWrite: undefined,
          },
          outputTokens: {
            total: outputTokens ?? undefined,
            text: undefined,
            reasoning: undefined,
          },
        },
        warnings: [],
        response: {
          modelId:
            safeProviderIdentifier(response.response?.modelId) ?? undefined,
          id: safeProviderIdentifier(response.response?.id) ?? undefined,
        },
      };
    } catch {
      deps.store().finishModel(runId, {
        id,
        now: deps.now(),
        epoch,
        inputTokens: normalizeUsage(response?.usage?.inputTokens?.total),
        outputTokens: normalizeUsage(response?.usage?.outputTokens?.total),
        outcome: signal.aborted ? "live_timeout_or_abort" : "live_failed",
        provider: "vercel-ai-gateway",
        returnedModelId: safeProviderIdentifier(response?.response?.modelId),
        providerVersion: null,
        estimatedCostMicrousd: estimatedUsageCost(
          normalizeUsage(response?.usage?.inputTokens?.total),
          normalizeUsage(response?.usage?.outputTokens?.total),
        ),
      });
      throw new Error(signal.aborted ? "live_timeout_or_abort" : "live_failed");
    }
  };
  return {
    specificationVersion: "v4",
    provider: "arl-live-gateway",
    modelId: deps.modelId,
    supportedUrls: {},
    doGenerate: generate,
    doStream: async (options) => {
      const result = await generate(options);
      return {
        stream: new ReadableStream({
          start(controller) {
            controller.enqueue({ type: "stream-start", warnings: [] });
            result.content.forEach((part, index) => {
              if (part.type === "tool-call") controller.enqueue(part);
              else if (part.type === "text") {
                const id = `live-text-${index}`;
                controller.enqueue({ type: "text-start", id });
                controller.enqueue({
                  type: "text-delta",
                  id,
                  delta: part.text,
                });
                controller.enqueue({ type: "text-end", id });
              }
            });
            controller.enqueue({
              type: "finish",
              finishReason: result.finishReason,
              usage: result.usage,
            });
            controller.close();
          },
        }),
      };
    },
  };
}

function configuredModel() {
  const cfg = liveConfiguration();
  return createLiveModel({
    model: createGateway({ apiKey: cfg.apiKey }).languageModel(cfg.modelId),
    modelId: cfg.modelId,
    maxCostMicrousd: cfg.maxCostMicrousd,
    store,
    config,
    now,
  });
}
// Lazy configuration keeps compilation offline; dispatch is always fail-closed.
export const liveModel: Model = {
  specificationVersion: "v4",
  provider: "arl-live-gateway",
  modelId: "explicit-live-selection",
  supportedUrls: {},
  doGenerate: (options) => configuredModel().doGenerate(options),
  doStream: (options) => configuredModel().doStream(options),
};
