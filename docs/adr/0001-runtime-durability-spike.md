# ADR 0001: local runtime durability compatibility gate

Date: 18 October 2026. Status: experimental investigation; implementation beyond milestone zero is not authorized by this ADR.

## Question

Can pinned eve 0.80.1 retain a pending approval across SIGKILL and resume an interrupted tool in the specification's 30-second case deadline, with real persisted runtime state and a deterministic model substitute?

## Setup and ownership

Node 24, TypeScript, AI SDK scripted model, built eve `start` on loopback, ephemeral Basic operator authentication, separate isolated process groups and temporary application directories. Framework state lives in the same `.eve/.workflow-data` directory across restart. No key, paid model, production service or private product code is used. The scripted model makes decisions only; framework execution, filesystem persistence, HTTP transport and process termination are real.

Eve/its bundled Workflow runtime owns session orchestration, checkpoint/replay and step execution ownership. The application must own approval binding, hard budgets, tool-specific retries, idempotency and sandbox fencing. No application scheduler has been built. The POSIX launcher holds an OS advisory lock; its contender exits 73. This establishes cooperative single-host server ownership only, not distributed fencing or rejection of stale external writes.

The probe writes an attempt-start and completion record; these are test observations, not transactional application effects. No claim about sandbox effect deduplication, host/power failure or production durability follows from this spike.

## Default result and explanation

With default runtime configuration, the pending request survived restart with the same ID and resumed after approval. The interrupted tool did not complete within 30 seconds: one start, zero completions. This is NO_GO against that deadline, not evidence that it can never recover.

Installed source shows inline step ownership defaults to an 860-second lease. Restart re-enqueues the run, but replay can defer the still-owned step until the lease elapses. No 860-second wait was performed; the explanation is source analysis, distinct from measured observations.

`WORKFLOW_INLINE_OWNERSHIP_LEASE_SECONDS` is parsed as an integer in [1,900], default 860. It is absent from bundled public eve guides. Its use is a source-observed, pinned-release experiment, not a documented stable eve API. The harness checks the exact helper hash before using an experimental override and never patches dependencies or runtime state.

Source compatibility evidence:

- `eve/dist/src/compiled/_chunks/workflow/helpers-DlLD3ov_.js`: SHA-256 `747627feb4fc23f0bd998d2f4ca42969b6681380ded6d57fef3dd6fe5ca14903`.
- `eve/dist/src/compiled/@workflow/core/runtime.js`: SHA-256 `4422b829266cd9daf01d5a9b861aa5dbccf3c1a0a3ab8398da85e60e74d5397e`.
- `eve/dist/src/compiled/@workflow/world-local/index.js`: SHA-256 `2b049eae015887730a6b92a0fd00fd1cb099543859ed9f7490a377c1bae1a516`.

## Decision boundary

An experimental shortened lease may demonstrate replay feasibility but cannot establish safe production ownership. A two-second lease is shorter than the specification's ten-second tool timeout; it must never become the application default. A server lock does not exclude overlapping redeliveries within one process. Even a longer tested lease requires bounded full-step duration and the later application idempotency/fencing contract.

Before milestone two, resolve whether dependence on this undocumented setting is acceptable and prove ownership under an alive slow step and duplicate deliveries. Otherwise replace the backend/runtime through a new ADR and repeat this exact crash/approval gate. Do not silently build a second scheduler beside eve.

A concrete independent fallback is a single SQLite-backed state-machine worker with transactional claims/dispatch intents and an AI SDK adapter; eve would then be removed as orchestrator, with no copied private orchestration code. That is a proposed architecture change, not an implemented substitute or an approved amendment. Another option is a documented durable Workflow world, tested against the same gate; do not assume another world removes step-lease behavior without testing.

The repository remains private pending the final publication review and explicit owner decision.

## Measured experimental results

The two-second experiment passed both cases. A separate twenty-second experiment also passed: approval restart took 2,489 ms and the interrupted-tool case took 21,598 ms in that observation. The latter recorded two starts and one completion, with same-turn completion and no outstanding input request. Both checked a competing launcher exits 73. These are individual local observations, not latency percentiles or service-level objectives.

Decision: **milestone-zero investigation complete; HOLD / NO_GO for milestone two**. Replay feasibility is demonstrated under explicitly experimental tuning, but the default fails the required deadline and safe ownership for a slow still-alive step/duplicate delivery is unproven. `CONDITIONAL_GO` in a tuned report means those two cases passed with an internal configuration dependency; it is not approval to proceed past this ADR's HOLD.

Next technical decision: validate a step-duration/lease contract with slow-alive and duplicate-delivery tests and obtain a supported configuration path, or approve the proposed runtime replacement and repeat the gate. Retain default and tuned evidence separately. No full workflow, operator UI, application database or external-effect service has been built at this stage.
