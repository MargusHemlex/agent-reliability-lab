# First genuine bounded live smoke

**Result: PASS, one synthetic sample. The repository was private during execution; its cleaned portfolio release was subsequently authorized.**

On 2026-10-18 the owner explicitly authorized one genuine model workflow with at most five calls and a USD 0.10 estimated per-run cap. The test used the normal real Gateway adapter, not the offline transport preload. No additional model run was required.

| Observation                             | Measured value                                         |
| --------------------------------------- | ------------------------------------------------------ |
| Source commit                           | `46c072ac457a9566749052b439de68b38744cc01`, clean tree |
| Requested Gateway model                 | `openai/gpt-4o-mini`                                   |
| Gateway route                           | `vercel-ai-gateway`                                    |
| Returned model/version                  | Unknown; not exposed by this installed SDK path        |
| Executed / passed samples               | 1 / 1                                                  |
| Model calls / physical tool calls       | 3 / 3                                                  |
| Read attempts                           | 2                                                      |
| Provider-reported input / output tokens | 1,206 / 150                                            |
| Estimated cost                          | USD 0.000272, rounded upward per call                  |
| Estimated run cap                       | USD 0.10                                               |
| Observed / expected sandbox effects     | 1 / 1                                                  |
| Duplicate effects                       | 0                                                      |
| Measured elapsed time                   | 6,678 ms, including harness lifecycle                  |

The workflow read the synthetic delivery and versioned policy, produced the exact allowed request-update action and paused at the approval boundary. The separately opted-in smoke runner checked the action and verified zero receiver effects before granting the exact proposal digest. This was controlled programmatic approval authorized for the synthetic smoke, not a manual browser approval claim. It then independently queried the sandbox effect count and required a succeeded run with one effect.

The report contains three completed call ledger entries with known usage. Conservative cost reservations totalled USD 0.007658; estimated usage cost was USD 0.000272. This remains a dated base-price estimate, not a reconciled provider invoice or a hard account-wide spending limit. The requested model identifier is not presented as an observed underlying model version.

## Evidence and checks

- [Immutable live JSON](evidence/live-smoke-2026-10-18.json)
- [Matching generated Markdown](evidence/live-smoke-2026-10-18.md)

Before copying the reports, `reports:live-validate --fresh --markdown` passed canonical schema/semantic gates, exact source freshness and matching Markdown. The actual credential was checked in memory against both files and was absent. The local key file is Git-ignored, untracked and owner-readable/writable only; no key or raw provider trace is included in these exports.

Earlier `not_run` records remain unchanged and accurately describe earlier evaluations and offline CI. This successful authenticated application-model call is separate from Kimi/Claude code-review requests. CI still makes no real model calls.

One successful smoke establishes genuine connectivity and one end-to-end happy path under the stated bounds. It does not establish live prompt-injection resistance, live crash/retry reliability, model-version stability, invoice accuracy, scale or production readiness. Existing deterministic failure/recovery tests remain separate evidence. Native browser reset-confirmation and mobile checks remain unverified. Original products, deployments and the private history archive were unchanged.
