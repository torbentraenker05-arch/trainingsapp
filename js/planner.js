// Plan-Algorithmus: Periodisierung, Umfangssteuerung und Verteilung der Einheiten auf die Wochentage
import { ymd, parse, addDays, mondayOf, fmtPace, fmtKm, newId, daysBetween, parseTime, fmtTime } from "./util.js";
import { paceZones, hrZones, fmtRange, loadOf, ENDURANCE, FOCUS, BASE_SPORTS } from "./sports.js";

const RACE_CAP = { 5: 45, 10: 55, 21.1: 70, 42.2: 90 };
export const RACES = [{ km: 5, label: "5 km" }, { km: 10, label: "10 km" }, { km: 21.1, label: "Halbmarathon" }, { km: 42.2, label: "Marathon" }];
export const CROSS_SPORTS = ["bike", "row", "stepper", "skierg", "swim"];
export const INTERVAL_TYPES = {
  i400: "10×400 m", i600: "8×600 m", i800: "6×800 m", i1000: "5×1000 m", i1600: "4×1,6 km", i2000: "3×2 km",
  pyramid: "Pyramide", hills: "Bergintervalle", threshold: "Schwelle",
};

// ---------- Klassifizierung ----------
// HE = harte Ausdauer (Qualität, langer Lauf, Fußball, Wettkampf), HS = harte Kraft (Beine, Plyo, Ganzkörper)
export function kindOf(w) {
  if (w.sport === "football" || w.target?.kind === "race") return "HE";
  if (w.sport === "run" && w.hard) return "HE";
  if (w.sport === "run" && w.isKey) return "MED"; // z. B. kurzer langer Lauf: wichtig, aber nicht hart
  if (w.sport === "plyo" || (w.sport === "gym" && (w.focus === "legs" || w.focus === "full"))) return "HS";
  if (w.sport === "gym") return "MED";
  if (w.hard && ENDURANCE.has(w.sport)) return "HE";
  return "EASY";
}
export const isHard = w => { const k = kindOf(w); return k === "HE" || k === "HS"; };
const isLegs = w => w.sport === "plyo" || (w.sport === "gym" && (w.focus === "legs" || w.focus === "full"));
const isCross = w => CROSS_SPORTS.includes(w.sport) && w.target?.kind === "cross";
export function labelOf(w) { return w.title || (BASE_SPORTS[w.sport]?.label || w.sport) + (w.sport === "gym" && FOCUS[w.focus] ? " · " + FOCUS[w.focus] : ""); }

// Gilt ein fester Termin an diesem Datum?
export const validOn = (f, date) => (!f.from || date >= f.from) && (!f.to || date <= f.to);

// ---------- Phasen und Umfänge ----------
export function weekPlan(cfg, rules) {
  const start = parse(cfg.start), end = parse(cfg.end);
  const weeks = [];
  for (let m = mondayOf(start); m <= end; m = addDays(m, 7)) weeks.push({ monday: ymd(m) });
  const n = weeks.length;
  const race = cfg.goal?.race && cfg.goal.raceDate ? cfg.goal : null;
  const raceIdx = race ? weeks.findIndex(w => race.raceDate >= w.monday && race.raceDate <= ymd(addDays(parse(w.monday), 6))) : -1;
  const D = race ? Number(race.raceDistanceKm) : 0;
  const N = Math.max(2, Number(rules.deloadEvery) || 4);

  weeks.forEach(w => { w.phase = "base"; w.deload = false; });
  if (raceIdx >= 0) {
    const taperW = D >= 21 ? 2 : 1;
    const m = Math.max(0, raceIdx - taperW);
    const baseW = m <= 3 ? 0 : Math.ceil(m * 0.4);
    const peakW = m >= 5 ? Math.max(1, Math.floor(m * 0.2)) : 0;
    for (let i = 0; i < n; i++) {
      if (i < baseW) weeks[i].phase = "base";
      else if (i < m - peakW) weeks[i].phase = "build";
      else if (i < m) weeks[i].phase = "peak";
      else if (i < raceIdx) weeks[i].phase = "taper";
      else if (i === raceIdx) weeks[i].phase = "race";
      else if (i === raceIdx + 1) weeks[i].phase = "recovery";
      else weeks[i].phase = "base";
    }
  }
  // Entlastungswochen: jede N-te Woche, nicht in Tapering/Wettkampf/Regeneration
  let sinceDeload = 0;
  for (const w of weeks) {
    if (["taper", "race", "recovery"].includes(w.phase)) { sinceDeload = 0; continue; }
    sinceDeload++;
    if (sinceDeload === N) { w.deload = true; sinceDeload = 0; }
  }
  // Laufumfang
  const inc = 1 + (Number(rules.maxIncreasePct) || 10) / 100;
  const v0 = Math.max(8, Number(cfg.startKm) || 15);
  const capBase = race ? (RACE_CAP[D] || 55) : Math.max(v0 * 1.5, v0 + 15);
  const cap = Math.max(v0, capBase);
  let level = v0, peakLevel = v0;
  weeks.forEach((w, i) => {
    if (i > 0 && !w.deload && !weeks[i - 1].deload && ["base", "build", "peak"].includes(w.phase)) level = Math.min(cap, level * inc);
    if (["base", "build", "peak"].includes(w.phase)) peakLevel = Math.max(peakLevel, level);
    let km = level;
    if (w.deload) km = level * (Number(rules.deloadFactor) || 70) / 100;
    if (w.phase === "taper") km = peakLevel * (i === raceIdx - 1 ? 0.65 : 0.8);
    if (w.phase === "race") km = peakLevel * 0.4;
    if (w.phase === "recovery") km = peakLevel * 0.5;
    w.km = Math.round(km);
  });
  return { weeks, raceIdx, race, D };
}

