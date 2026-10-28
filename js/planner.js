// Plan-Algorithmus: Periodisierung, Umfangssteuerung und Verteilung der Einheiten auf die Zeitfenster
import { ymd, parse, addDays, mondayOf, isoDow, fmtPace, fmtKm, newId, daysBetween, parseTime, fmtTime } from "./util.js";
import { paceZones, hrZones, fmtRange, loadOf, ENDURANCE, FOCUS, BASE_SPORTS } from "./sports.js";

export const PARTS = ["morgens", "mittags", "nachmittags", "abends"];
const RACE_CAP = { 5: 45, 10: 55, 21.1: 70, 42.2: 90 };
export const RACES = [{ km: 5, label: "5 km" }, { km: 10, label: "10 km" }, { km: 21.1, label: "Halbmarathon" }, { km: 42.2, label: "Marathon" }];

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

  weeks.forEach((w, i) => { w.phase = "base"; w.deload = false; });
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
  const what = s.m ? (s.m >= 1000 && s.m % 1000 === 0 ? s.m / 1000 + " km" : s.m + " m") : (s.sec >= 60 ? Math.round(s.sec / 60) + " min" : s.sec + " s");
  const rest = s.rest ? ", " + (s.rest >= 60 ? fmtTime(s.rest) + " min" : s.rest + " s") + " Trabpause" : "";
  return (s.reps > 1 ? s.reps + "×" : "") + what + " @ " + fmtPace(s.pace) + "/km" + rest;
}

function qualitySession(type, k, P, phase, deload, D) {
  const { z, rp } = P, iv = z.interval[0], th = z.threshold[0], rep = z.rep[0];
  let title, sets, wu = 2, cd = 1.5, zone;
  const red = n => deload ? Math.max(2, Math.round(n * 0.65)) : n;
  switch (type) {
    case "fartlek":
      title = "Fahrtspiel"; zone = "interval";
      sets = [{ reps: red(Math.min(10, 6 + k)), sec: 60, pace: iv, rest: 60 }]; break;
    case "hills":
      title = "Hügelsprints + locker"; zone = "rep";
      sets = [{ reps: red(Math.min(10, 6 + k)), sec: 20, pace: rep, rest: 90 }]; wu = 3; cd = 2; break;
    case "tempo": {
      title = "Schwellenlauf"; zone = "threshold";
      const prog = [[3, 480], [3, 600], [2, 900], [4, 480], [3, 720], [2, 1200]][k % 6];
      sets = [{ reps: red(prog[0]), sec: prog[1], pace: th, rest: 90 }]; break;
    }
    case "intervals": {
      title = "Intervalle"; zone = "interval";
      const prog = [[6, 800, 120], [5, 1000, 120], [4, 1200, 150], [6, 1000, 120], [8, 600, 90], [5, 1200, 150]][k % 6];
      sets = [{ reps: red(prog[0]), m: prog[1], pace: iv, rest: prog[2] }]; break;
    }
    case "racepace": {
      title = "Wettkampftempo"; zone = "race";
      const opts = D >= 42 ? [[2, 6000], [3, 5000], [2, 8000]] : D >= 21 ? [[3, 3000], [2, 5000], [3, 4000]] : D >= 10 ? [[3, 2000], [4, 1600], [2, 3000]] : [[5, 1000], [6, 800], [4, 1200]];
      const o = opts[k % opts.length];
      sets = [{ reps: red(o[0]), m: o[1], pace: rp || th, rest: D >= 21 ? 120 : 90 }]; break;
    }
    case "sharpen":
      title = "Kurz und knackig"; zone = "interval";
      sets = [{ reps: 4, m: 400, pace: iv, rest: 90 }]; break;
    case "opener":
      title = "Vorbelastung"; zone = "race";
      sets = [{ reps: 3, sec: 60, pace: rp || iv, rest: 90 }]; wu = 2; cd = 1; break;
  }
  const est = mk(sets, wu, cd, z);
  return {
    sport: "run", isKey: type !== "opener", hard: type !== "opener",
    title, distanceKm: est.km, durationMin: est.min, intervals: { warmupKm: wu, cooldownKm: cd, sets },
    note: `Einlaufen ${fmtKm(wu)} km locker · ${sets.map(setText).join(" · ")} · Auslaufen ${fmtKm(cd)} km`,
    target: { zone, kind: "quality" },
  };
}
function qualityTypes(phase, deload, qCount, weekNo) {
  if (phase === "recovery") return [];
  if (phase === "race") return ["opener"];
  if (phase === "taper") return ["sharpen"];
  if (phase === "base") return qCount >= 2 ? ["fartlek", "tempo"] : [weekNo % 3 === 2 ? "tempo" : weekNo % 3 === 1 ? "hills" : "fartlek"];
  if (phase === "build") return qCount >= 2 ? ["intervals", "tempo"] : [weekNo % 2 ? "tempo" : "intervals"];
  if (phase === "peak") return qCount >= 2 ? ["racepace", "intervals"] : ["racepace"];
  return [];
}
function longRun(km, P, phase, D) {
  const { z, rp } = P;
  const min = Math.round(km * z.easy[1] / 60);
  const out = { sport: "run", isKey: true, hard: min >= 90, title: "Langer Lauf", distanceKm: Math.round(km), durationMin: min, target: { zone: "easy", kind: "long" } };
  out.note = `${Math.round(km)} km locker @ ${fmtRange(z.easy)}/km`;
  if (phase === "peak" && D >= 21 && rp) {
    const fast = Math.round(km * 0.25);
    out.note += ` · davon die letzten ${fast} km @ ${fmtPace(rp)}/km (Wettkampftempo)`;
  }
  return out;
}
function easyRun(km, P, recovery) {
  const { z } = P, zone = recovery ? z.recovery : z.easy;
  return { sport: "run", isKey: false, hard: false, title: recovery ? "Regenerationslauf" : "Lockerer Lauf", distanceKm: Math.round(km * 10) / 10, durationMin: Math.round(km * (zone[0] + zone[1]) / 2 / 60), note: `${fmtKm(km)} km @ ${fmtRange(zone)}/km`, target: { zone: recovery ? "recovery" : "easy", kind: recovery ? "recovery" : "easy" } };
}
function z2(sport, min, settings, label) {
  const hz = hrZones(settings.zones)[1];
  return { sport, isKey: false, hard: false, title: label || "Grundlage Z2", durationMin: min, note: `${min} min locker in Z2 (Puls ${hz.lo}–${hz.hi})`, target: { zone: "Z2", kind: "easy" } };
}

