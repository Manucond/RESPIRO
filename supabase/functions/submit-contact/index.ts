// Edge Function: recibe la solicitud de contacto, verifica el captcha de Turnstile,
// valida tamaños y la inserta en contact_requests con la service role.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function clean(v: unknown, max: number): string {
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Método no permitido" }, 405);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Solicitud no válida" }, 400);
  }

  const name = clean(body.name, 100);
  const businessName = clean(body.business_name, 150);
  const email = clean(body.email, 254);
  const phone = clean(body.phone, 20);
  const comment = clean(body.comment, 2000);
  const captchaToken = typeof body.captchaToken === "string" ? body.captchaToken : "";

  if (!name || !businessName || !comment) return json({ error: "Faltan campos obligatorios." }, 400);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length < 5) {
    return json({ error: "El email no es válido." }, 400);
  }
  if (!captchaToken) return json({ error: "Falta la verificación de seguridad." }, 400);

  // Verificar el token con Cloudflare Turnstile
  const verify = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      secret: Deno.env.get("TURNSTILE_SECRET_KEY") ?? "",
      response: captchaToken,
      remoteip: req.headers.get("cf-connecting-ip") ?? "",
    }),
  });
  const verifyData = await verify.json().catch(() => ({}));
  if (!verifyData.success) return json({ error: "No se ha podido verificar que eres una persona." }, 400);

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  const { error } = await supabase.from("contact_requests").insert({
    name,
    business_name: businessName,
    email,
    phone: phone || null,
    comment,
    privacy_accepted_at: new Date().toISOString(),
  });
  if (error) return json({ error: "No se ha podido guardar la solicitud." }, 500);

  return json({ ok: true });
});
