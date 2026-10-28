// Datums-, Format- und DOM-Helfer
export const MONTHS = ["Januar","Februar","März","April","Mai","Juni","Juli","August","September","Oktober","November","Dezember"];
export const WD = ["Sonntag","Montag","Dienstag","Mittwoch","Donnerstag","Freitag","Samstag"];
export const WD_SHORT = ["Mo","Di","Mi","Do","Fr","Sa","So"]; // Index 0 = Montag

export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];
export const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
export const pad = n => String(n).padStart(2, "0");
export const ymd = d => d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
export const parse = s => { const [a, b, c] = String(s).split("-").map(Number); return new Date(a, b - 1, c); };
export const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
export const addDaysStr = (s, n) => ymd(addDays(parse(s), n));
export const mondayOf = d => addDays(new Date(d.getFullYear(), d.getMonth(), d.getDate()), -((d.getDay() + 6) % 7));
export const isoDow = d => ((d.getDay() + 6) % 7) + 1; // 1 = Montag … 7 = Sonntag
export const todayStr = () => ymd(new Date());
export const daysBetween = (a, b) => Math.round((parse(b) - parse(a)) / 864e5);
export function isoWeek(d) {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = t.getUTCDay() || 7; t.setUTCDate(t.getUTCDate() + 4 - day);
  const y0 = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return Math.ceil(((t - y0) / 864e5 + 1) / 7);
}
export const longDate = s => { const d = parse(s); return WD[d.getDay()] + ", " + d.getDate() + ". " + MONTHS[d.getMonth()]; };
export const shortDate = s => { const d = parse(s); return d.getDate() + "." + (d.getMonth() + 1) + "."; };

export const fmtKm = n => (Math.round(n * 10) / 10).toLocaleString("de-DE", { maximumFractionDigits: 1 });
export function fmtDur(min) { min = Math.round(min || 0); if (min < 60) return min + " min"; const h = Math.floor(min / 60), m = min % 60; return h + " h" + (m ? " " + pad(m) : ""); }
export function fmtDurShort(min) { min = Math.round(min || 0); return Math.floor(min / 60) + ":" + pad(min % 60); }
// Sekunden pro km → "4:35"
export function fmtPace(secPerKm) { if (!secPerKm || !isFinite(secPerKm)) return "–"; let m = Math.floor(secPerKm / 60), s = Math.round(secPerKm - m * 60); if (s === 60) { m++; s = 0; } return m + ":" + pad(s); }
// "45:00" oder "1:39:30" → Sekunden
export function parseTime(t) {
  const p = String(t || "").trim().split(":").map(Number);
  if (!p.length || p.some(isNaN)) return null;
  return p.length === 3 ? p[0] * 3600 + p[1] * 60 + p[2] : p.length === 2 ? p[0] * 60 + p[1] : p[0] * 60;
}
export function fmtTime(sec) { sec = Math.round(sec); const h = Math.floor(sec / 3600), m = Math.floor(sec % 3600 / 60), s = sec % 60; return h ? h + ":" + pad(m) + ":" + pad(s) : m + ":" + pad(s); }
export const num = v => { const n = parseFloat(String(v ?? "").replace(",", ".")); return isFinite(n) ? n : null; };

export function newId() { try { return crypto.randomUUID().replace(/-/g, "").slice(0, 20); } catch { return Date.now().toString(36) + Math.random().toString(36).slice(2, 10); } }
export const lsGet = (k, f) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : f; } catch { return f; } };
export const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* voll oder gesperrt */ } };
export const clone = o => JSON.parse(JSON.stringify(o));

export function toast(t) {
  const el = $("#toast"); el.textContent = t; el.hidden = false;
  clearTimeout(toast._t); toast._t = setTimeout(() => el.hidden = true, 2800);
}
