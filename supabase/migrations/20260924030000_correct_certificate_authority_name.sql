-- Correct the configured authority for future certificates only.
-- Issued certificates retain their original signer snapshot and audit history.
update public.certificate_settings
set signer_name = 'Yasir Khan Durrani',
    signer_title = 'Chief Executive',
    updated_at = now()
where id = true;

