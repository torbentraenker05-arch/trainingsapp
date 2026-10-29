// Profil: Konto, Zonen, Sportarten, Strava, CSV-Import, Backup
import { $, $$, esc, todayStr, toast, newId, num, parseTime } from "./util.js";
import { sb, store, callStrava, callGarmin } from "./store.js";
import { BASE_SPORTS, sportsOf, DEFAULT_STRAVA_MAP, trimp, learnedRest } from "./sports.js";
import { zonesTable } from "./plan-ui.js";
import { SUPABASE_URL } from "./config.js";

const CB_DOMAIN = new URL(SUPABASE_URL).host;
let webhookTried = false;

export function renderProfile(passive = false) {
  if (passive && $("#v-profile")) { renderGarmin(); renderStrava(); return; }
  const z = store.settings.zones;
  $("#app").innerHTML = `<section class="view" id="v-profile">
    <h2>Profil</h2>
    <div class="panel stack"><div class="panel-h" style="margin:0"><h3>Konto</h3><button class="ghost" id="logout">Abmelden</button></div>
      <div class="hint">${esc(store.email || "")}</div>
      <div class="row"><button class="btn secondary small" id="resync">Alle Daten neu laden</button><span class="hint">${store.pending() ? store.pending() + " Änderungen warten auf Verbindung" : "Alles synchronisiert"}</span></div></div>

    <div class="panel" id="garminBox"></div>

    <details class="panel" id="stravaWrap"${store.strava ? " open" : ""}><summary class="hint" style="cursor:pointer">Strava (Alternative – braucht ein kostenpflichtiges Strava-Abo)</summary><div id="stravaBox" style="margin-top:10px"></div></details>

    <div class="panel stack"><div class="panel-h" style="margin:0"><h3>Zonen</h3></div>
      <div class="row2"><div class="field"><label for="p-dist">Referenz-Distanz</label><select class="in" id="p-dist">${[3, 5, 10, 21.1, 42.2].map(d => `<option value="${d}"${Number(z.refDistanceKm) === d ? " selected" : ""}>${d === 21.1 ? "Halbmarathon" : d === 42.2 ? "Marathon" : d + " km"}</option>`).join("")}</select></div>
      <div class="field"><label for="p-time">Zeit</label><input type="text" id="p-time" inputmode="numeric" value="${esc(z.refTime)}"></div></div>
      <div class="row2"><div class="field"><label for="p-max">Maximalpuls</label><input type="number" id="p-max" value="${esc(z.hrMax)}"></div>
      <div class="field"><label for="p-rest">Ruhepuls</label><input type="number" id="p-rest" value="${esc(z.hrRest)}"></div></div>
      <div id="pZones">${zonesTable(z)}</div>
      <p class="hint" style="margin:0">${(lr => lr ? `Intervallpause (gelernt): <b>${Math.floor(lr.sec / 60)}:${String(lr.sec % 60).padStart(2, "0")} min</b> – Zeit bis Puls unter ${lr.thr}, aus ${lr.n} Intervall-Läufen.` : "Intervallpause: noch keine Messung. Sobald Garmin-Intervall-Läufe mit Pausen-Runden da sind, lernt der Plan deine Pausenzeit.")(learnedRest(store.allWorkouts()))}</p>
      <p class="hint" style="margin:0">Änderungen gelten für neu berechnete Pläne und neue Importe.</p></div>

    <div class="panel stack"><div class="panel-h" style="margin:0"><h3>Sportarten</h3></div>
      <div id="sportList"></div>
      <form class="row" id="addSport" novalidate><input type="color" id="ns-c" value="#3B82F6" aria-label="Farbe" style="width:40px;height:40px;border:0;background:none;padding:0"><input type="text" id="ns-l" class="grow" placeholder="Neue Sportart, z. B. Klettern" style="width:auto"><label class="row hint"><input type="checkbox" id="ns-km"> mit Distanz</label><button class="btn small" type="submit">Hinzufügen</button></form></div>

    <div class="panel stack"><div class="panel-h" style="margin:0"><h3>CSV-Import</h3></div>
      <p class="hint" style="margin:0">Für Daten ohne Garmin-Verbindung: Strava-Export (activities.csv), Garmin-Connect-Export oder eigene Tabelle mit Spalten wie Datum, Typ, Distanz, Zeit, Puls. Passende geplante Einheiten werden automatisch abgehakt, doppelte übersprungen.</p>
      <div class="import-row"><label class="btn" for="csvFile">CSV-Datei auswählen</label><input type="file" class="vh" id="csvFile" accept=".csv,text/csv,text/plain"></div>
      <p id="csvStatus" style="margin:0"></p></div>

    <div class="panel stack"><div class="panel-h" style="margin:0"><h3>Datensicherung</h3></div>
      <p class="hint" style="margin:0">Alle Einheiten, Pläne und Einstellungen als Datei, z. B. für iCloud Drive. Beim Einspielen wird ergänzt bzw. überschrieben, nichts gelöscht.</p>
      <div class="import-row"><button class="btn" id="exportBtn">Backup herunterladen</button><label class="btn secondary" for="backupFile">Backup einspielen</label><input type="file" class="vh" id="backupFile" accept=".json,application/json"></div>
      <p id="backupStatus" style="margin:0"></p></div>

    <div class="panel"><div class="panel-h"><h3>Auf dem iPhone installieren</h3></div>
      <ol class="hint steps"><li>Diese Seite in <b>Safari</b> öffnen.</li><li>Unten auf <b>Teilen</b> → <b>Zum Home-Bildschirm</b> → <b>Hinzufügen</b>.</li><li>Ab jetzt startest du die App über das Symbol – auch offline. Am PC öffnest du einfach denselben Link.</li></ol></div>
  </section>`;

  $("#logout").onclick = () => sb.auth.signOut();
  $("#resync").onclick = async () => { await store.fullResync(); toast("Daten neu geladen"); };
  const saveZ = () => {
    const nz = { refDistanceKm: Number($("#p-dist").value), refTime: $("#p-time").value.trim(), hrMax: num($("#p-max").value) || 190, hrRest: num($("#p-rest").value) || 60 };
    if (!parseTime(nz.refTime)) { toast("Zeit bitte als mm:ss oder h:mm:ss"); return; }
    store.saveSettings({ zones: nz }); $("#pZones").innerHTML = zonesTable(nz); toast("Zonen gespeichert");
  };
  ["#p-dist", "#p-time", "#p-max", "#p-rest"].forEach(s => $(s).onchange = saveZ);
  renderSports();
  $("#addSport").onsubmit = e => {
    e.preventDefault();
    const label = $("#ns-l").value.trim(); if (!label) return;
    const key = "c_" + label.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "").slice(0, 16) + "_" + newId().slice(0, 4);
    store.saveSettings({ sports: { ...store.settings.sports, [key]: { label, c: $("#ns-c").value, km: $("#ns-km").checked } } });
    renderSports(); toast(label + " hinzugefügt");
  };
  $("#csvFile").onchange = e => { const f = e.target.files[0]; e.target.value = ""; if (f) importCSV(f); };
  $("#exportBtn").onclick = exportBackup;
  $("#backupFile").onchange = e => { const f = e.target.files[0]; e.target.value = ""; if (f) importBackup(f); };
  renderGarmin();
  renderStrava();
}

