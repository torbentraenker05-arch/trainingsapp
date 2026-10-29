// Garmin Connect Personal API: Token aus dem persönlichen Schlüssel, Aktivitäten lesen und importieren.
import { SupabaseClient } from "npm:@supabase/supabase-js@2.45.4";
import { trimp } from "./strava.ts";
import { Decoder, Stream } from "npm:@garmin/fitsdk@21.217.0";
import { unzipSync } from "npm:fflate@0.8.2";
import { analyzeRecovery } from "./fit.js";

export const GARMIN_BASE = "https://personal.connectapi.garmin.com";
const TOKEN_PATH = "/personalapitoken-service/personal-api/personal-api-key/token";
const KM_SPORTS = new Set(["run", "bike", "swim", "row", "skierg", "football", "other"]);
// Einträge ohne Training (z. B. Unfallerkennung der Uhr)
const SKIP = new Set(["incident_detected", "breathwork", "sleep"]);

// Garmin activityType.typeKey → App-Sportart (Überschreibungen in settings.data.garminMap)
export function guessSport(key: string): string {
  const k = key.toLowerCase();
  if (/skierg|ski_erg/.test(k)) return "skierg";
  if (/run/.test(k)) return "run";
  if (/cycl|bik|ride|spin/.test(k)) return "bike";
  if (/swim/.test(k)) return "swim";
  if (/row/.test(k)) return "row";
  if (/stair|stepper/.test(k)) return "stepper";
  if (/strength|weight/.test(k)) return "gym";
  if (/soccer|football/.test(k)) return "football";
  if (/yoga|pilates|stretch|mobility/.test(k)) return "stretch";
  if (/jump|plyo/.test(k)) return "plyo";
  return "other";
}

class GarminError extends Error {
  constructor(public status: number, msg: string) { super(msg); }
}

function jwtExp(token: string): number {
  try {
    const p = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    const claims = JSON.parse(atob(p + "=".repeat((4 - p.length % 4) % 4)));
    if (typeof claims.exp === "number") return claims.exp;
  } catch { /* kein JWT */ }
  return Math.floor(Date.now() / 1000) + 23 * 3600;
}

export async function exchangeKey(apiKey: string) {
  const r = await fetch(GARMIN_BASE + TOKEN_PATH, { method: "POST", headers: { Accept: "*/*", Authorization: "ApiKey " + apiKey } });
  const body = (await r.text()).trim();
  if (!r.ok) throw new GarminError(r.status, r.status === 401 || r.status === 403 ? "Garmin-Schlüssel ungültig oder abgelaufen – bitte in Garmin Connect einen neuen erstellen" : "Garmin-Anmeldung fehlgeschlagen (" + r.status + ")");
  const token = body.startsWith("{") ? (JSON.parse(body).access_token ?? JSON.parse(body).token) : body;
  return { token, exp: jwtExp(token) };
}

async function getToken(db: SupabaseClient, userId: string, force = false): Promise<string> {
  const { data: k } = await db.from("garmin_keys").select("api_key,access_token,token_expires_at").eq("user_id", userId).maybeSingle();
  if (!k) throw new Error("Garmin ist nicht verbunden");
  if (!force && k.access_token && k.token_expires_at > Math.floor(Date.now() / 1000) + 300) return k.access_token;
  const t = await exchangeKey(k.api_key);
  await db.from("garmin_keys").update({ access_token: t.token, token_expires_at: t.exp }).eq("user_id", userId);
  return t.token;
}

async function garminGet(db: SupabaseClient, userId: string, path: string, query: Record<string, string | number>) {
  const url = GARMIN_BASE + path + "?" + new URLSearchParams(Object.entries(query).map(([k, v]) => [k, String(v)]));
  let token = await getToken(db, userId);
  for (let attempt = 0; attempt < 3; attempt++) {
    const r = await fetch(url, { headers: { Accept: "application/json", Authorization: "Bearer " + token } });
    if (r.ok) { const t = await r.text(); return t.trim() ? JSON.parse(t) : null; }
    if (r.status === 401 && attempt === 0) { token = await getToken(db, userId, true); continue; }
    if (r.status === 429 || r.status >= 502) { await new Promise((res) => setTimeout(res, 1500 * (attempt + 1))); continue; }
    throw new GarminError(r.status, "Garmin-Abruf fehlgeschlagen (" + r.status + ")");
  }
  throw new Error("Garmin antwortet gerade nicht – später nochmal versuchen");
}

async function garminBytes(db: SupabaseClient, userId: string, path: string): Promise<Uint8Array> {
  let token = await getToken(db, userId);
  // Garmin antwortet je nach Accept-Header mit 406 – nacheinander probieren
  const accepts = ["*/*", "application/octet-stream", "application/zip"];
  for (let attempt = 0, ai = 0; attempt < 5 && ai < accepts.length; attempt++) {
    const r = await fetch(GARMIN_BASE + path, { headers: { Accept: accepts[ai], Authorization: "Bearer " + token } });
    if (r.ok) return new Uint8Array(await r.arrayBuffer());
    if (r.status === 401) { token = await getToken(db, userId, true); continue; }
    if (r.status === 406) { ai++; continue; }
    throw new GarminError(r.status, "FIT-Download fehlgeschlagen (" + r.status + "): " + (await r.text()).slice(0, 200));
  }
  throw new Error("FIT-Download fehlgeschlagen");
}

