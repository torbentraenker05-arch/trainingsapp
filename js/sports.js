// Sportarten, Strava-Zuordnung, Zonen und Standardeinstellungen
import { fmtPace } from "./util.js";

export const BASE_SPORTS = {
  run: { label: "Laufen", c: "var(--run)", km: true },
  football: { label: "Fußball", c: "var(--football)", km: true },
  bike: { label: "Radfahren", c: "var(--bike)", km: true },
  swim: { label: "Schwimmen", c: "var(--swim)", km: true },
  row: { label: "Rudern", c: "var(--row)", km: true, p500: true },
  skierg: { label: "SkiErg", c: "var(--skierg)", km: true, p500: true },
  stepper: { label: "Stepper", c: "var(--stepper)" },
  plyo: { label: "Plyometrics", c: "var(--plyo)" },
  gym: { label: "Kraft", c: "var(--gym)" },
  stretch: { label: "Dehnen", c: "var(--stretch)" },
  other: { label: "Sonstiges", c: "var(--other)", km: true },
};
export const FOCUS = { push: "Push", pull: "Pull", legs: "Beine", full: "Ganzkörper", cali: "Calisthenics" };

// Ausdauer-Sportarten, für die der Plan Zonen und Intervalle erzeugt
export const ENDURANCE = new Set(["run", "bike", "swim", "row", "skierg", "stepper"]);

export const DEFAULT_STRAVA_MAP = {
  Run: "run", TrailRun: "run", VirtualRun: "run",
  Ride: "bike", VirtualRide: "bike", GravelRide: "bike", MountainBikeRide: "bike", EBikeRide: "bike", EMountainBikeRide: "bike", Velomobile: "bike", Handcycle: "bike",
  Swim: "swim", Rowing: "row", VirtualRow: "row", StairStepper: "stepper",
  WeightTraining: "gym", Crossfit: "gym", Yoga: "stretch", Pilates: "stretch", Soccer: "football", NordicSki: "skierg",
  HighIntensityIntervalTraining: "other", Workout: "other", Walk: "other", Hike: "other", Elliptical: "other",
};

export const DEFAULT_RULES = {
  maxIncreasePct: 10,      // Wochenumfang höchstens +10 %
  deloadEvery: 4,          // jede 4. Woche Entlastung
  deloadFactor: 70,        // Entlastungswoche: 70 % Umfang
  maxHardInRow: 2,         // höchstens 2 harte Tage in Folge
  noLegsBeforeMatch: true, // keine Beine/Plyo am Tag vor dem Spiel
  recoveryAfterMatch: true,// am Tag nach dem Spiel nur Regeneration
  qualityBeforeStrength: true, // Ausdauer-Qualität vor Kraft am selben Tag
  hardDaysHard: true,      // harte Einheiten bündeln
  maxPerDay: 4,            // max. Einheiten pro Tag (ohne Dehnen)
  maxPerDaySwim: 3,        // … wenn Schwimmen dabei ist
  excludedIntervals: [],   // abgewählte Intervall-Typen
};

export const DEFAULT_SETTINGS = {
  zones: { refDistanceKm: 5, refTime: "25:00", hrMax: 190, hrRest: 60 },
  rules: { ...DEFAULT_RULES },
  sports: {},      // eigene Sportarten {key:{label,c,km}}
  stravaMap: {},   // Überschreibungen
  dismissed: [],   // abgelehnte Vorschläge
};

export function sportsOf(settings) {
  return { ...BASE_SPORTS, ...(settings?.sports || {}) };
}
export function sportOf(settings, key) {
  const all = sportsOf(settings);
  return all[key] || all.other;
}

// Riegel-Formel: Zeit (s) für Distanz d aus Referenzleistung
export function riegel(refKm, refSec, d) { return refSec * Math.pow(d / refKm, 1.06); }

export function paceZones(z) {
  const refKm = Number(z.refDistanceKm) || 5;
  const refSec = parseTimeSafe(z.refTime);
  if (!refSec) return null;
  const p = d => riegel(refKm, refSec, d) / d;
  const p5 = p(5);
  return {
    recovery: [p5 * 1.42, p5 * 1.55],
    easy: [p5 * 1.25, p5 * 1.40],
    marathon: [p(42.195), p(42.195)],
    threshold: [p(15) * 0.99, p(15) * 1.01],
    interval: [p(3) * 0.99, p(3) * 1.01],
    rep: [p(1.5), p(1.5)],
    p5,
    pace: p,
  };
}
function parseTimeSafe(t) {
  const p = String(t || "").split(":").map(Number);
  if (!p.length || p.some(isNaN)) return null;
  return p.length === 3 ? p[0] * 3600 + p[1] * 60 + p[2] : p.length === 2 ? p[0] * 60 + p[1] : null;
}
export const ZONE_LABEL = { recovery: "Regeneration", easy: "Locker (Z2)", marathon: "Marathon-Tempo", threshold: "Schwelle", interval: "Intervall (VO2max)", rep: "Wiederholung" };
export function fmtRange(r) { return r[0] === r[1] || Math.abs(r[0] - r[1]) < 3 ? fmtPace(r[0]) : fmtPace(r[0]) + "–" + fmtPace(r[1]); }

// Karvonen-Pulszonen
export function hrZones(z) {
  const max = Number(z.hrMax) || 190, rest = Number(z.hrRest) || 60, r = max - rest;
  const at = f => Math.round(rest + r * f);
  return [
    { z: 1, name: "Z1 Regeneration", lo: at(.5), hi: at(.6) },
    { z: 2, name: "Z2 Grundlage", lo: at(.6), hi: at(.7) },
    { z: 3, name: "Z3 Tempo", lo: at(.7), hi: at(.8) },
    { z: 4, name: "Z4 Schwelle", lo: at(.8), hi: at(.9) },
    { z: 5, name: "Z5 VO2max", lo: at(.9), hi: max },
  ];
}

// Banister-TRIMP
export function trimp(durMin, avgHr, z) {
  const max = Number(z.hrMax) || 190, rest = Number(z.hrRest) || 60;
  if (!avgHr || !durMin || max <= rest) return null;
  const r = Math.min(1, Math.max(0, (avgHr - rest) / (max - rest)));
  return Math.round(durMin * r * 0.64 * Math.exp(1.92 * r));
}
// Belastung einer Einheit: TRIMP aus Puls, sonst Dauer × RPE, sonst Schätzung
export function loadOf(w, z) {
  if (w.trimp) return +w.trimp;
  const t = trimp(+w.durationMin, +w.avgHr, z);
  if (t) return t;
  if (w.rpe && w.durationMin) return Math.round(w.durationMin * w.rpe * 0.6);
  if (w.durationMin) return Math.round(w.durationMin * (w.hard ? 1.6 : 0.9));
  return 0;
}
