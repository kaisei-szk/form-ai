-- ポータル・名簿で発見したが、公式HPをまだ特定できていない事業者を保持する。
-- ポータルURLは companies/search_candidates の公式HP欄へは入れない。
create table if not exists public.discovered_businesses (
  id                 text primary key,
  project_id         text not null references public.projects(id) on delete cascade,
  run_id             text not null references public.project_runs(id) on delete cascade,
  name               text not null,
  address            text not null default '',
  phone              text not null default '',
  industry           text not null default '',
  area               text not null default '',
  category           text not null default '',
  portal_host        text not null default '',
  portal_url         text not null default '',
  dedupe_key         text not null,
  official_url       text not null default '',
  resolution_status  text not null default 'hp_not_found',
  resolution_attempts integer not null default 0,
  resolution_score   integer not null default 0,
  resolution_evidence jsonb not null default '[]'::jsonb,
  last_attempted_at  text,
  resolved_at        text,
  last_error         text not null default '',
  discovered_at      text not null,
  unique(run_id, dedupe_key)
);

alter table public.discovered_businesses add column if not exists resolution_attempts integer not null default 0;
alter table public.discovered_businesses add column if not exists resolution_score integer not null default 0;
alter table public.discovered_businesses add column if not exists resolution_evidence jsonb not null default '[]'::jsonb;
alter table public.discovered_businesses add column if not exists last_attempted_at text;
alter table public.discovered_businesses add column if not exists resolved_at text;
alter table public.discovered_businesses add column if not exists last_error text not null default '';

create index if not exists idx_discovered_businesses_project_id on public.discovered_businesses(project_id);
create index if not exists idx_discovered_businesses_run_id on public.discovered_businesses(run_id);
create index if not exists idx_discovered_businesses_status on public.discovered_businesses(resolution_status);
create index if not exists idx_discovered_businesses_retry on public.discovered_businesses(project_id, area, industry, resolution_status);

alter table public.discovered_businesses enable row level security;
notify pgrst, 'reload schema';