// ---------- Wochen-Brett: Zeitfenster belegen ----------
export class WeekBoard {
  constructor(monday, cfg, rules, opts = {}) {
    this.monday = monday; this.cfg = cfg; this.rules = rules;
    this.days = [];
    for (let i = 0; i < 7; i++) {
      const date = ymd(addDays(parse(monday), i));
      const wins = (cfg.windows?.[i + 1] || []).map((w, j) => ({ part: w.part, min: Number(w.min) || 0, left: Number(w.min) || 0, idx: j, items: [] }));
      const inRange = date >= (opts.from || cfg.start) && date <= (opts.to || cfg.end);
      this.days.push({ date, dow: i + 1, wins, extra: [], inRange, match: false });
    }
    this.prevHard = opts.prevHard || [false, false]; // letzte 2 Tage der Vorwoche
    this.nextMatch = opts.nextMatch || false;        // Montag der Folgewoche ist Spieltag
    this.prevMatch = opts.prevMatch || false;        // Sonntag der Vorwoche war Spieltag
    this.unplaced = [];
  }
  // Spieltage (Fußballspiel oder Wettkampf) markieren
  markMatches(extraDates = [], raceDate = null) {
    for (const d of this.days) { if (extraDates.includes(d.date)) d.match = true; if (d.date === raceDate) d.match = d.race = true; }
  }
  items(d) { return [...d.wins.flatMap(w => w.items), ...d.extra]; }
  dayHard(i) { if (i < 0) return this.prevHard[2 + i] ?? false; if (i > 6) return false; return this.items(this.days[i]).some(isHard); }
  isMatch(i) { if (i > 6) return this.nextMatch; if (i < 0) return this.prevMatch; return this.days[i].match; }

