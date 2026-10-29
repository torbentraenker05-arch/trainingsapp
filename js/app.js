// App-Start, Navigation, Login, Kalender und Eintrags-Formular
import { $, $$, esc, ymd, parse, addDays, mondayOf, isoWeek, longDate, todayStr, fmtKm, fmtDur, fmtPace, num, MONTHS, toast, addDaysStr } from "./util.js";
import { sb, store, autoGarmin } from "./store.js";
import { sportsOf, sportOf, FOCUS, trimp } from "./sports.js";
import { renderPlan } from "./plan-ui.js";
import { renderStats } from "./stats.js";
import { renderProfile } from "./profile.js";
import { proposals, renderProposals } from "./proposals.js";

export const ui = { view: "cal", month: null, sel: todayStr() };
{ const n = new Date(); ui.month = new Date(n.getFullYear(), n.getMonth(), 1); }

// ---------- Rahmen ----------
// passive = ausgelöst durch Datenänderung/Sync: Formulare mit Eingaben nicht überschreiben
export function render(passive = false) {
  renderSync();
  if (!store.uid) return;
  const v = ui.view;
  if (v === "cal") renderCal();
  else if (v === "plan") renderPlan(passive);
  else if (v === "stats") renderStats();
  else if (v === "profile") renderProfile(passive);
}
function setView(v) {
  ui.view = v; window.scrollTo(0, 0);
  $$("#tabs button").forEach(b => b.dataset.v === v ? b.setAttribute("aria-current", "page") : b.removeAttribute("aria-current"));
  render();
}
function renderSync() {
  const el = $("#sync");
  const p = store.pending();
  let cls = "local", txt = "Offline";
  if (!store.uid) { txt = "Abgemeldet"; }
  else if (store.syncing) { cls = "cloud"; txt = "Synchronisiere…"; }
  else if (store.online && !p) { cls = "cloud"; txt = "Synchronisiert"; }
  else if (p) txt = (store.online ? "" : "Offline · ") + p + " ausstehend";
  el.className = "sync " + cls;
  el.title = txt;
  el.querySelector("span").textContent = txt;
}

// ---------- Login ----------
function renderAuth(msg = "") {
  $("#tabs").hidden = true;
  $("#app").innerHTML = `<section class="auth">
    <div class="panel">
      <h2>Anmelden</h2>
      <p class="hint">Mit E-Mail und Passwort. Deine Daten werden zwischen iPhone und PC synchronisiert.</p>
      <form id="authForm" class="stack" novalidate>
        <div class="field"><label for="a-mail">E-Mail</label><input type="email" id="a-mail" autocomplete="email" required></div>
        <div class="field"><label for="a-pw">Passwort</label><input type="password" id="a-pw" autocomplete="current-password" minlength="8" required></div>
        <div class="row"><button class="btn" type="submit" data-mode="in">Anmelden</button><button class="btn secondary" type="submit" data-mode="up">Konto anlegen</button></div>
        <p id="authMsg" class="hint">${esc(msg)}</p>
      </form>
    </div>
  </section>`;
  let mode = "in";
  $$("#authForm button[type=submit]").forEach(b => b.onclick = () => mode = b.dataset.mode);
  $("#authForm").onsubmit = async e => {
    e.preventDefault();
    const email = $("#a-mail").value.trim(), password = $("#a-pw").value;
    const out = $("#authMsg");
    if (!email || password.length < 8) { out.textContent = "Bitte E-Mail und ein Passwort mit mindestens 8 Zeichen eingeben."; return; }
    out.textContent = "Einen Moment…";
    try {
      if (mode === "up") {
        const { data, error } = await sb.auth.signUp({ email, password, options: { emailRedirectTo: location.origin + location.pathname } });
        if (error) throw error;
        if (!data.session) { out.textContent = "Konto angelegt. Bestätige die E-Mail, die du gerade bekommen hast, und melde dich dann hier an."; return; }
      } else {
        const { error } = await sb.auth.signInWithPassword({ email, password });
        if (error) throw error;
      }
    } catch (err) {
      out.textContent = /Invalid login/i.test(err.message) ? "E-Mail oder Passwort falsch." : /not confirmed/i.test(err.message) ? "Bitte bestätige zuerst deine E-Mail-Adresse." : "Fehler: " + err.message;
    }
  };
}

