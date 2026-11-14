import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ArrowRight, LockKeyhole } from 'lucide-react';
import { Brand, BrandMark } from '@/components/brand';
import { createClient } from '@/lib/supabase/server';
import { redirectWith, returnPlace } from '@/lib/oauth';
import { ConsentForm } from './consent-form';
import '../../auth/auth.css';
import './oauth.css';

export const metadata: Metadata = { title: 'Connect an app · Slate', robots: { index: false } };

type Query = Record<string, string | string[] | undefined>;

/**
 * Where an app (Claude, ChatGPT, Codex…) sends someone to connect it to Slate. Signing in
 * comes first (the middleware sends visitors to log in and back). Then the person sees which
 * app is asking and where it will send them back, picks a workspace and what the app may do,
 * and allows or cancels. The app is only sent back to an address it registered.
 */
export default async function AuthorizePage({ searchParams }: { searchParams: Promise<Query> }) {
  const query = await searchParams;
  const param = (name: string) => (typeof query[name] === 'string' ? (query[name] as string) : '');
  const clientId = param('client_id');
  const redirectUri = param('redirect_uri');
  const state = param('state') || undefined;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const { data: client } = clientId
    ? await supabase.rpc('oauth_client', { p_client_id: clientId })
    : { data: null };
  const app = client as { name: string; redirect_uris: string[] } | null;
  // Without a known app and one of its own return addresses, there's nowhere safe to go back to.
  if (!user || !app || !app.redirect_uris.includes(redirectUri)) return <Invalid />;

  if (param('response_type') !== 'code')
    redirect(redirectWith(redirectUri, { error: 'unsupported_response_type', state }));
  const challenge = param('code_challenge');
  if (!/^[A-Za-z0-9_-]{43}$/.test(challenge) || param('code_challenge_method') !== 'S256')
    redirect(redirectWith(redirectUri, { error: 'invalid_request', error_description: 'PKCE with S256 is required.', state }));

  const [{ data: workspaces }, { data: profile }] = await Promise.all([
    supabase.from('workspaces').select('id,name').order('created_at'),
    supabase.from('profiles').select('active_workspace_id').eq('id', user.id).maybeSingle(),
  ]);
  const list = (workspaces ?? []) as { id: string; name: string }[];
  const active = list.find((w) => w.id === profile?.active_workspace_id)?.id ?? list[0]?.id ?? '';

  return (
    <main className="auth-shell">
      <Link href="/" className="auth-brand" aria-label="Slate home"><Brand size={28} /></Link>
      <div className="auth-content oauth-consent">
        <div className="auth-mark"><BrandMark size={48} /></div>
        <h1>Connect {app.name}?</h1>
        <p className="auth-subtitle">
          {app.name} wants to use your Slate workspace. You&apos;ll go back to {returnPlace(redirectUri)} after you choose.
        </p>
        <ConsentForm
          clientId={clientId}
          appName={app.name}
          redirectUri={redirectUri}
          state={state}
          challenge={challenge}
          workspaces={list}
          defaultWorkspace={active}
          email={user.email ?? ''}
        />
        <div className="auth-private"><LockKeyhole size={12} /> You can disconnect it any time in Settings › AI agents.</div>
      </div>
      <span className="auth-bottom">Thoughtfully organized. Effortlessly connected.</span>
    </main>
  );
}

function Invalid() {
  return (
    <main className="auth-shell">
      <Link href="/" className="auth-brand" aria-label="Slate home"><Brand size={28} /></Link>
      <div className="auth-content">
        <div className="auth-mark"><BrandMark size={48} /></div>
        <h1>This link can&apos;t connect an app.</h1>
        <p className="auth-subtitle">
          It&apos;s incomplete, or the app isn&apos;t registered with Slate. Start connecting again from the app.
        </p>
        <Link className="auth-submit" href="/docs/mcp">How to connect an app <ArrowRight size={16} /></Link>
      </div>
      <span className="auth-bottom">Thoughtfully organized. Effortlessly connected.</span>
    </main>
  );
}
