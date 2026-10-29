// Datenhaltung: lokaler Cache + Offline-Warteschlange, Abgleich mit Supabase
import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm";
import { SUPABASE_URL, SUPABASE_KEY } from "./config.js";
import { lsGet, lsSet, newId, clone } from "./util.js";
import { DEFAULT_SETTINGS, DEFAULT_RULES } from "./sports.js";

export const sb = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: true, autoRefreshToken: true, storageKey: "ta_auth" } });

// Spaltennamen App (camelCase) ↔ Datenbank (snake_case)
const W_COLS = { id: "id", date: "date", slot: "slot", sport: "sport", focus: "focus", status: "status", title: "title", note: "note",
  distanceKm: "distance_km", durationMin: "duration_min", avgHr: "avg_hr", maxHr: "max_hr", elevM: "elev_m", trimp: "trimp", rpe: "rpe",
  intervals: "intervals", target: "target", isKey: "is_key", hard: "hard", locked: "locked", source: "source", planId: "plan_id",
  garminId: "garmin_id", recovery: "recovery", deleted: "deleted", updatedAt: "updated_at" };
const P_COLS = { id: "id", name: "name", start: "start_date", end: "end_date", config: "config", active: "active", deleted: "deleted", createdAt: "created_at", updatedAt: "updated_at" };
const NUMERIC = new Set(["distanceKm", "durationMin", "elevM", "trimp"]);

function toDb(row, cols) {
  const o = {};
  for (const [k, c] of Object.entries(cols)) if (k !== "updatedAt" && k !== "createdAt" && row[k] !== undefined) o[c] = row[k];
  return o;
}
function fromDb(row, cols) {
  const o = {};
  for (const [k, c] of Object.entries(cols)) if (row[c] !== undefined) o[k] = NUMERIC.has(k) && row[c] != null ? Number(row[c]) : row[c];
  if (o.garminId != null) o.garminId = Number(o.garminId);
  return o;
}

