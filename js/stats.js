// Statistik: Kennzahlen, Kilometer pro Woche, Belastung (7 vs. 28 Tage), Plan-Erfüllung, Bestwerte
import { $, esc, ymd, parse, addDays, mondayOf, isoWeek, MONTHS, fmtKm, fmtDurShort, fmtPace, todayStr, addDaysStr } from "./util.js";
import { store } from "./store.js";
import { sportsOf, sportOf, loadOf } from "./sports.js";
import { entryHTML, openSheet } from "./app.js";

const st = { period: "week", chartSport: "run" };
const FONT_D = "Barlow Condensed,Arial Narrow,sans-serif", FONT_B = "Manrope,system-ui,sans-serif";

function periodRange(p) {
  const n = new Date();
  if (p === "week") { const a = mondayOf(n); return [ymd(a), ymd(addDays(a, 6)), "KW " + isoWeek(n)]; }
  if (p === "month") return [ymd(new Date(n.getFullYear(), n.getMonth(), 1)), ymd(new Date(n.getFullYear(), n.getMonth() + 1, 0)), MONTHS[n.getMonth()]];
  return [n.getFullYear() + "-01-01", n.getFullYear() + "-12-31", String(n.getFullYear())];
}
const sumOf = l => l.reduce((s, w) => ({ km: s.km + (+w.distanceKm || 0), min: s.min + (+w.durationMin || 0), n: s.n + 1 }), { km: 0, min: 0, n: 0 });

