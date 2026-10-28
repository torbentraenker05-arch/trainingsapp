// Strava-Aktionen der App (mit Login): App-Daten speichern, Verbindung starten, Sync, Webhook, Trennen.
import { admin, cors, json, getApp, syncUser, accessToken } from "../_shared/strava.ts";

const FN = Deno.env.get("SUPABASE_URL") + "/functions/v1";

function rand() {
  const b = new Uint8Array(18);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const db = admin();
  const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  const { data: u, error: ue } = await db.auth.getUser(jwt);
  if (ue || !u?.user) return json({ error: "Nicht angemeldet" }, 401);
  const userId = u.user.id;
  let body: any = {};
  try { body = await req.json(); } catch { /* leer */ }

  try {
    switch (body.action) {
      case "save_app": {
        const client_id = String(body.client_id || "").trim();
        const client_secret = String(body.client_secret || "").trim();
        if (!/^\d+$/.test(client_id) || client_secret.length < 20) return json({ error: "Client-ID oder Client-Secret ungültig" }, 400);
        const { error } = await db.from("strava_apps").upsert({ user_id: userId, client_id, client_secret, verify_token: rand(), updated_at: new Date().toISOString() });
        if (error) throw error;
        return json({ ok: true });
      }
      case "auth_url": {
        const app = await getApp(db, userId);
        const state = rand();
        await db.from("strava_oauth_states").delete().lt("created_at", new Date(Date.now() - 3600e3).toISOString());
        await db.from("strava_oauth_states").insert({ state, user_id: userId, return_to: String(body.return_to || "").slice(0, 500) });
        const p = new URLSearchParams({
          client_id: app.client_id,
          redirect_uri: FN + "/strava-callback",
          response_type: "code",
          approval_prompt: "auto",
          scope: "activity:read_all",
          state,
        });
        return json({ url: "https://www.strava.com/oauth/authorize?" + p });
      }
      case "sync":
        return json(await syncUser(db, userId, Number(body.days) || 60));
      case "subscribe_webhook": {
        const { data: app } = await db.from("strava_apps").select("*").eq("user_id", userId).single();
        if (!app) throw new Error("Strava-App ist noch nicht eingerichtet");
        const auth = { client_id: app.client_id, client_secret: app.client_secret };
        // Bestehende Abos dieser Strava-App entfernen (pro App ist nur eines erlaubt)
        const ex = await fetch("https://www.strava.com/api/v3/push_subscriptions?" + new URLSearchParams(auth));
        if (ex.ok) for (const s of await ex.json()) {
          await fetch(`https://www.strava.com/api/v3/push_subscriptions/${s.id}?` + new URLSearchParams(auth), { method: "DELETE" });
        }
        const r = await fetch("https://www.strava.com/api/v3/push_subscriptions", {
          method: "POST",
          body: new URLSearchParams({ ...auth, callback_url: FN + "/strava-webhook?u=" + userId, verify_token: app.verify_token }),
        });
        const res = await r.json();
        if (!r.ok) throw new Error("Webhook-Anmeldung fehlgeschlagen: " + JSON.stringify(res));
        await db.from("strava_apps").update({ subscription_id: res.id }).eq("user_id", userId);
        return json({ ok: true, id: res.id });
      }
      case "disconnect": {
        try {
          const t = await accessToken(db, userId);
          await fetch("https://www.strava.com/oauth/deauthorize", { method: "POST", headers: { Authorization: "Bearer " + t } });
        } catch { /* schon getrennt */ }
        await db.from("strava_tokens").delete().eq("user_id", userId);
        return json({ ok: true });
      }
      default:
        return json({ error: "Unbekannte Aktion" }, 400);
    }
  } catch (e) {
    return json({ error: (e as Error).message || String(e) }, 400);
  }
});
