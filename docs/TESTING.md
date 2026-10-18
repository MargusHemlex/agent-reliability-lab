# Testing and evidence guide

Use the pinned Node 24/POSIX setup in the [quickstart](QUICKSTART.md). Install dependencies before starting the five-minute clock. No provider key is needed for the default gates.

| Command                                                  | What it establishes                                                                                                      |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `npm run typecheck` / `npm run format`                   | Type and executable/config formatting checks                                                                             |
| `npm test`                                               | Unit and loopback HTTP contracts, including mocked adapter/reporting boundaries                                          |
| `npm run docs:check`                                     | Local documentation targets, required deliverables and exposed command names exist                                       |
| `npm run reports:schema` / `npm run reports:live-schema` | Generated structural companions match canonical schemas                                                                  |
| `npm run build`                                          | Offline eve application build; not a provider connection test                                                            |
| `npm run walkthrough`                                    | Two isolated guided cases: rejected approval/zero effects and real after-commit crash/restart/same-key one effect        |
| `npm run test:live-workflow`                             | Compiled live-adapter path with blocked external networking and simulated Gateway responses; zero genuine provider calls |
| `npm run evaluate`                                       | 31 normal fixture scenarios and two deliberate negative controls, strict immutable JSON/Markdown exports                 |
| `npm run evaluate:live`                                  | Separately gated genuine smoke; without opt-in exports `not_run`, never fixture fallback                                 |

CI explicitly disables live opt-in when recording the not-run report. Do not provide model credentials to CI.

## Runtime compatibility gates

```sh
npm run spike
npm run spike -- --lease-seconds=20
npm run spike:overlap -- --lease-seconds=20
npm run spike:ownership
```

The first command intentionally exits 1/NO_GO: the default 860-second lease misses the 30-second recovery target. CI separately asserts that exact known limitation; it is not ignored. The selected twenty-second configuration, authentic callback overlap and actual-worker ownership checks must pass. Run all four after runtime/dependency/topology changes. Windows is unsupported.

## Reading evidence

Full fixture reports are under ignored `reports/evaluation/`; live reports under `reports/live/`; focused teaching observations under `reports/walkthrough/`. The focused runner validates its own strict two-case observation schema before export; that format is not the canonical 33-case evaluation schema. It records source hashes and actual observations, and cannot replace the complete suite.

```sh
npm run reports:validate -- reports/evaluation/REPORT_ID.json
npm run reports:live-validate -- reports/live/REPORT_ID.json --markdown
```

The canonical Zod schemas include semantic gates that generic structural JSON Schema alone cannot enforce. `--fresh` additionally requires the report's exact current source inventory and commit (the fixture validator also rechecks guarded runtime hashes); use it before changing HEAD. Historical committed reports deliberately validate without `--fresh`. A later documentation commit does not retrospectively change the recorded executable commit. Generated reports contain nulls for unknown measurements; fixture requested tokens are not provider usage.

The aggregate entry point `test/evaluate.mjs` runs `test/negative-controls.mjs` for the two negative controls. The `test:negative` and `test:adverse` scripts are standalone subsets, not additional cases beyond the 33.

The two negative controls apply exact mutations to disposable copies and run the same probe against baseline and mutant. A clean baseline must exit 0; the mutant must exit exactly 1 with the expected violation and measured effect increase. Build/process failures do not count as detection. Unknown effects or unrun cases cannot pass.

Primary crash recovery is measured including restart and must stay within 30 seconds. Latency boundaries vary between harnesses. Each case is a finite sample, not a production reliability estimate. Read [evidence history](evidence/README.md), [milestone 5 review](MILESTONE-5-REVIEW.md) and [publication review](PUBLICATION-REVIEW.md) for scope and remaining holds.

The guided walkthrough recovery clock starts after the worker is killed and the committed-service barrier is released, immediately before restart. It measures restart and receipt reconciliation, not the entire commit-to-recovery interval. Current runtime-gate step results are retained in CI logs; their raw `spike-results` files are not uploaded by the current artifact allowlist. Historical sanitized runtime observations remain committed separately.
