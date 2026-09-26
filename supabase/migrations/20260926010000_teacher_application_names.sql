-- Preserve the original full_name while recording structured applicant names.
alter table public.teacher_applications add column if not exists first_name text;
alter table public.teacher_applications add column if not exists last_name text;

-- Safely normalize legacy camel-case entries such as MaryamRamzan. Names that
-- already contain spaces remain unchanged and are split at the first space.
update public.teacher_applications
set full_name = trim(regexp_replace(full_name, '([[:lower:]])([[:upper:]])', '\1 \2', 'g'))
where full_name ~ '[[:lower:]][[:upper:]]';

update public.teacher_applications
set first_name = nullif(split_part(trim(full_name), ' ', 1), ''),
    last_name = nullif(trim(substr(trim(full_name), length(split_part(trim(full_name), ' ', 1)) + 1)), '')
where first_name is null and last_name is null;

