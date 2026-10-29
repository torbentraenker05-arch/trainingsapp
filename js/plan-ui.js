// Plan-Tab: Übersicht, Assistent, Regeln und Übergabe an Claude
import { $, $$, esc, ymd, parse, addDays, mondayOf, isoWeek, todayStr, fmtKm, shortDate, WD, WD_SHORT, newId, clone, toast, addDaysStr, num, parseTime, fmtPace } from "./util.js";
import { store } from "./store.js";
import { sportsOf, sportOf, FOCUS, paceZones, hrZones, fmtRange, ZONE_LABEL, loadOf, DEFAULT_RULES } from "./sports.js";
import { generatePlan, PHASE_LABEL, RACES, CROSS_SPORTS, INTERVAL_TYPES, normCross } from "./planner.js";

const st = { wizard: null }; // {step, cfg, preview}
const STEPS = ["Ziel", "Termine", "Bausteine", "Zonen", "Vorschau"];

export function renderPlan(passive = false) {
  if (st.wizard) { if (!passive) renderWizard(); return; }
  renderOverview();
}

// ---------- Übersicht ----------
function renderOverview() {
  const p = store.activePlan(), app = $("#app"), t = todayStr();
  if (!p) {
    app.innerHTML = `<section class="view"><div class="intro"><h2>Dein Trainingsplan</h2>
      <p>Der Assistent fragt Ziel, Zeitraum, feste Termine wie Fußball, deine Kraft- und Dehn-Bausteine und deine Cross-Sportarten ab. Daraus baut der Algorithmus einen Plan mit Aufbau- und Entlastungswochen und trägt ihn in den Kalender ein. Kostenlos, ohne KI.</p>
      <button class="btn" id="newPlan">Plan erstellen</button></div>${rulesHTML()}</section>`;
    $("#newPlan").onclick = () => startWizard(null);
    bindRules();
    return;
  }
  const c = p.config || {};
  const weeks = c.weeks || [];
  const all = store.allWorkouts();
  const z = store.settings.zones;
  const curMon = ymd(mondayOf(new Date()));
  const maxKm = Math.max(1, ...weeks.map(w => w.plannedKm || w.km || 0));
  const rows = weeks.map((w, i) => {
    const sun = addDaysStr(w.monday, 6);
    const done = all.filter(x => x.status === "done" && x.date >= w.monday && x.date <= sun);
    const dKm = done.filter(x => x.sport === "run").reduce((s, x) => s + (+x.distanceKm || 0), 0);
    const pl = all.filter(x => x.planId === p.id && x.date >= w.monday && x.date <= sun);
    const ph = w.deload ? "deload" : w.phase;
    return `<div class="weekrow"${w.monday === curMon ? ' style="background:var(--accent-soft);border-radius:10px;padding-inline:8px"' : ""}>
      <span class="kwn">KW ${isoWeek(parse(w.monday))}</span>
      <span class="stack" style="gap:4px"><span class="row"><span class="phase ${ph}">${PHASE_LABEL[ph] || ph}</span><span class="muted">${shortDate(w.monday)} · ${pl.filter(x => x.status === "done").length}/${pl.length} erledigt</span></span>
        <span class="minibar" style="width:${Math.max(4, (w.plannedKm || w.km || 0) / maxKm * 100)}%"></span>
        ${w.unplaced?.length ? `<span class="hint" style="color:var(--danger)">Nicht untergebracht: ${esc(w.unplaced.join(", "))}</span>` : ""}</span>
      <span class="num" style="text-align:right">${w.monday <= t ? fmtKm(dKm) + " / " : ""}${w.plannedKm ?? w.km} km</span></div>`;
  }).join("");
  const goal = c.goal?.race ? `${RACES.find(r => r.km === Number(c.goal.raceDistanceKm))?.label || c.goal.raceDistanceKm + " km"} am ${shortDate(c.goal.raceDate)}${c.goal.raceTime ? " in " + esc(c.goal.raceTime) : ""}` : "Allgemeine Ausdauer";
  app.innerHTML = `<section class="view">
    <div class="panel stack">
      <div class="panel-h" style="margin:0"><h2>${esc(p.name || "Mein Plan")}</h2><span class="chip plan">aktiv</span></div>
      <div class="hint">${shortDate(p.start)}${parse(p.start).getFullYear()} – ${shortDate(p.end)}${parse(p.end).getFullYear()} · Ziel: ${goal} · ${c.runsPerWeek} Läufe/Woche</div>
      <div class="row">
        <button class="btn" id="editPlan">Plan bearbeiten</button>
        <button class="btn secondary" id="recalc">Ab heute neu berechnen</button>
        <button class="btn secondary" id="claude">An Claude übergeben</button>
      </div>
      <div class="row"><button class="btn danger small" id="endPlan">Plan beenden</button><span class="hint">Beenden entfernt alle offenen geplanten Einheiten dieses Plans ab heute.</span></div>
      <div class="confirm" id="endConfirm" hidden>Plan wirklich beenden?<button class="btn danger" id="endYes">Ja, beenden</button><button class="btn secondary" id="endNo">Abbrechen</button></div>
    </div>
    <div class="panel"><div class="panel-h"><h3>Wochen</h3><span class="hint">gelaufen / geplant</span></div>${rows || '<div class="empty">Keine Wochen</div>'}</div>
    ${rulesHTML()}
  </section>`;
  $("#editPlan").onclick = () => startWizard(p);
  $("#recalc").onclick = () => { startWizard(p); st.wizard.step = 5; renderWizard(); };
  $("#claude").onclick = () => openBridge(p);
  $("#endPlan").onclick = () => $("#endConfirm").hidden = false;
  $("#endNo").onclick = () => $("#endConfirm").hidden = true;
  $("#endYes").onclick = () => {
    const rm = store.allWorkouts().filter(w => w.planId === p.id && w.status === "planned" && w.date >= t && !w.locked);
    store.putWorkouts(rm.map(w => ({ ...w, deleted: true })));
    store.putPlan({ ...p, active: false, end: t < p.end ? t : p.end });
    toast("Plan beendet");
  };
  bindRules();
}

