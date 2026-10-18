import { spawn } from "node:child_process";

// Keep credential/configuration isolation; this flag only selects the runtime mode.
export function runtimeEnvironment(parent = process.env) {
  return parent.ELECTRON_RUN_AS_NODE === "1"
    ? { ELECTRON_RUN_AS_NODE: "1" }
    : {};
}

export class FixtureProcessError extends Error {
  constructor(phase, child, code) {
    super(
      `${phase}: child could not continue; check Node 24 and /usr/bin/python3`,
    );
    this.name = "FixtureProcessError";
    this.diagnostic = {
      phase,
      exitCode: child.exitCode,
      signal: child.signalCode,
      code: ["ENOENT", "EACCES", "ENOEXEC"].includes(code) ? code : null,
    };
  }
}

export function launch(command, args, cwd, env, phase) {
  const child = spawn(command, args, {
    cwd,
    env,
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let spawnError;
  // Drain output without retaining or exposing arbitrary child content. It may
  // contain live credentials, headers, payloads or provider responses.
  child.stdout.resume();
  child.stderr.resume();
  child.on("error", (error) => {
    spawnError = error;
  });
  return {
    child,
    assertRunning() {
      if (spawnError || child.exitCode !== null || child.signalCode !== null)
        throw new FixtureProcessError(phase, child, spawnError?.code);
    },
  };
}

// Only controlled metadata is emitted; arbitrary error messages, causes, stacks
// and logs never cross this boundary, even for unknown/unregistered secrets.
export function diagnostic(error, phase) {
  return JSON.stringify({
    event: "fixture_failure",
    phase,
    error:
      error instanceof FixtureProcessError
        ? "child_process_failed"
        : error?.code === "ERR_ASSERTION"
          ? "assertion_failed"
          : "operation_failed",
    ...(error instanceof FixtureProcessError ? error.diagnostic : {}),
    hint: "Use standalone Node 24 and /usr/bin/python3; verify the build and runtime guards. Raw errors and child logs are withheld to protect credentials.",
  });
}

export async function withCleanup(action, cleanup, report) {
  let primary;
  try {
    return await action();
  } catch (error) {
    primary = error;
    throw error;
  } finally {
    try {
      await cleanup();
    } catch (error) {
      report(error, "cleanup");
      if (!primary) throw error;
    }
  }
}
