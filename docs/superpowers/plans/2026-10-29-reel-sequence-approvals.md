# Owner approvals for one-Reel-per-day batches

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Keep the work isolated on `codex/reel-sequence-approval` in the DMFlow repository and preserve the existing dirty Reelsflow checkout.

**Goal:** Make owner-authenticated approval and scheduling support the approved cadence of one Reel per day for three days, with no queue insert unless all six Reel/Story approvals are stored.

**Architecture:** Extend the DMFlow approval handler to accept legacy one-day slots or an ordered three-date sequence at one BRT time. Extend the Supabase sequence scheduler to fetch the owner-approved fingerprints and IDs, verify they match the exact Reel/Story rows, and insert them. Reelsflow validates the owner API key before upload, asks DMFlow to hash and persist approvals after upload, then calls the guarded scheduler.

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
- `supabase/functions/reels-batch-control/handler.ts`: validate exact approval records for `schedule-sequence` and add their fingerprints/IDs to queue rows.
- `tests/reels-batch-control.test.mjs`: approval propagation, daily caps, fail-closed behavior, and sequence idempotency.
- `C:/Users/freit/Documents/ChatGPT/Instagram/Reelsflow/scripts/schedule-batch.mjs`: fail before upload without owner auth; call preflight, approval, then scheduler.
- `C:/Users/freit/Documents/ChatGPT/Instagram/Reelsflow/scripts/schedule-batch.test.mjs`: fail-fast behavior when owner auth is missing.

## Tasks

- [x] Add failing tests for ordered sequence dates, invalid sequence inputs, owner preflight, and scheduler approval propagation.
- [x] Implement sequence schedule derivation in the owner approval handler; keep canonical fingerprints aligned with `scheduled_reels`.
- [x] Update the Supabase sequence scheduler to require all six immutable approvals and carry their IDs/fingerprints into queue inserts.
- [x] Integrate Reelsflow preflight, server approval, and scheduler calls; fail before upload if the owner API key is absent.
- [x] Run the DMFlow suite (92 tests), Reelsflow scheduler tests, and production build.
- [x] Deploy the DMFlow approval handler and verify owner preflight through `https://dmflow.vercel.app`.
- [ ] Schedule the approved cuts for 30/10, 31/10 and 01/11 at 12:00 BRT, then verify all three queue rows.