// ---------- Regeln ----------
function rulesHTML() {
  const r = store.settings.rules;
  const n = (k, l, unit) => `<div class="field"><label for="r-${k}">${l}</label><span class="row"><input type="number" id="r-${k}" data-r="${k}" value="${esc(r[k])}" inputmode="numeric">${unit ? `<span class="hint">${unit}</span>` : ""}</span></div>`;
  const b = (k, l) => `<label class="switch"><span>${l}</span><input type="checkbox" data-r="${k}"${r[k] ? " checked" : ""}></label>`;
  return `<div class="panel rules"><div class="panel-h"><h3>Regeln des Plans</h3><button class="ghost" id="rReset">Standard</button></div>
    <p class="hint">Gelten beim nächsten Erstellen oder Neuberechnen eines Plans.</p>
    <div class="stack">
      ${n("maxIncreasePct", "Max. Steigerung pro Woche (Laufkilometer und Gesamtbelastung)", "%")}
      ${n("deloadEvery", "Entlastungswoche alle", "Wochen")}
      ${n("deloadFactor", "Umfang in der Entlastungswoche", "%")}
      ${n("maxHardInRow", "Max. harte Tage in Folge", "Tage")}
      ${n("maxPerDay", "Max. Einheiten pro Tag (ohne Dehnen)", "")}
      ${n("maxPerDaySwim", "… an Tagen mit Schwimmen", "")}
      ${b("hardDaysHard", "Harte Einheiten am selben Tag bündeln (z. B. Intervalle + Beine)")}
      ${b("qualityBeforeStrength", "Ausdauer-Qualität vor dem Krafttraining")}
      ${b("noLegsBeforeMatch", "Keine Beine, Plyo oder harten Läufe am Tag vor dem Spiel")}
      ${b("recoveryAfterMatch", "Am Tag nach dem Spiel kein Laufen, keine Beine, kein Plyo")}
      <div class="field" style="flex-direction:column;align-items:stretch"><span class="label">Intervall-Typen, die vorkommen dürfen</span>
        <div class="sports">${Object.entries(INTERVAL_TYPES).map(([k, l]) => `<label style="--c:var(--run)"><input type="checkbox" data-iv="${k}"${(r.excludedIntervals || []).includes(k) ? "" : " checked"}><i></i>${l}</label>`).join("")}</div></div>
    </div></div>`;
}
function bindRules() {
  $$("[data-r]").forEach(el => el.onchange = () => {
    const r = { ...store.settings.rules };
    r[el.dataset.r] = el.type === "checkbox" ? el.checked : Math.max(0, num(el.value) ?? DEFAULT_RULES[el.dataset.r]);
    store.saveSettings({ rules: r }); toast("Regel gespeichert");
  });
  $$("[data-iv]").forEach(el => el.onchange = () => {
    const ex = $$("[data-iv]").filter(x => !x.checked).map(x => x.dataset.iv);
    if (ex.length === Object.keys(INTERVAL_TYPES).length) { el.checked = true; toast("Mindestens ein Typ muss bleiben"); return; }
    store.saveSettings({ rules: { ...store.settings.rules, excludedIntervals: ex } }); toast("Gespeichert");
  });
  const rs = $("#rReset"); if (rs) rs.onclick = () => { store.saveSettings({ rules: { ...DEFAULT_RULES } }); renderOverview(); toast("Standardregeln wiederhergestellt"); };
}

