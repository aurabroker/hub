-- Aura HUB - modul masowej i szybkiej wysylki maili z zalacznikami.
-- Nie modyfikuje istniejacych tabel CRM; korzysta z konwencji projektu:
-- public.is_platform_admin() oraz public.set_updated_at().

-- ---------------------------------------------------------------------------
-- Normalizacja crm_companies.ubezpieczenie -> kod kanoniczny
-- Obsluguje warianty myslnika (-, EN dash, EM dash, minus) + trim/lower.
-- ---------------------------------------------------------------------------
create or replace function public.email_normalize_interest(src text)
returns text
language sql
immutable
set search_path to ''
as $$
  select case
    when v = ''                                  then 'brak'
    when v like 'ubezpieczenie oc%'              then 'oc'
    when v like 'nie wiem%'                      then 'konsultacja'
    when v like 'ochrona karno-skarbowa%'        then 'tax'
    when v like 'ubezpieczenie utraty dochodu%'  then 'utrata_dochodu'
    when v like 'pakiety zdrowotne%'             then 'zdrowie'
    when v like 'ubezpieczenia grupowe%'         then 'grupowe'
    else 'inne'
  end
  from (
    select lower(trim(regexp_replace(coalesce(src, ''), '[‐‑‒–—−]', '-', 'g'))) as v
  ) t;
$$;

comment on function public.email_normalize_interest(text)
  is 'Mapuje wolny tekst crm_companies.ubezpieczenie na kod kanoniczny (oc, konsultacja, tax, utrata_dochodu, zdrowie, grupowe, brak, inne).';

-- Interpretacja zgody RODO (crm_companies.rodo to wolny tekst).
create or replace function public.email_has_rodo_consent(src text)
returns boolean
language sql
immutable
set search_path to ''
as $$
  select lower(trim(coalesce(src, ''))) in ('tak', 'true', '1', 'yes', 'on', 'zgoda');
$$;

-- ---------------------------------------------------------------------------
-- Tabele
-- ---------------------------------------------------------------------------

-- Kanoniczne kategorie/sekcje = konfiguracja "co wysylamy"
create table public.email_categories (
  id            uuid primary key default gen_random_uuid(),
  code          text not null unique,
  name          text not null,
  resend_template_id text,
  subject       text,
  from_email    text,
  active        boolean not null default true,
  sort_order    integer not null default 100,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- Biblioteka zalacznikow (upload raz, uzyj wielokrotnie)
create table public.email_assets (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  storage_path  text not null,
  filename      text not null,
  content_type  text,
  size_bytes    bigint,
  created_by    uuid,
  created_at    timestamptz not null default now()
);

-- Domyslne zalaczniki przypiete do kategorii
create table public.email_category_assets (
  category_id   uuid references public.email_categories(id) on delete cascade,
  asset_id      uuid references public.email_assets(id) on delete cascade,
  primary key (category_id, asset_id)
);

-- Kampania = jedna wysylka masowa do segmentu
create table public.email_campaigns (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  category_id   uuid references public.email_categories(id),
  subject       text,
  from_email    text,
  segment_json  jsonb not null default '{}'::jsonb,
  audience_mode text not null default 'all'
                check (audience_mode in ('all','new_only','not_opened','retry_failed')),
  status        text not null default 'draft'
                check (status in ('draft','scheduled','sending','sent','failed','canceled')),
  scheduled_at  timestamptz,
  created_by    uuid,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- Pojedynczy mail (kolejka + status + tracking); wspolne dla kampanii i szybkiej wysylki
create table public.email_messages (
  id            uuid primary key default gen_random_uuid(),
  campaign_id   uuid references public.email_campaigns(id) on delete cascade,
  category_id   uuid references public.email_categories(id),
  company_id    integer references public.crm_companies(id),
  to_email      text not null,
  source        text not null default 'campaign' check (source in ('campaign','quick_send')),
  variables_json jsonb not null default '{}'::jsonb,
  status        text not null default 'queued'
                check (status in ('queued','sending','sent','failed','bounced','skipped')),
  resend_id     text,
  error         text,
  attempts      integer not null default 0,
  -- audyt RODO: status zgody w momencie kolejkowania/wysylki
  rodo_snapshot text,
  sent_at       timestamptz,
  delivered_at  timestamptz,
  opened_at     timestamptz,
  clicked_at    timestamptz,
  bounced_at    timestamptz,
  complained_at timestamptz,
  created_at    timestamptz not null default now()
);

-- Idempotencja tylko dla kampanii (szybka wysylka moze isc wielokrotnie)
create unique index email_messages_campaign_company_uniq
  on public.email_messages (campaign_id, company_id)
  where campaign_id is not null and company_id is not null;

-- Snapshot: ktore pliki z biblioteki poszly z ktorym mailem
create table public.email_attachments (
  id            uuid primary key default gen_random_uuid(),
  message_id    uuid references public.email_messages(id) on delete cascade,
  asset_id      uuid references public.email_assets(id),
  created_at    timestamptz not null default now()
);

create index email_messages_campaign_status_idx on public.email_messages (campaign_id, status);
create index email_messages_category_sent_idx on public.email_messages (category_id, sent_at);
create index email_messages_resend_id_idx on public.email_messages (resend_id);
create index email_messages_status_created_idx on public.email_messages (status, created_at);
create index email_attachments_message_idx on public.email_attachments (message_id);

create trigger email_categories_set_updated_at
  before update on public.email_categories
  for each row execute function public.set_updated_at();

create trigger email_campaigns_set_updated_at
  before update on public.email_campaigns
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- RLS: dostep tylko dla zalogowanych administratorow platformy
-- (backend uzywa service role, ktory omija RLS)
-- ---------------------------------------------------------------------------
alter table public.email_categories      enable row level security;
alter table public.email_assets          enable row level security;
alter table public.email_category_assets enable row level security;
alter table public.email_campaigns       enable row level security;
alter table public.email_messages        enable row level security;
alter table public.email_attachments     enable row level security;

create policy email_categories_admin_all on public.email_categories
  for all to authenticated
  using (public.is_platform_admin()) with check (public.is_platform_admin());

create policy email_assets_admin_all on public.email_assets
  for all to authenticated
  using (public.is_platform_admin()) with check (public.is_platform_admin());

create policy email_category_assets_admin_all on public.email_category_assets
  for all to authenticated
  using (public.is_platform_admin()) with check (public.is_platform_admin());

create policy email_campaigns_admin_all on public.email_campaigns
  for all to authenticated
  using (public.is_platform_admin()) with check (public.is_platform_admin());

create policy email_messages_admin_all on public.email_messages
  for all to authenticated
  using (public.is_platform_admin()) with check (public.is_platform_admin());

create policy email_attachments_admin_all on public.email_attachments
  for all to authenticated
  using (public.is_platform_admin()) with check (public.is_platform_admin());

-- ---------------------------------------------------------------------------
-- Storage: prywatny bucket na dokumenty ubezpieczeniowe
-- Sciezki: library/{asset_id}/{filename}
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('email-assets', 'email-assets', false)
on conflict (id) do nothing;

create policy email_assets_storage_select on storage.objects
  for select to authenticated
  using (bucket_id = 'email-assets' and public.is_platform_admin());

create policy email_assets_storage_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'email-assets' and public.is_platform_admin());

create policy email_assets_storage_update on storage.objects
  for update to authenticated
  using (bucket_id = 'email-assets' and public.is_platform_admin());

create policy email_assets_storage_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'email-assets' and public.is_platform_admin());

