import { createClient } from "@/lib/supabase/server";
import { redirectTo } from "../redirect";

/** Code-flow auth links (OAuth, and email links sent before /auth/confirm existed). */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const requested = searchParams.get("next") ?? "/app";
  const next = requested.startsWith("/") && !requested.startsWith("//") ? requested : "/app";
  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return redirectTo(next, 302);
  }
  return redirectTo("/auth/login?error=confirmation_failed", 302);
}
