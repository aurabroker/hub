-- Biblioteka draftów treści e-maili (Edytor e-mail w HUB).
-- Drafty są robocze: realna wysyłka nadal czyta treść z email_categories,
-- a draft trafia tam dopiero akcją „Zastosuj do sekcji".

create table if not exists public.email_drafts (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  subject       text,
  html_body     text not null default '',
  -- Opcjonalne powiązanie z sekcją (tylko do filtrowania/podpowiedzi).
  category_id   uuid references public.email_categories(id) on delete set null,
  -- null = dziedzicz tryb z sekcji; 'attachments' | 'links' = nadpisz.
  attachment_mode text check (attachment_mode in ('attachments','links')),
  created_by    uuid,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- Załączniki przypięte do draftu (puste = przy zastosowaniu zostają pliki sekcji).
create table if not exists public.email_draft_assets (
  draft_id      uuid references public.email_drafts(id) on delete cascade,
  asset_id      uuid references public.email_assets(id) on delete cascade,
  primary key (draft_id, asset_id)
);

create index if not exists email_drafts_updated_idx on public.email_drafts (updated_at desc);
create index if not exists email_drafts_category_idx on public.email_drafts (category_id);

drop trigger if exists email_drafts_set_updated_at on public.email_drafts;
create trigger email_drafts_set_updated_at
  before update on public.email_drafts
  for each row execute function public.set_updated_at();

alter table public.email_drafts       enable row level security;
alter table public.email_draft_assets enable row level security;

drop policy if exists email_drafts_admin_all on public.email_drafts;
create policy email_drafts_admin_all on public.email_drafts
  for all to authenticated
  using (public.is_platform_admin()) with check (public.is_platform_admin());

drop policy if exists email_draft_assets_admin_all on public.email_draft_assets;
create policy email_draft_assets_admin_all on public.email_draft_assets
  for all to authenticated
  using (public.is_platform_admin()) with check (public.is_platform_admin());
