import { defineAgent } from "eve";
import { model as fixtureModel } from "./lib/scripted-model";
import { liveModel } from "./lib/live-model";
if (
  process.env.ARL_LAB_MODE &&
  !["fixture", "live"].includes(process.env.ARL_LAB_MODE)
)
  throw new Error("invalid_lab_mode");
const model = process.env.ARL_LAB_MODE === "live" ? liveModel : fixtureModel;
export default defineAgent({
  model,
  defaultTools: false,
  tool: false,
  modelContextWindowTokens: 32000,
  limits: { sessionTimeoutMs: 3600000 },
});