// ---------- Garmin (Personal API) ----------
function renderGarmin() {
  const box = $("#garminBox"); if (!box) return;
  const g = store.garmin;
  let h = `<div class="panel-h"><h3>Garmin Connect</h3>${g ? '<span class="chip done">verbunden</span>' : ""}</div>`;
  if (!g) {
    h += `<p class="hint">Holt deine Aktivitäten direkt von Garmin – kostenlos, mit Puls. Einmalig einrichten:</p>
      <ol class="hint steps">
        <li>In Safari oder am PC <a href="https://connect.garmin.com/app/settings/personalApiToken" target="_blank" rel="noopener">Garmin Connect → Einstellungen → Persönlicher API-Schlüssel</a> öffnen und anmelden.</li>
        <li>Neuen Schlüssel erstellen. Bei der Gültigkeit am besten <b>1 Jahr</b> wählen.</li>
        <li>Schlüssel kopieren, hier einfügen und <b>Verbinden</b> tippen.</li>
      </ol>
      <form class="stack" id="gForm" novalidate>
        <div class="field"><label for="g-key">Persönlicher API-Schlüssel</label><input type="password" id="g-key" autocomplete="off"></div>
        <div class="row"><button class="btn" type="submit">Verbinden</button><span class="hint" id="g-msg"></span></div>
      </form>
      <p class="hint" style="margin:0">Der Schlüssel wird nur auf dem Server gespeichert und nie wieder an die App geschickt. Bereits per CSV importierte Einheiten werden erkannt und nicht doppelt angelegt.</p>`;
  } else {
    const last = g.last_sync ? new Date(g.last_sync).toLocaleString("de-DE", { dateStyle: "short", timeStyle: "short" }) : "noch nie";
    h += `<p class="hint">Letzter Abgleich: ${esc(last)}. Die App gleicht automatisch ab, sobald du sie öffnest (höchstens alle 30 Minuten).</p>
      ${g.last_error ? `<div class="warn">${esc(g.last_error)}</div>` : ""}
      <div class="row"><button class="btn" id="g-sync">Jetzt abgleichen</button><button class="btn secondary small" id="g-new">Neuen Schlüssel eintragen</button><button class="btn danger small" id="g-off">Trennen</button></div>
      <p class="hint" id="g-msg"></p>`;
  }
  box.innerHTML = h;
  const msg = t => { const m = $("#g-msg"); if (m) m.textContent = t; };
  const result = r => `${r.created} neu, ${r.matched} geplante abgehakt, ${r.linked} vorhandene verknüpft, ${r.updated} aktualisiert`;
  const run = async (fn, busy) => { msg(busy); try { await fn(); } catch (e) { msg("Fehler: " + e.message); } };
  const f = $("#gForm");
  if (f) f.onsubmit = e => { e.preventDefault(); run(async () => { const r = await callGarmin("save_key", { api_key: $("#g-key").value }); await store.sync(); toast("Garmin verbunden"); msg(result(r)); }, "Verbinde und lade die letzten 4 Monate…"); };
  const sy = $("#g-sync"); if (sy) sy.onclick = () => run(async () => { const r = await callGarmin("sync"); await store.sync(); msg(result(r)); }, "Gleiche ab…");
  const nw = $("#g-new"); if (nw) nw.onclick = () => { store.garmin = null; renderGarmin(); };
  const off = $("#g-off"); if (off) off.onclick = () => run(async () => { await callGarmin("disconnect"); await store.sync(); toast("Garmin getrennt"); }, "Trenne…");
}