// ---------- Assistent ----------
function defaultCfg() {
  const t = new Date(), dow = (t.getDay() + 6) % 7; // 0 = Montag
  const start = dow === 0 ? todayStr() : ymd(addDays(t, 7 - dow));
  return {
    name: "Mein Plan", start, end: ymd(addDays(parse(start), 12 * 7 - 1)),
    goal: { race: false, raceDistanceKm: 10, raceDate: ymd(addDays(parse(start), 12 * 7 - 1)), raceTime: "" },
    runsPerWeek: 3, startKm: recentKm() || 15, longRunMaxMin: 120,
    fixed: [
      { weekday: 7, sport: "football", durationMin: 90, title: "Fußballspiel", match: true },
      { weekday: 3, sport: "football", durationMin: 90, title: "Fußballtraining", match: false },
      { weekday: 5, sport: "football", durationMin: 90, title: "Fußballtraining", match: false },
    ],
    blocks: [
      { sport: "gym", focus: "push", durationMin: 60, perWeek: 1 }, { sport: "gym", focus: "pull", durationMin: 60, perWeek: 1 },
      { sport: "gym", focus: "legs", durationMin: 60, perWeek: 1 }, { sport: "plyo", focus: null, durationMin: 30, perWeek: 1 },
      { sport: "gym", focus: "cali", durationMin: 45, perWeek: 1 }, { sport: "stretch", focus: null, durationMin: 15, perWeek: 2 },
    ],
    cross: { sports: ["bike", "row", "stepper", "skierg", "swim"], perWeekFootball: 2, perWeekNoFootball: 4, durationMin: 30 },
    notes: "",
  };
}
function recentKm() {
  const t = todayStr(), from = addDaysStr(t, -28);
  const km = store.allWorkouts().filter(w => w.status === "done" && w.sport === "run" && w.date >= from && w.date < t).reduce((s, w) => s + (+w.distanceKm || 0), 0);
  return Math.round(km / 4);
}
function historyLoad() {
  const z = store.settings.zones, mon = mondayOf(new Date()), loads = [];
  for (let i = 1; i <= 4; i++) {
    const a = ymd(addDays(mon, -7 * i)), b = ymd(addDays(mon, -7 * i + 6));
    const l = store.allWorkouts().filter(w => w.status === "done" && w.date >= a && w.date <= b).reduce((s, w) => s + loadOf(w, z), 0);
    if (l > 0) loads.push(l);
  }
  return loads.length >= 3 ? { avgWeekLoad: loads.reduce((a, b) => a + b, 0) / loads.length } : {};
}
function startWizard(plan) {
  const cfg = plan ? { ...defaultCfg(), ...clone(plan.config), name: plan.name, start: plan.start, end: plan.end, planId: plan.id } : defaultCfg();
  delete cfg.weeks;
  cfg.cross = normCross(cfg);
  delete cfg.windows; delete cfg.endurance;
  st.wizard = { step: 0, cfg, editing: !!plan };
  renderWizard();
}

function renderWizard() {
  const W = st.wizard, c = W.cfg, app = $("#app");
  const nav = `<div class="steps-nav">${STEPS.map((s, i) => `<i class="${i <= W.step ? "on" : ""}"></i>`).join("")}</div>`;
  const body = [stepGoal, stepFixed, stepBlocks, stepZones, stepPreview][W.step](c);
  app.innerHTML = `<section class="view">
    <div class="panel-h" style="margin:0"><h2>${W.editing ? "Plan bearbeiten" : "Neuer Plan"} · ${STEPS[W.step]}</h2><button class="ghost" id="wzCancel">Abbrechen</button></div>
    ${nav}
    <form class="panel stack" id="wz" novalidate>${body}</form>
    <div class="actions">
      ${W.step > 0 ? '<button class="btn secondary" id="wzBack">Zurück</button>' : "<span></span>"}
      ${W.step < STEPS.length - 1 ? '<button class="btn" id="wzNext">Weiter</button>' : '<button class="btn" id="wzApply">Plan übernehmen</button>'}
    </div>
  </section>`;
  $("#wzCancel").onclick = () => { st.wizard = null; renderOverview(); };
  const back = $("#wzBack"); if (back) back.onclick = () => { W.step--; renderWizard(); window.scrollTo(0, 0); };
  const next = $("#wzNext"); if (next) next.onclick = () => { const err = validate(W.step, c); if (err) { toast(err); return; } W.step++; renderWizard(); window.scrollTo(0, 0); };
  const apply = $("#wzApply"); if (apply) apply.onclick = applyPlan;
  $("#wz").onsubmit = e => e.preventDefault();
  [bindGoal, bindFixed, bindBlocks, bindZones, () => {}][W.step](c);
}
function validate(step, c) {
  if (step === 0) {
    if (!c.start || !c.end || c.end <= c.start) return "Bitte einen gültigen Zeitraum wählen";
    if (c.goal.race && (!c.goal.raceDate || c.goal.raceDate < c.start || c.goal.raceDate > c.end)) return "Das Wettkampfdatum muss im Zeitraum liegen";
    if (c.goal.race && c.goal.raceTime && !parseTime(c.goal.raceTime)) return "Zielzeit bitte als mm:ss oder h:mm:ss";
  }
  if (step === 1 && c.fixed.some(f => f.from && f.to && f.to < f.from)) return "Bei einem Termin liegt „bis“ vor „von“";
  if (step === 2 && (c.cross.perWeekFootball || c.cross.perWeekNoFootball) && !c.cross.sports.length) return "Bitte mindestens eine Cross-Sportart anhaken";
  return null;
}

const sportOpts = (sel, filter) => Object.entries(sportsOf(store.settings)).filter(([k]) => !filter || filter(k)).map(([k, s]) => `<option value="${esc(k)}"${k === sel ? " selected" : ""}>${esc(s.label)}</option>`).join("");
const wdOpts = sel => [1, 2, 3, 4, 5, 6, 7].map(d => `<option value="${d}"${+sel === d ? " selected" : ""}>${WD[d % 7]}</option>`).join("");

