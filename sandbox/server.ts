import { createSandbox } from "./service.ts";
const testMode = process.env.ARL_TEST_MODE === "1";
if (
  !testMode &&
  Object.keys(process.env).some((key) =>
    /^(ARL_.*(?:CLOCK|FAULT|BARRIER)|ARL_TEST_)/.test(key),
  )
)
  throw new Error("Test configuration requires explicit test mode");
if (!process.env.ARL_SANDBOX_DB || !process.env.ARL_SERVICE_SECRET)
  throw new Error("Sandbox database and service secret are required");
const port = Number(process.env.ARL_SANDBOX_PORT ?? 4319);
if (!Number.isInteger(port) || port < 0 || port > 65535)
  throw new Error("Invalid sandbox port");
const sandbox = createSandbox({
  dbPath: process.env.ARL_SANDBOX_DB,
  secret: process.env.ARL_SERVICE_SECRET,
  testMode,
  ...(process.env.ARL_FAULT_READ_FAILURES !== undefined
    ? { testReadFailures: Number(process.env.ARL_FAULT_READ_FAILURES) }
    : {}),
  ...(process.env.ARL_FAULT_READ_DELAY_MS !== undefined
    ? { testReadDelayMs: Number(process.env.ARL_FAULT_READ_DELAY_MS) }
    : {}),
  ...(process.env.ARL_FAULT_READ_DELAY_COUNT !== undefined
    ? { testReadDelayCount: Number(process.env.ARL_FAULT_READ_DELAY_COUNT) }
    : {}),
  clockFile: process.env.ARL_CLOCK_FILE,
  testBarrierDir: process.env.ARL_SERVICE_BARRIER_DIR,
});
await sandbox.listen(port);
console.log(
  JSON.stringify({ event: "sandbox_listening", address: sandbox.address() }),
);
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.on(signal, () => {
    void sandbox.close().then(() => process.exit(0));
  });