export const PHASE_LABEL = { base: "Grundlage", build: "Aufbau", peak: "Spitze", taper: "Tapering", race: "Wettkampf", recovery: "Regeneration", deload: "Entlastung" };

// ---------- Inhalte der Lauf-Einheiten ----------
function runPaces(settings, cfg) {
  const z = paceZones(settings.zones) || paceZones({ refDistanceKm: 5, refTime: "28:00" });
  let rp = null;
  if (cfg.goal?.race && cfg.goal.raceTime && cfg.goal.raceDistanceKm) {
    const t = parseTime(cfg.goal.raceTime);
    if (t) rp = t / Number(cfg.goal.raceDistanceKm);
  }
  if (!rp && cfg.goal?.race) rp = z.pace(Number(cfg.goal.raceDistanceKm) || 10);
  return { z, rp };
}
const easyMid = z => (z.easy[0] + z.easy[1]) / 2;

function mk(sets, wuKm, cdKm, z) {
  // sets: [{reps, m|sec, pace, rest}] → Distanz/Dauer schätzen
  let km = wuKm + cdKm, sec = (wuKm + cdKm) * easyMid(z);
  for (const s of sets) {
    const segKm = s.m ? s.m / 1000 : (s.sec / s.pace);
    km += s.reps * segKm; sec += s.reps * segKm * s.pace;
    if (s.rest && s.reps > 1) { sec += (s.reps - 1) * s.rest; km += (s.reps - 1) * s.rest / (z.recovery[0] * 1.05); }
  }
  return { km: Math.round(km * 10) / 10, min: Math.round(sec / 60) };
}
function setText(s) {
  const what = s.m ? (s.m >= 1000 ? fmtKm(s.m / 1000) + " km" : s.m + " m") : (s.sec >= 60 && s.sec % 60 === 0 ? s.sec / 60 + " min" : s.sec + " s");
  const rest = s.rest ? ", " + (s.rest >= 60 ? fmtTime(s.rest) + " min" : s.rest + " s") + (s.uphill ? " locker zurück traben" : " Trabpause") : "";
  const how = s.uphill ? " zügig bergauf" : " @ " + fmtPace(s.pace) + "/km";
  return (s.reps > 1 ? s.reps + "×" : "") + what + how + rest;
}

// Abwechslung: Typen je Phase, nie derselbe Typ wie in der Vorwoche
const PHASE_TYPES = {
  base: ["hills", "i400", "i600", "threshold"],
  build: ["i800", "i1000", "i1600", "i2000", "pyramid", "threshold", "hills"],
  peak: ["i1000", "i1600", "i2000", "pyramid"],
};
const FAST = new Set(["i400", "i600", "i800", "i1000", "pyramid", "hills"]);