export function renderStats() {
  const app = $("#app");
  if (!app.querySelector("#v-stats")) {
    const S = sportsOf(store.settings);
    app.innerHTML = `<section class="view" id="v-stats">
      <div class="panel-h" style="margin:0"><h2>Performance</h2>
        <div class="seg" id="periodSeg"><button data-p="week">Woche</button><button data-p="month">Monat</button><button data-p="year">Jahr</button></div></div>
      <div class="tiles" id="tiles"></div>
      <div class="panel"><div class="panel-h"><h3>Belastung</h3><span class="hint">Ø pro Tag · 7 Tage vs. 28 Tage</span></div><div id="loadChart"></div><p class="hint" id="acwr" style="margin:6px 0 0"></p></div>
      <div class="panel"><div class="panel-h"><h3>Plan-Erfüllung</h3><span class="hint">geplant vs. erledigt</span></div><div class="bars" id="fulfil"></div></div>
      <div class="panel"><div class="panel-h"><h3 id="chartTitle"></h3>
        <select class="in" id="chartSel" aria-label="Sportart für das Diagramm">${Object.entries(S).filter(([, s]) => s.km).map(([k, s]) => `<option value="${esc(k)}">${esc(s.label)}</option>`).join("")}</select></div><div id="chart"></div></div>
      <div class="panel"><div class="panel-h"><h3 id="mixTitle"></h3></div><div class="bars" id="mix"></div></div>
      <div class="panel"><div class="panel-h"><h3>Bestwerte</h3></div><div class="pbs" id="pbs"></div></div>
      <div><div class="label" style="margin-bottom:8px">Letzte Einheiten</div><div class="list" id="recent"></div></div>
    </section>`;
    $("#periodSeg").onclick = e => { const b = e.target.closest("button[data-p]"); if (b) { st.period = b.dataset.p; renderStats(); } };
    $("#chartSel").onchange = e => { st.chartSport = e.target.value; renderStats(); };
    $("#recent").onclick = e => { const ed = e.target.closest("[data-edit]"); if (ed) openSheet(store.workouts.get(ed.dataset.edit)); };
  }
  $("#periodSeg").querySelectorAll("button").forEach(b => b.setAttribute("aria-pressed", b.dataset.p === st.period));
  $("#chartSel").value = st.chartSport;
  const z = store.settings.zones;
  const done = store.allWorkouts().filter(w => w.status === "done");
  const [a, b, name] = periodRange(st.period);
  const list = done.filter(w => w.date >= a && w.date <= b), all = sumOf(list), run = sumOf(list.filter(w => w.sport === "run"));
  const load = list.reduce((s, w) => s + loadOf(w, z), 0);
  $("#tiles").innerHTML = [
    ["Laufen · " + name, fmtKm(run.km), "km"],
    ["Trainingszeit", fmtDurShort(all.min), "h"],
    [run.km > 0 && run.min > 0 ? "Ø Lauf-Pace" : "Einheiten", run.km > 0 && run.min > 0 ? fmtPace(run.min * 60 / run.km) : all.n, run.km > 0 && run.min > 0 ? "/km" : ""],
    ["Belastung (TRIMP)", Math.round(load), ""],
  ].map(([l, v, u]) => `<div class="tile"><div class="label">${esc(l)}</div><div class="v">${v}${u ? `<small>${u}</small>` : ""}</div></div>`).join("");

  // Belastungskurve: tägliche Belastung, gleitend 7 und 28 Tage, letzte 12 Wochen
  const days = 84, t = todayStr(), daily = {};
  for (const w of done) if (w.date > addDaysStr(t, -days - 28) && w.date <= t) daily[w.date] = (daily[w.date] || 0) + loadOf(w, z);
  const pts = [];
  for (let i = days; i >= 0; i--) {
    const d = addDaysStr(t, -i);
    let a7 = 0, a28 = 0;
    for (let j = 0; j < 28; j++) { const v = daily[addDaysStr(d, -j)] || 0; a28 += v; if (j < 7) a7 += v; }
    pts.push({ d, a: a7 / 7, c: a28 / 28 });
  }
  $("#loadChart").innerHTML = lineSVG(pts);
  const last = pts[pts.length - 1], ratio = last.c > 0 ? last.a / last.c : null;
  $("#acwr").innerHTML = ratio == null ? "Noch keine Belastungsdaten. Sie kommen automatisch aus Garmin (Puls)." :
    `Verhältnis akut/chronisch: <b>${ratio.toFixed(2)}</b> – ${ratio > 1.5 ? '<span class="status-err">deutlich erhöht, Verletzungsrisiko steigt</span>' : ratio > 1.3 ? "erhöht, achte auf Erholung" : ratio < 0.8 ? "unter deinem Niveau (Entlastung oder Pause)" : '<span class="status-ok">im grünen Bereich</span>'}`;

  // Plan-Erfüllung: letzte 6 Wochen + aktuelle
  const m0 = mondayOf(new Date()), rows = [];
  for (let i = 6; i >= 0; i--) {
    const st0 = ymd(addDays(m0, -7 * i)), en = ymd(addDays(m0, -7 * i + 6));
    const pl = store.allWorkouts().filter(w => w.planId && w.date >= st0 && w.date <= en && (i > 0 || w.date < t));
    if (!pl.length) continue;
    const dn = pl.filter(w => w.status === "done").length;
    rows.push(`<div class="bar-row" style="--c:var(--accent)"><span>KW ${isoWeek(parse(st0))}${i === 0 ? " (bis gestern)" : ""}</span><div class="bar-track"><div class="bar-fill" style="width:${(dn / pl.length * 100).toFixed(0)}%"></div></div><span class="r">${dn}/${pl.length}</span></div>`);
  }
  $("#fulfil").innerHTML = rows.length ? rows.join("") : `<div class="empty">Sobald ein Plan läuft, siehst du hier, wie viel du davon erledigst.</div>`;

  // Kilometer pro Woche
  const sp = st.chartSport, weeks = [];
  for (let i = 11; i >= 0; i--) { const s0 = addDays(m0, -7 * i), e0 = addDays(s0, 6); weeks.push({ kw: isoWeek(s0), v: done.filter(w => w.sport === sp && w.date >= ymd(s0) && w.date <= ymd(e0)).reduce((s, w) => s + (+w.distanceKm || 0), 0) }); }
  $("#chartTitle").textContent = sportOf(store.settings, sp).label + ": Kilometer pro Woche";
  $("#chart").innerHTML = barSVG(weeks, sportOf(store.settings, sp).c);

  // Zeit nach Sportart
  $("#mixTitle").textContent = "Zeit nach Sportart · " + name;
  const S = sportsOf(store.settings);
  const mix = Object.keys(S).map(k => ({ k, min: list.filter(w => (S[w.sport] ? w.sport : "other") === k).reduce((s, w) => s + (+w.durationMin || 0), 0) })).filter(x => x.min > 0).sort((x, y) => y.min - x.min);
  const mx = Math.max(1, ...mix.map(x => x.min));
  $("#mix").innerHTML = mix.length ? mix.map(x => `<div class="bar-row" style="--c:${S[x.k].c}"><span>${esc(S[x.k].label)}</span><div class="bar-track"><div class="bar-fill" style="width:${(x.min / mx * 100).toFixed(1)}%"></div></div><span class="r">${fmtDurShort(x.min)} h</span></div>`).join("") : `<div class="empty">In diesem Zeitraum ist noch kein Training mit Dauer eingetragen.</div>`;

  // Bestwerte
  const runs = done.filter(w => w.sport === "run" && +w.distanceKm > 0);
  const longest = runs.slice().sort((x, y) => y.distanceKm - x.distanceKm)[0];
  const fastest = runs.filter(w => +w.distanceKm >= 3 && +w.durationMin > 0).sort((x, y) => x.durationMin / x.distanceKm - y.durationMin / y.distanceKm)[0];
  const ride = done.filter(w => w.sport === "bike" && +w.distanceKm > 0).sort((x, y) => y.distanceKm - x.distanceKm)[0];
  const wk = {}; for (const w of runs) { const k = ymd(mondayOf(parse(w.date))); wk[k] = (wk[k] || 0) + (+w.distanceKm); }
  const bestWk = Object.entries(wk).sort((x, y) => y[1] - x[1])[0];
  const dd = s => { const d = parse(s); return d.getDate() + "." + (d.getMonth() + 1) + "." + String(d.getFullYear()).slice(2); };
  $("#pbs").innerHTML = [
    ["Längster Lauf", longest ? fmtKm(+longest.distanceKm) + " km" : "–", longest ? dd(longest.date) : "noch kein Lauf"],
    ["Schnellste Pace", fastest ? fmtPace(fastest.durationMin * 60 / fastest.distanceKm) + " /km" : "–", fastest ? fmtKm(+fastest.distanceKm) + " km am " + dd(fastest.date) : "ab 3 km mit Zeit"],
    ["Stärkste Laufwoche", bestWk ? fmtKm(bestWk[1]) + " km" : "–", bestWk ? "KW " + isoWeek(parse(bestWk[0])) : "noch keine Daten"],
    ["Längste Radfahrt", ride ? fmtKm(+ride.distanceKm) + " km" : "–", ride ? dd(ride.date) : "noch keine Fahrt"],
  ].map(([l, v, s]) => `<div class="pb"><div class="label">${l}</div><div class="v">${v}</div><div class="s">${s}</div></div>`).join("");

  const rec = done.slice().sort((x, y) => x.date < y.date ? 1 : -1).slice(0, 5);
  $("#recent").innerHTML = rec.length ? rec.map(w => entryHTML(w, true)).join("") : `<div class="empty">Sobald du Trainings einträgst oder Garmin verbindest, siehst du hier Kilometer, Zeiten und Bestwerte.</div>`;
}

