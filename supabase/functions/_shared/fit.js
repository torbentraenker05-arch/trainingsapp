// FIT-Auswertung: Wie lange dauert es in den Pausen-Runden eines Garmin-Workouts, bis der Puls unter die Schwelle fällt?
// Bibliotheken werden übergeben (Deno: npm-Imports, Tests: Node), damit diese Datei überall läuft.

const REST = new Set(["rest", "recovery"]);
const sec = (a, b) => (new Date(b).getTime() - new Date(a).getTime()) / 1000;

// bytes: ZIP von Garmin (oder direkt .fit).
// Ergebnis: { thr, values: [s…] Zeit bis Puls < thr je Pause, censored, avgSec, reps: [{ m, sec, hr }] tatsächliche Intervalle }
export function analyzeRecovery(bytes, { Decoder, Stream, unzipSync }, thr = 130) {
  let fit = bytes;
  if (bytes[0] === 0x50 && bytes[1] === 0x4b) { // "PK" = ZIP
    const files = unzipSync(bytes);
    const name = Object.keys(files).find(n => n.toLowerCase().endsWith(".fit"));
    if (!name) return { thr, values: [], censored: 0, avgSec: null, reps: [] };
    fit = files[name];
  }
  const decoder = new Decoder(Stream.fromByteArray(fit));
  const { messages } = decoder.read({ convertTypesToStrings: true });
  const laps = (messages.lapMesgs || []).slice().sort((a, b) => new Date(a.startTime) - new Date(b.startTime));
  const recs = (messages.recordMesgs || []).filter(r => r.heartRate != null && r.timestamp);
  const values = [], reps = []; let censored = 0;
  const isRep = (l, i) => ["active", "interval"].includes(String(l.intensity)) && (l.totalTimerTime ?? 0) >= 20 && (l.totalTimerTime ?? 0) <= 570 && l.totalDistance > 0
    && (REST.has(String(laps[i + 1]?.intensity)) || REST.has(String(laps[i - 1]?.intensity)));
  laps.forEach((l, i) => { if (isRep(l, i)) reps.push({ m: Math.round(l.totalDistance), sec: Math.round((l.totalTimerTime ?? l.totalElapsedTime) * 10) / 10, hr: l.avgHeartRate ?? null }); });
  for (let i = 1; i < laps.length; i++) {
    const lap = laps[i], prev = laps[i - 1];
    if (!REST.has(String(lap.intensity))) continue;
    // nur echte Intervalle davor: aktiv, höchstens ~9,5 min (Schwelle/Tempo wird nicht gelernt)
    const prevDur = prev.totalElapsedTime ?? prev.totalTimerTime ?? 0;
    if (!["active", "interval"].includes(String(prev.intensity)) || prevDur > 570 || prevDur < 20) continue;
    const start = lap.startTime, dur = lap.totalElapsedTime ?? lap.totalTimerTime ?? 0;
    const inLap = recs.filter(r => { const d = sec(start, r.timestamp); return d >= 0 && d <= dur; });
    if (!inLap.length || Math.max(...inLap.map(r => r.heartRate)) < thr + 10) continue; // Puls war gar nicht oben
    const below = inLap.find(r => r.heartRate < thr);
    if (below) values.push(Math.round(sec(start, below.timestamp)));
    else { values.push(Math.round(dur)); censored++; }
  }
  const avgSec = values.length ? Math.round(values.reduce((a, b) => a + b, 0) / values.length) : null;
  return { thr, values, censored, avgSec, reps };
}
