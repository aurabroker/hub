-- Aura HUB — moduł UTM: generator linków kampanijnych, skracacz, kody QR
-- oraz atrybucja źródła leada.
--
-- Nie modyfikuje tabel CRM. `utm_attributions.company_id` celowo NIE ma klucza
-- obcego do `crm_companies` — dzięki temu moduł nie zakłada żadnego więzu na
-- tabelach CRM (patrz README: „HUB tylko z niej czyta").
-- Nie dotyka autoryzacji ani weryfikacji Supabase.

-- ---------------------------------------------------------------------------
-- Normalizacja wartości parametrów utm
-- Bliźniak w TypeScript: src/lib/utm.ts (slugify). Obie implementacje muszą
-- dawać ten sam wynik, tak jak email_normalize_interest i normalizeInterest.
-- ---------------------------------------------------------------------------
create or replace function public.utm_slugify(src text)
returns text
language sql
immutable
set search_path to ''
as $$
  select nullif(
    trim(both '-' from
      regexp_replace(
        regexp_replace(
          lower(translate(
            coalesce(src, ''),
            'ąćęłńóśźżĄĆĘŁŃÓŚŹŻ',
            'acelnoszzACELNOSZZ'
          )),
          '[^a-z0-9]+', '-', 'g'
        ),
        '-{2,}', '-', 'g'
      )
    ),
    ''
  );
$$;

comment on function public.utm_slugify(text)
  is 'Normalizuje wartość parametru utm: polskie znaki na ASCII, małe litery, spacje i znaki specjalne na myślnik. Puste wejście zwraca NULL.';

-- ---------------------------------------------------------------------------
-- Tabele
-- ---------------------------------------------------------------------------

-- Nasze serwisy — lista adresów startowych dostępnych w generatorze.
create table if not exists public.utm_destinations (
  id          uuid primary key default gen_random_uuid(),
  code        text not null unique,
  name        text not null,
  base_url    text not null,
  active      boolean not null default true,
  sort_order  integer not null default 100,
  notes       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

comment on table public.utm_destinations
  is 'Serwisy Aura dostępne jako cel linku w generatorze UTM.';

-- Słowniki dopuszczalnych wartości — żeby nie powstało „Facebook" obok „facebook".
create table if not exists public.utm_presets (
  id          uuid primary key default gen_random_uuid(),
  kind        text not null check (kind in ('source', 'medium', 'campaign', 'content', 'term')),
  value       text not null,
  label       text,
  active      boolean not null default true,
  sort_order  integer not null default 100,
  created_at  timestamptz not null default now(),
  unique (kind, value)
);

comment on table public.utm_presets
  is 'Słownik kanonicznych wartości utm_source / utm_medium / utm_campaign / utm_content / utm_term.';

-- Wygenerowane linki. `final_url` to snapshot pełnego adresu z parametrami.
create table if not exists public.utm_links (
  id                 uuid primary key default gen_random_uuid(),
  slug               text not null unique,
  label              text not null,
  destination_id     uuid references public.utm_destinations(id) on delete restrict,
  base_url           text not null,
  utm_source         text not null,
  utm_medium         text not null,
  utm_campaign       text not null,
  utm_content        text,
  utm_term           text,
  extra_params       jsonb not null default '{}'::jsonb,
  final_url          text not null,
  -- Skrót zewnętrzny (Bitly). Wypełniany przyciskiem przez API albo ręcznie.
  short_url_external text,
  bitly_id           text,
  bitly_clicks       integer,
  -- Moment skrócenia — po nim liczymy zużycie miesięcznego limitu planu Bitly.
  bitly_shortened_at timestamptz,
  -- Moment ostatniego pobrania licznika kliknięć z API Bitly.
  bitly_synced_at    timestamptz,
  -- Opcjonalne powiązanie z sekcją wysyłki (tylko do raportów i filtrów).
  category_id        uuid references public.email_categories(id) on delete set null,
  notes              text,
  archived           boolean not null default false,
  created_by         uuid,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

comment on column public.utm_links.short_url_external
  is 'Krótki link Bitly. Celuje prosto w final_url, więc jego kliknięcia NIE trafiają do utm_clicks — liczy je bitly_clicks.';

-- Ten sam komplet parametrów nie może dać dwóch aktywnych linków.
-- Archiwalne są wyłączone z więzu, żeby dało się odtworzyć historyczną kampanię.
create unique index if not exists utm_links_params_uniq
  on public.utm_links (
    destination_id, utm_source, utm_medium, utm_campaign,
    coalesce(utm_content, ''), coalesce(utm_term, '')
  )
  where not archived;

create index if not exists utm_links_campaign_idx on public.utm_links (utm_campaign);
create index if not exists utm_links_created_idx  on public.utm_links (created_at desc);
create index if not exists utm_links_category_idx on public.utm_links (category_id);
create index if not exists utm_links_bitly_idx
  on public.utm_links (bitly_shortened_at desc)
  where bitly_id is not null;

-- Kliknięcia we własne przekierowanie /l/{slug}.
-- Adres IP wyłącznie jako skrót SHA-256 z solą — nigdy surowa wartość (RODO).
create table if not exists public.utm_clicks (
  id          bigint generated always as identity primary key,
  link_id     uuid not null references public.utm_links(id) on delete cascade,
  clicked_at  timestamptz not null default now(),
  referer     text,
  user_agent  text,
  ip_hash     text,
  country     text
);

create index if not exists utm_clicks_link_idx on public.utm_clicks (link_id, clicked_at desc);
create index if not exists utm_clicks_time_idx on public.utm_clicks (clicked_at desc);

comment on column public.utm_clicks.ip_hash
  is 'SHA-256 z adresu IP i sekretu. Surowy IP nie jest nigdzie zapisywany.';

-- Źródło leada. Zasilane przez /api/webhooks/utm-attribution z landingów.
create table if not exists public.utm_attributions (
  id             uuid primary key default gen_random_uuid(),
  company_id     integer,
  lead_intake_id uuid,
  email          text,
  link_id        uuid references public.utm_links(id) on delete set null,
  utm_source     text,
  utm_medium     text,
  utm_campaign   text,
  utm_content    text,
  utm_term       text,
  landing_url    text,
  referrer       text,
  gclid          text,
  fbclid         text,
  first_seen_at  timestamptz,
  created_at     timestamptz not null default now()
);

comment on table public.utm_attributions
  is 'Źródło pozyskania leada. Bez klucza obcego do crm_companies — moduł nie zakłada więzów na tabelach CRM.';

create index if not exists utm_attributions_company_idx  on public.utm_attributions (company_id);
create index if not exists utm_attributions_email_idx    on public.utm_attributions (lower(email));
create index if not exists utm_attributions_campaign_idx on public.utm_attributions (utm_campaign);
create index if not exists utm_attributions_created_idx  on public.utm_attributions (created_at desc);

-- ---------------------------------------------------------------------------
-- Triggery updated_at (konwencja projektu: public.set_updated_at)
-- ---------------------------------------------------------------------------
drop trigger if exists utm_destinations_set_updated_at on public.utm_destinations;
create trigger utm_destinations_set_updated_at
  before update on public.utm_destinations
  for each row execute function public.set_updated_at();

drop trigger if exists utm_links_set_updated_at on public.utm_links;
create trigger utm_links_set_updated_at
  before update on public.utm_links
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- RLS: dostęp tylko dla administratorów platformy.
-- Backend używa service role, który omija RLS (zapis kliknięć z /l/{slug}
-- i atrybucji z webhooka idzie właśnie tą drogą, bez logowania).
-- ---------------------------------------------------------------------------
alter table public.utm_destinations  enable row level security;
alter table public.utm_presets       enable row level security;
alter table public.utm_links         enable row level security;
alter table public.utm_clicks        enable row level security;
alter table public.utm_attributions  enable row level security;

drop policy if exists utm_destinations_admin_all on public.utm_destinations;
create policy utm_destinations_admin_all on public.utm_destinations
  for all to authenticated
  using (public.is_platform_admin()) with check (public.is_platform_admin());

drop policy if exists utm_presets_admin_all on public.utm_presets;
create policy utm_presets_admin_all on public.utm_presets
  for all to authenticated
  using (public.is_platform_admin()) with check (public.is_platform_admin());

drop policy if exists utm_links_admin_all on public.utm_links;
create policy utm_links_admin_all on public.utm_links
  for all to authenticated
  using (public.is_platform_admin()) with check (public.is_platform_admin());

drop policy if exists utm_clicks_admin_all on public.utm_clicks;
create policy utm_clicks_admin_all on public.utm_clicks
  for all to authenticated
  using (public.is_platform_admin()) with check (public.is_platform_admin());

drop policy if exists utm_attributions_admin_all on public.utm_attributions;
create policy utm_attributions_admin_all on public.utm_attributions
  for all to authenticated
  using (public.is_platform_admin()) with check (public.is_platform_admin());

-- ---------------------------------------------------------------------------
-- Widoki (security_invoker: dziedziczą RLS tabel źródłowych)
-- ---------------------------------------------------------------------------

-- Kliknięcia własnego przekierowania w rozbiciu na okna czasowe.
create or replace view public.utm_link_stats
with (security_invoker = on) as
select l.id                                                                          as link_id,
       count(c.id)                                                                   as clicks_total,
       count(c.id) filter (where c.clicked_at >= now() - interval '7 days')          as clicks_7d,
       count(c.id) filter (where c.clicked_at >= now() - interval '30 days')         as clicks_30d,
       max(c.clicked_at)                                                             as last_click_at
from public.utm_links l
left join public.utm_clicks c on c.link_id = l.id
group by l.id;

-- Skuteczność kampanii: kliknięcia z obu źródeł (własne /l/ oraz Bitly) i leady.
-- FULL JOIN, bo atrybucja może przyjść z kampanii, dla której nikt nie zapisał
-- linku w HUB (np. UTM-y wpisane ręcznie w panelu reklamowym).
create or replace view public.utm_campaign_performance
with (security_invoker = on) as
with link_agg as (
  select l.utm_campaign                      as k_campaign,
         l.utm_source                        as k_source,
         l.utm_medium                        as k_medium,
         count(*)                            as links,
         coalesce(sum(s.clicks_total), 0)    as clicks_own,
         coalesce(sum(l.bitly_clicks), 0)    as clicks_bitly,
         max(s.last_click_at)                as last_click_at
  from public.utm_links l
  left join public.utm_link_stats s on s.link_id = l.id
  where not l.archived
  group by 1, 2, 3
),
lead_agg as (
  -- Klucze sprowadzamy do tekstu bez NULL-i: FULL JOIN w Postgresie wymaga
  -- warunku hash- albo merge-joinable, więc `is not distinct from` odpada.
  select coalesce(utm_campaign, '') as k_campaign,
         coalesce(utm_source,   '') as k_source,
         coalesce(utm_medium,   '') as k_medium,
         count(*)                   as leads
  from public.utm_attributions
  group by 1, 2, 3
)
select nullif(coalesce(la.k_campaign, ga.k_campaign), '')     as utm_campaign,
       nullif(coalesce(la.k_source,   ga.k_source),   '')     as utm_source,
       nullif(coalesce(la.k_medium,   ga.k_medium),   '')     as utm_medium,
       coalesce(la.links, 0)                                  as links,
       coalesce(la.clicks_own, 0)                             as clicks_own,
       coalesce(la.clicks_bitly, 0)                           as clicks_bitly,
       coalesce(la.clicks_own, 0) + coalesce(la.clicks_bitly, 0) as clicks_total,
       coalesce(ga.leads, 0)                                  as leads,
       la.last_click_at
from link_agg la
full outer join lead_agg ga
  on  ga.k_campaign = la.k_campaign
  and ga.k_source   = la.k_source
  and ga.k_medium   = la.k_medium;

-- ---------------------------------------------------------------------------
-- Seed: serwisy Aura
-- ---------------------------------------------------------------------------
insert into public.utm_destinations (code, name, base_url, sort_order) values
  ('auraexpert',      'Aura Expert',            'https://auraexpert.pl',      10),
  ('auraconsulting',  'Aura Consulting',        'https://auraconsulting.pl',  20),
  ('utratadochodu',   'Utrata dochodu',         'https://utratadochodu.pl',   30),
  ('grupowe',         'Ubezpieczenia grupowe',  'https://grupowe.pro',        40),
  ('gwarancje',       'Gwarancje',              'https://gwarancje.pro',      50),
  ('rozwod',          'Rozwód Warszawa',        'https://rozwod.waw.pl',      60)
on conflict (code) do nothing;

-- ---------------------------------------------------------------------------
-- Seed: słowniki wartości
-- ---------------------------------------------------------------------------
insert into public.utm_presets (kind, value, label, sort_order) values
  ('source', 'google',    'Google',              10),
  ('source', 'facebook',  'Facebook',            20),
  ('source', 'instagram', 'Instagram',           30),
  ('source', 'linkedin',  'LinkedIn',            40),
  ('source', 'tiktok',    'TikTok',              50),
  ('source', 'youtube',   'YouTube',             60),
  ('source', 'email',     'E-mail (Aura HUB)',   70),
  ('source', 'sms',       'SMS',                 80),
  ('source', 'partner',   'Partner / polecenie', 90),
  ('source', 'qr',        'Kod QR / offline',   100),
  ('medium', 'cpc',       'Płatne kliknięcia',   10),
  ('medium', 'organic',   'Ruch organiczny',     20),
  ('medium', 'email',     'E-mail',              30),
  ('medium', 'sms',       'SMS',                 40),
  ('medium', 'social',    'Social media',        50),
  ('medium', 'display',   'Banery / display',    60),
  ('medium', 'referral',  'Odesłanie',           70),
  ('medium', 'affiliate', 'Program partnerski',  80),
  ('medium', 'print',     'Druk / materiały',    90),
  ('medium', 'qr',        'Kod QR',             100)
on conflict (kind, value) do nothing;