async function start(session) {
  if (!session) { store.uid = null; renderSync(); renderAuth(); return; }
  if (store.uid === session.user.id) return;
  store.load(session.user.id);
  store.email = session.user.email;
  $("#tabs").hidden = false;
  render();
  await store.sync();
  handleHash();
  autoGarmin();
}

function handleHash() {
  const h = new URLSearchParams(location.hash.slice(1));
  if (h.has("strava")) {
    if (h.get("strava") === "ok") toast("Strava verbunden – Aktivitäten werden geladen");
    else toast("Strava: " + (h.get("msg") || "Verbindung fehlgeschlagen"));
    history.replaceState(null, "", location.pathname);
    ui.view = "profile"; store.fullResync().then(render); render();
  }
}

// ---------- Kalender ----------
function renderLegendHTML() {
  const S = sportsOf(store.settings);
  return Object.values(S).map(s => `<span><i class="dot" style="--c:${s.c}"></i>${esc(s.label)}</span>`).join("") + `<span><i class="dot plan" style="--c:var(--muted)"></i>geplant</span>`;
}
function renderCal() {
  const app = $("#app");
  if (!app.querySelector("#v-cal")) {
    app.innerHTML = `<section class="view" id="v-cal">
      <div id="proposals"></div>
      <div class="monthbar">
        <button class="iconbtn" id="prev" aria-label="Vorheriger Monat"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M15 6l-6 6 6 6"/></svg></button>
        <h2 id="monthTitle" class="num"></h2>
        <div style="display:flex;gap:6px">
          <button class="ghost" id="todayBtn">Heute</button>
          <button class="iconbtn" id="next" aria-label="Nächster Monat"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M9 6l6 6-6 6"/></svg></button>
        </div>
      </div>
      <div class="cal"><div class="cal-grid" id="calGrid"></div></div>
      <div class="legend" id="legend"></div>
      <div class="dayhead">
        <div><div class="label" id="dayLabel"></div><h2 id="dayTitle"></h2></div>
        <button class="btn" id="addBtn"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>Training</button>
      </div>
      <div class="list" id="dayList"></div>
    </section>`;
    $("#prev").onclick = () => { ui.month = new Date(ui.month.getFullYear(), ui.month.getMonth() - 1, 1); renderCal(); };
    $("#next").onclick = () => { ui.month = new Date(ui.month.getFullYear(), ui.month.getMonth() + 1, 1); renderCal(); };
    $("#todayBtn").onclick = () => { const n = new Date(); ui.month = new Date(n.getFullYear(), n.getMonth(), 1); ui.sel = todayStr(); renderCal(); };
    $("#calGrid").onclick = e => { const b = e.target.closest("[data-day]"); if (!b) return; ui.sel = b.dataset.day; const d = parse(ui.sel); if (d.getMonth() !== ui.month.getMonth()) ui.month = new Date(d.getFullYear(), d.getMonth(), 1); renderCal(); };
    $("#addBtn").onclick = () => openSheet(null);
    $("#dayList").onclick = e => {
      const c = e.target.closest("[data-check]"); if (c) { toggleDone(c.dataset.check); return; }
      const ed = e.target.closest("[data-edit]"); if (ed) openSheet(store.workouts.get(ed.dataset.edit));
    };
  }
  renderProposals($("#proposals"), proposals());
  const m = ui.month, y = m.getFullYear(), mo = m.getMonth();
  $("#monthTitle").textContent = MONTHS[mo] + " " + y;
  const first = new Date(y, mo, 1), offset = (first.getDay() + 6) % 7, dim = new Date(y, mo + 1, 0).getDate();
  const rows = Math.ceil((offset + dim) / 7), start = addDays(first, -offset), t = todayStr();
  const byDay = {};
  for (const w of store.allWorkouts()) if (w.status !== "missed") (byDay[w.date] ||= []).push(w);
  let h = `<div></div>` + ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"].map(d => `<div class="cal-h">${d}</div>`).join("");
  for (let r = 0; r < rows; r++) {
    h += `<div class="kw" title="Kalenderwoche">${isoWeek(addDays(start, r * 7))}</div>`;
    for (let c = 0; c < 7; c++) {
      const d = addDays(start, r * 7 + c), s = ymd(d), list = (byDay[s] || []).sort(bySlot);
      const km = list.filter(w => w.status === "done").reduce((a, w) => a + (+w.distanceKm || 0), 0);
      const cls = ["day"]; if (d.getMonth() !== mo) cls.push("out"); if (s === t) cls.push("today"); if (s === ui.sel) cls.push("sel");
      const dots = list.slice(0, 5).map(w => `<i class="dot${w.status === "planned" ? " plan" : ""}" style="--c:${sportOf(store.settings, w.sport).c}"></i>`).join("");
      h += `<button class="${cls.join(" ")}" data-day="${s}" aria-label="${longDate(s)}${list.length ? ", " + list.length + " Einheit(en)" : ""}"><span class="d">${d.getDate()}</span><span class="dots">${dots}</span>${km > 0 ? `<span class="km">${fmtKm(km)} km</span>` : ""}</button>`;
    }
  }
  $("#calGrid").innerHTML = h;
  $("#legend").innerHTML = renderLegendHTML();
  renderDay();
}
export const bySlot = (a, b) => (a.slot ?? 99) - (b.slot ?? 99) || (a.status === "planned") - (b.status === "planned");

