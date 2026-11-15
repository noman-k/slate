import { createBrowserClient } from "@supabase/ssr";

export const isSupabaseConfigured = Boolean(
  process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
);
let client: ReturnType<typeof createBrowserClient> | undefined;
export function getSupabaseClient() {
  if (!isSupabaseConfigured)
    throw new Error("Connect Supabase using the variables in .env.example to use your private account.");
  return (client ??= createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
  ));
}
export const createClient = getSupabaseClient;