  // vorhandene Einheit (fix, erledigt, manuell) eintragen
  occupy(w) {
    const d = this.days.find(x => x.date === w.date); if (!d) return;
    const wi = w.slot != null ? Math.floor(w.slot / 10) : -1;
    const win = d.wins[wi] || d.wins.find(x => x.left >= (w.durationMin || 0)) || null;
    if (win) { win.items.push(w); win.left -= (w.durationMin || 0); } else d.extra.push(w);
  }

  allowed(item, i, win) {
    const d = this.days[i], k = kindOf(item), R = this.rules;
    if (!d.inRange || !win) return false;
    if (win.left < (item.durationMin || 0)) return false;
    const its = this.items(d);
    if (d.match && item.sport !== "stretch") return false;
    const pre = this.isMatch(i + 1), post = this.isMatch(i - 1);
    if (pre && R.noLegsBeforeMatch && (k === "HS" || k === "HE")) return false;
    if (pre && item.sport === "run" && item.isKey) return false;
    if (i < 6 && this.days[i + 1].race && (k !== "EASY" || (item.durationMin || 0) > 45)) return false;
    if (post && R.recoveryAfterMatch) {
      if (k !== "EASY") return false;
      if (item.sport === "run" && item.target?.kind !== "recovery") return false;
      if ((item.durationMin || 0) > 45 && item.sport !== "stretch") return false;
    }
    if (k === "HE" && its.some(x => kindOf(x) === "HE")) return false;
    if (item.sport === "run" && its.some(x => x.sport === "run")) return false;
    // gleiche Kraft-Einheit nicht zweimal am Tag
    if (item.sport !== "stretch" && its.some(x => x.sport === item.sport && x.focus === item.focus && item.sport !== "run")) return false;
    // Qualität vor Kraft: harte Kraft nur im selben oder späteren Fenster als harte Ausdauer
    if (R.qualityBeforeStrength) {
      const lead = x => kindOf(x) === "HE" || (x.sport === "run" && x.isKey);
      if (k === "HS" && d.wins.some(w => w.idx > win.idx && w.items.some(lead))) return false;
      if (lead(item) && d.wins.some(w => w.idx < win.idx && w.items.some(x => kindOf(x) === "HS"))) return false;
      if (lead(item) && win.items.some(x => kindOf(x) === "HS")) return false;
    }
    // max. harte Tage in Folge
    if ((k === "HE" || k === "HS") && !this.dayHard(i)) {
      const max = Number(R.maxHardInRow) || 2;
      let run = 1;
      for (let j = i - 1; j >= i - 3 && this.dayHard(j); j--) run++;
      for (let j = i + 1; j <= i + 3 && j <= 6 && this.dayHard(j); j++) run++;
      if (run > max) return false;
    }
    return true;
  }

  score(item, i, win) {
    const d = this.days[i], k = kindOf(item), its = this.items(d), R = this.rules;
    let s = 0;
    const hard = this.dayHard(i);
    if (k === "HE" || k === "HS") {
      if (R.hardDaysHard) s += hard ? 6 : 0;
      if (k === "HS" && its.some(x => kindOf(x) === "HE" && x.sport === "run")) s += 4;
      // harte Lauf-Qualität nicht direkt nach Beinen
      if (k === "HE" && i > 0 && this.items(this.days[i - 1]).some(x => kindOf(x) === "HS")) s -= 5;
      if (k === "HS" && i < 6 && this.items(this.days[i + 1]).some(x => x.isKey && x.sport === "run")) s -= 5;
      // Qualitätsläufe verteilen
      if (item.isKey && item.sport === "run") for (const j of [i - 1, i + 1]) if (j >= 0 && j <= 6 && this.items(this.days[j]).some(x => x.isKey && x.sport === "run")) s -= 8;
    } else {
      if (hard && R.hardDaysHard && item.sport !== "stretch") s -= 4;
      if (item.sport === "stretch") s += (i > 0 && this.dayHard(i - 1)) || hard ? 3 : 0;
      s -= its.length * 1.5;
      if (item.sport === "run" && i > 0 && this.items(this.days[i - 1]).some(x => x.sport === "run")) s -= 1;
      if (k === "MED") for (const j of [i - 1, i + 1]) if (j >= 0 && j <= 6 && this.items(this.days[j]).some(x => x.sport === "gym" && x.focus === item.focus)) s -= 3;
    }
    if (item.target?.kind === "long") s += (d.dow >= 6 ? 4 : 0) + win.min / 30;
    s += win.left / 200; // Puffer
    return s;
  }