const CHECK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
export function entryHTML(w, showDate, pos) {
  const s = sportOf(store.settings, w.sport), plan = w.status === "planned", late = plan && w.date < todayStr();
  const bits = [];
  if (+w.distanceKm) bits.push(`<b>${fmtKm(+w.distanceKm)} km</b>`);
  if (+w.durationMin) bits.push(`<b>${fmtDur(+w.durationMin)}</b>`);
  if (!plan && +w.distanceKm && +w.durationMin) {
    if (s.p500) bits.push(fmtPace(w.durationMin * 60 / (w.distanceKm * 2)) + " /500 m");
    else if (w.sport === "run") bits.push(fmtPace(w.durationMin * 60 / w.distanceKm) + " /km");
    else if (w.sport === "bike") bits.push(fmtKm(w.distanceKm / (w.durationMin / 60)) + " km/h");
  }
  if (+w.avgHr && !plan) bits.push("Ø " + w.avgHr + " bpm");
  if (+w.trimp && !plan) bits.push("Belastung " + Math.round(w.trimp));
  const lbl = plan ? "Als erledigt abhaken" : "Wieder auf geplant setzen";
  const check = (plan || w.planId) ? `<button class="check${plan ? "" : " on"}" data-check="${esc(w.id)}" aria-label="${lbl}" title="${lbl}"><span>${CHECK}</span></button>` : "";
  const name = esc(w.title || (s.label + (w.sport === "gym" && FOCUS[w.focus] ? " · " + FOCUS[w.focus] : "")));
  const sub = w.title && w.sport === "gym" && FOCUS[w.focus] ? " · " + FOCUS[w.focus] : "";
  const dt = parse(w.date);
  const chips = [
    plan ? `<span class="chip ${late ? "late" : "plan"}">${late ? "Offen" : "Geplant"}</span>` : "",
    plan && w.isKey ? `<span class="chip key">Schlüssel</span>` : "",
    w.source === "strava" ? `<span class="chip">Strava</span>` : "",
    w.source === "garmin" ? `<span class="chip">Garmin</span>` : "",
    w.seriesId ? `<span class="chip">Serie</span>` : "",
  ].join("");
  return `<div class="entry${plan ? " plan" : ""}" style="--c:${s.c}"><button class="entry-main" data-edit="${esc(w.id)}"><span class="sw"></span><span class="t">${name}${sub}${chips}</span><span class="date">${showDate ? dt.getDate() + "." + (dt.getMonth() + 1) + "." : pos ? `<span class="slotlbl">${pos}.</span>` : ""}</span>${bits.length ? `<span class="m">${bits.join(" · ")}</span>` : ""}${w.note ? `<span class="n">${esc(w.note)}</span>` : ""}</button>${check}</div>`;
}
function renderDay() {
  const s = ui.sel, t = todayStr();
  $("#dayLabel").textContent = s === t ? "Heute" : s === addDaysStr(t, 1) ? "Morgen" : s === addDaysStr(t, -1) ? "Gestern" : "KW " + isoWeek(parse(s));
  $("#dayTitle").textContent = longDate(s);
  const list = store.allWorkouts().filter(w => w.date === s && w.status !== "missed").sort(bySlot);
  const missed = store.allWorkouts().filter(w => w.date === s && w.status === "missed");
  $("#dayList").innerHTML = (list.length ? list.map((w, i) => entryHTML(w, false, list.length > 1 ? i + 1 : null)).join("") : `<div class="empty">${s > t ? "Noch nichts geplant für diesen Tag." : "Kein Training eingetragen."} Tippe auf <b>+ Training</b>, um eine Einheit hinzuzufügen.</div>`)
    + (missed.length ? `<div class="hint">Verfallen: ${missed.map(w => esc(w.title || sportOf(store.settings, w.sport).label)).join(", ")}</div>` : "");
}

