-- Odzyskiwanie zawieszonych wysyłek.
-- Gdy funkcja padnie po przejęciu wiadomości (status 'sending'), nikt jej już nie
-- podniesie — claimMessage bierze wyłącznie 'queued'. claimed_at pozwala wykryć
-- takie wiadomości i bezpiecznie wrócić z nimi do kolejki po ustalonym czasie.
alter table public.email_messages
  add column if not exists claimed_at timestamptz;

comment on column public.email_messages.claimed_at is
  'Moment przejęcia wiadomości do wysyłki (status sending). Służy do odzyskiwania zawieszonych.';

create index if not exists email_messages_sending_claimed_idx
  on public.email_messages (status, claimed_at);
