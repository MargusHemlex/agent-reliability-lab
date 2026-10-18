import { defineAgent } from "eve";
import { model } from "./lib/scripted-model";
export default defineAgent({
  model,
  modelContextWindowTokens: 32000,
  limits: { sessionTimeoutMs: 3600000 },
});
