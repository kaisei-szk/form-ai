create table if not exists public.search_candidates (
  id             text primary key,
  project_id     text not null references public.projects(id) on delete cascade,
  run_id         text not null references public.project_runs(id) on delete cascade,
  name           text not null default '',
  url            text not null,
  normalized_url text not null,
  source         text not null default '',
  keyword        text not null default '',
  area           text not null default '',
  address        text not null default '',
  phone          text not null default '',
  category       text not null default '',
  discovered_at  text not null,
  unique(run_id, normalized_url)
);

create index if not exists idx_search_candidates_project_id on public.search_candidates(project_id);
create index if not exists idx_search_candidates_run_id on public.search_candidates(run_id);
create index if not exists idx_search_candidates_normalized_url on public.search_candidates(normalized_url);

alter table public.search_candidates enable row level security;
notify pgrst, 'reload schema';
