-- auto-form Supabase schema
-- Run this once in Supabase Dashboard > SQL Editor.

create table if not exists public.companies (
  id                    text primary key,
  name                  text not null default '',
  hp_url                text not null default '',
  form_url              text not null default '',
  normalized_form_url   text not null default '',
  normalized_hp_url     text not null default '',
  phone                 text not null default '',
  email                 text not null default '',
  address               text not null default '',
  industry              text not null default '',
  area                  text not null default '',
  form_type             text not null default '',
  status                text not null default '未送信',
  notes                 text not null default '',
  project_id            text not null default '',
  run_id                text not null default '',
  collected_at          text not null default '',
  imported_from_sheets  boolean not null default false
);

create index if not exists idx_companies_normalized_form_url on public.companies(normalized_form_url);
create index if not exists idx_companies_normalized_hp_url on public.companies(normalized_hp_url);
create index if not exists idx_companies_project_id on public.companies(project_id);
create index if not exists idx_companies_run_id on public.companies(run_id);
create index if not exists idx_companies_industry on public.companies(industry);
create index if not exists idx_companies_area on public.companies(area);
create index if not exists idx_companies_status on public.companies(status);
create index if not exists idx_companies_form_type on public.companies(form_type);
create index if not exists idx_companies_collected_at on public.companies(collected_at desc);

create table if not exists public.projects (
  id           text primary key,
  name         text not null,
  description  text,
  created_at   text not null,
  run_ids      jsonb not null default '[]'::jsonb,
  sheets_id    text
);

create table if not exists public.project_runs (
  id                  text primary key,
  project_id          text not null references public.projects(id) on delete cascade,
  label               text not null,
  created_at          text not null,
  search_target       jsonb not null default '{}'::jsonb,
  status              text not null default 'pending',
  run_type            text,
  parent_run_id       text,
  child_run_ids       jsonb,
  n8n_execution_id    text,
  items_written       integer,
  completed_at        text,
  estimated_cost_usd  numeric,
  tokens_input        integer,
  tokens_output       integer,
  raw_search_count    integer,
  results             jsonb,
  error               text
);

create index if not exists idx_project_runs_project_id on public.project_runs(project_id);
create index if not exists idx_project_runs_parent_run_id on public.project_runs(parent_run_id);

create table if not exists public.queue_jobs (
  id            text primary key,
  run_id        text not null,
  project_id    text not null,
  status        text not null default 'waiting',
  params        jsonb not null default '{}'::jsonb,
  created_at    text not null,
  started_at    text,
  completed_at  text,
  error         text
);

create index if not exists idx_queue_jobs_status on public.queue_jobs(status);

create table if not exists public.presets (
  id             text primary key,
  name           text not null,
  created_at     text not null,
  search_target  jsonb not null default '{}'::jsonb
);

alter table public.companies enable row level security;
alter table public.projects enable row level security;
alter table public.project_runs enable row level security;
alter table public.queue_jobs enable row level security;
alter table public.presets enable row level security;

-- Make newly created tables visible to the REST API immediately.
notify pgrst, 'reload schema';