function intervalSession(type, P, deload) {
  const { z } = P, iv = z.interval[0], th = z.threshold[0], tenK = z.pace(10);
  const red = n => deload ? Math.max(2, Math.round(n * 0.65)) : n;
  let label = "Intervalle", sets, wu = 2, cd = 1.5, zone = "interval";
  switch (type) {
    case "i400": sets = [{ reps: red(10), m: 400, pace: iv * 0.97, rest: 75 }]; break;
    case "i600": sets = [{ reps: red(8), m: 600, pace: iv * 0.98, rest: 90 }]; break;
    case "i800": sets = [{ reps: red(6), m: 800, pace: iv, rest: 120 }]; break;
    case "i1000": sets = [{ reps: red(5), m: 1000, pace: iv, rest: 120 }]; break;
    case "i1600": sets = [{ reps: red(4), m: 1600, pace: (iv + tenK) / 2, rest: 150 }]; break;
    case "i2000": sets = [{ reps: red(3), m: 2000, pace: tenK, rest: 180 }]; break;
    case "pyramid":
      label = "Pyramide";
      sets = (deload ? [400, 800, 400] : [400, 800, 1200, 800, 400]).map(m => ({ reps: 1, m, pace: iv, rest: m >= 800 ? 120 : 90 }));
      break;
    case "hills":
      label = "Bergintervalle"; zone = "rep"; wu = 3; cd = 2;
      sets = [{ reps: red(10), sec: 75, pace: iv * 1.15, rest: 90, uphill: true }]; break;
    case "threshold":
      label = "Schwelle"; zone = "threshold";
      sets = deload ? [{ reps: 2, sec: 600, pace: th, rest: 120 }] : [{ reps: 3, sec: 600, pace: th, rest: 120 }]; break;
  }
  return runQuality(label, sets, wu, cd, zone, z, type);
}
function runQuality(label, sets, wu, cd, zone, z, type, key = true) {
  const est = mk(sets, wu, cd, z);
  const main = sets.every(s => s.reps === 1) && sets.length > 1 ? sets.map(s => s.m + " m").join("–") + " @ " + fmtPace(sets[0].pace) + "/km, 1:30–2:00 min Trabpause" : sets.map(setText).join(" · ");
  return {
    sport: "run", isKey: key, hard: key, title: null, distanceKm: est.km, durationMin: est.min,
    intervals: { warmupKm: wu, cooldownKm: cd, sets },
    note: `${label} · Einlaufen ${fmtKm(wu)} km · ${main} · Auslaufen ${fmtKm(cd)} km`,
    target: { zone, kind: "quality", type },
  };
}
function raceSession(k, P, D, deload) {
  const { z, rp, } = P, th = z.threshold[0];
  const red = n => deload ? Math.max(2, Math.round(n * 0.65)) : n;
  const opts = D >= 42 ? [[2, 6000], [3, 5000], [2, 8000]] : D >= 21 ? [[3, 3000], [2, 5000], [3, 4000]] : D >= 10 ? [[3, 2000], [4, 1600], [2, 3000]] : [[5, 1000], [6, 800], [4, 1200]];
  const o = opts[k % opts.length];
  return runQuality("Wettkampftempo", [{ reps: red(o[0]), m: o[1], pace: rp || th, rest: D >= 21 ? 120 : 90 }], 2, 1.5, "race", z, "racepace");
}
function longRun(km, P, phase, D) {
  const { z, rp } = P;
  const min = Math.round(km * z.easy[1] / 60);
  const out = { sport: "run", isKey: true, hard: min >= 90, title: null, distanceKm: Math.round(km), durationMin: min, target: { zone: "easy", kind: "long" } };
  out.note = `Langer Lauf · ${Math.round(km)} km Zone 2 @ ${fmtRange(z.easy)}/km`;
  if (phase === "peak" && D >= 21 && rp) out.note += ` · die letzten ${Math.round(km * 0.25)} km @ ${fmtPace(rp)}/km (Wettkampftempo)`;
  return out;
}
function easyRun(km, P, recovery) {
  const { z } = P, zone = recovery ? z.recovery : z.easy;
  return { sport: "run", isKey: false, hard: false, title: null, distanceKm: Math.round(km * 10) / 10, durationMin: Math.round(km * (zone[0] + zone[1]) / 2 / 60),
    note: `${recovery ? "Regeneration" : "Zone 2"} · ${fmtKm(km)} km @ ${fmtRange(zone)}/km`, target: { zone: recovery ? "recovery" : "easy", kind: recovery ? "recovery" : "easy" } };
}
function crossSession(sport, min, settings) {
  const hz = hrZones(settings.zones)[1];
  return { sport, isKey: false, hard: false, title: null, durationMin: min, note: `Zone 2 · ${min} min (Puls ${hz.lo}–${hz.hi})`, target: { zone: "Z2", kind: "cross" } };
}

