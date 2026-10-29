// Vorschläge, die du bestätigen oder ablehnen kannst: verpasste Einheiten, Wochenanpassung, neue Zonen
import { esc, ymd, parse, addDays, mondayOf, todayStr, shortDate, WD, fmtTime, parseTime, toast, addDaysStr } from "./util.js";
import { store } from "./store.js";
import { sportOf } from "./sports.js";
import { rescheduleOptions, weekBalance } from "./planner.js";

const dismissed = k => store.settings.dismissed.includes(k);
function dismiss(k) { store.saveSettings({ dismissed: [...store.settings.dismissed.slice(-200), k] }); }
const nameOf = w => w.title || sportOf(store.settings, w.sport).label;
const wd = s => WD[parse(s).getDay()].slice(0, 2);

export function proposals() {
  const out = [], t = todayStr(), all = store.allWorkouts(), plan = store.activePlan();
  const cfg = plan ? { ...plan.config, start: plan.start, end: plan.end } : null;
  const z = store.settings.zones;

  // 1. Verpasste Einheiten der letzten 14 Tage
  const missed = all.filter(w => w.status === "planned" && w.date < t && w.date >= addDaysStr(t, -14) && w.planId);
  const easy = [];
  for (const w of missed) {
    if (w.isKey && cfg) {
      const opt = rescheduleOptions(w, all, cfg, store.settings.rules, t);
      if (opt && !dismissed("mv:" + w.id + ":" + opt.date)) {
        out.push({ key: "mv:" + w.id + ":" + opt.date, text: `<b>${esc(nameOf(w))}</b> vom ${wd(w.date)} ${shortDate(w.date)} verpasst. Auf <b>${wd(opt.date)} ${shortDate(opt.date)}${opt.part ? " " + esc(opt.part) : ""}</b> verschieben?`,
          actions: [["Verschieben", () => store.putWorkout({ ...w, date: opt.date, slot: opt.slot, target: { ...(w.target || {}), part: opt.part }, locked: true })],
                    ["Verfallen lassen", () => store.putWorkout({ ...w, status: "missed" })]] });
        continue;
      }
    }
    easy.push(w);
  }
  if (easy.length) out.push({ key: "easy:" + easy.map(w => w.id).join(","), text: easy.length === 1 ? `<b>${esc(nameOf(easy[0]))}</b> vom ${wd(easy[0].date)} ${shortDate(easy[0].date)} nicht erledigt.` : `<b>${easy.length} Einheiten</b> der letzten Tage nicht erledigt (${easy.map(w => esc(nameOf(w))).join(", ")}).`,
    actions: [["Verfallen lassen", () => store.putWorkouts(easy.map(w => ({ ...w, status: "missed" })))]], hint: "Erledigt? Dann im Kalender abhaken." });

  // 2. Letzte Woche deutlich unter Plan → diese Woche Laufumfang reduzieren
  const thisMon = ymd(mondayOf(new Date())), lastMon = addDaysStr(thisMon, -7);
  const bal = weekBalance(all, lastMon, z);
  const kAdj = "adj:" + thisMon;
  if (bal.plannedCount >= 3 && bal.ratio < 0.7 && !dismissed(kAdj)) {
    const runs = all.filter(w => w.status === "planned" && w.planId && w.sport === "run" && w.date >= t && w.date <= addDaysStr(thisMon, 6) && !w.locked && w.target?.kind !== "race");
    if (runs.length) out.push({ key: kAdj, text: `Letzte Woche hast du <b>${Math.round(bal.ratio * 100)} %</b> der geplanten Belastung geschafft. Laufumfang dieser Woche um 15 % senken, damit der Sprung nicht zu groß wird?`,
      actions: [["Anpassen", () => { store.putWorkouts(runs.map(w => scaleRun(w, 0.85))); dismiss(kAdj); toast(runs.length + " Läufe angepasst"); }], ["Nein, so lassen", () => dismiss(kAdj)]] });
  }

  // 3. Pace-Zonen: tatsächliche Intervall-Pace (aus den FIT-Dateien) gegen die geplante, letzte 3 Intervall-Läufe
  const ivRuns = all.filter(w => w.status === "done" && w.sport === "run" && w.date >= addDaysStr(t, -60) && w.recovery?.reps?.length && planPace(w))
    .sort((a, b) => b.date.localeCompare(a.date)).slice(0, 3);
  const refSec = parseTime(z.refTime);
  if (ivRuns.length === 3 && refSec) {
    const ratios = ivRuns.map(w => { const reps = w.recovery.reps, m = reps.reduce((s, r) => s + r.m, 0); return (reps.reduce((s, r) => s + r.sec, 0) / m * 1000) / planPace(w); });
    const faster = ratios.every(r => r < 0.98), slower = ratios.every(r => r > 1.04);
    if (faster || slower) {
      const r = ratios.reduce((a, b) => a + b, 0) / ratios.length;
      const newRef = fmtTime(refSec * r), diff = Math.round(Math.abs(1 - r) * 100);
      const k = "zp:" + newRef;
      if (!dismissed(k)) out.push({ key: k, text: `Deine letzten 3 Intervall-Läufe warst du im Schnitt <b>${diff} % ${faster ? "schneller" : "langsamer"}</b> als geplant. Pace-Zonen anpassen (${esc(String(z.refDistanceKm))} km: ${esc(z.refTime)} → <b>${newRef}</b>)?`,
        actions: [["Anpassen", () => { store.saveSettings({ zones: { ...store.settings.zones, refTime: newRef } }); dismiss(k); toast("Zonen angepasst – gilt beim nächsten Neuberechnen des Plans"); }], ["Ablehnen", () => dismiss(k)]] });
    }
  }

  // 4. Maximalpuls: nur Werte, die von einem zweiten Lauf bestätigt werden (einzelne Messfehler wie 211 zählen nicht)
  const maxHr = robustMaxHr(all.filter(w => w.status === "done" && w.date >= addDaysStr(t, -180)).map(w => +w.maxHr || 0));
  const kHr = "hr:" + maxHr;
  if (maxHr && maxHr > (Number(z.hrMax) || 190) && !dismissed(kHr)) out.push({ key: kHr, text: `Gemessener Maximalpuls <b>${maxHr} bpm</b> liegt über deinem eingestellten (${z.hrMax}). Übernehmen?`,
    actions: [["Übernehmen", () => store.saveSettings({ zones: { ...store.settings.zones, hrMax: maxHr } })], ["Ablehnen", () => dismiss(kHr)]] });
  return out;
}

