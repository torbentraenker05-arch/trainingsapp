// Gemeinsame Strava-Logik für die Edge Functions: Tokens, Import, Zuordnung zu geplanten Einheiten.
import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2.45.4";

export const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

export function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
}

export function admin(): SupabaseClient {
  return createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false },
  });
}

// Standard-Zuordnung Strava-Sportart → App-Sportart. Der Nutzer kann sie im Profil überschreiben (settings.data.stravaMap).
export const DEFAULT_MAP: Record<string, string> = {
  Run: "run", TrailRun: "run", VirtualRun: "run",
  Ride: "bike", VirtualRide: "bike", GravelRide: "bike", MountainBikeRide: "bike", EBikeRide: "bike", EMountainBikeRide: "bike", Velomobile: "bike", Handcycle: "bike",
  Swim: "swim",
  Rowing: "row", VirtualRow: "row",
  StairStepper: "stepper",
  WeightTraining: "gym", Crossfit: "gym",
  Yoga: "stretch", Pilates: "stretch",
  Soccer: "football",
  NordicSki: "skierg",
};

const KM_SPORTS = new Set(["run", "bike", "swim", "row", "skierg", "football", "other"]);

export function trimp(durMin: number, avgHr: number | null, hrRest: number, hrMax: number) {
  if (!avgHr || !durMin || hrMax <= hrRest) return null;
  const r = Math.min(1, Math.max(0, (avgHr - hrRest) / (hrMax - hrRest)));
  return Math.round(durMin * r * 0.64 * Math.exp(1.92 * r));
}

type App = { client_id: string; client_secret: string };

export async function getApp(db: SupabaseClient, userId: string): Promise<App> {
  const { data, error } = await db.from("strava_apps").select("client_id,client_secret").eq("user_id", userId).single();
  if (error || !data) throw new Error("Strava-App ist noch nicht eingerichtet");
  return data as App;
}

// Gibt ein gültiges Access-Token zurück und erneuert es bei Bedarf.
export async function accessToken(db: SupabaseClient, userId: string): Promise<string> {
  const { data: tok, error } = await db.from("strava_tokens").select("*").eq("user_id", userId).single();
  if (error || !tok) throw new Error("Strava ist nicht verbunden");
  if (tok.expires_at > Math.floor(Date.now() / 1000) + 120) return tok.access_token;
  const app = await getApp(db, userId);
  const r = await fetch("https://www.strava.com/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ client_id: app.client_id, client_secret: app.client_secret, grant_type: "refresh_token", refresh_token: tok.refresh_token }),
  });
  if (!r.ok) throw new Error("Strava-Token konnte nicht erneuert werden (" + r.status + ")");
  const t = await r.json();
  await db.from("strava_tokens").update({ access_token: t.access_token, refresh_token: t.refresh_token, expires_at: t.expires_at }).eq("user_id", userId);
  return t.access_token;
}

async function userSettings(db: SupabaseClient, userId: string) {
  const { data } = await db.from("settings").select("data").eq("user_id", userId).maybeSingle();
  const s = (data?.data ?? {}) as Record<string, any>;
  return {
    map: { ...DEFAULT_MAP, ...(s.stravaMap ?? {}) } as Record<string, string>,
    hrRest: Number(s.zones?.hrRest) || 60,
    hrMax: Number(s.zones?.hrMax) || 190,
  };
}

function newId() {
  return crypto.randomUUID().replace(/-/g, "").slice(0, 20);
}

// Importiert eine Strava-Aktivität: aktualisiert eine bereits importierte, hakt sonst eine passende
// geplante Einheit ab oder legt eine ungeplante Einheit an. Gibt zurück, was passiert ist.
export async function importActivity(db: SupabaseClient, userId: string, a: any, cfg?: Awaited<ReturnType<typeof userSettings>>) {
  cfg = cfg ?? (await userSettings(db, userId));
  const stype = String(a.sport_type || a.type || "Workout");
  const sport = cfg.map[stype] || "other";
  const date = String(a.start_date_local || a.start_date).slice(0, 10);
  const dur = Math.round(((a.moving_time || a.elapsed_time || 0) / 60) * 10) / 10;
  const avgHr = a.average_heartrate ? Math.round(a.average_heartrate) : null;
  const data = {
    date,
    sport,
    status: "done",
    distance_km: KM_SPORTS.has(sport) && a.distance ? Math.round(a.distance / 10) / 100 : null,
    duration_min: dur || null,
    avg_hr: avgHr,
    max_hr: a.max_heartrate ? Math.round(a.max_heartrate) : null,
    elev_m: a.total_elevation_gain ?? null,
    trimp: trimp(dur, avgHr, cfg.hrRest, cfg.hrMax),
    strava_id: a.id,
    source: "strava",
    locked: true,
    deleted: false,
  };

  const { data: existing } = await db.from("workouts").select("id").eq("user_id", userId).eq("strava_id", a.id).maybeSingle();
  if (existing) {
    await db.from("workouts").update(data).eq("id", existing.id);
    return "updated";
  }

  const { data: planned } = await db.from("workouts").select("id,slot")
    .eq("user_id", userId).eq("date", date).eq("sport", sport).eq("status", "planned").eq("deleted", false)
    .is("strava_id", null).order("slot", { ascending: true, nullsFirst: false }).limit(1);
  if (planned && planned.length) {
    await db.from("workouts").update(data).eq("id", planned[0].id);
    return "matched";
  }

  await db.from("workouts").insert({ id: newId(), user_id: userId, title: a.name ? String(a.name).slice(0, 120) : null, ...data });
  return "created";
}

// Holt alle Aktivitäten seit dem letzten Sync (beim ersten Mal: die letzten `days` Tage).
export async function syncUser(db: SupabaseClient, userId: string, days = 60) {
  const token = await accessToken(db, userId);
  const { data: tok } = await db.from("strava_tokens").select("last_sync").eq("user_id", userId).single();
  const since = tok?.last_sync ? new Date(tok.last_sync).getTime() / 1000 - 3 * 86400 : Date.now() / 1000 - days * 86400;
  const cfg = await userSettings(db, userId);
  const stats = { updated: 0, matched: 0, created: 0 };
  for (let page = 1; page <= 10; page++) {
    const r = await fetch(`https://www.strava.com/api/v3/athlete/activities?after=${Math.floor(since)}&per_page=100&page=${page}`, {
      headers: { Authorization: "Bearer " + token },
    });
    if (!r.ok) throw new Error("Strava-Abruf fehlgeschlagen (" + r.status + ")");
    const list = await r.json();
    for (const a of list) stats[(await importActivity(db, userId, a, cfg)) as keyof typeof stats]++;
    if (list.length < 100) break;
  }
  await db.from("strava_tokens").update({ last_sync: new Date().toISOString() }).eq("user_id", userId);
  return stats;
}
