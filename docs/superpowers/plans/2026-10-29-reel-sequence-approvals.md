# Owner approvals for one-Reel-per-day batches

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Keep the work isolated on `codex/reel-sequence-approval` in the DMFlow repository and preserve the existing dirty Reelsflow checkout.

**Goal:** Make owner-authenticated approval and scheduling support the approved cadence of one Reel per day for three days, with no queue insert unless all six Reel/Story approvals are stored.

**Architecture:** Extend the existing DMFlow approval handler to accept either its legacy one-day slots or an ordered three-date sequence at one BRT time. Reelsflow will validate the owner API key before uploading, upload the exact assets, ask DMFlow to hash and persist the six owner-bound approvals, then call the existing idempotent Supabase sequence scheduler.

**Tech Stack:** Next.js 16, TypeScript, Supabase/PostgREST, Node.js ESM.

## Global constraints

- Geek Academy project only: `zoknypleoribwomifzgi`.
- Never print or commit API keys; Reelsflow stores its owner key only in ignored `.env.local`.
- Preserve legacy same-day approval behavior.
- The approval endpoint computes hashes and fingerprints server-side, binds `approved_by` to the verified DMFlow key owner, and never inserts queue rows.
- Approval is idempotent for identical assets and schedule; changed assets or dates require a new approval.
- Do not schedule or publish the missed 29/10 slot. New publication dates require explicit approval.

## Files

- `app/api/v1/reels/approve-batch/handler.ts`: validate legacy or sequence schedule and derive approval fingerprints.
- `tests/reels-approval-endpoint.test.mjs`: sequence approval, date/time validation, ownership, and idempotency.
- `C:/Users/freit/Documents/ChatGPT/Instagram/Reelsflow/scripts/schedule-batch.mjs`: fail before upload without owner auth; call preflight, approval, then scheduler.
- `C:/Users/freit/Documents/ChatGPT/Instagram/Reelsflow/scripts/schedule-batch.test.mjs`: fail-fast behavior when owner auth is missing.

## Tasks

- [x] Add failing tests for three ordered dates at one BRT time, invalid sequence inputs, and owner preflight.
- [x] Implement sequence schedule derivation in the owner approval handler; keep canonical fingerprints aligned with `scheduled_reels`.
- [x] Run the approval handler tests and verify legacy one-day approvals still pass.
- [x] Add Reelsflow owner-key preflight and approval call before `schedule-sequence`; keep dry-run and legacy modes intact.
- [x] Verify the local scheduler fails before upload when the owner key is invalid and the sequence request carries the expected assets and dates.
- [ ] Build and deploy the DMFlow approval handler to production, then verify it through `https://dmflow.vercel.app` using the owner key without printing it.
- [ ] Prepare the corrected future schedule for user review; do not commit queue rows until the new dates are approved.
