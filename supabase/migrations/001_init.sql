-- Schema der Trainings-App (so in Supabase-Projekt todpltoqjiozzdelower angewendet)
create table public.settings (
  user_id uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
create table public.plans (
  id text primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text, start_date date not null, end_date date not null,
  config jsonb not null default '{}'::jsonb, active boolean not null default true,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  deleted boolean not null default false
);
create index plans_user_idx on public.plans(user_id, updated_at);
create table public.workouts (
  id text primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  date date not null, slot smallint, sport text not null, focus text,
  status text not null default 'done' check (status in ('planned','done','missed')),
  title text, note text, distance_km numeric, duration_min numeric, avg_hr smallint, max_hr smallint,
  elev_m numeric, trimp numeric, rpe smallint, intervals jsonb, target jsonb,
  is_key boolean not null default false, hard boolean not null default false, locked boolean not null default false,
  source text not null default 'manual', plan_id text, strava_id bigint,
  updated_at timestamptz not null default now(), deleted boolean not null default false
);
create index workouts_user_idx on public.workouts(user_id, updated_at);
create index workouts_user_date_idx on public.workouts(user_id, date);
create unique index workouts_strava_uidx on public.workouts(user_id, strava_id) where strava_id is not null;
create table public.strava_tokens (
  user_id uuid primary key references auth.users(id) on delete cascade,
  athlete_id bigint unique not null, athlete_name text,
  access_token text not null, refresh_token text not null, expires_at bigint not null,
  last_sync timestamptz, created_at timestamptz not null default now()
);
create table public.strava_oauth_states (
  state text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  return_to text,
  created_at timestamptz not null default now()
);
create table public.strava_apps (
  user_id uuid primary key references auth.users(id) on delete cascade,
  client_id text not null, client_secret text not null, verify_token text not null,
  subscription_id bigint, updated_at timestamptz not null default now()
);

alter table public.settings enable row level security;
alter table public.plans enable row level security;
alter table public.workouts enable row level security;
alter table public.strava_tokens enable row level security;
alter table public.strava_oauth_states enable row level security;
alter table public.strava_apps enable row level security;

create policy "own settings" on public.settings for all to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "own plans" on public.plans for all to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "own workouts" on public.workouts for all to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

-- Tokens und Secrets: die App sieht nur den Verbindungsstatus
revoke all on public.strava_tokens from anon, authenticated;
grant select (user_id, athlete_id, athlete_name, last_sync) on public.strava_tokens to authenticated;
create policy "own strava status" on public.strava_tokens for select to authenticated using ((select auth.uid()) = user_id);
revoke all on public.strava_apps from anon, authenticated;
grant select (user_id, client_id, subscription_id) on public.strava_apps to authenticated;
create policy "own strava app status" on public.strava_apps for select to authenticated using ((select auth.uid()) = user_id);
revoke all on public.strava_oauth_states from anon, authenticated;

create or replace function public.touch_updated_at() returns trigger language plpgsql set search_path = '' as $$
begin new.updated_at = now(); return new; end $$;
create trigger settings_touch before insert or update on public.settings for each row execute function public.touch_updated_at();
create trigger plans_touch before insert or update on public.plans for each row execute function public.touch_updated_at();
create trigger workouts_touch before insert or update on public.workouts for each row execute function public.touch_updated_at();
