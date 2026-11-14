'use client';
import { useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, ArrowRight, Eye, EyeOff, LoaderCircle, LockKeyhole } from 'lucide-react';
import { getSupabaseClient, isSupabaseConfigured } from '@/lib/supabase/client';
import { Brand, BrandMark } from '@/components/brand';
import './auth.css';

type Mode = 'login' | 'register' | 'forgot' | 'reset';
const headings: Record<Mode, [string, string]> = {
  login: ['Your space to think.', 'Welcome back to your private workspace.'],
  register: ['Make room for your ideas.', 'A private home for your notes, projects, and knowledge.'],
  forgot: ['A fresh start.', 'Enter your email and we’ll send a password reset link.'],
  reset: ['Set a new password.', 'Choose a secure password for your workspace.'],
};
export function AuthForm({mode}: {mode: Mode}) {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [reveal, setReveal] = useState(false);
  useEffect(() => {
    // The email-confirmation callback redirects here with ?error=… when a link is stale.
    if (new URLSearchParams(window.location.search).get('error') === 'confirmation_failed')
      queueMicrotask(() => setError('That link has expired or was already used. Log in, or request a new link.'));
  }, []);
  async function submit(event: FormEvent) {
    event.preventDefault(); setError(''); setMessage(''); setBusy(true);
    try {
      const supabase = getSupabaseClient();
      const origin = window.location.origin;
      if (mode === 'register') {
        const {data, error} = await supabase.auth.signUp({email, password, options: {data: {display_name: name || email.split('@')[0]}, emailRedirectTo: `${origin}/auth/callback`}});
        if (error) throw error;
        if (data.session) { router.replace('/app'); router.refresh(); }
        else setMessage('Check your email to confirm your account. Your private workspace will be ready when you sign in.');
      } else if (mode === 'forgot') {
        const {error} = await supabase.auth.resetPasswordForEmail(email, {redirectTo: `${origin}/auth/callback?next=/auth/reset`});
        if (error) throw error;
        setMessage('If an account exists for that address, you’ll receive a password reset email.');
      } else if (mode === 'reset') {
        const {error} = await supabase.auth.updateUser({password});
        if (error) throw error;
        setMessage('Your password has been updated. You can return to your workspace.');
      } else {
        const {error} = await supabase.auth.signInWithPassword({email, password});
        if (error) throw error;
        const next = new URLSearchParams(window.location.search).get('next');
        router.replace(next?.startsWith('/') && !next.startsWith('//') ? next : '/app');
        router.refresh();
      }
    } catch (err) { setError(err instanceof Error ? err.message : 'Something went wrong. Please try again.'); }
    finally { setBusy(false); }
  }
  return <main className="auth-shell">
    <Link href="/" className="auth-brand" aria-label="Slate home"><Brand size={28}/></Link>
    <div className="auth-content">
      <div className="auth-mark"><BrandMark size={48}/></div>
      <h1>{headings[mode][0]}</h1><p className="auth-subtitle">{headings[mode][1]}</p>
      {!isSupabaseConfigured ? <div className="auth-notice"><LockKeyhole size={18}/><div><strong>Connect your private workspace</strong><p>Authentication becomes available after configuring Supabase. The local demo is ready to explore.</p><Link href="/app">Explore the demo <ArrowRight size={14}/></Link></div></div> : <form onSubmit={submit}>
        {mode === 'register' && <label>Your name<input autoComplete="name" value={name} onChange={e=>setName(e.target.value)} placeholder="Alex Morgan" maxLength={100}/></label>}
        {mode !== 'reset' && <label>Email address<input type="email" autoComplete="email" autoFocus required value={email} onChange={e=>setEmail(e.target.value)} placeholder="you@example.com"/></label>}
        {mode !== 'forgot' && <label>Password{mode === 'login' && <Link className="auth-forgot" href="/auth/forgot">Forgot password?</Link>}<span className="auth-password"><input type={reveal?'text':'password'} autoComplete={mode==='login'?'current-password':'new-password'} required minLength={8} value={password} onChange={e=>setPassword(e.target.value)} placeholder={mode==='login'?'Enter your password':'At least 8 characters'}/><button type="button" className="auth-reveal" aria-label={reveal?'Hide password':'Show password'} aria-pressed={reveal} onClick={()=>setReveal(v=>!v)}>{reveal?<EyeOff size={16}/>:<Eye size={16}/>}</button></span></label>}
        {error && <p className="auth-error" role="alert">{error}</p>}
        {message && <p className="auth-message" role="status">{message}</p>}
        <button className="auth-submit" disabled={busy} aria-busy={busy}>{busy?<LoaderCircle size={16} className="auth-spinner"/>:null}{mode==='login'?'Continue with email':mode==='register'?'Create your workspace':mode==='forgot'?'Send reset link':'Update password'}{!busy&&<ArrowRight size={16}/>}</button>
      </form>}
      <p className="auth-footer">{mode === 'login' ? <>New to Slate? <Link href="/auth/register">Create an account</Link></> : mode==='register'?<>Already have an account? <Link href="/auth/login">Log in</Link></>:<Link href={mode==='reset'?'/app':'/auth/login'}><ArrowLeft size={14}/> {mode==='reset'?'Back to workspace':'Back to log in'}</Link>}</p>
      <div className="auth-private"><LockKeyhole size={12}/> A quiet space. Only yours.</div>
    </div>
    <span className="auth-bottom">Thoughtfully organized. Effortlessly connected.</span>
  </main>;
}
