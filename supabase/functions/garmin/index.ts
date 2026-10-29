// Garmin-Aktionen der App (mit Login): Schlüssel speichern, abgleichen, trennen.
import { admin, cors, json } from "../_shared/common.ts";
import { exchangeKey, syncGarmin } from "../_shared/garmin.ts";

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
      case "save_key": {
        const key = String(body.api_key || "").trim();
        if (key.length < 16) return json({ error: "Bitte den kompletten Schlüssel einfügen" }, 400);
        const t = await exchangeKey(key); // prüft den Schlüssel sofort
        const { error } = await db.from("garmin_keys").upsert({ user_id: userId, api_key: key, access_token: t.token, token_expires_at: t.exp, last_sync: null, last_error: null });
        if (error) throw error;
        return json({ ok: true, ...(await syncGarmin(db, userId, Number(body.days) || 120)) });
      }
      case "sync":
        return json(await syncGarmin(db, userId));
      case "disconnect":
        await db.from("garmin_keys").delete().eq("user_id", userId);
        return json({ ok: true });
      default:
        return json({ error: "Unbekannte Aktion" }, 400);
    }
  } catch (e) {
    return json({ error: (e as Error).message || String(e) }, 400);
  }
});
