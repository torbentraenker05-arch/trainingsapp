// Strava leitet nach der Freigabe hierher um: Code gegen Tokens tauschen, erste Daten holen, zurück zur App.
import { admin, getApp, syncUser } from "../_shared/strava.ts";

function back(to: string | null, status: string, msg = "") {
  const base = to && /^https?:\/\//.test(to) ? to.split("#")[0] : null;
  if (!base) return new Response(status === "ok" ? "Strava verbunden. Du kannst dieses Fenster schließen." : "Fehler: " + msg, { status: 200, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  return Response.redirect(base + "#strava=" + status + (msg ? "&msg=" + encodeURIComponent(msg) : ""), 302);
}

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const db = admin();
  const state = url.searchParams.get("state") || "";
  const { data: st } = await db.from("strava_oauth_states").select("*").eq("state", state).maybeSingle();
  if (!st) return back(null, "error", "Ungültiger oder abgelaufener Anmeldeversuch");
  await db.from("strava_oauth_states").delete().eq("state", state);
  if (url.searchParams.get("error")) return back(st.return_to, "error", "Zugriff wurde nicht erlaubt");
  const scope = url.searchParams.get("scope") || "";
  if (!scope.includes("activity:read")) return back(st.return_to, "error", "Bitte den Zugriff auf Aktivitäten erlauben");
  try {
    const app = await getApp(db, st.user_id);
    const r = await fetch("https://www.strava.com/oauth/token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ client_id: app.client_id, client_secret: app.client_secret, code: url.searchParams.get("code"), grant_type: "authorization_code" }),
    });
    const t = await r.json();
    if (!r.ok) throw new Error("Token-Tausch fehlgeschlagen");
    const { error } = await db.from("strava_tokens").upsert({
      user_id: st.user_id,
      athlete_id: t.athlete.id,
      athlete_name: [t.athlete.firstname, t.athlete.lastname].filter(Boolean).join(" "),
      access_token: t.access_token,
      refresh_token: t.refresh_token,
      expires_at: t.expires_at,
      last_sync: null,
    });
    if (error) throw error;
    await syncUser(db, st.user_id, 60);
    return back(st.return_to, "ok");
  } catch (e) {
    return back(st.return_to, "error", (e as Error).message);
  }
});