  place(item, opts = {}) {
    let best = null;
    for (let i = 0; i < 7; i++) {
      if (opts.fromIdx != null && i < opts.fromIdx) continue;
      for (const win of this.days[i].wins) {
        if (!this.allowed(item, i, win)) continue;
        const sc = this.score(item, i, win);
        if (!best || sc > best.sc) best = { i, win, sc };
      }
    }
    if (!best) { this.unplaced.push(item); return null; }
    const d = this.days[best.i];
    const w = { ...item, date: d.date, slot: best.win.idx * 10 + best.win.items.length, target: { ...(item.target || {}), part: best.win.part } };
    best.win.items.push(w); best.win.left -= (item.durationMin || 0);
    return w;
  }

  // feste Termine haben Vorrang: ins größte Fenster des Tages, sonst ohne Fenster
  placeFixed(item, dow) {
    const d = this.days[dow - 1];
    if (!d.inRange) return null;
    const win = [...d.wins].sort((a, b) => b.left - a.left || b.idx - a.idx)[0];
    const w = { ...item, date: d.date, slot: win ? win.idx * 10 + win.items.length : null, target: { ...(item.target || {}), part: win?.part || null } };
    if (win && win.left >= (item.durationMin || 0)) { win.items.push(w); win.left -= item.durationMin || 0; } else d.extra.push(w);
    return w;
  }
  hardTail() { return [this.dayHard(5), this.dayHard(6)]; }
}

