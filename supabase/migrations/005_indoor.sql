-- Laufband/Indoor: Pace ohne GPS zählt nicht für Pace-Zonen-Vorschläge
alter table public.workouts add column indoor boolean not null default false;