function renderSports() {
  const custom = store.settings.sports;
  $("#sportList").innerHTML = Object.entries(sportsOf(store.settings)).map(([k, s]) => `<div class="sportrow"><i class="dot" style="--c:${s.c};width:14px;height:14px;justify-self:center"></i><span>${esc(s.label)}${s.km ? ' <span class="hint">· mit Distanz</span>' : ""}</span>${custom[k] ? `<button class="ghost" data-delsport="${esc(k)}">Entfernen</button>` : "<span></span>"}</div>`).join("");
  $("#sportList").onclick = e => { const b = e.target.closest("[data-delsport]"); if (!b) return; const s = { ...store.settings.sports }; delete s[b.dataset.delsport]; store.saveSettings({ sports: s }); renderSports(); };
}

// ---------- Strava ----------
function renderStrava() {
  const box = $("#stravaBox"); if (!box) return;
  const app = store.stravaApp, con = store.strava;
  let h = con ? `<div class="panel-h"><span class="chip done">verbunden</span></div>` : "";
  if (!app) {
    h += `<p class="hint">Einmalig: Lege bei Strava eine eigene API-Anwendung an. Das dauert ca. 2 Minuten und kostet nichts.</p>
      <ol class="hint steps">
        <li>Am besten am PC <a href="https://www.strava.com/settings/api" target="_blank" rel="noopener">strava.com/settings/api</a> öffnen.</li>
        <li>Ausfüllen: <b>Application Name</b> „Trainingsbuch“, <b>Category</b> „Training“, <b>Website</b> <code>${esc(location.origin + location.pathname)}</code></li>
        <li><b>Authorization Callback Domain</b>: <code>${esc(CB_DOMAIN)}</code></li>
        <li>Speichern (ein Logo musst du ggf. hochladen – irgendein Bild genügt). Dann <b>Client ID</b> und <b>Client Secret</b> hier eintragen.</li>
      </ol>
      <form class="stack" id="stravaApp" novalidate>
        <div class="row2"><div class="field"><label for="s-id">Client ID</label><input type="text" id="s-id" inputmode="numeric" autocomplete="off"></div>
        <div class="field"><label for="s-sec">Client Secret</label><input type="password" id="s-sec" autocomplete="off"></div></div>
        <div class="row"><button class="btn" type="submit">Speichern</button><span class="hint" id="s-msg"></span></div>
      </form>
      <p class="hint" style="margin:0">Das Secret wird nur auf dem Server gespeichert und nie wieder an die App geschickt.</p>`;
  } else if (!con) {
    h += `<p class="hint">Strava-App eingerichtet (Client ID ${esc(app.client_id)}). Jetzt dein Konto verbinden: Die App darf deine Aktivitäten nur lesen.</p>
      <div class="row"><button class="btn" id="s-connect">Mit Strava verbinden</button><button class="ghost" id="s-reset">Client-Daten ändern</button></div><p class="hint" id="s-msg"></p>`;
  } else {
    const last = con.last_sync ? new Date(con.last_sync).toLocaleString("de-DE", { dateStyle: "short", timeStyle: "short" }) : "noch nie";
    h += `<p class="hint">Verbunden als <b>${esc(con.athlete_name || "Strava-Athlet")}</b> · letzter Abgleich ${esc(last)}<br>Automatischer Import: ${app.subscription_id ? '<span class="status-ok">aktiv</span> – neue Aktivitäten kommen von selbst' : "nicht aktiv"}</p>
      <div class="row"><button class="btn" id="s-sync">Jetzt abgleichen</button>${app.subscription_id ? "" : '<button class="btn secondary" id="s-hook">Automatik aktivieren</button>'}<button class="btn danger small" id="s-off">Trennen</button></div>
      <p class="hint" id="s-msg"></p>
      <details><summary class="hint" style="cursor:pointer">Zuordnung Strava-Sportart → App</summary><div id="s-map" style="margin-top:8px"></div></details>`;
  }
  box.innerHTML = h;
  const msg = t => { const m = $("#s-msg"); if (m) m.textContent = t; };
  const run = async (fn, busy) => { msg(busy); try { await fn(); } catch (e) { msg("Fehler: " + e.message); } };
  const f = $("#stravaApp");
  if (f) f.onsubmit = e => { e.preventDefault(); run(async () => { await callStrava("save_app", { client_id: $("#s-id").value, client_secret: $("#s-sec").value }); await store.sync(); toast("Strava-App gespeichert"); }, "Speichere…"); };
  const c = $("#s-connect");
  if (c) c.onclick = () => run(async () => { const { url } = await callStrava("auth_url", { return_to: location.origin + location.pathname }); location.href = url; }, "Weiter zu Strava…");
  const rs = $("#s-reset"); if (rs) rs.onclick = () => { store.stravaApp = null; renderStrava(); };
  const sy = $("#s-sync");
  if (sy) sy.onclick = () => run(async () => { const r = await callStrava("sync"); await store.sync(); msg(`${r.created} neu, ${r.matched} geplante abgehakt, ${r.updated} aktualisiert`); }, "Gleiche ab…");
  const hk = $("#s-hook");
  const hook = () => run(async () => { await callStrava("subscribe_webhook"); await store.sync(); toast("Automatischer Import aktiv"); }, "Aktiviere…");
  if (hk) hk.onclick = hook;
  if (con && !app.subscription_id && !webhookTried) { webhookTried = true; hook(); }
  const off = $("#s-off");
  if (off) off.onclick = () => run(async () => { await callStrava("disconnect"); await store.sync(); toast("Strava getrennt"); }, "Trenne…");
  const map = $("#s-map");
  if (map) {
    const S = sportsOf(store.settings), cur = { ...DEFAULT_STRAVA_MAP, ...store.settings.stravaMap };
    map.innerHTML = Object.keys(cur).sort().map(t => `<div class="maprow"><span>${esc(t)}</span><select class="in" data-st="${esc(t)}">${Object.entries(S).map(([k, s]) => `<option value="${esc(k)}"${cur[t] === k ? " selected" : ""}>${esc(s.label)}</option>`).join("")}</select></div>`).join("") + `<p class="hint">Gilt für neue Importe. Unbekannte Sportarten landen bei „Sonstiges“.</p>`;
    map.onchange = e => { const s = e.target.closest("[data-st]"); if (!s) return; store.saveSettings({ stravaMap: { ...store.settings.stravaMap, [s.dataset.st]: s.value } }); toast("Zuordnung gespeichert"); };
  }
}

