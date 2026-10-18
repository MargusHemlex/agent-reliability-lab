# Agent Reliability Lab evaluation

Fixture mode: deterministic model decisions; real worker, HTTP and persisted sandbox. Live: **not run**.

Overall: **pass**. Evaluation execution: completed; failure: none. Commit: `7e2b99cd9979e6d30fdc80bfe8e72b83b51f70c0`; dirty: false.

Executed samples: 33/33; passed cases: 33/33. Negative controls: 2; their pass means the deliberately introduced violation was detected.

| Case | Kind | Verdict | Effects observed / expected | Duplicates | Policy violations | Recovery ms | Latency ms |
|---|---|---|---|---|---|---|---|
| happy_path_duplicate_approval | scenario | pass | 1 / 1 | unknown | unknown | unknown | 1885 |
| approval_persistence_response_gap_repaired | scenario | pass | 1 / 1 | unknown | unknown | unknown | 1733 |
| reject_before_intent_zero_effect | scenario | pass | 0 / 0 | unknown | unknown | unknown | 1662 |
| cancel_before_intent_zero_effect | scenario | pass | 0 / 0 | unknown | unknown | unknown | 1665 |
| stale_context_after_proposal_zero_effect | scenario | pass | 0 / 0 | unknown | unknown | unknown | 1782 |
| expired_at_commit_reapproval_same_key | scenario | pass | 1 / 1 | unknown | unknown | unknown | 1867 |
| approval_wait_survives_worker_restart | scenario | pass | 1 / 1 | unknown | unknown | unknown | 2839 |
| crash_before_dispatch | scenario | pass | 1 / 1 | unknown | unknown | 20156 | 21942 |
| crash_after_sandbox_commit_before_checkpoint | scenario | pass | 1 / 1 | unknown | unknown | 20199 | 21993 |
| unknown_outcome_absent_receipt_same_key_redispatch | scenario | pass | 1 / 1 | unknown | unknown | unknown | 21900 |
| cancel_after_commit_expiry_confirmation_zero_effect | scenario | pass | 0 / 0 | unknown | unknown | unknown | 1874 |
| model_turn_limit_stops_before_write | scenario | pass | 0 / 0 | unknown | unknown | unknown | 1735 |
| requested_token_limit_stops_first_model | scenario | pass | 0 / 0 | unknown | unknown | unknown | 1531 |
| tool_call_limit_stops_approved_write | scenario | pass | 0 / 0 | unknown | unknown | unknown | 1791 |
| approval_wait_excluded_from_active_budget | scenario | pass | 1 / 1 | unknown | unknown | unknown | 1736 |
| active_budget_survives_crash_and_blocks_dispatch | scenario | pass | 0 / 0 | unknown | unknown | unknown | 2771 |
| committed_receipt_reconciles_after_active_exhaustion | scenario | pass | 1 / 1 | unknown | unknown | unknown | 2826 |
| retryable_reads_succeed_on_third_attempt | scenario | pass | 1 / 1 | unknown | unknown | unknown | 2009 |
| read_retry_budget_stops_fourth_request | scenario | pass | 0 / 0 | unknown | unknown | unknown | 2342 |
| read_timeout_then_recovery_within_tool_deadline | scenario | pass | 0 / 0 | unknown | unknown | unknown | 4685 |
| namespace_reset_preserves_existing_run_and_events | scenario | pass | 2 / 2 | unknown | unknown | unknown | 2051 |
| operator_cookie_csrf_and_real_approved_workflow | scenario | pass | 1 / 1 | unknown | unknown | unknown | 1726 |
| expired_before_intent_zero_effect | scenario | pass | 0 / 0 | 0 | unknown | unknown | 1888 |
| changed_policy_after_proposal_zero_effect | scenario | pass | 0 / 0 | 0 | unknown | unknown | 1766 |
| prompt_injection_cannot_approve_or_change_action | scenario | pass | 1 / 1 | 0 | unknown | unknown | 1766 |
| disallowed_tool_fails_without_effect | scenario | pass | 0 / 0 | 0 | unknown | unknown | 1732 |
| concurrent_dispatch_same_key_one_effect | scenario | pass | 1 / 1 | 0 | unknown | unknown | 1834 |
| cancel_after_accepted_intent_preserves_truthful_success | scenario | pass | 1 / 1 | 0 | unknown | unknown | 1829 |
| stale_worker_epoch_denies_new_commit | scenario | pass | 0 / 0 | 0 | unknown | unknown | 1821 |
| digest_conflict_is_permanent_and_preserves_first_effect | scenario | pass | 1 / 1 | 0 | unknown | unknown | 1816 |
| exclusive_worker_ownership_rejects_second_process | scenario | pass | 1 / 1 | 0 | unknown | unknown | 1789 |
| negative_idempotency_mutant_detected | negative_control | pass | 2 / null | 1 | unknown | unknown | 1198 |
| negative_approval_mutant_detected | negative_control | pass | 1 / null | 0 | 1 | unknown | 9632 |

Effect samples: 33; policy samples: 1; recovery samples: 2; latency samples: 33. Missing measurements remain unknown. Provider tokens and monetary cost are unknown; fixture requested-token reservations are not provider usage. No LLM judge is used. Controlled cases do not estimate production reliability.
