-- Lista blokad adresów e-mail.
--
-- Adres trafia tu, gdy osoba zażądała usunięcia swoich danych. Po usunięciu
-- kontaktu baza nie pamięta już, że tej osoby nie wolno ponownie dodać ani
-- mailować, a kontakty wpadają do crm_companies także spoza kodu HUB (importy,
-- formularze). Dlatego blokada działa w samej bazie, na każdej drodze zapisu.
--
-- Przechowujemy wyłącznie skrót SHA-256 znormalizowanego adresu (małe litery,
-- bez spacji na brzegach), nie sam adres. Skrót wciąż pozwala sprawdzić, czy
-- znany adres jest zablokowany, ale z samej tabeli nie da się odczytać adresów.
--
-- Dodanie adresu (adres podaje się tylko w zapytaniu, w tabeli zostaje skrót):
--   insert into public.email_blocklist (email_sha256)
--   values (public.email_sha256('adres@example.com')) on conflict do nothing;

create table if not exists public.email_blocklist (
	email_sha256 text primary key check (email_sha256 ~ '^[0-9a-f]{64}$'),
	reason text not null default 'żądanie usunięcia danych',
	created_at timestamptz not null default now()
);

alter table public.email_blocklist enable row level security;

drop policy if exists email_blocklist_admin_select on public.email_blocklist;
create policy email_blocklist_admin_select on public.email_blocklist
	for select to authenticated
	using ((select public.is_crm_admin()));

-- Skrót znormalizowanego adresu. Ta sama normalizacja przy dodawaniu i sprawdzaniu.
create or replace function public.email_sha256(addr text)
returns text
language sql
immutable
set search_path = ''
as $$
	select encode(sha256(convert_to(lower(trim(addr)), 'UTF8')), 'hex')
$$;

-- Czy którykolwiek adres w polu jest zablokowany. Pole bywa listą adresów
-- rozdzieloną przecinkiem, średnikiem albo spacją, więc sprawdzamy każdy.
-- security definer: zapis do CRM robią też role bez prawa odczytu listy (RLS),
-- a bez tego funkcja widziałaby pustą listę i niczego by nie blokowała.
create or replace function public.email_is_blocked(addrs text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
	select exists (
		select 1
		from regexp_split_to_table(coalesce(addrs, ''), '[[:space:],;]+') as a(addr)
		join public.email_blocklist b on b.email_sha256 = public.email_sha256(a.addr)
		where a.addr <> ''
	)
$$;

revoke execute on function public.email_is_blocked(text) from public, anon, authenticated;

-- Kontakt z listy blokad nie wraca do CRM: wstawienie zostaje po cichu pominięte
-- (formularz czy import nie dostaje błędu, ale wiersz nie powstaje), a zmiana
-- adresu istniejącego kontaktu na zablokowany kończy się błędem.
create or replace function public.crm_companies_blocklist_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
	if public.email_is_blocked(new.email) then
		if tg_op = 'INSERT' then
			return null;
		end if;
		raise exception 'Adres e-mail jest na liście blokad (żądanie usunięcia danych)';
	end if;
	return new;
end
$$;

drop trigger if exists crm_companies_blocklist_guard on public.crm_companies;
create trigger crm_companies_blocklist_guard
	before insert or update of email on public.crm_companies
	for each row execute function public.crm_companies_blocklist_guard();

-- Druga zapora, przy wysyłce: mail do zablokowanego adresu nie trafia do kolejki,
-- tylko od razu dostaje status 'skipped'. Wysyłka bierze wyłącznie wiadomości
-- 'queued', więc to zatrzymuje kampanie, automat i szybką wysyłkę 1-do-1,
-- także ponowienie nieudanych i wznowienie anulowanej kampanii.
create or replace function public.email_messages_blocklist_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
	if new.status = 'queued' and public.email_is_blocked(new.to_email) then
		new.status := 'skipped';
		new.error := 'Adres na liście blokad (żądanie usunięcia danych)';
	end if;
	return new;
end
$$;

drop trigger if exists email_messages_blocklist_guard on public.email_messages;
create trigger email_messages_blocklist_guard
	before insert or update of status, to_email on public.email_messages
	for each row execute function public.email_messages_blocklist_guard();

-- Funkcje wyzwalaczy nie mają być wywoływane przez API (rpc). EXECUTE jest
-- sprawdzane przy tworzeniu wyzwalacza, nie przy jego działaniu, więc odebranie
-- uprawnienia nie wyłącza blokady.
revoke execute on function public.crm_companies_blocklist_guard() from public, anon, authenticated;
revoke execute on function public.email_messages_blocklist_guard() from public, anon, authenticated;