// ---------- Wochen-Brett: Einheiten auf Tage verteilen ----------
export class WeekBoard {
  constructor(monday, cfg, rules, opts = {}) {
    this.monday = monday; this.cfg = cfg; this.rules = rules;
    this.days = [];
    for (let i = 0; i < 7; i++) {
      const date = ymd(addDays(parse(monday), i));
      const inRange = date >= (opts.from || cfg.start) && date <= (opts.to || cfg.end);
      this.days.push({ date, dow: i + 1, items: [], inRange, match: false, race: false });
    }
    this.prevHard = opts.prevHard || [false, false]; // letzte 2 Tage der Vorwoche
    this.nextMatch = !!opts.nextMatch;               // Montag der Folgewoche ist Spieltag
    this.prevMatch = !!opts.prevMatch;               // Sonntag der Vorwoche war Spieltag
    this.doubleStretchUsed = false;                  // Tag mit zwei verschiedenen Dehn-Bausteinen (max. 1× pro Woche)
    this.unplaced = [];
    this.warnings = [];
  }
  markMatches(dates = [], raceDate = null) {
    for (const d of this.days) { if (dates.includes(d.date)) d.match = true; if (d.date === raceDate) d.match = d.race = true; }
  }
  dayHard(i) { if (i < 0) return this.prevHard[2 + i] ?? false; if (i > 6) return false; return this.days[i].items.some(isHard); }
  isMatch(i) { if (i > 6) return this.nextMatch; if (i < 0) return this.prevMatch; return this.days[i].match; }
  occupy(w) { const d = this.days.find(x => x.date === w.date); if (d) d.items.push(w); }

  // Gibt den Grund zurück, warum die Einheit an Tag i nicht passt (oder null)
  why(item, i) {
    const d = this.days[i], k = kindOf(item), R = this.rules, its = d.items;
    if (!d.inRange) return "außerhalb des Plans";
    const counted = its.filter(x => x.sport !== "stretch");
    if (item.sport !== "stretch") {
      const swim = item.sport === "swim" || counted.some(x => x.sport === "swim");
      const max = swim ? (Number(R.maxPerDaySwim) || 3) : (Number(R.maxPerDay) || 4);
      if (counted.length >= max) return "schon " + counted.length + " Einheiten an dem Tag";
    }
    if (d.match && item.sport !== "stretch") return "Spieltag";
    const pre = this.isMatch(i + 1), post = this.isMatch(i - 1);
    if (pre && R.noLegsBeforeMatch && (k === "HS" || k === "HE")) return "Tag vor dem Spiel";
    if (pre && item.sport === "run" && item.isKey) return "Tag vor dem Spiel";
    if (i < 6 && this.days[i + 1].race && (k !== "EASY" || (item.durationMin || 0) > 45)) return "Tag vor dem Wettkampf";
    if (post && R.recoveryAfterMatch && (isLegs(item) || item.sport === "run" || k === "HE")) return "Tag nach dem Spiel";
    if (k === "HE" && its.some(x => kindOf(x) === "HE")) return "schon eine harte Ausdauereinheit";
    if (item.sport === "run" && its.some(x => x.sport === "run")) return "schon ein Lauf";
    // nie zweimal dasselbe am Tag
    if (item.blockKey && its.some(x => x.blockKey === item.blockKey)) return "gleiche Einheit schon am Tag";
    if (item.sport === "gym" && its.some(x => x.sport === "gym" && x.focus === item.focus)) return "gleiche Einheit schon am Tag";
    if (item.sport === "stretch" && its.some(x => x.sport === "stretch") && this.doubleStretchUsed) return "schon gedehnt";
    if (isCross(item)) {
      const cs = its.filter(isCross);
      if (cs.length >= 2 || cs.some(x => x.sport === item.sport)) return "Cross-Einheit schon am Tag";
    }
    // Qualität vor Kraft regelt die Reihenfolge am Tag (RANK)
    if ((k === "HE" || k === "HS") && !this.dayHard(i)) {
      const max = Number(R.maxHardInRow) || 2;
      let run = 1;
      for (let j = i - 1; j >= i - 3 && this.dayHard(j); j--) run++;
      for (let j = i + 1; j <= i + 3 && j <= 6 && this.dayHard(j); j++) run++;
      if (run > max) return "zu viele harte Tage in Folge";
    }
    return null;
  }

