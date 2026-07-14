create table if not exists public.app_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.app_settings enable row level security;

comment on table public.app_settings is
  'Server-only application settings accessed with the Supabase service role.';
