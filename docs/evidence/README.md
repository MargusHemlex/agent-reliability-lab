# Historical milestone-zero observations

These are sanitized local observations, not fixtures pretending to be executions and not a certificate for later source changes.

- `default-observation.json`: an earlier harness run, no source/config hash block; no retrospective hash attribution is asserted. Default ownership configuration, approval persistence passed, interrupted execution timed out.
- `lease-2-observation.json`: experimental two-second override with its recorded historical harness/source hashes; diagnostic only, unsuitable for planned ten-second tools.
- `lease-20-observation.json`: experimental twenty-second override; its recorded source hashes matched the files at the final local review. Two cases passed, with interrupted-tool starts=2/completions=1.

The inner 30-second watchdog starts after initial server startup; reported durationMs includes startup and cleanup. The twenty-second observation finished in 21,598 ms total locally. This investigative watchdog is not yet a complete implementation of every future application deadline.

A report's sourceSnapshot captures checked-out source/lock bytes, not a cryptographic attestation that a particular build consumed them. The probe's build/run were performed locally in this investigation. Build provenance and generated report schemas are later deliverables and remain unimplemented; do not infer full release readiness from this evidence.

CI reruns default and experimental cases and uploads fresh observations separately. Its success would mean the expected limitation was reproduced and the explicit experiment passed; the architecture HOLD still applies. CI results on another host are not claimed until observed.

`lease-20-final-observation.json` repeats the twenty-second experiment after final formatting and a fresh build. Its source hashes identify the final executable spike sources; the earlier twenty-second report is retained as a separate historical observation.

`ci-default-observation.json` and `ci-lease-20-observation.json` are separate Linux x64 observations from CI run 39085904262, executable-source commit a5714c76eeea22b37b877566ddaa4faaf4b791df. Both contain checked-out source hashes. Default interrupted recovery misses the watchdog; experimental twenty-second recovery passes. This closes provenance for the newer default observation without altering the older local record.