  score(item, i) {
    const d = this.days[i], k = kindOf(item), its = d.items, R = this.rules;
    const near = j => j >= 0 && j <= 6 ? this.days[j].items : [];
    let s = 0;
    const hard = this.dayHard(i);
    const counted = its.filter(x => x.sport !== "stretch").length;
    if (k === "HE" || k === "HS") {
      if (R.hardDaysHard) s += hard ? 6 : 0;
      // Harte Tage hart: Beine und Plyo gehören auf die Tage mit Intervallen/Schwelle
      if (k === "HS" && its.some(x => x.sport === "run" && x.target?.kind === "quality")) s += 20;
      else if (k === "HS" && its.some(x => kindOf(x) === "HE" && x.sport === "run")) s += 4;
      if (item.sport === "run" && item.target?.kind === "quality" && its.some(x => kindOf(x) === "HS")) s += 10;
      if (k === "HS" && its.some(x => kindOf(x) === "HS")) s -= 7; // Beine und Plyo lieber auf verschiedene harte Tage
      if (k === "HE" && near(i - 1).some(x => kindOf(x) === "HS")) s -= 5;
      if (k === "HS" && near(i + 1).some(x => x.isKey && x.sport === "run")) s -= 5;
      if (item.isKey && item.sport === "run") for (const j of [i - 1, i + 1]) if (near(j).some(x => x.isKey && x.sport === "run")) s -= 8;
    } else {
      if (hard && R.hardDaysHard && item.sport !== "stretch") s -= 3;
      s -= counted * 2;
      if (item.sport === "run" && near(i - 1).some(x => x.sport === "run")) s -= 1;
      if (k === "MED" && item.sport === "gym") for (const j of [i - 1, i + 1]) if (near(j).some(x => x.sport === "gym" && x.focus === item.focus)) s -= 3;
    }
    if (item.sport === "stretch") { s = 0; if (its.some(x => x.sport === "stretch")) s -= 10; if (hard || this.dayHard(i - 1) || this.isMatch(i)) s += 3; }
    if (isCross(item)) { if (its.some(isCross)) s -= 8; if (this.isMatch(i - 1)) s += 2; }
    if (item.target?.kind === "long") s += d.dow >= 6 ? 4 : 0;
    if (item.isKey && item.sport === "run" && its.some(x => x.sport === "football")) s -= 6;
    return s;
  }

  put(item, i) {
    const d = this.days[i];
    if (item.sport === "stretch" && d.items.some(x => x.sport === "stretch")) this.doubleStretchUsed = true;
    const w = { ...item, date: d.date };
    d.items.push(w);
    return w;
  }
  place(item) {
    let best = null;
    for (let i = 0; i < 7; i++) {
      if (this.why(item, i)) continue;
      const sc = this.score(item, i);
      if (!best || sc > best.sc) best = { i, sc };
    }
    if (!best) { this.unplaced.push(item); return null; }
    return this.put(item, best.i);
  }
  // Fester Tag: immer dort, bei Regelverstoß mit Warnung
  placeOn(item, dow) {
    const i = dow - 1;
    if (!this.days[i].inRange) return null;
    const why = this.why(item, i);
    if (why && why !== "außerhalb des Plans") this.warnings.push(`${labelOf(item)} am ${["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"][i]} ${this.days[i].date.slice(8, 10)}.${this.days[i].date.slice(5, 7)}.: ${why}`);
    return this.put(item, i);
  }
  placeFixed(item, dow) { const d = this.days[dow - 1]; if (!d.inRange) return null; return this.put(item, dow - 1); }
  hardTail() { return [this.dayHard(5), this.dayHard(6)]; }
}

// Reihenfolge am Tag: Lauf-Qualität zuerst, dann Fußball, Läufe, Cross, Kraft, Dehnen zum Schluss
const RANK = w => w.sport === "stretch" ? 9 : w.sport === "run" && (w.isKey || w.hard) ? 0 : w.sport === "football" ? 1 : w.sport === "run" ? 2 : isCross(w) ? 3 : w.sport === "gym" || w.sport === "plyo" ? 4 : 5;

