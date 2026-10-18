import { defineAgent } from "eve";
import { model } from "./lib/scripted-model";
export default defineAgent({
  model,
  defaultTools: false,
  tool: false,
  modelContextWindowTokens: 32000,
  limits: { sessionTimeoutMs: 3600000 },
});