export function toggleDone(id) {
  const w = store.workouts.get(id); if (!w) return;
  const plan = w.status === "planned";
  store.putWorkout({ ...w, status: plan ? "done" : "planned", locked: plan ? true : w.locked });
  toast(plan ? "Erledigt – zählt jetzt in deiner Statistik" : "Wieder auf geplant gesetzt");
}

// ---------- Formular ----------
export function openSheet(w) {
  const isNew = !w; const t = todayStr();
  const S = sportsOf(store.settings);
  w = w || { date: ui.sel, sport: "run", status: ui.sel > t ? "planned" : "done" };
  const root = $("#sheetRoot");
  root.innerHTML = `<div class="overlay" id="ov"><form class="sheet" id="wf" novalidate>
    <div class="sheet-h"><h2>${isNew ? "Training eintragen" : "Training bearbeiten"}</h2><button type="button" class="iconbtn" id="closeSheet" aria-label="Schließen"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg></button></div>
    <div class="field"><span class="label">Sportart</span><div class="sports">${Object.entries(S).map(([k, s]) => `<label style="--c:${s.c}"><input type="radio" name="sport" value="${esc(k)}"${w.sport === k ? " checked" : ""}><i></i>${esc(s.label)}</label>`).join("")}</div></div>
    <div class="field" id="focusField"><span class="label">Fokus</span><div class="sports">${Object.entries(FOCUS).map(([k, l]) => `<label style="--c:var(--gym)"><input type="radio" name="focus" value="${k}"${w.focus === k ? " checked" : ""}><i></i>${l}</label>`).join("")}</div></div>
    <div class="field"><label for="f-title">Titel (optional)</label><input type="text" id="f-title" value="${esc(w.title || "")}" placeholder="z. B. Intervalle, Fußballspiel"></div>
    <div class="row2">
      <div class="field"><label for="f-date">Datum</label><input type="date" id="f-date" value="${esc(w.date)}" required></div>
      <div class="field"><span class="label">Status</span><div class="seg" id="f-status"><button type="button" data-st="done" aria-pressed="${w.status !== "planned"}">Erledigt</button><button type="button" data-st="planned" aria-pressed="${w.status === "planned"}">Geplant</button></div></div>
    </div>
    <div class="row3">
      <div class="field" id="kmField"><label for="f-km">Distanz (km)</label><input type="number" id="f-km" inputmode="decimal" step="0.01" min="0" placeholder="z. B. 8,5" value="${w.distanceKm ?? ""}"></div>
      <div class="field"><label for="f-min">Dauer (Minuten)</label><input type="number" id="f-min" inputmode="numeric" step="1" min="0" placeholder="z. B. 45" value="${w.durationMin != null ? Math.round(w.durationMin) : ""}"></div>
      <div class="field" id="hrField"><label for="f-hr">Ø Puls</label><input type="number" id="f-hr" inputmode="numeric" step="1" min="30" max="230" placeholder="bpm" value="${w.avgHr ?? ""}"></div>
    </div>
    <div class="field" id="rpeField"><label for="f-rpe">Anstrengung (RPE ${w.rpe || "–"}/10) – nur nötig ohne Puls</label><input type="range" id="f-rpe" min="0" max="10" step="1" value="${w.rpe || 0}"></div>
    <div class="hint" id="f-pace"></div>
    <div class="field"><label for="f-note">Notiz / Ablauf</label><textarea class="in" id="f-note" rows="3" placeholder="z. B. 6×800 m @ 4:05/km, 2 min Trabpause">${esc(w.note || "")}</textarea></div>
    ${isNew ? `<div class="row2">
      <div class="field"><label for="f-rep">Wiederholen</label><select class="in" id="f-rep"><option value="0">Nicht wiederholen</option><option value="1">Jeden Tag</option><option value="7">Jede Woche</option><option value="14">Alle 2 Wochen</option></select></div>
      <div class="field" id="repUntilField" hidden><label for="f-until">Bis einschließlich</label><input type="date" id="f-until" value="${ymd(addDays(parse(w.date), 27))}"></div>
    </div>` : ""}
    ${w.source === "strava" || w.source === "garmin" ? `<p class="hint">Aus ${w.source === "garmin" ? "Garmin" : "Strava"} importiert. Änderungen dort überschreiben diese Werte beim nächsten Abgleich.</p>` : ""}
    ${w.planId && !isNew ? `<p class="hint">Teil deines Plans. Wenn du hier etwas änderst, bleibt die Einheit beim Neuberechnen des Plans erhalten.</p>` : ""}
    <div class="actions" id="f-actions">
      ${isNew ? "<span></span>" : `<button type="button" class="btn danger" id="delBtn">Löschen</button>`}
      <button type="submit" class="btn" id="saveBtn">Speichern</button>
    </div>
  </form></div>`;
  let status = w.status === "planned" ? "planned" : "done";
  const f = $("#wf"), close = () => { root.innerHTML = ""; };
  const upd = () => {
    const sp = f.querySelector("input[name=sport]:checked")?.value;
    const km = num($("#f-km").value), mn = num($("#f-min").value), hr = num($("#f-hr").value);
    const noKm = !(S[sp] && S[sp].km);
    $("#kmField").hidden = noKm; $("#focusField").hidden = sp !== "gym";
    $("#hrField").hidden = status === "planned"; $("#rpeField").hidden = status === "planned" || !!hr;
    $("#rpeField label").textContent = `Anstrengung (RPE ${+$("#f-rpe").value || "–"}/10) – nur nötig ohne Puls`;
    const rep = $("#f-rep"); if (rep) $("#repUntilField").hidden = rep.value === "0";
    let p = "";
    if (!noKm && km > 0 && mn > 0) p = sp === "bike" ? "Ø " + fmtKm(km / (mn / 60)) + " km/h" : S[sp]?.p500 ? "Ø " + fmtPace(mn * 60 / (km * 2)) + " min/500 m" : "Pace: " + fmtPace(mn * 60 / km) + " min/km";
    $("#f-pace").textContent = p;
  };
  upd();
  f.addEventListener("input", upd);
  $("#f-status").onclick = e => { const b = e.target.closest("button[data-st]"); if (!b) return; status = b.dataset.st; $$("#f-status button").forEach(x => x.setAttribute("aria-pressed", x === b)); upd(); };
  $("#closeSheet").onclick = close;
  $("#ov").addEventListener("click", e => { if (e.target.id === "ov") close(); });
  const del = $("#delBtn");
  if (del) del.onclick = () => {
    const series = w.seriesId ? store.allWorkouts().filter(x => x.seriesId === w.seriesId && x.status === "planned" && x.id !== w.id && x.date >= w.date) : [];
    $("#f-actions").innerHTML = `<div class="confirm">${series.length ? "Nur diese Einheit löschen oder auch die " + series.length + " folgenden geplanten der Serie?" : "Wirklich löschen?"}<button type="button" class="btn danger" id="yesDel">${series.length ? "Nur diese" : "Ja, löschen"}</button>${series.length ? '<button type="button" class="btn danger" id="serDel">Ganze Serie</button>' : ""}<button type="button" class="btn secondary" id="noDel">Abbrechen</button></div>`;
    $("#noDel").onclick = () => { close(); openSheet(w); };
    $("#yesDel").onclick = () => { store.removeWorkout(w.id); close(); toast("Training gelöscht"); };
    if (series.length) $("#serDel").onclick = () => { for (const x of [w, ...series]) store.removeWorkout(x.id); close(); toast((series.length + 1) + " Einheiten gelöscht"); };
  };
  f.onsubmit = e => {
    e.preventDefault();
    const sport = f.querySelector("input[name=sport]:checked")?.value || "other";
    const date = $("#f-date").value;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) { toast("Bitte ein Datum wählen"); return; }
    const km = num($("#f-km").value), mn = num($("#f-min").value), hr = num($("#f-hr").value), rpe = +$("#f-rpe").value || null;
    const done = status === "done";
    const data = {
      ...w, date, sport, status,
      focus: sport === "gym" ? (f.querySelector("input[name=focus]:checked")?.value || null) : null,
      title: $("#f-title").value.trim() || null,
      distanceKm: S[sport]?.km && km > 0 ? Math.round(km * 100) / 100 : null,
      durationMin: mn > 0 ? Math.round(mn) : null,
      avgHr: done && hr > 0 ? Math.round(hr) : null,
      rpe: done && !hr ? rpe : null,
      note: $("#f-note").value.trim() || null,
      locked: true,
      source: w.source || "manual",
    };
    data.trimp = done ? trimp(data.durationMin, data.avgHr, store.settings.zones) : null;
    if (w.source === "strava" && w.trimp && data.avgHr === w.avgHr && data.durationMin === Math.round(w.durationMin || 0)) data.trimp = w.trimp;
    if (sport === "gym" && !data.focus) { toast("Bitte einen Fokus wählen"); return; }
    if (isNew) {
      const step = +($("#f-rep")?.value || 0);
      if (step) {
        const until = $("#f-until").value; if (!until || until < date) { toast("Bitte ein Enddatum nach dem Startdatum wählen"); return; }
        const seriesId = crypto.randomUUID?.().slice(0, 12) || String(Date.now());
        const list = [];
        for (let d = parse(date); ymd(d) <= until && list.length < 200; d = addDays(d, step)) list.push({ ...data, id: undefined, date: ymd(d), seriesId, status: ymd(d) > t ? "planned" : status });
        store.putWorkouts(list); close(); toast(list.length + " Einheiten eingetragen"); return;
      }
    }
    store.putWorkout(data);
    close(); toast(isNew ? "Training gespeichert" : "Änderungen gespeichert");
    ui.sel = date;
  };
}

// ---------- Start ----------
$("#tabs").addEventListener("click", e => { const b = e.target.closest("button[data-v]"); if (b) setView(b.dataset.v); });
$("#sync").onclick = () => store.sync();
store.on(() => render(true));
sb.auth.onAuthStateChange((ev, session) => { if (ev === "SIGNED_OUT") { store.uid = null; renderAuth(); renderSync(); } else if (session) start(session); });
sb.auth.getSession().then(({ data }) => start(data.session));

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("sw.js").catch(() => {});
  let reloaded = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => { if (!reloaded && navigator.serviceWorker.controller) { reloaded = true; location.reload(); } });
}
export { setView };