// Geplante Intervall-Pace (s/km), gewichtet nach Strecke; null, wenn die Einheit keine Strecken-Intervalle hatte
function planPace(w) {
  const sets = (w.intervals?.sets || []).filter(x => x.m && x.pace && !x.uphill);
  const m = sets.reduce((s, x) => s + x.m * x.reps, 0);
  return m ? sets.reduce((s, x) => s + x.m * x.reps * x.pace, 0) / m : null;
}
// Höchster Puls, den mindestens ein zweiter Wert bis auf 5 bpm bestätigt
export function robustMaxHr(values) {
  const v = values.filter(x => x >= 120 && x <= 225).sort((a, b) => b - a);
  for (let i = 0; i + 1 < v.length; i++) if (v[i] - v[i + 1] <= 5) return v[i];
  return null;
}

function scaleRun(w, f) {
  const km = Math.max(3, Math.round((+w.distanceKm || 0) * f * 10) / 10);
  const min = Math.round((+w.durationMin || 0) * f);
  return { ...w, distanceKm: km, durationMin: min, note: (w.note || "") + ` (angepasst: ${String(km).replace(".", ",")} km)` };
}

export function renderProposals(el, list) {
  if (!list.length) { el.innerHTML = ""; return; }
  el.innerHTML = `<div class="proposals"><div class="label">Vorschläge</div>${list.map((p, i) => `<div class="proposal"><span class="grow">${p.text}${p.hint ? `<br><span class="hint">${esc(p.hint)}</span>` : ""}</span><span class="row">${p.actions.map(([l], j) => `<button class="btn small${j ? " secondary" : ""}" data-p="${i}" data-a="${j}">${esc(l)}</button>`).join("")}</span></div>`).join("")}</div>`;
  el.onclick = e => { const b = e.target.closest("button[data-p]"); if (!b) return; list[+b.dataset.p].actions[+b.dataset.a][1](); };
}