function stepGoal(c) {
  const g = c.goal;
  return `<div class="field"><label for="g-name">Name</label><input type="text" id="g-name" value="${esc(c.name)}"></div>
    <div class="row2"><div class="field"><label for="g-start">Start</label><input type="date" id="g-start" value="${esc(c.start)}"></div>
    <div class="field"><label for="g-end">Ende</label><input type="date" id="g-end" value="${esc(c.end)}"></div></div>
    <label class="switch"><span><b>Laufwettkampf</b> als Ziel (sonst: allgemeine Ausdauer)</span><input type="checkbox" id="g-race"${g.race ? " checked" : ""}></label>
    <div class="stack" id="raceBox"${g.race ? "" : " hidden"}>
      <div class="row2"><div class="field"><label for="g-dist">Distanz</label><select class="in" id="g-dist">${RACES.map(r => `<option value="${r.km}"${Number(g.raceDistanceKm) === r.km ? " selected" : ""}>${r.label}</option>`).join("")}</select></div>
      <div class="field"><label for="g-date">Wettkampftag</label><input type="date" id="g-date" value="${esc(g.raceDate)}"></div></div>
      <div class="field"><label for="g-time">Zielzeit (optional)</label><input type="text" id="g-time" inputmode="numeric" placeholder="z. B. 45:00 oder 1:39:00" value="${esc(g.raceTime || "")}"></div>
      <p class="hint">Liegt der Wettkampf vor dem Plan-Ende, geht es danach mit Regeneration und Grundlage weiter. So kombinierst du z. B. „Grundlage bis Februar, dann 10-km-Vorbereitung“: Der Plan beginnt automatisch mit Grundlagenwochen.</p>
    </div>
    <div class="row3">
      <div class="field"><label for="g-runs">Läufe pro Woche</label><input type="number" id="g-runs" min="1" max="7" value="${esc(c.runsPerWeek)}"></div>
      <div class="field"><label for="g-km">Aktuell km/Woche</label><input type="number" id="g-km" min="0" value="${esc(c.startKm)}"></div>
      <div class="field"><label for="g-long">Langer Lauf max. (min)</label><input type="number" id="g-long" min="30" value="${esc(c.longRunMaxMin)}"></div>
    </div>
    <p class="hint">„Aktuell km/Woche“ ist mit deinem Schnitt der letzten 4 Wochen vorbelegt. Von dort steigert der Plan höchstens um ${store.settings.rules.maxIncreasePct} % pro Woche.</p>`;
}
function bindGoal(c) {
  const f = $("#wz");
  f.oninput = () => {
    c.name = $("#g-name").value; c.start = $("#g-start").value; c.end = $("#g-end").value;
    c.goal.race = $("#g-race").checked; $("#raceBox").hidden = !c.goal.race;
    c.goal.raceDistanceKm = Number($("#g-dist").value); c.goal.raceDate = $("#g-date").value; c.goal.raceTime = $("#g-time").value.trim();
    c.runsPerWeek = Math.max(1, Math.min(7, num($("#g-runs").value) || 1)); c.startKm = num($("#g-km").value) || 0; c.longRunMaxMin = num($("#g-long").value) || 120;
  };
  f.onchange = f.oninput;
}

function stepFixed(c) {
  return `<p class="hint">Feste Termine wie Fußball stehen jede Woche fest im Plan, solange sie gültig sind. Ein <b>Spiel</b> löst die Regeln aus: am Vortag keine Beine, kein Plyo, keine harten Läufe; am Tag danach kein Laufen, keine Beine, kein Plyo.</p>
  <div class="stack">${c.fixed.map((f, i) => `<div class="panel stack" style="padding:10px;background:var(--bg)">
    <div class="row2"><select class="in" data-i="${i}" data-f="weekday" aria-label="Wochentag">${wdOpts(f.weekday)}</select><select class="in" data-i="${i}" data-f="sport" aria-label="Sportart">${sportOpts(f.sport)}</select></div>
    <div class="row2"><input type="text" data-i="${i}" data-f="title" value="${esc(f.title || "")}" placeholder="Titel" aria-label="Titel"><span class="row"><input type="number" class="small-in" data-i="${i}" data-f="durationMin" value="${esc(f.durationMin)}" aria-label="Minuten"><span class="hint">min</span></span></div>
    <div class="row2"><div class="field"><label>gültig von</label><input type="date" data-i="${i}" data-f="from" value="${esc(f.from || "")}"></div><div class="field"><label>gültig bis</label><input type="date" data-i="${i}" data-f="to" value="${esc(f.to || "")}"></div></div>
    <div class="row" style="justify-content:space-between"><label class="switch" style="padding:0"><input type="checkbox" data-i="${i}" data-f="match"${f.match ? " checked" : ""}><span>Spiel / Wettkampf</span></label><button type="button" class="btn danger small" data-del="${i}">Entfernen</button></div>
  </div>`).join("")}</div>
  <button type="button" class="btn secondary" id="addFixed">+ Fester Termin</button>`;
}
function bindFixed(c) {
  const f = $("#wz");
  f.oninput = e => { const el = e.target, i = el.dataset.i; if (i == null) return; const x = c.fixed[+i];
    if (el.dataset.f === "match") x.match = el.checked; else if (el.dataset.f === "from" || el.dataset.f === "to") x[el.dataset.f] = el.value || null; else if (el.dataset.f === "durationMin" || el.dataset.f === "weekday") x[el.dataset.f] = num(el.value) || 0; else x[el.dataset.f] = el.value; };
  f.onchange = f.oninput;
  f.onclick = e => { const d = e.target.closest("[data-del]"); if (d) { c.fixed.splice(+d.dataset.del, 1); renderWizard(); } };
  $("#addFixed").onclick = () => { c.fixed.push({ weekday: 2, sport: "football", durationMin: 90, title: "", match: false }); renderWizard(); };
}

