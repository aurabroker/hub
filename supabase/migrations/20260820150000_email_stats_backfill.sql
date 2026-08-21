-- Uzupełnianie statystyk z API Resend dla maili wysłanych przed subskrypcją
-- zdarzenia email.opened w webhooku.
--
-- Uwaga: API Resend zwraca wyłącznie `last_event` (ostatni stan), BEZ znaczników
-- czasu poszczególnych zdarzeń. Uzupełnione znaczniki są więc przybliżone (czas
-- dostarczenia/wysyłki), a stats_backfilled_at odróżnia je od danych z webhooka.
alter table public.email_messages
  add column if not exists stats_backfilled_at timestamptz;

comment on column public.email_messages.stats_backfilled_at is
  'Kiedy statystyki uzupełniono z API Resend. Ustawione = znaczniki otwarcia/kliknięcia są przybliżone (API nie podaje czasu zdarzeń).';

create index if not exists email_messages_backfill_idx
  on public.email_messages (status, stats_backfilled_at);