// ---------- Plan erzeugen ----------
// existing: alle Einheiten der App; geschützt bleiben erledigte, fixierte (manuelle/geänderte) Einheiten
export function generatePlan(cfg, settings, existing, history = {}) {
  const rules = settings.rules;
  const P = runPaces(settings, cfg);
  const { weeks, race, D } = weekPlan(cfg, rules);
  const planId = cfg.planId || newId();
  const applyFrom = cfg.applyFrom && cfg.applyFrom > cfg.start ? cfg.applyFrom : cfg.start;
  const keep = existing.filter(w => !w.deleted && w.status !== "missed" && w.date >= cfg.start && w.date <= cfg.end && (w.status !== "planned" || w.locked || w.source !== "plan" || w.date < applyFrom));
  const out = [];
  let prevHard = [false, false];
  let prevLoad = history.avgWeekLoad || null;
  const fixed = cfg.fixed || [];
  const matchOn = date => fixed.some(f => f.match && Number(f.weekday) === dowOf(date) && validOn(f, date)) || (race && race.raceDate === date);
  const runs = Math.max(1, Math.min(7, Number(cfg.runsPerWeek) || 3));
  const cross = normCross(cfg);
  const excluded = new Set(rules.excludedIntervals || []);
  let lastTypes = [], crossIdx = 0, typeIdx = 0;

  weeks.forEach((wk, wi) => {
    const sun = ymd(addDays(parse(wk.monday), 6));
    const board = new WeekBoard(wk.monday, cfg, rules, {
      prevHard, from: applyFrom,
      nextMatch: matchOn(ymd(addDays(parse(wk.monday), 7))),
      prevMatch: matchOn(ymd(addDays(parse(wk.monday), -1))),
    });
    board.markMatches(board.days.filter(d => matchOn(d.date)).map(d => d.date), race && wk.phase === "race" ? race.raceDate : null);
    const mine = keep.filter(w => w.date >= wk.monday && w.date <= sun);
    mine.forEach(w => board.occupy(w));
    const placed = [];
    const add = w => { if (w) placed.push(w); };

    // 1. feste Termine (nur solange gültig)
    let footballWeek = false;
    for (const f of fixed) {
      const d = board.days[Number(f.weekday) - 1];
      if (!validOn(f, d.date)) continue;
      if (f.sport === "football") footballWeek = true;
      if (!d.inRange) continue;
      if (mine.some(x => x.date === d.date && x.sport === f.sport && !x.planId)) continue;
      if (race && d.date === race.raceDate) continue;
      add(board.placeFixed({ sport: f.sport, title: f.title || null, durationMin: Number(f.durationMin) || 60, hard: f.sport === "football" || !!f.hard, isKey: false, note: f.match ? "Spiel" : "", target: { kind: f.match ? "match" : "fixed" } }, Number(f.weekday)));
    }
    // 2. Wettkampf
    if (race && wk.phase === "race") {
      const d = board.days.find(x => x.date === race.raceDate);
      if (d) add(board.placeFixed({ sport: "run", title: "Wettkampf " + (RACES.find(r => r.km === D)?.label || D + " km"), distanceKm: D, durationMin: Math.round((parseTime(race.raceTime) || P.z.pace(D) * D) / 60), isKey: true, hard: true, note: race.raceTime ? "Zielzeit " + race.raceTime + " (" + fmtPace(P.rp) + "/km)" : "Wettkampf", target: { kind: "race" } }, d.dow));
    }

    // 3. Läufe
    const existingRuns = mine.filter(w => w.sport === "run").length;
    let nRuns = Math.max(0, runs - existingRuns - (wk.phase === "race" ? 1 : 0));
    const qCount = runs >= 4 ? 2 : runs >= 2 ? 1 : 0;
    const hasLong = nRuns >= 1 && !["race", "recovery"].includes(wk.phase);
    const runItems = [];
    let kmLeft = wk.km;
    if (hasLong) {
      const lrMax = (Number(cfg.longRunMaxMin) || 150) * 60 / P.z.easy[1];
      const lrKm = Math.max(6, Math.min(lrMax, wk.km * (runs <= 3 ? 0.36 : 0.3), D >= 42 ? 32 : D >= 21 ? 22 : 18));
      runItems.push(longRun(wk.phase === "taper" ? lrKm * 0.7 : lrKm, P, wk.phase, D));
      kmLeft -= runItems[0].distanceKm; nRuns--;
    }
    const qSlots = wk.phase === "race" ? Math.min(1, nRuns) : wk.phase === "recovery" ? 0 : Math.min(qCount, nRuns);
    const thisTypes = [];
    for (let q = 0; q < qSlots; q++) {
      let s;
      if (wk.phase === "race") s = runQuality("Vorbelastung", [{ reps: 3, sec: 60, pace: P.rp || P.z.interval[0], rest: 90 }], 2, 1, "race", P.z, "opener", false);
      else if (wk.phase === "taper") s = runQuality("Intervalle", [{ reps: 4, m: 400, pace: P.z.interval[0], rest: 90 }], 2, 1.5, "interval", P.z, "sharpen");
      else if (wk.phase === "peak" && q === 0 && race) s = raceSession(wi, P, D, wk.deload);
      else {
        let pool = (wk.phase === "base" && !race && wi >= 4 ? [...PHASE_TYPES.base, ...PHASE_TYPES.build] : PHASE_TYPES[wk.phase] || PHASE_TYPES.base)
          .filter(t => !excluded.has(t));
        if (!pool.length) pool = ["threshold"];
        // nicht wie letzte Woche, bei zwei Einheiten eine schnelle und eine längere
        let cand = pool.filter(t => !lastTypes.includes(t) && !thisTypes.includes(t));
        if (q === 1 && thisTypes.length) cand = [...cand.filter(t => FAST.has(t) !== FAST.has(thisTypes[0])), ...cand];
        if (!cand.length) cand = pool.filter(t => !thisTypes.includes(t));
        if (!cand.length) cand = pool;
        const t = cand[(typeIdx++) % cand.length];
        thisTypes.push(t);
        s = intervalSession(t, P, wk.deload);
      }
      runItems.push(s); kmLeft -= s.distanceKm; nRuns--;
    }
    if (thisTypes.length) lastTypes = thisTypes;
    for (let i = 0; i < nRuns; i++) {
      const km = Math.max(4, Math.min(16, kmLeft / (nRuns - i)));
      const e = easyRun(km, P, wk.phase === "recovery");
      runItems.push(e); kmLeft -= e.distanceKm;
    }

    // 4. Bausteine (Kraft, Plyo, Dehnen, eigene)
    const blocks = [], fixedBlocks = [];
    (cfg.blocks || []).forEach((b, bi) => {
      const have = mine.filter(w => w.sport === b.sport && (b.sport !== "gym" || w.focus === b.focus)).length;
      for (let i = have; i < (Number(b.perWeek) || 0); i++) {
        const legs = b.sport === "plyo" || (b.sport === "gym" && (b.focus === "legs" || b.focus === "full"));
        if (wk.phase === "race" && legs) continue;
        const it = { sport: b.sport, focus: b.sport === "gym" ? b.focus : null, durationMin: Number(b.durationMin) || 45, hard: legs, isKey: false, title: null, note: `${Number(b.durationMin) || 45} min`, blockKey: "b" + bi, target: { kind: "block" } };
        if (b.day && i === have) fixedBlocks.push([it, Number(b.day)]); else blocks.push(it);
      }
    });
    // 5. Cross-Pool: Anzahl je nachdem, ob in dieser Woche Fußball ist
    const crossItems = [];
    const nCross = footballWeek ? cross.perWeekFootball : cross.perWeekNoFootball;
    for (let i = 0; i < nCross && cross.sports.length; i++) {
      const used = crossItems.map(x => x.sport);
      let sp = cross.sports[crossIdx % cross.sports.length];
      for (let t = 0; t < cross.sports.length && used.includes(sp); t++) sp = cross.sports[(++crossIdx) % cross.sports.length];
      crossIdx++;
      crossItems.push(crossSession(sp, cross.durationMin, settings));
    }

    // Belastungsgrenze: lockere Läufe und Cross-Einheiten kürzen
    const z = settings.zones;
    const est = l => l.reduce((s, w) => s + loadOf(w, z), 0);
    const weekLoad = () => est([...placed, ...mine.filter(w => w.status === "planned"), ...runItems, ...blocks, ...fixedBlocks.map(f => f[0]), ...crossItems]);
    if (prevLoad && !wk.deload && ["base", "build", "peak"].includes(wk.phase)) {
      const limit = prevLoad * (1 + (Number(rules.maxIncreasePct) || 10) / 100);
      let guard = 0;
      while (weekLoad() > limit && guard++ < 8) {
        let changed = false;
        for (const e of crossItems) if (e.durationMin > 25) { e.durationMin = Math.max(25, Math.round(e.durationMin * 0.85 / 5) * 5); e.note = e.note.replace(/· \d+ min/, "· " + e.durationMin + " min"); changed = true; }
        for (const r of runItems) if (r.target.kind === "easy" && r.distanceKm > 4) { Object.assign(r, easyRun(Math.max(4, r.distanceKm * 0.88), P, false)); changed = true; }
        if (!changed) break;
      }
    }

    // 6. Verteilen: feste Bausteine → lang/Qualität → harte Kraft → übrige Kraft → lockere Läufe → Cross → Dehnen
    for (const [it, day] of fixedBlocks) add(board.placeOn(it, day));
    const order = [
      ...runItems.filter(r => r.target.kind === "long" && r.hard),
      ...runItems.filter(r => r.target.kind === "quality"),
      ...runItems.filter(r => r.target.kind === "long" && !r.hard),
      ...blocks.filter(b => b.hard),
      ...blocks.filter(b => !b.hard && b.sport !== "stretch"),
      ...runItems.filter(r => r.target.kind === "easy" || r.target.kind === "recovery"),
      ...crossItems,
      ...blocks.filter(b => b.sport === "stretch"),
    ];
    for (const it of order) {
      let w = board.place(it);
      // Kein Tag für die harte Variante frei → als lockeren Lauf einplanen statt ganz wegzulassen
      if (!w && it.sport === "run" && it.target?.kind !== "easy") {
        const e = easyRun(Math.min(it.distanceKm || 6, 14), P, false);
        e.note += " · statt " + it.note.split(" · ")[0] + " (kein passender Tag frei)";
        board.unplaced.pop();
        w = board.place(e);
        if (w) wk.downgraded = (wk.downgraded || 0) + 1;
      }
      add(w);
    }

    // Reihenfolge am Tag festlegen und neue Einheiten übernehmen
    const newOnes = new Set(placed);
    for (const d of board.days) {
      d.items.slice().sort((a, b) => RANK(a) - RANK(b)).forEach((w, idx) => {
        if (newOnes.has(w)) out.push({ ...w, slot: idx * 10, target: { ...(w.target || {}), order: idx + 1, part: null }, id: newId(), status: "planned", source: "plan", planId, locked: false });
      });
    }

    wk.unplaced = board.unplaced.map(labelOf);
    wk.warnings = board.warnings;
    wk.load = Math.round(est([...placed, ...mine]));
    wk.sessions = placed.length + mine.length;
    wk.plannedKm = Math.round([...placed, ...mine].filter(w => w.sport === "run").reduce((s, w) => s + (+w.distanceKm || 0), 0));
    if (!wk.deload && ["base", "build", "peak"].includes(wk.phase)) prevLoad = wk.load;
    prevHard = board.hardTail();
  });

  for (const w of out) delete w.blockKey;
  return { planId, workouts: out, weeks, removed: existing.filter(w => !w.deleted && w.status === "planned" && w.source === "plan" && !w.locked && w.date >= applyFrom && w.date <= cfg.end) };
}
const dowOf = s => ((parse(s).getDay() + 6) % 7) + 1;