-- ---------------------------------------------------------------------------
-- Widoki analityczne (security_invoker: dziedzicza RLS tabel zrodlowych)
-- ---------------------------------------------------------------------------

-- A. Zapisy dziennie
create view public.email_stats_signups_daily
with (security_invoker = on) as
select date_trunc('day', coalesce(data_zgloszenia, created_at))::date as dzien,
       count(*) as n
from public.crm_companies
group by 1
order by 1 desc;

-- B1. Duplikaty po e-mailu (po normalizacji)
create view public.email_duplicates_by_email
with (security_invoker = on) as
select lower(trim(email)) as email,
       count(*) as ile,
       array_agg(id order by created_at) as ids,
       array_agg(company order by created_at) as firmy
from public.crm_companies
where coalesce(trim(email), '') <> ''
group by 1
having count(*) > 1
order by ile desc;

-- B2. Duplikaty wtornie po NIP
create view public.email_duplicates_by_nip
with (security_invoker = on) as
select regexp_replace(nip, '\D', '', 'g') as nip,
       count(*) as ile,
       array_agg(id order by created_at) as ids,
       array_agg(company order by created_at) as firmy
from public.crm_companies
where coalesce(regexp_replace(nip, '\D', '', 'g'), '') <> ''
group by 1
having count(*) > 1
order by ile desc;

-- C. Rozklad zainteresowan wg kategorii kanonicznej
create view public.email_stats_interest
with (security_invoker = on) as
select public.email_normalize_interest(ubezpieczenie) as kategoria,
       count(*) as n
from public.crm_companies
group by 1
order by n desc;

-- D. Wyslane maile wg dnia i sekcji + tracking
create view public.email_stats_sent_daily
with (security_invoker = on) as
select date_trunc('day', m.sent_at)::date as dzien,
       coalesce(c.code, 'brak') as sekcja,
       count(*) filter (where m.status = 'sent')        as wyslane,
       count(*) filter (where m.opened_at is not null)  as otwarcia,
       count(*) filter (where m.clicked_at is not null) as klikniecia
from public.email_messages m
left join public.email_categories c on c.id = m.category_id
where m.sent_at is not null
group by 1, 2
order by 1 desc;

-- ---------------------------------------------------------------------------
-- Seed kategorii kanonicznych
-- ---------------------------------------------------------------------------
insert into public.email_categories (code, name, sort_order) values
  ('oc',             'Ubezpieczenie OC',             10),
  ('tax',            'Ochrona karno-skarbowa',       20),
  ('utrata_dochodu', 'Ubezpieczenie utraty dochodu', 30),
  ('zdrowie',        'Pakiety zdrowotne',            40),
  ('grupowe',        'Ubezpieczenia grupowe',        50),
  ('konsultacja',    'Konsultacja',                  60)
on conflict (code) do nothing;
