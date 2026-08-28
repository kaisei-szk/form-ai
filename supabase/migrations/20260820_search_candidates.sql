create table if not exists public.search_candidates (
  id             text primary key,
  project_id     text not null references public.projects(id) on delete cascade,
  run_id         text not null references public.project_runs(id) on delete cascade,
  name           text not null default '',
  url            text not null,
  normalized_url text not null,
  source         text not null default '',
  keyword        text not null default '',
  industry       text not null default '',
  area           text not null default '',
  address        text not null default '',
  phone          text not null default '',
  category       text not null default '',
  verification_status text not null default 'pending',
  verification_reasons jsonb not null default '[]'::jsonb,
  verification_attempts integer not null default 0,
  verified_at    text,
  discovered_at  text not null,
  unique(run_id, normalized_url)
);

alter table public.search_candidates add column if not exists verification_status text not null default 'pending';
alter table public.search_candidates add column if not exists verification_reasons jsonb not null default '[]'::jsonb;
alter table public.search_candidates add column if not exists verification_attempts integer not null default 0;
alter table public.search_candidates add column if not exists verified_at text;
alter table public.search_candidates add column if not exists industry text not null default '';

create index if not exists idx_search_candidates_project_id on public.search_candidates(project_id);
create index if not exists idx_search_candidates_run_id on public.search_candidates(run_id);
create index if not exists idx_search_candidates_normalized_url on public.search_candidates(normalized_url);
create index if not exists idx_search_candidates_verification_status on public.search_candidates(verification_status);

alter table public.search_candidates enable row level security;
notify pgrst, 'reload schema';
