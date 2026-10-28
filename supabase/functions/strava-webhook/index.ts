// Strava-Webhook: Bestätigung des Abos (GET) und neue/geänderte/gelöschte Aktivitäten (POST).
import { admin, accessToken, importActivity } from "../_shared/strava.ts";

declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void };

async function handle(ev: any, userParam: string | null) {
  const db = admin();
  const { data: tok } = await db.from("strava_tokens").select("user_id").eq("athlete_id", ev.owner_id).maybeSingle();
  if (!tok || (userParam && tok.user_id !== userParam)) return;
  const userId = tok.user_id;

  if (ev.object_type === "athlete") {
    if (ev.updates && String(ev.updates.authorized) === "false") await db.from("strava_tokens").delete().eq("user_id", userId);
    return;
  }
  if (ev.object_type !== "activity") return;

  if (ev.aspect_type === "delete") {
    const { data: w } = await db.from("workouts").select("id,plan_id").eq("user_id", userId).eq("strava_id", ev.object_id).maybeSingle();
    if (!w) return;
    if (w.plan_id) {
      // War eine geplante Einheit: wieder auf geplant zurücksetzen
      await db.from("workouts").update({ status: "planned", strava_id: null, source: "plan", distance_km: null, duration_min: null, avg_hr: null, max_hr: null, elev_m: null, trimp: null }).eq("id", w.id);
    } else {
      await db.from("workouts").update({ deleted: true }).eq("id", w.id);
    }
    return;
  }

  const token = await accessToken(db, userId);
  const r = await fetch("https://www.strava.com/api/v3/activities/" + ev.object_id, { headers: { Authorization: "Bearer " + token } });
  if (!r.ok) return;
  await importActivity(db, userId, await r.json());
}

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const userParam = url.searchParams.get("u");

  if (req.method === "GET") {
    const mode = url.searchParams.get("hub.mode");
    const vt = url.searchParams.get("hub.verify_token");
    const challenge = url.searchParams.get("hub.challenge");
    if (mode !== "subscribe" || !userParam || !vt) return new Response("bad request", { status: 400 });
    const { data: app } = await admin().from("strava_apps").select("verify_token").eq("user_id", userParam).maybeSingle();
    if (!app || app.verify_token !== vt) return new Response("forbidden", { status: 403 });
    return new Response(JSON.stringify({ "hub.challenge": challenge }), { headers: { "Content-Type": "application/json" } });
  }

  if (req.method === "POST") {
    let ev: any = null;
    try { ev = await req.json(); } catch { return new Response("ok"); }
    // Strava erwartet die Antwort innerhalb von 2 s – Verarbeitung im Hintergrund
    EdgeRuntime.waitUntil(handle(ev, userParam).catch((e) => console.error("webhook", e)));
    return new Response("ok");
  }
  return new Response("method not allowed", { status: 405 });
});