// ---------- Plan erzeugen ----------
// existing: alle Einheiten der App; geschützt bleiben erledigte, fixierte (manuelle/geänderte) Einheiten
export function generatePlan(cfg, settings, existing, history = {}) {
  const rules = settings.rules;
  const P = runPaces(settings, cfg);
  const { weeks, race, D } = weekPlan(cfg, rules);
  const planId = cfg.planId || newId();
  // applyFrom: beim Bearbeiten eines laufenden Plans nur ab heute neu verteilen
  const applyFrom = cfg.applyFrom && cfg.applyFrom > cfg.start ? cfg.applyFrom : cfg.start;
  const keep = existing.filter(w => !w.deleted && w.date >= cfg.start && w.date <= cfg.end && (w.status !== "planned" || w.locked || w.source !== "plan" || w.date < applyFrom));
  const out = [];
  let prevHard = [false, false];
  let prevLoad = history.avgWeekLoad || null;
  const fixedMatchDows = (cfg.fixed || []).filter(f => f.match).map(f => Number(f.weekday));
  const runs = Math.max(1, Math.min(7, Number(cfg.runsPerWeek) || 3));

  weeks.forEach((wk, wi) => {
    const board = new WeekBoard(wk.monday, cfg, rules, {
      prevHard, from: applyFrom,
      nextMatch: fixedMatchDows.includes(1) || (race && race.raceDate === ymd(addDays(parse(wk.monday), 7))),
      prevMatch: fixedMatchDows.includes(7) || (race && race.raceDate === ymd(addDays(parse(wk.monday), -1))),
    });
    const matchDates = board.days.filter(d => fixedMatchDows.includes(d.dow)).map(d => d.date);
    board.markMatches(matchDates, race && wk.phase === "race" ? race.raceDate : null);
    const mine = keep.filter(w => w.date >= wk.monday && w.date <= board.days[6].date);
    mine.forEach(w => board.occupy(w));
    const placed = [];
    const add = w => { if (w) placed.push(w); };

    // 1. feste Termine
    for (const f of cfg.fixed || []) {
      const d = board.days[Number(f.weekday) - 1];
      if (!d.inRange) continue;
      if (mine.some(x => x.date === d.date && x.sport === f.sport && !x.planId)) continue;
      if (race && d.date === race.raceDate) continue;
      add(board.placeFixed({ sport: f.sport, title: f.title || "Fester Termin", durationMin: Number(f.durationMin) || 60, hard: f.sport === "football" || !!f.hard, isKey: false, note: f.note || "", target: { kind: f.match ? "match" : "fixed" } }, Number(f.weekday)));
    }
    // 2. Wettkampf
    if (race && wk.phase === "race") {
      const d = board.days.find(x => x.date === race.raceDate);
      if (d) add(board.placeFixed({ sport: "run", title: "Wettkampf " + (RACES.find(r => r.km === D)?.label || D + " km"), distanceKm: D, durationMin: Math.round((parseTime(race.raceTime) || P.z.pace(D) * D) / 60), isKey: true, hard: true, note: race.raceTime ? "Zielzeit " + race.raceTime + " (" + fmtPace(P.rp) + "/km)" : "Wettkampf", target: { kind: "race" } }, d.dow));
    }

    // 3. Läufe dieser Woche
    const existingRuns = mine.filter(w => w.sport === "run").length;
    let nRuns = Math.max(0, runs - existingRuns - (wk.phase === "race" ? 1 : 0));
    const qCount = runs >= 4 ? 2 : runs >= 2 ? 1 : 0;
    const hasLong = nRuns >= 1 && !["race", "recovery"].includes(wk.phase);
    const qSlots = wk.phase === "race" ? Math.min(1, nRuns) : hasLong ? nRuns - 1 : 0;
    const qTypes = qualityTypes(wk.phase, wk.deload, qCount, wi).slice(0, Math.max(0, qSlots));
    const runItems = [];
    let kmLeft = wk.km;
    if (hasLong) {
      const lrMax = (Number(cfg.longRunMaxMin) || 150) * 60 / P.z.easy[1];
      const share = runs <= 3 ? 0.36 : 0.3;
      const lrKm = Math.max(6, Math.min(lrMax, wk.km * share, D >= 42 ? 32 : D >= 21 ? 22 : 18));
      runItems.push(longRun(wk.phase === "taper" ? lrKm * 0.7 : lrKm, P, wk.phase, D));
      kmLeft -= runItems[0].distanceKm; nRuns--;
    }
    for (const t of qTypes) { if (nRuns <= 0) break; const q = qualitySession(t, wi, P, wk.phase, wk.deload, D); runItems.push(q); kmLeft -= q.distanceKm; nRuns--; }
    for (let i = 0; i < nRuns; i++) {
      const km = Math.max(4, Math.min(16, kmLeft / (nRuns - i)));
      const e = easyRun(km, P, wk.phase === "recovery");
      runItems.push(e); kmLeft -= e.distanceKm;
    }

    // Belastungsgrenze (Gesamtbelastung) prüfen: flexible Einheiten kürzen
    const blocks = [];
    for (const b of cfg.blocks || []) {
      const have = mine.filter(w => w.sport === b.sport && (b.sport !== "gym" || w.focus === b.focus)).length;
      for (let i = have; i < (Number(b.perWeek) || 0); i++) {
        if (wk.phase === "race" && (b.sport === "plyo" || (b.sport === "gym" && (b.focus === "legs" || b.focus === "full")))) continue;
        blocks.push({ sport: b.sport, focus: b.sport === "gym" ? b.focus : null, durationMin: Number(b.durationMin) || 45, hard: b.sport === "plyo" || (b.sport === "gym" && (b.focus === "legs" || b.focus === "full")), isKey: false, title: b.title || null, note: b.note || "", target: { kind: "block" } });
      }
    }
    const endu = [];
    for (const e of cfg.endurance || []) for (let i = 0; i < (Number(e.perWeek) || 0); i++) endu.push(z2(e.sport, Number(e.durationMin) || 45, settings));

    const z = settings.zones;
    const est = l => l.reduce((s, w) => s + loadOf(w, z), 0);
    const weekLoad = () => est([...placed, ...mine.filter(w => w.status === "planned"), ...runItems, ...blocks, ...endu]);
    if (prevLoad && !wk.deload && ["base", "build", "peak"].includes(wk.phase)) {
      const limit = prevLoad * (1 + (Number(rules.maxIncreasePct) || 10) / 100);
      let guard = 0;
      while (weekLoad() > limit && guard++ < 8) {
        let changed = false;
        for (const e of endu) if (e.durationMin > 30) { e.durationMin = Math.round(e.durationMin * 0.85); e.note = e.note.replace(/^\d+ min/, e.durationMin + " min"); changed = true; }
        for (const r of runItems) if (r.target.kind === "easy" && r.distanceKm > 4) { const n = easyRun(Math.max(4, r.distanceKm * 0.88), P, false); Object.assign(r, n); changed = true; }
        if (!changed) break;
      }
    }

    // 4. Verteilen: lang → Qualität → harte Kraft → mittlere Kraft → lockere Läufe → Z2 → Dehnen
    const order = [
      ...runItems.filter(r => r.target.kind === "long" && r.hard),
      ...runItems.filter(r => r.target.kind === "quality"),
      ...runItems.filter(r => r.target.kind === "long" && !r.hard),
      ...blocks.filter(b => b.hard),
      ...blocks.filter(b => !b.hard && b.sport !== "stretch"),
      ...runItems.filter(r => r.target.kind === "easy" || r.target.kind === "recovery"),
      ...endu,
      ...blocks.filter(b => b.sport === "stretch"),
    ];
    for (const it of order) {
      let w = board.place(it);
      // Kein Tag für die harte Variante frei → als lockeren Lauf einplanen statt ganz wegzulassen
      if (!w && it.sport === "run" && it.target?.kind !== "easy") {
        const e = easyRun(Math.min(it.distanceKm || 6, 14), P, false);
        e.note += " · statt „" + it.title + "“ (kein passender Tag frei)";
        board.unplaced.pop();
        w = board.place(e);
        if (w) wk.downgraded = (wk.downgraded || 0) + 1;
      }
      add(w);
    }

    wk.unplaced = board.unplaced.map(u => u.title || (u.sport === "gym" && FOCUS[u.focus]) || BASE_SPORTS[u.sport]?.label || u.sport);
    for (const w of placed) out.push({ ...w, id: newId(), status: "planned", source: "plan", planId, locked: false });
    wk.load = Math.round(est([...placed, ...mine]));
    wk.sessions = placed.length + mine.length;
    wk.plannedKm = Math.round([...placed, ...mine].filter(w => w.sport === "run").reduce((s, w) => s + (+w.distanceKm || 0), 0));
    if (!wk.deload && ["base", "build", "peak"].includes(wk.phase)) prevLoad = wk.load;
    prevHard = board.hardTail();
  });

  return { planId, workouts: out, weeks, removed: existing.filter(w => !w.deleted && w.status === "planned" && w.source === "plan" && !w.locked && w.date >= applyFrom && w.date <= cfg.end) };
}