// Läufe der letzten 60 Tage: FIT laden und Erholung in den Pausen-Runden messen (max. 8 pro Abgleich)
async function analyzeRecent(db: SupabaseClient, userId: string, thr: number) {
  const since = new Date(Date.now() - 60 * 864e5).toISOString().slice(0, 10);
  const { data: list } = await db.from("workouts").select("id,garmin_id")
    .eq("user_id", userId).eq("sport", "run").eq("fit_checked", false).eq("deleted", false)
    .not("garmin_id", "is", null).gte("date", since).order("date", { ascending: false }).limit(8);
  let n = 0;
  for (const w of list || []) {
    try {
      const bytes = await garminBytes(db, userId, "/download-service/files/activity/" + w.garmin_id);
      const rec = analyzeRecovery(bytes, { Decoder, Stream, unzipSync }, thr);
      await db.from("workouts").update({ fit_checked: true, recovery: rec.values.length ? rec : null }).eq("id", w.id);
      if (rec.values.length) n++;
    } catch (e) {
      console.warn("fit", w.garmin_id, (e as Error).message);
      if ((e as any).status === 404) await db.from("workouts").update({ fit_checked: true }).eq("id", w.id);
    }
  }
  return n;
}

function newId() { return crypto.randomUUID().replace(/-/g, "").slice(0, 20); }

type Cfg = { map: Record<string, string>; hrRest: number; hrMax: number; recoveryHr: number };
async function settingsOf(db: SupabaseClient, userId: string): Promise<Cfg> {
  const { data } = await db.from("settings").select("data").eq("user_id", userId).maybeSingle();
  const s = (data?.data ?? {}) as Record<string, any>;
  return { map: s.garminMap ?? {}, hrRest: Number(s.zones?.hrRest) || 60, hrMax: Number(s.zones?.hrMax) || 190, recoveryHr: Number(s.zones?.recoveryHr) || 130 };
}

// Importiert eine Garmin-Aktivität: aktualisiert eine bereits importierte, übernimmt einen passenden
// CSV-Eintrag, hakt eine passende geplante Einheit ab oder legt eine neue Einheit an.
export async function importGarmin(db: SupabaseClient, userId: string, a: any, cfg: Cfg) {
  const typeKey = String(a.activityType?.typeKey || "other");
  if (SKIP.has(typeKey)) return "skipped";
  const sport = cfg.map[typeKey] || guessSport(typeKey);
  const date = String(a.startTimeLocal || a.startTimeGMT || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return "skipped";
  const dur = Math.round(((a.duration || a.movingDuration || a.elapsedDuration || 0) / 60) * 10) / 10;
  const avgHr = a.averageHR ? Math.round(a.averageHR) : null;
  const data = {
    date, sport, status: "done",
    distance_km: KM_SPORTS.has(sport) && a.distance ? Math.round(a.distance / 10) / 100 : null,
    duration_min: dur || null,
    avg_hr: avgHr,
    max_hr: a.maxHR ? Math.round(a.maxHR) : null,
    elev_m: a.elevationGain != null ? Math.round(a.elevationGain) : null,
    trimp: trimp(dur, avgHr, cfg.hrRest, cfg.hrMax),
    garmin_id: a.activityId,
    source: "garmin", locked: true, deleted: false,
  };

  const { data: existing } = await db.from("workouts").select("id").eq("user_id", userId).eq("garmin_id", a.activityId).maybeSingle();
  if (existing) { await db.from("workouts").update(data).eq("id", existing.id); return "updated"; }

  // Schon per CSV (oder von Hand) eingetragen? Gleicher Tag, gleiche Sportart, Dauer ±3 min
  const { data: same } = await db.from("workouts").select("id,duration_min")
    .eq("user_id", userId).eq("date", date).eq("sport", sport).eq("status", "done").eq("deleted", false).is("garmin_id", null);
  const dup = (same || []).find((w: any) => Math.abs((Number(w.duration_min) || 0) - dur) <= 3);
  if (dup) { await db.from("workouts").update(data).eq("id", dup.id); return "linked"; }

  const { data: planned } = await db.from("workouts").select("id")
    .eq("user_id", userId).eq("date", date).eq("sport", sport).eq("status", "planned").eq("deleted", false)
    .order("slot", { ascending: true, nullsFirst: false }).limit(1);
  if (planned && planned.length) { await db.from("workouts").update(data).eq("id", planned[0].id); return "matched"; }

  await db.from("workouts").insert({ id: newId(), user_id: userId, title: a.activityName ? String(a.activityName).slice(0, 120) : null, ...data });
  return "created";
}

const ymd = (d: Date) => d.toISOString().slice(0, 10);

// Holt Aktivitäten seit dem letzten Abgleich (beim ersten Mal: die letzten `days` Tage)
export async function syncGarmin(db: SupabaseClient, userId: string, days = 120) {
  const { data: k } = await db.from("garmin_keys").select("last_sync").eq("user_id", userId).maybeSingle();
  if (!k) throw new Error("Garmin ist nicht verbunden");
  const from = k.last_sync ? new Date(new Date(k.last_sync).getTime() - 3 * 864e5) : new Date(Date.now() - days * 864e5);
  const to = new Date(Date.now() + 864e5);
  const cfg = await settingsOf(db, userId);
  const stats: Record<string, number> = { created: 0, matched: 0, linked: 0, updated: 0, skipped: 0, analyzed: 0 };
  try {
    for (let page = 0; page < 20; page++) {
      const list = (await garminGet(db, userId, "/activitylist-service/activities/search/activities", { start: page * 100, limit: 100, startDate: ymd(from), endDate: ymd(to) })) ?? [];
      for (const a of list) stats[await importGarmin(db, userId, a, cfg)]++;
      if (list.length < 100) break;
    }
    stats.analyzed = await analyzeRecent(db, userId, cfg.recoveryHr);
    await db.from("garmin_keys").update({ last_sync: new Date().toISOString(), last_error: null }).eq("user_id", userId);
  } catch (e) {
    await db.from("garmin_keys").update({ last_error: (e as Error).message }).eq("user_id", userId);
    throw e;
  }
  return stats;
}
