-- Garmin Connect Personal API
alter table public.workouts add column garmin_id bigint;
create unique index workouts_garmin_uidx on public.workouts(user_id, garmin_id) where garmin_id is not null;
create table public.garmin_keys (
  user_id uuid primary key references auth.users(id) on delete cascade,
  api_key text not null, access_token text, token_expires_at bigint,
  last_sync timestamptz, last_error text, created_at timestamptz not null default now()
);
alter table public.garmin_keys enable row level security;
revoke all on public.garmin_keys from anon, authenticated;
grant select (user_id, last_sync, last_error, created_at) on public.garmin_keys to authenticated;
create policy "own garmin status" on public.garmin_keys for select to authenticated using ((select auth.uid()) = user_id);
