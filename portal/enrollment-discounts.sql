-- NIPS Portal — per-student batch fee discounts (additive, non-destructive)
-- The batch fee remains the standard published fee. This audit note applies
-- only to the individual student's enrollment in that batch.

alter table public.enrollments
  add column if not exists discount_note text;