function niceStep(max) { const steps = [2, 5, 10, 20, 25, 50, 100, 200, 500]; return max === 0 ? 5 : steps.find(s => s * 4 >= max) || Math.ceil(max / 4 / 100) * 100; }

function barSVG(weeks, color) {
  const W = 360, H = 190, L = 34, R = 352, T = 18, B = 160;
  const max = Math.max(...weeks.map(w => w.v)), step = niceStep(max), top = step * 4, y = v => B - (v / top) * (B - T);
  const slot = (R - L) / weeks.length, bw = slot * 0.6;
  let g = "";
  for (let i = 0; i <= 4; i++) { const yy = y(step * i); g += `<line x1="${L}" x2="${R}" y1="${yy}" y2="${yy}" stroke="var(--line)"/><text x="${L - 6}" y="${yy + 3.5}" text-anchor="end" font-size="10" fill="var(--muted)" font-family="${FONT_D}">${step * i}</text>`; }
  weeks.forEach((w, i) => {
    const x = L + slot * i + (slot - bw) / 2, h = Math.max(0, B - y(w.v)), last = i === weeks.length - 1;
    if (w.v > 0) g += `<rect x="${x.toFixed(1)}" y="${(B - h).toFixed(1)}" width="${bw.toFixed(1)}" height="${h.toFixed(1)}" rx="3" fill="${color}" opacity="${last ? 1 : .6}"/>`;
    if (w.v > 0 && (last || w.v === max)) g += `<text x="${(x + bw / 2).toFixed(1)}" y="${(B - h - 5).toFixed(1)}" text-anchor="middle" font-size="11" font-weight="700" fill="var(--ink)" font-family="${FONT_D}">${fmtKm(w.v)}</text>`;
    g += `<text x="${(x + bw / 2).toFixed(1)}" y="${B + 15}" text-anchor="middle" font-size="10" fill="${last ? "var(--ink)" : "var(--muted)"}" font-weight="${last ? 700 : 500}" font-family="${FONT_D}">${w.kw}</text>`;
  });
  g += `<text x="${R}" y="${H - 2}" text-anchor="end" font-size="10" fill="var(--muted)" font-family="${FONT_B}">Kalenderwoche</text>`;
  if (max === 0) g += `<text x="${(L + R) / 2}" y="${(T + B) / 2}" text-anchor="middle" font-size="13" fill="var(--muted)" font-family="${FONT_B}">Noch keine Kilometer in den letzten 12 Wochen</text>`;
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Kilometer pro Woche, letzte 12 Wochen">${g}</svg>`;
}

