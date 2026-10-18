# History rewrite and evidence provenance

The active history has been cleaned. Original source IDs in immutable reports refer to the privately archived original history; use the [commit map](history-rewrite-commit-map.json) and [cleanup explanation](../HISTORY-CLEANUP.md). Historical CI links require archive access. No old report has been relabelled as a new execution.

# Evidence index

Current implementation evidence is recorded in [milestone 4](../MILESTONE-4-REVIEW.md) and [milestone 5](../MILESTONE-5-REVIEW.md). Canonical fixture/live report schemas are now implemented. Those CI runs did not execute a genuine provider. A later [bounded genuine smoke](../LIVE-SMOKE-REVIEW.md) now has separate live evidence. Historical records below retain their original scope; statements about deferred work describe that earlier stage. The current CI uploads canonical evaluation/live reports and focused walkthrough observations, not all raw spike outputs.

## Historical milestone-zero observations

These are sanitized local observations, not fixtures pretending to be executions and not a certificate for later source changes.

- `default-observation.json`: an earlier harness run, no source/config hash block; no retrospective hash attribution is asserted. Default ownership configuration, approval persistence passed, interrupted execution timed out.
- `lease-2-observation.json`: experimental two-second override with its recorded historical harness/source hashes; diagnostic only, unsuitable for planned ten-second tools.
- `lease-20-observation.json`: experimental twenty-second override; its recorded source hashes matched the files at the final local review. Two cases passed, with interrupted-tool starts=2/completions=1.

The inner 30-second watchdog starts after initial server startup; reported durationMs includes startup and cleanup. The twenty-second observation finished in 21,598 ms total locally. This investigative watchdog is not yet a complete implementation of every future application deadline.

A report's sourceSnapshot captures checked-out source/lock bytes, not a cryptographic attestation that a particular build consumed them. The probe's build/run were performed locally in this investigation. At that historical milestone, build provenance and generated report schemas were later deliverables and remained unimplemented; do not infer full release readiness from this evidence.

The historical CI reran default and experimental cases and uploaded fresh observations separately. Its success would mean the expected limitation was reproduced and the explicit experiment passed; the architecture HOLD still applies. CI results on another host are not claimed until observed.

`lease-20-final-observation.json` repeats the twenty-second experiment after final formatting and a fresh build. Its source hashes identify the final executable spike sources; the earlier twenty-second report is retained as a separate historical observation.

`ci-default-observation.json` and `ci-lease-20-observation.json` are separate Linux x64 observations from CI run 39085904262, executable-source commit a5714c76eeea22b37b877566ddaa4faaf4b791df. Both contain checked-out source hashes. Default interrupted recovery misses the watchdog; experimental twenty-second recovery passes. This closes provenance for the newer default observation without altering the older local record.

The later overlap/ownership investigation is documented in ../OVERLAP-REVIEW.md and ../adr/0002-single-worker-runtime-decision.md. Its source-bound local and Linux observations are separate from the initial milestone-zero reports. ownership-launcher-baseline.json records the historical defect in our pre-fix supervisor-held lock; it does not describe the final launcher or an eve defect. The overlap-ci-*.json files are exact-code Linux observations from run 39113383786. A constrained GO now supersedes the earlier HOLD only for the guarded twenty-second single-worker configuration.

## Milestone 2 workflow observations

`milestone-2-local.json` and `milestone-2-ci.json` are separate eleven-case fixture observations of executable-source commit `bf1cfb27bb83142b5ecb86317e2b100846170cca` on macOS and Linux. Their twenty source/lock hashes match the reviewed candidate. The Linux report is from [CI run 39115927464](https://github.com/MargusHemlex/agent-reliability-lab-private-history-backup-20261018/actions/runs/39115927464). Each scenario is one sample; real HTTP, independent SQLite effects and worker crashes are exercised, while model decisions are scripted. At that stage, final schema-validated evaluation exports remained a later milestone. See [the scoped four-agent review](../MILESTONE-2-REVIEW.md).

## Milestone 3 operator and budget observations

`milestone-3-workflow-local.json`, `milestone-3-budgets-local.json` and corresponding `*-ci.json` files record separate eleven-case suites for source commit `e77beeb0a9bc0632a260fbacc229765d9f4e41ab`. The Linux files come from [CI run 39117575165](https://github.com/MargusHemlex/agent-reliability-lab-private-history-backup-20261018/actions/runs/39117575165); all 26 recorded executable/config hashes match the reviewed candidate. `milestone-3-retry-repeats.json` retains three focused bounded-read repetitions. `milestone-3-browser.json` and `milestone-3-operator-desktop.jpg` record the real Chrome core flow and explicitly retain the uncompleted native reset confirmation and untested mobile viewport. See [milestone 3 review](../MILESTONE-3-REVIEW.md).

## Documentation-stage observations

`milestone-6-linux-fixture.*`, `milestone-6-linux-live-not-run.*` and `milestone-6-linux-walkthrough.*` identify executable-source commit `16b047018a7b2dba286a38146104721c11113af9` from [CI run](https://github.com/MargusHemlex/agent-reliability-lab-private-history-backup-20261018/actions/runs/39123089377). The full fixture report passes all 33 cases; live-provider samples remain unexecuted. The guided observation has its own strict two-case schema and is not a replacement for the full evaluation. Its same-key crash recovery took 20758 ms including restart. See [publication review](../PUBLICATION-REVIEW.md): verification passed but release remains on hold. The historical browser screenshot was renamed from `.png` to `.jpg` to match its unchanged JPEG bytes.

## Fresh observations after history cleanup

`history-cleanup-ci-fixture.*`, `history-cleanup-ci-walkthrough.*` and `history-cleanup-ci-live-not-run.*` come from the cleaned active repository's [CI run](https://github.com/MargusHemlex/agent-reliability-lab/actions/runs/39131096180) at `7e2b99cd9979e6d30fdc80bfe8e72b83b51f70c0`. These are new observations with new commit provenance; prior report payloads remain unchanged. [Cleanup verification](history-cleanup-verification.json) records the private backup and rewrite checks.

## First genuine bounded model smoke

`live-smoke-2026-10-18.json` and `.md` preserve the actual successful report at clean source commit `46c072ac457a9566749052b439de68b38744cc01`: one executed/passed sample, three calls, one independent effect, no duplicate, known token usage and USD 0.000272 estimated cost. See [scope and validation](../LIVE-SMOKE-REVIEW.md). Previous fixture and live-not-run payloads remain unchanged.