function blockLabel(b) { return b.sport === "gym" ? "gym:" + b.focus : b.sport; }
function stepBlocks(c) {
  const bOpts = sel => [...Object.entries(FOCUS).map(([k, l]) => ["gym:" + k, l]), ["plyo", "Plyo"], ["stretch", "Dehnen"],
    ...Object.entries(sportsOf(store.settings)).filter(([k]) => !BASE_KEYS.has(k)).map(([k, s]) => [k, s.label])].map(([v, l]) => `<option value="${esc(v)}"${v === sel ? " selected" : ""}>${esc(l)}</option>`).join("");
  const dayOpts = sel => `<option value="">frei</option>` + WD_SHORT.map((d, i) => `<option value="${i + 1}"${+sel === i + 1 ? " selected" : ""}>${d}</option>`).join("");
  const S = sportsOf(store.settings), x = c.cross;
  return `<h3 style="margin:0">Kraft, Plyo und Dehnen</h3>
  <p class="hint">Stehen nur als Einheit im Kalender, ohne Übungen. Mit <b>Tag</b> legst du einen Baustein fest (z. B. Push am Montag), „frei“ lässt den Algorithmus entscheiden. Dieselbe Einheit kommt nie zweimal an einem Tag; zwei verschiedene Dehn-Bausteine höchstens einmal pro Woche am selben Tag.</p>
  <div class="blocks"><div class="block b5 hint"><span>Baustein</span><span>× Wo.</span><span>Min.</span><span>Tag</span><span></span></div>
  ${c.blocks.map((b, i) => `<div class="block b5"><select class="in" data-b="${i}" data-f="kind" aria-label="Baustein">${bOpts(blockLabel(b))}</select><input type="number" data-b="${i}" data-f="perWeek" value="${b.perWeek}" min="0" max="7" aria-label="pro Woche"><input type="number" data-b="${i}" data-f="durationMin" value="${b.durationMin}" min="5" step="5" aria-label="Minuten"><select class="in" data-b="${i}" data-f="day" aria-label="Tag">${dayOpts(b.day)}</select><button type="button" class="x" data-delb="${i}" aria-label="Entfernen">✕</button></div>`).join("")}</div>
  <button type="button" class="btn secondary" id="addBlock">+ Baustein</button>
  <h3 style="margin:8px 0 0">Cross-Einheiten</h3>
  <p class="hint">Ausdauer außer Laufen, immer Zone 2 und eine Sportart pro Einheit. Der Plan wechselt die angehakten Sportarten ab, höchstens 2 verschiedene pro Tag.</p>
  <div class="sports">${CROSS_SPORTS.map(k => `<label style="--c:${S[k].c}"><input type="checkbox" data-cx="${k}"${x.sports.includes(k) ? " checked" : ""}><i></i>${esc(S[k].label)}</label>`).join("")}</div>
  <div class="row3">
    <div class="field"><label for="cx-f">pro Woche mit Fußball</label><input type="number" id="cx-f" min="0" max="10" value="${x.perWeekFootball}"></div>
    <div class="field"><label for="cx-n">pro Woche ohne Fußball</label><input type="number" id="cx-n" min="0" max="10" value="${x.perWeekNoFootball}"></div>
    <div class="field"><label for="cx-d">Minuten</label><input type="number" id="cx-d" min="10" step="5" value="${x.durationMin}"></div>
  </div>`;
}
const BASE_KEYS = new Set(["run", "football", "bike", "swim", "row", "skierg", "stepper", "plyo", "gym", "stretch", "other"]);
function bindBlocks(c) {
  const f = $("#wz");
  f.oninput = e => {
    const el = e.target;
    if (el.dataset.b != null) { const b = c.blocks[+el.dataset.b];
      if (el.dataset.f === "kind") { const [s, fo] = el.value.split(":"); b.sport = s; b.focus = fo || null; }
      else if (el.dataset.f === "day") b.day = el.value ? +el.value : null;
      else b[el.dataset.f] = num(el.value) || 0; }
    if (el.dataset.cx) c.cross.sports = $$("[data-cx]").filter(x => x.checked).map(x => x.dataset.cx);
    if (el.id === "cx-f") c.cross.perWeekFootball = Math.max(0, num(el.value) || 0);
    if (el.id === "cx-n") c.cross.perWeekNoFootball = Math.max(0, num(el.value) || 0);
    if (el.id === "cx-d") c.cross.durationMin = Math.max(10, num(el.value) || 30);
  };
  f.onchange = f.oninput;
  f.onclick = e => { const b = e.target.closest("[data-delb]"); if (b) { c.blocks.splice(+b.dataset.delb, 1); renderWizard(); } };
  $("#addBlock").onclick = () => { c.blocks.push({ sport: "gym", focus: "full", durationMin: 45, perWeek: 1, day: null }); renderWizard(); };
}

