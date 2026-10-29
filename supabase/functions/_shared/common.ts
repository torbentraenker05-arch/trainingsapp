// Gemeinsame Helfer der Edge Functions: CORS, JSON-Antworten, Admin-Client, Belastung (TRIMP)
import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2.45.4";

export const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

export function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
}

export function admin(): SupabaseClient {
  return createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
}

export function trimp(durMin: number, avgHr: number | null, hrRest: number, hrMax: number) {
  if (!avgHr || !durMin || hrMax <= hrRest) return null;
  const r = Math.min(1, Math.max(0, (avgHr - hrRest) / (hrMax - hrRest)));
  return Math.round(durMin * r * 0.64 * Math.exp(1.92 * r));
}
