import { createClient } from '@/lib/supabase/server';
import { CONFIRM_TYPES, type ConfirmType } from '../types';
import { redirectTo } from '../../redirect';

/**
 * The Confirm button on /auth/confirm posts here. Verifying the email token on the server
 * sets the session cookies, so it doesn't matter which browser the email was opened in.
 */
export async function POST(request: Request) {
  const form = await request.formData();
  const tokenHash = String(form.get('token_hash') || '');
  const type = String(form.get('type') || '') as ConfirmType;
  // 303: the browser follows with a GET, as after any form post.
  const go = (path: string) => redirectTo(path, 303);
  if (!tokenHash || !CONFIRM_TYPES.includes(type)) return go('/auth/login?error=confirmation_failed');
  const supabase = await createClient();
  const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type });
  if (error) return go('/auth/login?error=confirmation_failed');
  return go(type === 'recovery' ? '/auth/reset' : '/app');
}
