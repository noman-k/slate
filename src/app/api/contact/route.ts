import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { isTopic, validateContact } from '@/lib/contact';
import { clientAddress, rateLimit } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' };
const reply = (data: object, status = 200, extra: Record<string, string> = {}) =>
  NextResponse.json(data, { status, headers: { ...headers, ...extra } });
const MAX_BODY = 20_000;

/**
 * The contact form posts here. Anyone can send a message (signed in or not); it's stored for
 * the operator to read in the Supabase dashboard. Signed-in senders are recorded, so requests
 * about an account can be trusted.
 */
export async function POST(request: Request) {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY)
    return reply({ error: 'The contact form isn’t available on this server.' }, 503);
  const raw = await request.text();
  if (raw.length > MAX_BODY) return reply({ error: 'That message is too long to send.' }, 413);
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(raw);
  } catch {
    return reply({ error: 'That message could not be read.' }, 400);
  }
  // A field people never see: if it's filled in, a bot sent this. Pretend it worked.
  if (typeof body.website === 'string' && body.website.trim()) return reply({ ok: true });
  const input = { topic: String(body.topic ?? ''), email: String(body.email ?? ''), message: String(body.message ?? '') };
  const errors = validateContact(input);
  if (Object.keys(errors).length) return reply({ errors }, 400);
  const limited = await rateLimit('CONTACT_LIMITER', clientAddress(request));
  if (!limited.ok)
    return reply({ error: `Too many messages from this address. Wait ${limited.retryAfter} seconds, then try again.` }, 429, { 'Retry-After': String(limited.retryAfter) });
  try {
    const supabase = await createClient();
    // Refreshes an expired session, so a signed-in sender is still recognized.
    await supabase.auth.getUser();
    const { error } = await supabase.rpc('submit_contact_message', {
      p_topic: isTopic(input.topic) ? input.topic : 'other',
      p_email: input.email.trim(),
      p_message: input.message.trim(),
    });
    if (error) throw error;
  } catch {
    return reply({ error: 'Your message couldn’t be sent just now. Please try again in a moment.' }, 503);
  }
  return reply({ ok: true });
}
