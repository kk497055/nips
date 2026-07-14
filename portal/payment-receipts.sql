-- NIPS Portal — numbered payment receipts (additive, non-destructive)
-- Payments are retained; this only adds receipt delivery metadata.

alter table public.payments add column if not exists receipt_number text;
alter table public.payments add column if not exists receipt_sent_at timestamptz;
create unique index if not exists payments_receipt_number_unique
  on public.payments (receipt_number) where receipt_number is not null;