function stepZones(c) {
  const z = store.settings.zones;
  return `<p class="hint">Daraus berechnet der Plan Tempo und Puls für jede Einheit. Die App schlägt neue Werte vor, sobald deine Garmin-Daten das hergeben.</p>
  <div class="row2"><div class="field"><label for="z-dist">Referenz-Distanz</label><select class="in" id="z-dist">${[3, 5, 10, 21.1, 42.2].map(d => `<option value="${d}"${Number(z.refDistanceKm) === d ? " selected" : ""}>${d === 21.1 ? "Halbmarathon" : d === 42.2 ? "Marathon" : d + " km"}</option>`).join("")}</select></div>
  <div class="field"><label for="z-time">Deine Zeit darauf</label><input type="text" id="z-time" inputmode="numeric" value="${esc(z.refTime)}" placeholder="mm:ss"></div></div>
  <div class="row2"><div class="field"><label for="z-max">Maximalpuls</label><input type="number" id="z-max" value="${esc(z.hrMax)}"></div>
  <div class="field"><label for="z-rest">Ruhepuls</label><input type="number" id="z-rest" value="${esc(z.hrRest)}"></div></div>
  <div id="zonePrev"></div>
  <div class="field"><label for="g-notes">Notizen für Claude (z. B. Verletzungen) – <b>wird vom Algorithmus nicht ausgewertet</b>, nur bei „An Claude übergeben“ mitgeschickt</label><textarea class="in" id="g-notes" rows="4">${esc(c.notes || "")}</textarea></div>`;
}
export function zonesTable(z) {
  const pz = paceZones(z), hz = hrZones(z);
  return `<table class="zonetbl">${pz ? Object.keys(ZONE_LABEL).map(k => `<tr><td>${ZONE_LABEL[k]}</td><td>${fmtRange(pz[k])} /km</td></tr>`).join("") : '<tr><td colspan="2" class="hint">Zeit bitte als mm:ss</td></tr>'}
    ${hz.map(h => `<tr><td>${h.name}</td><td>${h.lo}–${h.hi} bpm</td></tr>`).join("")}</table>`;
}
function bindZones(c) {
  const show = () => $("#zonePrev").innerHTML = zonesTable(readZones());
  const readZones = () => ({ refDistanceKm: Number($("#z-dist").value), refTime: $("#z-time").value.trim(), hrMax: num($("#z-max").value) || 190, hrRest: num($("#z-rest").value) || 60 });
  show();
  const f = $("#wz");
  f.oninput = () => { c.notes = $("#g-notes").value; show(); };
  f.onchange = () => { const z = readZones(); if (parseTime(z.refTime)) store.saveSettings({ zones: { ...store.settings.zones, ...z } }); show(); };
}

function stepPreview(c) {
  const t = todayStr();
  const cfg = { ...c, applyFrom: st.wizard.editing && t > c.start ? t : c.start };
  const res = generatePlan(cfg, store.settings, store.allWorkouts(), historyLoad());
  st.wizard.preview = { res, cfg };
  const weeks = res.weeks;
  const maxKm = Math.max(1, ...weeks.map(w => w.plannedKm || 0));
  const unpl = weeks.filter(w => w.unplaced.length);
  const warns = weeks.flatMap(w => w.warnings || []);
  const down = weeks.reduce((s, w) => s + (w.downgraded || 0), 0);
  return `<div class="okbox"><b>${res.workouts.length}</b> Einheiten in <b>${weeks.length}</b> Wochen.${res.removed.length ? ` ${res.removed.length} bisher geplante Einheiten werden ersetzt.` : ""} Erledigte und von dir geänderte Einheiten bleiben erhalten.</div>
    ${warns.length ? `<div class="warn"><b>Feste Tage mit Regelkonflikt</b> (bleiben trotzdem dort):<br>${warns.slice(0, 6).map(esc).join("<br>")}${warns.length > 6 ? "<br>… und " + (warns.length - 6) + " weitere" : ""}</div>` : ""}
    ${unpl.length ? `<div class="warn">In ${unpl.length} Wochen ließ sich nicht alles regelkonform verteilen (z. B. ${esc(unpl[0].unplaced.slice(0, 3).join(", "))}). Weniger Bausteine oder eine höhere Tagesgrenze unter „Regeln“ helfen.</div>` : ""}
    ${down ? `<div class="hint">${down}× wurde eine harte Laufeinheit durch einen lockeren Lauf ersetzt, weil die Regeln keinen passenden Tag erlaubt haben.</div>` : ""}
    <div>${weeks.map(w => { const ph = w.deload ? "deload" : w.phase; return `<div class="weekrow"><span class="kwn">KW ${isoWeek(parse(w.monday))}</span><span class="stack" style="gap:4px"><span class="row"><span class="phase ${ph}">${PHASE_LABEL[ph]}</span><span class="muted">${w.sessions} Einheiten</span></span><span class="minibar" style="width:${Math.max(4, (w.plannedKm || 0) / maxKm * 100)}%"></span></span><span class="num">${w.plannedKm} km</span></div>`; }).join("")}</div>
    <details><summary class="hint" style="cursor:pointer">Erste Woche im Detail</summary><div class="list" style="margin-top:8px">${firstWeek(res)}</div></details>`;
}
function firstWeek(res) {
  const w0 = res.weeks[0]; if (!w0) return "";
  const sun = addDaysStr(w0.monday, 6);
  return res.workouts.filter(w => w.date <= sun).sort((a, b) => a.date.localeCompare(b.date) || (a.slot ?? 0) - (b.slot ?? 0)).map(w => {
    const s = sportOf(store.settings, w.sport);
    return `<div class="entry plan" style="--c:${s.c}"><div class="entry-main"><span class="sw"></span><span class="t">${WD[parse(w.date).getDay()].slice(0, 2)} · ${esc(w.title || s.label + (w.focus ? " · " + FOCUS[w.focus] : ""))}</span><span class="date"><span class="slotlbl">${w.target?.order ? w.target.order + "." : ""}</span></span><span class="m">${w.distanceKm ? fmtKm(w.distanceKm) + " km · " : ""}${w.durationMin || "–"} min</span>${w.note ? `<span class="n">${esc(w.note)}</span>` : ""}</div></div>`;
  }).join("");
}
function applyPlan() {
  const pv = st.wizard?.preview; if (!pv) return;
  const { res, cfg } = pv;
  for (const p of store.plans.values()) if (p.active && !p.deleted && p.id !== res.planId) store.putPlan({ ...p, active: false });
  store.putWorkouts([...res.removed.map(w => ({ ...w, deleted: true })), ...res.workouts]);
  const config = { ...cfg, weeks: res.weeks.map(w => ({ monday: w.monday, phase: w.phase, deload: w.deload, km: w.km, plannedKm: w.plannedKm, load: w.load, sessions: w.sessions, unplaced: w.unplaced })) };
  delete config.planId; delete config.applyFrom;
  const old = store.plans.get(res.planId);
  store.putPlan({ id: res.planId, name: cfg.name || "Mein Plan", start: cfg.start, end: cfg.end, config, active: true, deleted: false, createdAt: old?.createdAt || new Date().toISOString() });
  st.wizard = null;
  toast("Plan übernommen – " + res.workouts.length + " Einheiten im Kalender");
  renderOverview();
}