// ---------- Verpasste Einheiten: freien Platz in derselben Woche finden ----------
export function rescheduleOptions(missed, all, cfg, rules, today) {
  const monday = ymd(mondayOf(parse(missed.date)));
  const sunday = ymd(addDays(parse(monday), 6));
  if (today > sunday) return null;
  const from = today > missed.date ? today : addDaysStr2(missed.date, 1);
  const board = new WeekBoard(monday, { ...cfg, start: cfg.start, end: cfg.end }, rules, { from, to: sunday });
  const matchDows = (cfg.fixed || []).filter(f => f.match).map(f => Number(f.weekday));
  board.prevMatch = matchDows.includes(7);
  board.nextMatch = matchDows.includes(1);
  const rd = cfg.goal?.race ? cfg.goal.raceDate : null;
  board.markMatches(board.days.filter(d => matchDows.includes(d.dow)).map(d => d.date), rd);
  all.filter(w => !w.deleted && w.id !== missed.id && w.date >= monday && w.date <= sunday && w.status !== "missed").forEach(w => board.occupy(w));
  const res = board.place({ ...missed, target: { ...(missed.target || {}) } });
  return res ? { date: res.date, slot: res.slot, part: res.target?.part } : null;
}
const addDaysStr2 = (s, n) => ymd(addDays(parse(s), n));

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
