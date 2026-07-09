-- Tryb dostarczania plikow per kategoria:
-- 'attachments' = pliki Base64 w mailu, 'links' = linki do pobrania w tresci
alter table public.email_categories
  add column attachment_mode text not null default 'attachments'
  check (attachment_mode in ('attachments','links'));

comment on column public.email_categories.attachment_mode
  is 'attachments = zalaczniki w mailu; links = linki do pobrania (zmienna {{{pliki_html}}} w szablonie Resend)';
