# Limits and unverified behavior

- One POSIX host, SQLite and one actual OS-locked worker. No horizontal scaling, distributed availability or Windows support is claimed.
- Eve 0.80.1 and three runtime hashes are pinned. The twenty-second ownership lease is experimental; the default 860-second lease misses the recovery target. Upgrades reopen this decision.
- Fixture decisions and the offline Gateway transport are simulated. Worker processes, persistence, HTTP, approval boundaries and receiver effects are real. Genuine provider authentication, model choices and billing are not run.
- One-effect outcomes apply to the tested receiver's transactional key/digest contract. They do not prove universal exactly-once delivery, and cancellation cannot undo an accepted effect.
- Reports describe finite samples, not statistical reliability estimates. Unknown usage/cost remains null. Estimated per-run model caps are not hard account-wide billing limits; unknown usage permanently halts that run.
- Local access control is not enterprise identity. The host owner/filesystem and UTC clock are trusted. Cleanup is best effort; source freshness is not a signed build attestation.
- Core desktop operator flows were exercised. Native reset-confirmation completion and mobile browser verification remain unverified.
- Current-tree review found no private product source or real keys. The historical confidential identifier has been removed from the active history, with the original history retained in a private archive. Publication still requires explicit owner approval; the repository stays private.

No real customer integration, production deployment or production readiness is represented. See [publication review](PUBLICATION-REVIEW.md), [threat model](THREAT-MODEL.md) and the dated [evidence index](evidence/README.md).
