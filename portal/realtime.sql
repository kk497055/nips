-- ============================================================
-- NIPS Portal — enable Realtime for the live "class is on now" banner.
-- Lets students get instant updates when a teacher starts/ends a class.
-- RLS still applies: students only receive events for their own batches.
-- Run once in Supabase → SQL Editor. (If it errors "already member", ignore.)
-- ============================================================

alter publication supabase_realtime add table public.sessions;
