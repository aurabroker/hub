-- Treść HTML e-maila edytowana w HUB (Edytor e-mail).
-- Gdy ustawiona i niepusta, wysyłka używa tego HTML zamiast resend_template_id
-- (personalizacja {{firma}} itd. podstawiana po stronie HUB). Brak = szablon Resend.
alter table public.email_categories
  add column if not exists html_body text;

comment on column public.email_categories.html_body is
  'Treść HTML maila z Edytora HUB. Ustawiona = wysyłka przez html zamiast resend_template_id.';
