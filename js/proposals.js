// Vorschläge, die du bestätigen oder ablehnen kannst: verpasste Einheiten, Wochenanpassung, neue Zonen
import { esc, ymd, parse, addDays, mondayOf, todayStr, shortDate, WD, fmtTime, parseTime, toast, addDaysStr } from "./util.js";
import { store } from "./store.js";
import { sportOf, riegel, paceZones } from "./sports.js";
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

  // 3. Zonen: schnellere Läufe oder höherer Maximalpuls aus Strava/Einträgen
  const since = addDaysStr(t, -56);
  const runs = all.filter(w => w.status === "done" && w.sport === "run" && w.date >= since && +w.distanceKm >= 3 && +w.durationMin > 0);
  const pz = paceZones(z);
  if (pz && runs.length) {
    const best = Math.min(...runs.map(w => riegel(+w.distanceKm, w.durationMin * 60, 5)));
    const cur = riegel(Number(z.refDistanceKm) || 5, parseTime(z.refTime), 5);
    const k = "z5:" + Math.round(best);
    if (best < cur * 0.98 && !dismissed(k)) out.push({ key: k, text: `Deine Läufe der letzten 8 Wochen deuten auf eine 5-km-Zeit von <b>${fmtTime(best)}</b> hin (bisher ${fmtTime(cur)}). Pace-Zonen aktualisieren?`,
      actions: [["Aktualisieren", () => { store.saveSettings({ zones: { ...store.settings.zones, refDistanceKm: 5, refTime: fmtTime(best) } }); toast("Zonen aktualisiert – gilt für neu berechnete Pläne"); }], ["Ablehnen", () => dismiss(k)]] });
  }
  const maxHr = Math.max(0, ...all.filter(w => w.status === "done" && w.date >= since).map(w => +w.maxHr || 0));
  const kHr = "hr:" + maxHr;
  if (maxHr > (Number(z.hrMax) || 190) && maxHr < 230 && !dismissed(kHr)) out.push({ key: kHr, text: `Gemessener Maximalpuls <b>${maxHr} bpm</b> liegt über deinem eingestellten (${z.hrMax}). Übernehmen?`,
    actions: [["Übernehmen", () => store.saveSettings({ zones: { ...store.settings.zones, hrMax: maxHr } })], ["Ablehnen", () => dismiss(kHr)]] });
  return out;
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