export const store = {
  uid: null,
  workouts: new Map(),
  plans: new Map(),
  settings: clone(DEFAULT_SETTINGS),
  garmin: null,       // {last_sync,last_error} oder null
  outbox: {},         // "w:<id>" | "p:<id>" | "s" → Datensatz
  lastPull: null,
  online: navigator.onLine,
  syncing: false,
  listeners: new Set(),

  on(fn) { this.listeners.add(fn); },
  emit() { for (const fn of this.listeners) fn(); },

  key() { return "ta_cache_" + this.uid; },
  load(uid) {
    this.uid = uid;
    const c = lsGet(this.key(), null);
    this.workouts = new Map((c?.workouts || []).map(w => [w.id, w]));
    this.plans = new Map((c?.plans || []).map(p => [p.id, p]));
    this.settings = mergeSettings(c?.settings);
    this.outbox = c?.outbox || {};
    this.lastPull = c?.lastPull || null;
    this.garmin = c?.garmin || null;
  },
  persist() {
    lsSet(this.key(), { workouts: [...this.workouts.values()], plans: [...this.plans.values()], settings: this.settings, outbox: this.outbox, lastPull: this.lastPull, garmin: this.garmin });
  },
  pending() { return Object.keys(this.outbox).length; },

  // ---------- Schreiben (lokal sofort, Server über Warteschlange) ----------
  putWorkout(w) {
    const row = { ...w, id: w.id || newId(), updatedAt: new Date().toISOString() };
    this.workouts.set(row.id, row);
    this.outbox["w:" + row.id] = row;
    this.persist(); this.emit(); this.flushSoon();
    return row;
  },
  putWorkouts(list) {
    const now = new Date().toISOString();
    for (const w of list) {
      const row = { ...w, id: w.id || newId(), updatedAt: now };
      this.workouts.set(row.id, row);
      this.outbox["w:" + row.id] = row;
    }
    this.persist(); this.emit(); this.flushSoon();
  },
  removeWorkout(id) {
    const w = this.workouts.get(id); if (!w) return;
    this.putWorkout({ ...w, deleted: true });
  },
  putPlan(p) {
    const row = { ...p, updatedAt: new Date().toISOString() };
    this.plans.set(row.id, row);
    this.outbox["p:" + row.id] = row;
    this.persist(); this.emit(); this.flushSoon();
    return row;
  },
  saveSettings(patch) {
    this.settings = mergeSettings({ ...this.settings, ...patch });
    this.outbox["s"] = this.settings;
    this.persist(); this.emit(); this.flushSoon();
  },

  // ---------- Lesen ----------
  allWorkouts() { return [...this.workouts.values()].filter(w => !w.deleted); },
  activePlan() { return [...this.plans.values()].filter(p => p.active && !p.deleted).sort((a, b) => (b.createdAt || b.updatedAt || "").localeCompare(a.createdAt || a.updatedAt || ""))[0] || null; },

  // ---------- Abgleich ----------
  flushSoon() { clearTimeout(this._ft); this._ft = setTimeout(() => this.sync(), 400); },
  async sync() {
    if (this.syncing || !this.uid) return;
    if (!navigator.onLine) { this.online = false; this.emit(); return; }
    this.syncing = true; this.emit();
    try {
      await this.push();
      await this.pull();
      this.online = true;
    } catch (e) {
      console.warn("sync", e);
      this.online = false;
    } finally {
      this.syncing = false; this.persist(); this.emit();
    }
  },
  async push() {
    const entries = Object.entries(this.outbox);
    if (!entries.length) return;
    const ws = entries.filter(([k]) => k.startsWith("w:")).map(([, r]) => toDb(r, W_COLS));
    const ps = entries.filter(([k]) => k.startsWith("p:")).map(([, r]) => toDb(r, P_COLS));
    const sentinel = { ...this.outbox };
    if (ps.length) { const { error } = await sb.from("plans").upsert(ps); if (error) throw error; }
    for (let i = 0; i < ws.length; i += 300) {
      const { error } = await sb.from("workouts").upsert(ws.slice(i, i + 300)); if (error) throw error;
    }
    if (this.outbox.s) { const { error } = await sb.from("settings").upsert({ user_id: this.uid, data: this.outbox.s }); if (error) throw error; }
    // Nur entfernen, was seit dem Senden nicht erneut geändert wurde
    for (const [k, v] of Object.entries(sentinel)) if (this.outbox[k] === v) delete this.outbox[k];
  },
  async pull() {
    const since = this.lastPull ? new Date(new Date(this.lastPull).getTime() - 5000).toISOString() : "1970-01-01T00:00:00Z";
    let maxTs = this.lastPull;
    for (let from = 0; ; from += 1000) {
      const { data, error } = await sb.from("workouts").select("*").gt("updated_at", since).order("updated_at").range(from, from + 999);
      if (error) throw error;
      for (const r of data) {
        const w = fromDb(r, W_COLS);
        if (!this.outbox["w:" + w.id]) this.workouts.set(w.id, w);
        if (!maxTs || r.updated_at > maxTs) maxTs = r.updated_at;
      }
      if (data.length < 1000) break;
    }
    const { data: plans, error: pe } = await sb.from("plans").select("*").gt("updated_at", since);
    if (pe) throw pe;
    for (const r of plans) { const p = fromDb(r, P_COLS); if (!this.outbox["p:" + p.id]) this.plans.set(p.id, p); if (!maxTs || r.updated_at > maxTs) maxTs = r.updated_at; }
    if (!this.outbox.s) {
      const { data: s } = await sb.from("settings").select("data").eq("user_id", this.uid).maybeSingle();
      if (s) this.settings = mergeSettings(s.data);
    }
    const { data: gk } = await sb.from("garmin_keys").select("last_sync,last_error,created_at").eq("user_id", this.uid).maybeSingle();
    this.garmin = gk || null;
    this.lastPull = maxTs;
  },
  async fullResync() { this.lastPull = null; await this.sync(); },
};

function mergeSettings(s) {
  const d = clone(DEFAULT_SETTINGS);
  s = s || {};
  return { ...d, ...s, zones: { ...d.zones, ...(s.zones || {}) }, rules: { ...DEFAULT_RULES, ...(s.rules || {}) }, sports: { ...(s.sports || {}) }, dismissed: s.dismissed || [] };
}

export const callGarmin = (action, extra) => callFn("garmin", action, extra);

// Garmin automatisch abgleichen, wenn der letzte Abgleich länger als 30 min her ist
export async function autoGarmin() {
  const g = store.garmin;
  if (!g || !navigator.onLine || store._garminBusy) return;
  if (g.last_sync && Date.now() - new Date(g.last_sync).getTime() < 30 * 60e3) return;
  store._garminBusy = true;
  try { await callGarmin("sync"); await store.sync(); } catch (e) { console.warn("garmin", e); } finally { store._garminBusy = false; }
}

async function callFn(fn, action, extra = {}) {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) throw new Error("Nicht angemeldet");
  const r = await fetch(SUPABASE_URL + "/functions/v1/" + fn, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + session.access_token, apikey: SUPABASE_KEY },
    body: JSON.stringify({ action, ...extra }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.error) throw new Error(j.error || "Fehler " + r.status);
  return j;
}

window.addEventListener("online", () => store.sync());
window.addEventListener("offline", () => { store.online = false; store.emit(); });
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") store.sync().then(autoGarmin); });
setInterval(() => { if (document.visibilityState === "visible") store.sync(); }, 60000);
