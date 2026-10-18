import { assertRuntimeCompatibility } from "../spike/runtime-compatibility.mjs";
import { AppStore } from "../agent/lib/lab/store.ts";
import { config } from "../agent/lib/lab/runtime.ts";
await assertRuntimeCompatibility(process.cwd());
if (
  !["fixture", "live"].includes(process.env.ARL_LAB_MODE) ||
  process.env.WORKFLOW_INLINE_OWNERSHIP_LEASE_SECONDS !== "20"
)
  throw new Error("Guarded lab runtime configuration required");
if (
  process.env.ARL_TEST_MODE !== "1" &&
  Object.keys(process.env).some((key) =>
    /^(ARL_.*(?:CLOCK|FAULT|BARRIER)|ARL_TEST_)/.test(key),
  )
)
  throw new Error("Test configuration denied");
process.env.ARL_WORKER_EPOCH = "1"; // Validate remaining configuration before contacting service.
const cfg = config();
const response = await fetch(`${cfg.serviceURL}/epoch`, {
  method: "POST",
  headers: {
    authorization: `Bearer ${cfg.serviceSecret}`,
    "content-type": "application/json",
  },
  body: "{}",
  signal: AbortSignal.timeout(10000),
  redirect: "error",
});
if (!response.ok) throw new Error("Sandbox epoch activation failed");
const { epoch } = await response.json();
if (!Number.isSafeInteger(epoch) || epoch < 1)
  throw new Error("Invalid fencing epoch");
process.env.ARL_WORKER_EPOCH = String(epoch);
const db = new AppStore(cfg.dbPath);
db.activateEpoch(epoch);
db.close();
await import("../.output/server/index.mjs");
