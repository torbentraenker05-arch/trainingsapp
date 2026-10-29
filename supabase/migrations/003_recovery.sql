-- Pulserholung aus FIT-Dateien
alter table public.workouts add column recovery jsonb, add column fit_checked boolean not null default false;