// ---------- CSV ----------
function splitCSV(text) {
  const first = text.split(/\r?\n/, 1)[0];
  const sep = (first.match(/;/g) || []).length > (first.match(/,/g) || []).length ? ";" : ",";
  const rows = []; let row = [], cur = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) { if (ch === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += ch; }
    else if (ch === '"') q = true;
    else if (ch === sep) { row.push(cur); cur = ""; }
    else if (ch === "\n" || ch === "\r") { if (ch === "\r" && text[i + 1] === "\n") i++; row.push(cur); rows.push(row); row = []; cur = ""; }
    else cur += ch;
  }
  if (cur || row.length) { row.push(cur); rows.push(row); }
  return rows.filter(r => r.some(c => c.trim()));
}
const COLS = {
  date: ["activity date", "date", "datum", "startzeit", "start time", "start"],
  type: ["activity type", "aktivitätstyp", "type", "typ", "sport", "sportart"],
  title: ["activity name", "titel", "title", "name"],
  dist: ["distance", "distanz", "strecke", "km"],
  time: ["moving time", "bewegungszeit", "elapsed time", "zeit", "time", "dauer", "duration", "minuten"],
  hr: ["average heart rate", "avg hr", "ø herzfrequenz", "durchschnittliche herzfrequenz", "avg heart rate", "puls"],
  maxhr: ["max heart rate", "max hr", "maximale herzfrequenz", "max. herzfrequenz"],
  elev: ["elevation gain", "total ascent", "anstieg gesamt", "höhenmeter", "aufstieg gesamt"],
};
function colIndex(head) {
  const h = head.map(x => x.trim().toLowerCase().replace(/^﻿/, ""));
  const idx = {};
  for (const [k, names] of Object.entries(COLS)) { for (const n of names) { const i = h.indexOf(n); if (i >= 0) { idx[k] = i; break; } } }
  return idx;
}
const MON = { jan: 1, feb: 2, mar: 3, mär: 3, apr: 4, may: 5, mai: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, okt: 10, nov: 11, dec: 12, dez: 12 };
function parseDate(s) {
  s = String(s || "").trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/); if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})/); if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  m = s.match(/^([A-Za-zäÄ]{3})[a-z]*\.? (\d{1,2}), (\d{4})/); if (m && MON[m[1].toLowerCase()]) return `${m[3]}-${String(MON[m[1].toLowerCase()]).padStart(2, "0")}-${m[2].padStart(2, "0")}`;
  m = s.match(/^(\d{1,2})\.? ([A-Za-zäÄ]{3})[a-z]*\.? (\d{4})/); if (m && MON[m[2].toLowerCase()]) return `${m[3]}-${String(MON[m[2].toLowerCase()]).padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  return null;
}
function parseDur(s, header) {
  s = String(s || "").trim(); if (!s) return null;
  if (s.includes(":")) { const p = s.split(":").map(x => parseFloat(x.replace(",", "."))); return p.length === 3 ? p[0] * 60 + p[1] + p[2] / 60 : p[0] + p[1] / 60; }
  const n = num(s); if (n == null) return null;
  if (/minute/.test(header)) return n;
  return /moving|elapsed/.test(header) || n > 400 ? n / 60 : n;
}
function mapType(t) {
  const raw = String(t || "").trim(), key = raw.replace(/\s+/g, "");
  const m = { ...DEFAULT_STRAVA_MAP, ...store.settings.stravaMap };
  if (m[key]) return m[key];
  const l = raw.toLowerCase();
  const custom = Object.entries(store.settings.sports).find(([, s]) => s.label.toLowerCase() === l);
  if (custom) return custom[0];
  if (/lauf|run|jogg|trail/.test(l)) return "run";
  if (/rad|cycl|bike|ride|spinning/.test(l)) return "bike";
  if (/schwimm|swim/.test(l)) return "swim";
  if (/ruder|row/.test(l)) return "row";
  if (/ski ?erg/.test(l)) return "skierg";
  if (/stepper|stair|treppe/.test(l)) return "stepper";
  if (/plyo|sprung|jump/.test(l)) return "plyo";
  if (/kraft|strength|weight|gym/.test(l)) return "gym";
  if (/yoga|dehn|stretch|mobil|pilates/.test(l)) return "stretch";
  if (/fußball|fussball|soccer|football/.test(l)) return "football";
  return "other";
}
async function importCSV(file) {
  const out = $("#csvStatus");
  try {
    const rows = splitCSV(await file.text());
    if (rows.length < 2) throw new Error("Datei ist leer");
    const head = rows[0], idx = colIndex(head);
    if (idx.date == null) throw new Error("Keine Datumsspalte gefunden");
    const S = sportsOf(store.settings), z = store.settings.zones;
    const all = store.allWorkouts(), put = [];
    let created = 0, matched = 0, dup = 0, bad = 0;
    for (const r of rows.slice(1)) {
      const date = parseDate(r[idx.date]); if (!date) { bad++; continue; }
      const sport = idx.type != null ? mapType(r[idx.type]) : "other";
      const dur = idx.time != null ? parseDur(r[idx.time], head[idx.time].toLowerCase()) : null;
      let km = idx.dist != null ? num(r[idx.dist]) : null;
      if (km && km > 400) km = km / 1000; // Meter
      const hr = idx.hr != null ? num(r[idx.hr]) : null;
      const data = { date, sport, status: "done", source: "csv", locked: true,
        distanceKm: S[sport]?.km && km > 0 ? Math.round(km * 100) / 100 : null, durationMin: dur ? Math.round(dur * 10) / 10 : null,
        avgHr: hr ? Math.round(hr) : null, maxHr: idx.maxhr != null ? Math.round(num(r[idx.maxhr]) || 0) || null : null,
        elevM: idx.elev != null ? num(r[idx.elev]) : null };
      data.trimp = trimp(data.durationMin, data.avgHr, z);
      const same = [...all, ...put].find(w => w.date === date && w.sport === sport && w.status === "done" && Math.abs((+w.durationMin || 0) - (data.durationMin || 0)) <= 3);
      if (same) { dup++; continue; }
      const pl = [...all, ...put].find(w => w.date === date && w.sport === sport && w.status === "planned" && !w.deleted && !put.includes(w));
      if (pl) { put.push({ ...pl, ...data }); matched++; }
      else { put.push({ id: newId(), title: idx.title != null ? String(r[idx.title]).slice(0, 120) || null : null, ...data }); created++; }
    }
    store.putWorkouts(put);
    out.innerHTML = `<span class="status-ok">${created} neu, ${matched} geplante abgehakt</span>${dup ? ` · ${dup} schon vorhanden` : ""}${bad ? ` · ${bad} Zeilen ohne Datum` : ""}`;
  } catch (e) { out.innerHTML = `<span class="status-err">${esc(e.message)}</span>`; }
}

// ---------- Backup ----------
function exportBackup() {
  const data = { app: "trainingsbuch", version: 1, exportedAt: new Date().toISOString(), workouts: [...store.workouts.values()], plans: [...store.plans.values()], settings: store.settings };
  const blob = new Blob([JSON.stringify(data)], { type: "application/json" });
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "trainingsbuch-backup-" + todayStr() + ".json";
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  $("#backupStatus").innerHTML = `<span class="status-ok">Backup mit ${data.workouts.length} Einheiten erstellt</span>`;
}
async function importBackup(file) {
  const out = $("#backupStatus");
  try {
    const d = JSON.parse(await file.text());
    if (d.app !== "trainingsbuch" || !Array.isArray(d.workouts)) throw new Error("Keine Backup-Datei dieser App");
    store.putWorkouts(d.workouts.filter(w => w && w.id && w.date && w.sport));
    for (const p of d.plans || []) if (p && p.id) store.putPlan(p);
    if (d.settings) store.saveSettings(d.settings);
    out.innerHTML = `<span class="status-ok">${d.workouts.length} Einheiten eingespielt</span>`;
  } catch (e) { out.innerHTML = `<span class="status-err">${esc(e.message)}</span>`; }
}
