-- Aura HUB — tygodniowe raporty Google Ads (kampania UD_2026, utratadochodu.pl).
--
-- Raport wpycha skrypt Google Ads Scripts na POST /api/webhooks/ads-report
-- (co poniedziałek, za poprzedni pełny tydzień). Jeden wiersz = jeden tydzień,
-- kluczem jest ostatni dzień okresu, więc ponowne wysłanie tego samego tygodnia
-- nadpisuje wiersz zamiast tworzyć duplikat. „Najnowszy" = max(period_end).
--
-- Nie modyfikuje tabel CRM. Nie dotyka autoryzacji ani weryfikacji Supabase —
-- polityka tylko wywołuje istniejącą public.is_platform_admin().

create table if not exists public.ads_reports (
  period_end    date        primary key,
  campaign      text,
  generated_at  timestamptz,
  received_at   timestamptz not null default now(),
  payload       jsonb       not null
);

comment on table public.ads_reports
  is 'Tygodniowe raporty Google Ads wpychane przez skrypt (POST /api/webhooks/ads-report). Klucz: ostatni dzień okresu.';

-- ---------------------------------------------------------------------------
-- RLS: odczyt tylko dla administratorów platformy.
-- Zapis idzie wyłącznie przez webhook z kluczem service role, który omija RLS,
-- więc dla zalogowanych nie ma polityki zapisu.
-- ---------------------------------------------------------------------------
alter table public.ads_reports enable row level security;

drop policy if exists ads_reports_admin_select on public.ads_reports;
create policy ads_reports_admin_select on public.ads_reports
  for select to authenticated
  using (public.is_platform_admin());
