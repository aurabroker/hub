-- Automatyczna wysyłka dla wybranych sekcji (autoresponder na nowe zapisy).
-- auto_send_since = data odcięcia: kolejkowane są WYŁĄCZNIE kontakty zapisane
-- po włączeniu automatu, żeby istniejąca baza nie dostała maila znienacka.

alter table public.email_categories
  add column if not exists auto_send boolean not null default false,
  add column if not exists auto_send_since timestamptz;

comment on column public.email_categories.auto_send is
  'Automatyczna wysyłka do nowych zapisów tej sekcji (obsługiwana przez cron).';
comment on column public.email_categories.auto_send_since is
  'Data odcięcia — automat bierze tylko kontakty zapisane po tym momencie.';

-- Nowe źródło wiadomości: 'auto' (odróżnia automat od ręcznej wysyłki i kampanii).
alter table public.email_messages
  drop constraint if exists email_messages_source_check;
alter table public.email_messages
  add constraint email_messages_source_check
  check (source in ('campaign','quick_send','auto'));

create index if not exists email_messages_source_created_idx
  on public.email_messages (source, created_at);