function lineSVG(pts) {
  const W = 360, H = 170, L = 34, R = 352, T = 14, B = 140;
  const max = Math.max(1, ...pts.map(p => Math.max(p.a, p.c))), step = niceStep(max), top = step * 4;
  const x = i => L + (R - L) * i / (pts.length - 1), y = v => B - (v / top) * (B - T);
  let g = "";
  for (let i = 0; i <= 4; i++) { const yy = y(step * i); g += `<line x1="${L}" x2="${R}" y1="${yy}" y2="${yy}" stroke="var(--line)"/><text x="${L - 6}" y="${yy + 3.5}" text-anchor="end" font-size="10" fill="var(--muted)" font-family="${FONT_D}">${step * i}</text>`; }
  const path = k => pts.map((p, i) => (i ? "L" : "M") + x(i).toFixed(1) + " " + y(p[k]).toFixed(1)).join("");
  g += `<path d="${path("c")}" fill="none" stroke="var(--muted)" stroke-width="2" stroke-dasharray="4 3"/>`;
  g += `<path d="${path("a")}" fill="none" stroke="var(--accent)" stroke-width="2.4" stroke-linejoin="round"/>`;
  for (let i = 0; i < pts.length; i += 14) { const d = parse(pts[i].d); g += `<text x="${x(i).toFixed(1)}" y="${B + 15}" text-anchor="middle" font-size="10" fill="var(--muted)" font-family="${FONT_D}">${d.getDate()}.${d.getMonth() + 1}.</text>`; }
  g += `<g font-size="11" font-family="${FONT_B}" font-weight="600"><line x1="${L}" x2="${L + 16}" y1="${H - 6}" y2="${H - 6}" stroke="var(--accent)" stroke-width="2.4"/><text x="${L + 20}" y="${H - 2}" fill="var(--ink)">7 Tage</text><line x1="${L + 80}" x2="${L + 96}" y1="${H - 6}" y2="${H - 6}" stroke="var(--muted)" stroke-width="2" stroke-dasharray="4 3"/><text x="${L + 100}" y="${H - 2}" fill="var(--ink)">28 Tage</text></g>`;
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Belastung der letzten 12 Wochen">${g}</svg>`;
}
