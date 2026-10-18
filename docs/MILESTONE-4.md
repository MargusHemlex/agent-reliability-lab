# Milestone 4: failure evaluation and evidence

The fixture evaluation covers 31 normal scenarios and two negative controls. The controls each run the same probe against an unchanged baseline and a deliberately weakened disposable source copy: four probe executions in total. No live provider or production integration is used.

## Reproduce

Use Node 24 on macOS or Linux with Python 3 and the pinned installation described in the README:

```sh
npm run typecheck
npm run format
npm test
npm run reports:schema
npm run build
npm run evaluate
```

`npm run evaluate` runs the eleven workflow cases, eleven operator/budget cases, nine additional failure cases and two negative controls sequentially. The catalog is `fixtures/evaluation-catalog.json`. `npm run test:adverse` and `npm run test:negative` run the new subsets independently; their preliminary outputs are not final evaluation reports.

The additional scenarios cover approval expiration before intent, changed policy, injected delivery text, an unregistered tool request, concurrent duplicate dispatch, cancellation after accepted intent, stale receiver epoch, conflicting digest and competing worker ownership. The digest-conflict case deliberately seeds one prior effect and verifies that it is preserved without an additional effect. Cancellation after accepted intent preserves truthful success when the external effect already committed.

The injection case uses a scripted model and tests the application approval/action boundary. It does not establish live-model prompt-injection resistance. The stale-epoch case exercises receiver fencing; application-store generation behavior is separately unit tested.

## Negative controls

The idempotency mutant removes key uniqueness and bypasses duplicate lookup in the sandbox. The approval mutant automatically grants the proposed action and bypasses the human pause; proposal binding remains in place. Both operate only on disposable copies, never on the working repository.

Each unchanged baseline must exit 0. Its mutant must exit exactly 1 with the expected invariant violation and an independently measured effect increase. Build failures and infrastructure failures (exit 2) cannot count as successful detection. Mutation evidence contains changed-file hashes and exact replacement counts. A passing control means that the probe detected the deliberately introduced failure.

The child watchdog first requests cleanup, then uses a recorded PID manifest if forced termination is necessary. This is best-effort fixture cleanup: the 100 ms manifest refresh leaves a race under hard kill, and abnormal termination is not a production containment mechanism.

## Reports and validation

Final immutable UUID-named JSON and Markdown files are written under ignored `reports/evaluation/`. `reports/evaluation-latest.json` is only a convenience locator. Existing report paths cannot be overwritten.

```sh
npm run reports:validate -- reports/evaluation/REPORT_ID.json --markdown
npm run reports:validate -- reports/evaluation/REPORT_ID.json --fresh
```

`evaluation/schemas/report.ts` is the canonical strict Zod schema, including cross-field semantic gates. `report.schema.json` is its generated structural companion; a generic JSON Schema validator alone does not perform all semantic checks. `npm run reports:schema` checks that the generated companion is current.

Reports record catalog denominators, execution status, source commit and dirty state, allowed source inventory hashes, lock/configuration/fixture hashes, exact guarded runtime hashes, scenario effects and measured counters. Every normal passing case requires a measured expected effect count. The two primary crash cases require measured recovery within 30 seconds, including restart. Case latency is wall time; setup and cleanup boundaries differ between harnesses.

Model-turn, physical-tool and read-attempt counters come from persisted fixture budgets. Dispatch-attempt counts and unmeasured policy metrics remain null. Actual provider identity, tokens, prices and cost remain null; live evaluation is explicitly not run. A case success means that its expected assertions held, including an expected denial, rather than that every application run succeeded.

Malformed evidence, missing cases, mismatched effects, missed detectors and infrastructure failures fail the report. Before export, freshness checks compare the current commit, complete allowed source inventory, catalog metadata and runtime hashes with the captured snapshot. A failed preflight exports a schema-valid failed report. Sources must remain frozen through export; this is not a cryptographic build attestation. Historical validation omits freshness by default because subsequent documentation commits legitimately change HEAD.

CI uploads only the final validated JSON and Markdown reports. Preliminary harness outputs, local credentials, databases, provider sessions and raw process logs are excluded. Earlier milestone evidence retains its historical format and claims.

## Scope

Local verification passed 56 unit/HTTP tests and 33 evaluation cases. These are finite synthetic observations, not statistical reliability estimates or universal exactly-once guarantees. The supported topology remains one POSIX host, one actual worker and the guarded experimental twenty-second eve lease. The original default lease limitation remains an explicit CI regression check.

The previous native reset-confirmation browser check and mobile verification limitations remain unchanged. Live adapters, production deployment and public release require separate work and review. The repository remains private; original products and deployments are unchanged.
