# Threat model and trust boundaries

## Scope and assets

This model covers the synthetic local workflow, operator surface, model adapter, worker launcher, application database and independent sandbox. Assets are operator/provider credentials, immutable proposal/approval bindings, dispatch identity, truthful run state, persistent budget accounting and the receiver's effect/receipt record. It assumes one trusted POSIX machine and an owner controlling its filesystem and process environment. Host compromise, a malicious local administrator, distributed operation and real external integrations are outside scope.

## Boundaries

| Boundary                      | Untrusted input                                           | Enforcement and evidence                                                                                                                                                                                                                                        |
| ----------------------------- | --------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Browser to operator           | Requests, cookies, body and origin                        | Loopback Host/origin checks, session expiry, CSRF-safe mutations, strict/size-bounded bodies; operator HTTP tests and historical browser evidence                                                                                                               |
| Operator to run               | Proposed decision, stale/replayed digest                  | Exact proposal/context binding, expiry, single-use intent transaction, cancellation ordering; store and process cases                                                                                                                                           |
| Model/retrieved text to tools | Tool name, arguments and descriptions                     | Exactly three registered typed tools, strict action/run binding, no shell/arbitrary URL/filesystem tool; injection/disallowed-tool fixtures and mocked live tests                                                                                               |
| Worker to application state   | Stale generation or replay                                | Actual-worker OS lock, ownership epoch and transactional state revisions; ownership/fencing/restart tests                                                                                                                                                       |
| Application to receiver       | Duplicate, delayed or conflicting dispatch                | Independent authorization/expiry/context/epoch checks and atomic key/digest/effect/receipt transaction; concurrent dispatch and crash cases                                                                                                                     |
| Adapter to Gateway            | Slow/failing response, malformed output, unknown usage    | Explicit opt-in, one application dispatch per reservation, deadlines and size bounds, strict output validation, persistent estimated cost reservations; offline SDK tests only                                                                                  |
| Evidence to reader            | Missing measurements, stale sources or misleading success | Canonical strict schemas/semantic gates, source inventories, denominators, null unknowns, fail-closed exports and separated fixture/live results                                                                                                                |
| Repository to public          | History, artifacts, dependency code or screenshots        | Ignore rules, sanitized exports, license review and full reachable-history checks; historical identifier was subsequently removed from the active repository with the original history retained privately; separate owner publication approval remains required |

## Relevant abuse and failure cases

A model cannot grant its own approval or expand its tool surface. Retrieved text cannot change the trusted action schema. Changed context invalidates the action; a sandbox digest conflict is permanent. Replayed approval cannot create a second intent. Cancellation before intent blocks dispatch; cancellation after accepted intent cannot promise rollback. Reconciliation may discover a committed receipt even after authorization expires, while an absent receipt never authorizes a new write.

A second worker must fail the OS lock. An old request cannot create a new effect after a newer receiver epoch activates. An effect committed earlier remains legitimate and discoverable. The twenty-second framework lease is experimental, exact-version/hash guarded and single-host; it is not a distributed fencing guarantee.

## Residual risks and validation limits

A compromised host can read local secrets, mutate SQLite or alter this code. HTTP is loopback-only and has no enterprise authentication. SQLite durability and the UTC clock retain local-machine assumptions. Process cleanup is best effort; source freshness requires frozen files and is not a signed build attestation. Dependency advisory checks have limited coverage.

Scripted prompt-injection cases prove application boundaries for chosen inputs, not live-model resistance. The real-provider adapter has not been exercised against a genuine provider. Returned model/version, usage and cost remain unknown when not supplied. Estimated per-run caps are not account-wide billing limits; post-timeout provider billing and service-internal retries may differ. Unknown usage halts that run without an automatic unlock.

Finite synthetic observations are not reliability statistics. Native browser reset-confirmation completion and mobile verification remain unverified. No production readiness, horizontal availability or universal exactly-once claim follows from these tests.