// ---------- Übergabe an Claude ----------
function bridgeItems(p, days) {
  const t = todayStr(), to = days ? addDaysStr(t, days) : p.end;
  return store.allWorkouts().filter(w => w.planId === p.id && w.status === "planned" && w.date >= t && w.date <= to).sort((a, b) => a.date.localeCompare(b.date) || (a.slot ?? 0) - (b.slot ?? 0)).slice(0, 150);
}
function buildPrompt(p, days) {
  const c = p.config || {}, z = store.settings.zones, pz = paceZones(z), hz = hrZones(z);
  const items = bridgeItems(p, days).map(w => ({ id: w.id, date: w.date, weekday: WD[parse(w.date).getDay()], reihenfolge: w.target?.order || undefined, sport: w.sport, focus: w.focus || undefined, title: w.title || undefined, note: w.note || undefined, distanceKm: w.distanceKm || undefined, durationMin: w.durationMin || undefined, key: w.isKey || undefined }));
  const mon = mondayOf(new Date()), hist = [];
  for (let i = 4; i >= 1; i--) {
    const a = ymd(addDays(mon, -7 * i)), b = ymd(addDays(mon, -7 * i + 6));
    const d = store.allWorkouts().filter(w => w.status === "done" && w.date >= a && w.date <= b);
    hist.push({ week: a, runKm: Math.round(d.filter(w => w.sport === "run").reduce((s, w) => s + (+w.distanceKm || 0), 0)), sessions: d.length, load: Math.round(d.reduce((s, w) => s + loadOf(w, z), 0)) });
  }
  const vorgaben = { ziel: c.goal?.race ? { wettkampf: c.goal.raceDistanceKm + " km", datum: c.goal.raceDate, zielzeit: c.goal.raceTime || null } : "allgemeine Ausdauer", zeitraum: [p.start, p.end], laeufeProWoche: c.runsPerWeek, festeTermine: c.fixed, bausteine: c.blocks, crossPool: normCross(c), sonstiges: c.notes || "" };
  const zonen = { pace: pz ? Object.fromEntries(Object.keys(ZONE_LABEL).map(k => [ZONE_LABEL[k], fmtRange(pz[k]) + "/km"])) : null, puls: hz.map(h => `${h.name}: ${h.lo}-${h.hi}`) };
  return `Du bist mein Ausdauer-Coach. Unten stehen meine Vorgaben, die Regeln meines Plans, meine Zonen, die letzten 4 Wochen und die geplanten Einheiten der ${days ? "nächsten " + days + " Tage" : "restlichen Planlaufzeit"} aus meiner Trainings-App.

Aufgabe: Prüfe die Einheiten und verbessere sie, wo es sinnvoll ist (konkrete Intervall-Inhalte, Abwechslung, Belastungssteuerung). Halte dich strikt an die Regeln. Titel bleibt leer bzw. die Sportart; Intensität und Inhalt gehören in "note" (z. B. "Zone 2 · 30 min"). Kraft-Einheiten (gym, plyo, stretch) bleiben ohne Übungsliste – höchstens Tag oder Dauer ändern. Feste Termine (Fußball) nicht verschieben.

Antworte mit einem kurzen Kommentar auf Deutsch und danach mit GENAU EINEM JSON-Codeblock in diesem Format:
\`\`\`json
{"changes":[
  {"op":"update","id":"<id aus der Liste>","date":"YYYY-MM-DD","title":"…","note":"…","distanceKm":8,"durationMin":45},
  {"op":"add","date":"YYYY-MM-DD","sport":"run|bike|swim|row|skierg|stepper|gym|plyo|stretch|other","focus":"push|pull|legs|full|cali (nur bei gym)","title":"…","note":"…","distanceKm":6,"durationMin":40},
  {"op":"remove","id":"<id>"}
]}
\`\`\`
Bei "update" nur die Felder angeben, die sich ändern. Nur ids aus der Liste verwenden.

REGELN: ${JSON.stringify(store.settings.rules)}
ZONEN: ${JSON.stringify(zonen)}
VORGABEN: ${JSON.stringify(vorgaben)}
LETZTE 4 WOCHEN: ${JSON.stringify(hist)}
GEPLANTE EINHEITEN: ${JSON.stringify(items)}`;
}
function parseAnswer(text) {
  const m = text.match(/```(?:json)?\s*([\s\S]*?)```/) || text.match(/(\{[\s\S]*\})/);
  if (!m) throw new Error("Kein JSON gefunden");
  const j = JSON.parse(m[1]);
  if (!Array.isArray(j.changes)) throw new Error("„changes“ fehlt");
  return j.changes;
}
function openBridge(p) {
  const root = $("#sheetRoot");
  let days = 14;
  const draw = () => {
    root.innerHTML = `<div class="overlay" id="ov"><div class="sheet">
      <div class="sheet-h"><h2>An Claude übergeben</h2><button type="button" class="iconbtn" id="closeSheet" aria-label="Schließen"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg></button></div>
      <ol class="hint steps"><li>Zeitraum wählen und <b>Prompt kopieren</b>.</li><li>In der Claude-App einfügen und senden – läuft über dein Abo, ohne Extrakosten.</li><li>Claudes komplette Antwort kopieren, unten einfügen und <b>Prüfen</b> tippen.</li></ol>
      <div class="seg" id="bDays"><button data-d="14" aria-pressed="${days === 14}">14 Tage</button><button data-d="28" aria-pressed="${days === 28}">4 Wochen</button><button data-d="0" aria-pressed="${days === 0}">Ganzer Plan</button></div>
      <div class="hint">${bridgeItems(p, days).length} geplante Einheiten</div>
      <button class="btn" id="bCopy">Prompt kopieren</button>
      <textarea class="code" id="bPrompt" readonly hidden></textarea>
      <div class="field"><label for="bAns">Antwort von Claude</label><textarea class="code" id="bAns" placeholder="Hier die Antwort einfügen"></textarea></div>
      <button class="btn secondary" id="bCheck">Prüfen</button>
      <div id="bDiff"></div>
    </div></div>`;
    $("#closeSheet").onclick = () => root.innerHTML = "";
    $("#ov").onclick = e => { if (e.target.id === "ov") root.innerHTML = ""; };
    $("#bDays").onclick = e => { const b = e.target.closest("button[data-d]"); if (b) { days = +b.dataset.d; draw(); } };
    $("#bCopy").onclick = async () => {
      const txt = buildPrompt(p, days);
      try { await navigator.clipboard.writeText(txt); toast("Prompt kopiert – jetzt in Claude einfügen"); }
      catch { const ta = $("#bPrompt"); ta.hidden = false; ta.value = txt; ta.select(); toast("Bitte markierten Text kopieren"); }
    };
    $("#bCheck").onclick = () => {
      let ch;
      try { ch = parseAnswer($("#bAns").value); } catch (e) { $("#bDiff").innerHTML = `<div class="warn">Antwort nicht lesbar: ${esc(e.message)}. Bitte die komplette Antwort mit dem JSON-Block einfügen.</div>`; return; }
      const ops = [], S = sportsOf(store.settings);
      for (const x of ch) {
        if (x.op === "remove" || x.op === "update") {
          const w = store.workouts.get(String(x.id));
          if (!w || w.deleted || w.status !== "planned") continue;
          if (x.op === "remove") { ops.push({ type: "rem", w, text: `Entfernen: ${shortDate(w.date)} ${esc(w.title || S[w.sport]?.label)}` }); continue; }
          const n = { ...w, locked: true };
          if (/^\d{4}-\d{2}-\d{2}$/.test(x.date || "")) n.date = x.date;
          for (const k of ["title", "note"]) if (typeof x[k] === "string") n[k] = x[k].slice(0, 400);
          for (const k of ["distanceKm", "durationMin"]) if (x[k] != null && isFinite(+x[k])) n[k] = +x[k];
          ops.push({ type: "upd", w: n, text: `Ändern: ${shortDate(w.date)} ${esc(w.title || S[w.sport]?.label)}${n.date !== w.date ? " → " + shortDate(n.date) : ""}${n.note !== w.note ? "<br><span class='hint'>" + esc(n.note || "") + "</span>" : ""}` });
        } else if (x.op === "add" && /^\d{4}-\d{2}-\d{2}$/.test(x.date || "")) {
          const sport = S[x.sport] ? x.sport : "other";
          const n = { id: newId(), date: x.date, sport, focus: sport === "gym" && FOCUS[x.focus] ? x.focus : null, status: "planned", title: x.title ? String(x.title).slice(0, 120) : null, note: x.note ? String(x.note).slice(0, 400) : null, distanceKm: +x.distanceKm || null, durationMin: +x.durationMin || null, planId: p.id, source: "claude", locked: true, target: { kind: "claude" } };
          ops.push({ type: "add", w: n, text: `Neu: ${shortDate(n.date)} ${esc(n.title || S[sport].label)}${n.note ? "<br><span class='hint'>" + esc(n.note) + "</span>" : ""}` });
        }
      }
      if (!ops.length) { $("#bDiff").innerHTML = `<div class="hint">Keine anwendbaren Änderungen gefunden.</div>`; return; }
      $("#bDiff").innerHTML = `<div class="diff">${ops.map(o => `<div class="${o.type}">${o.text}</div>`).join("")}</div><div class="actions" style="margin-top:10px"><span></span><button class="btn" id="bApply">${ops.length} Änderungen übernehmen</button></div>`;
      $("#bApply").onclick = () => { store.putWorkouts(ops.map(o => o.type === "rem" ? { ...o.w, deleted: true } : o.w)); root.innerHTML = ""; toast("Änderungen von Claude übernommen"); };
    };
  };
  draw();
}
