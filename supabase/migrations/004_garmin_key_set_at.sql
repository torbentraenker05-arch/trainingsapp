-- Zeitpunkt, wann der Garmin-Schlüssel eingetragen wurde
alter table public.garmin_keys add column key_set_at timestamptz;
grant select (key_set_at) on public.garmin_keys to authenticated;
