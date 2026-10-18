# ADR 0002: continue with a pinned, single-worker eve runtime

Date: 18 October 2026. Status: accepted. All four reviewers approve the constrained next milestone; exact-code Linux CI passed.

## Decision scope

The decision is GO for the next implementation milestone of the local, synthetic, single-host Agent Reliability Lab using eve 0.80.1 with an explicit twenty-second ownership lease. It is not production approval, public-release approval, multi-worker support or a claim that the full specification is implemented. ADR 0001's default-configuration failure remains true; this decision supersedes its HOLD only for this constrained configuration. The required exact-code gates passed.

## What was tested

A scripted model chooses the probe, but the built eve/Nitro worker, persistent workflow state, HTTP callbacks, human-input protocol and process failures are real. The live barrier deliberately exceeds the planned business-tool timeout to stress ownership. Each invocation records its unique ID, actual PID and monotonic start/end times. A 45-second adversarial-case watchdog permits a 22-second slow barrier; it does not raise the original 30-second crash-recovery gate.

1. A live step remains blocked for over 22 seconds. Repeated approval API requests before and after twenty seconds do not create a second probe invocation. They can queue an extra turn; this is not API-level business-request deduplication.
2. A loopback proxy captures the genuine workflow callback. The run ID and message ID are matched against the held step's persisted ownerMessageId, read without mutation. Exact callback bytes are redelivered with the same message ID before and after twenty seconds; a separate fresh-message workflow wake is injected too. All injected responses must be HTTP 200. The original invocation stays alive and blocked until release. One invocation, one completion, maximum concurrency one, no pending approval and no callback-created extra turn are asserted.
3. A competing launcher fails with exit 73 while the worker is active.
4. A launcher-only-death experiment found a defect in our earlier wrapper: the lock belonged to eve's supervising CLI, so killing that supervisor left its child alive and allowed a second worker. Two overlapping invocations and two completions were observed. This is our launcher defect, not evidence of an eve defect.
5. The corrected POSIX wrapper execs the actual generated Nitro worker (the same server entry eve start launches). That process retains the advisory-lock descriptor. The regression requires the logged actual worker PID to equal the launched PID; after killing it, it must be dead before a replacement starts. Exactly one replacement invocation completes; the terminated original does not. It does not create an unlocked worker child.
6. The original approval-wait and interrupted-tool crash tests are rerun using the corrected launcher and the original recovery watchdog.

Default-lease overlap controls hold only 22 seconds; they do not cross the default 860-second lease. The earlier default crash test still fails the 30-second recovery target. Do not generalize the short control to default behavior after 860 seconds.

## Why the configuration is coherent

Installed runtime source and internal declaration comments describe a process-local single-flight map keyed by run and step. Both inline and background paths use it; a duplicate waits on the active execution instead of invoking the tool again. Final overlap observations must corroborate this with accepted genuine callbacks, independent invocation records and the single-flight diagnostic. This protection is process-local, not distributed fencing.

The OS lock enforces one actual worker using the same local state path; in-process single-flight handles repeated callbacks inside that worker. After a real process death, a bounded twenty-second lease allows the new worker to resume. No second application scheduler is introduced.

The twenty-second setting is source-observed and not documented as a stable public eve configuration API. That remains an explicit supportability cost. The experiment checks exact eve version and hashes of its lease helper, runtime and local world before running. npm's exact dependencies and lockfile are committed. Changed bytes require a compatibility review; regression CI must rerun on dependency changes. A pinned preview dependency is accepted for this small laboratory because its relevant behavior has executable evidence. Replacing it with a fresh custom orchestrator would introduce different untested ownership/replay behavior and is not justified by the bounded passing results alone.

## Non-negotiable implementation boundaries

- Node 24, one POSIX host, one actual worker, one persistent local workflow directory and the corrected fail-closed launcher. No horizontal scaling or mixed-version workers.
- Explicit twenty-second lease; no silent fallback to defaults. The next application startup path must enforce the same compatibility guards before starting its worker.
- The application owns proposal/approval binding, single consumption, run limits and sandbox fencing/idempotency. Built-in approval and repeated HTTP responses are not substitutes for the specification's transactional authorization boundary.
- Receiver-side idempotency, context/version checks and read-only receipt reconciliation are required before implementing a synthetic effect. A caller timeout does not establish that the receiver stopped or committed nothing. Process single-flight does not protect an external effect after a crash.
- The next milestone implements the specified three-tool fixture workflow and independently persisted sandbox. It must retain these regression cases. Live models, real customer data, real integrations and deployment remain out of scope until separately implemented and checked.
- If exact-code Linux CI or owner-bound callback/restart tests fail, retain HOLD; do not raise deadlines or weaken assertions to obtain GO. If required topology expands, reopen this ADR and compare a supported durable backend or replacement runtime against the same tests.

## Acceptance and evidence

Final source-bound overlap, lock-death and recovery reports plus the exact-code CI run and four-agent verdicts are recorded in docs/OVERLAP-REVIEW.md. Historical before-fix evidence remains labelled by its own source hashes. Source/build hashes identify local observations; they are not third-party attestations or power-loss durability tests.

Repository visibility remains PRIVATE. This architectural decision changes neither original products nor deployments and does not authorize publication.

## Ratification

All four current reviewers (Codex runtime/architecture, Codex quality, Claude Code and Kimi K3) support constrained GO. Their remaining condition was fulfilled by [Linux CI run 39113383786](https://github.com/MargusHemlex/agent-reliability-lab/actions/runs/39113383786) for executable-source commit 19ed1d16c5c6492a49b9a6850fd083c5d0b42dd3. Downloaded reports verify both overlap cases PASS with maximum concurrency one; all three injected callbacks return 200 and single-flight handling is observed. Actual-worker ownership/replacement PASS. Tuned interrupted recovery PASS in 21,744 ms; default interrupted recovery still fails the watchdog.

Proceed to implement the next fixture-workflow milestone using these boundaries. Replacing eve is not justified by this record. This acceptance neither approves publication nor claims production guarantees. Subsequent changes in this ratification commit are documentation/evidence only.