// Cross-Pool aus der Konfiguration (ältere Pläne: "endurance"-Liste übernehmen)
export function normCross(cfg) {
  if (cfg.cross) return { sports: (cfg.cross.sports || []).filter(s => CROSS_SPORTS.includes(s)), perWeekFootball: Number(cfg.cross.perWeekFootball) || 0, perWeekNoFootball: Number(cfg.cross.perWeekNoFootball) || 0, durationMin: Number(cfg.cross.durationMin) || 30 };
  const sports = [...new Set((cfg.endurance || []).map(e => e.sport).filter(s => CROSS_SPORTS.includes(s)))];
  return { sports, perWeekFootball: Math.min(2, sports.length), perWeekNoFootball: Math.min(4, sports.length), durationMin: 30 };
}

// ---------- Verpasste Einheiten: freien Platz in derselben Woche finden ----------
export function rescheduleOptions(missed, all, cfg, rules, today) {
  const monday = ymd(mondayOf(parse(missed.date)));
  const sunday = ymd(addDays(parse(monday), 6));
  if (today > sunday) return null;
  const from = today > missed.date ? today : ymd(addDays(parse(missed.date), 1));
  const fixed = cfg.fixed || [];
  const rd = cfg.goal?.race ? cfg.goal.raceDate : null;
  const matchOn = date => fixed.some(f => f.match && Number(f.weekday) === dowOf(date) && validOn(f, date)) || rd === date;
  const board = new WeekBoard(monday, cfg, rules, { from, to: sunday, prevMatch: matchOn(ymd(addDays(parse(monday), -1))), nextMatch: matchOn(ymd(addDays(parse(monday), 7))) });
  board.markMatches(board.days.filter(d => matchOn(d.date)).map(d => d.date), rd);
  all.filter(w => !w.deleted && w.id !== missed.id && w.date >= monday && w.date <= sunday && w.status !== "missed").forEach(w => board.occupy(w));
  const res = board.place({ ...missed });
  if (!res) return null;
  const d = board.days.find(x => x.date === res.date);
  return { date: res.date, slot: (d.items.length - 1) * 10 + 5 };
}

// Wochenbilanz für Anpassungsvorschlag
export function weekBalance(all, monday, z) {
  const sunday = ymd(addDays(parse(monday), 6));
  const inW = all.filter(w => !w.deleted && w.date >= monday && w.date <= sunday);
  const planned = inW.filter(w => w.planId);
  const plannedLoad = planned.reduce((s, w) => s + loadOf({ ...w, trimp: null, avgHr: null }, z), 0);
  const doneLoad = inW.filter(w => w.status === "done").reduce((s, w) => s + loadOf(w, z), 0);
  return { plannedLoad, doneLoad, ratio: plannedLoad ? doneLoad / plannedLoad : 1, plannedCount: planned.length, doneCount: planned.filter(w => w.status === "done").length };
}

export { daysBetween };
