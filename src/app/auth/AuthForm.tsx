"use client";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight, Eye, EyeOff, LoaderCircle, LockKeyhole, MailCheck } from "lucide-react";
import { getSupabaseClient, isSupabaseConfigured } from "@/lib/supabase/client";
import { Brand, BrandMark } from "@/components/brand";
import "./auth.css";

type Mode = "login" | "register" | "forgot" | "reset";
const headings: Record<Mode, [string, string]> = {
  login: ["Your space to think.", "Welcome back to your private workspace."],
  register: [
    "Make room for your ideas.",
    "All it takes is an email and a password. Your private workspace comes with it.",
  ],
  forgot: ["A fresh start.", "Enter your email and we’ll send a password reset link."],
  reset: ["Set a new password.", "Choose a secure password for your workspace."],
};
const MIN_PASSWORD = 8;

/** Supabase Auth errors, said plainly — with the next step when there is one. */
function explain(error: unknown, mode: Mode): { text: string; action?: "login" | "register" | "resend" } {
  const { code = "", message = "" } = (error ?? {}) as { code?: string; message?: string };
  const is = (...needles: string[]) =>
    needles.some((n) => code === n || message.toLowerCase().includes(n.replace(/_/g, " ")));
  if (is("user_already_exists", "already registered"))
    return { text: "There’s already an account with this email.", action: "login" };
  if (is("invalid_credentials", "invalid login credentials"))
    return { text: "That email and password don’t match.", action: mode === "login" ? "register" : undefined };
  if (is("email_not_confirmed"))
    return { text: "Confirm your email first: open the link we sent you.", action: "resend" };
  if (is("weak_password", "password should"))
    return { text: `Choose a stronger password: at least ${MIN_PASSWORD} characters, and not a common one.` };
  if (is("email_address_invalid", "invalid email")) return { text: "That email address doesn’t look right." };
  if (is("over_email_send_rate_limit", "over_request_rate_limit", "rate limit"))
    return { text: "Too many attempts. Wait a minute, then try again." };
  if (is("signup_disabled")) return { text: "New accounts aren’t open right now." };
  return { text: message || "Something went wrong. Please try again." };
}

export function AuthForm({ mode }: { mode: Mode }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ text: string; action?: "login" | "register" | "resend" } | null>(null);
  const [message, setMessage] = useState("");
  const [reveal, setReveal] = useState(false);
  /** After sign-up when the project asks people to confirm their email first. */
  const [sentTo, setSentTo] = useState("");
  const [resent, setResent] = useState(false);
  useEffect(() => {
    // The email-confirmation callback redirects here with ?error=… when a link is stale.
    if (new URLSearchParams(window.location.search).get("error") === "confirmation_failed")
      queueMicrotask(() =>
        setError({
          text: "That link has expired or was already used. Log in, or enter your email to get a new one.",
          action: "resend",
        }),
      );
  }, []);
  // Email links land on /auth/confirm (see supabase/templates), which works in any browser.
  const confirmLink = () => `${window.location.origin}/auth/confirm`;

  async function resend(address: string) {
    setBusy(true);
    setError(null);
    try {
      const { error } = await getSupabaseClient().auth.resend({
        type: "signup",
        email: address,
        options: { emailRedirectTo: confirmLink() },
      });
      if (error) throw error;
      setResent(true);
      if (!sentTo) setMessage(`We sent a new confirmation link to ${address}.`);
    } catch (err) {
      setError(explain(err, mode));
    } finally {
      setBusy(false);
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setMessage("");
    setBusy(true);
    try {
      const supabase = getSupabaseClient();
      const address = email.trim();
      if (mode === "register") {
        const { data, error } = await supabase.auth.signUp({
          email: address,
          password,
          options: { emailRedirectTo: confirmLink() },
        });
        if (error) throw error;
        if (data.session) {
          router.replace("/app");
          router.refresh();
        } else setSentTo(address);
      } else if (mode === "forgot") {
        const { error } = await supabase.auth.resetPasswordForEmail(address, { redirectTo: confirmLink() });
        if (error) throw error;
        setMessage("If an account exists for that address, you’ll receive a password reset email.");
      } else if (mode === "reset") {
        const { error } = await supabase.auth.updateUser({ password });
        if (error) throw error;
        setMessage("Your password has been updated. You can return to your workspace.");
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email: address, password });
        if (error) throw error;
        const next = new URLSearchParams(window.location.search).get("next");
        router.replace(next?.startsWith("/") && !next.startsWith("//") ? next : "/app");
        router.refresh();
      }
    } catch (err) {
      setError(explain(err, mode));
    } finally {
      setBusy(false);
    }
  }

  const errorAction: Record<"login" | "register" | "resend", ReactNode> = {
    login: <Link href="/auth/login">Log in instead</Link>,
    register: <Link href="/auth/register">Create an account</Link>,
    resend: (
      <button
        type="button"
        className="auth-link-button"
        disabled={busy || resent}
        onClick={() => void resend(email.trim())}
      >
        {resent ? "Link sent" : "Send a new link"}
      </button>
    ),
  };

  let body: ReactNode;
  if (!isSupabaseConfigured) {
    body = (
      <div className="auth-notice">
        <LockKeyhole size={18} />
        <div>
          <strong>Connect your private workspace</strong>
          <p>
            Sign-in isn&apos;t available yet: this Slate server needs its Supabase URL and publishable key (see
            .env.example).
          </p>
        </div>
      </div>
    );
  } else if (sentTo) {
    body = (
      <div className="auth-sent" role="status">
        <MailCheck size={20} />
        <div>
          <strong>Check your inbox</strong>
          <p>
            We sent a confirmation link to <b>{sentTo}</b>. Open it to finish signing up — your workspace will be
            waiting.
          </p>
          <div className="auth-sent-actions">
            <button
              type="button"
              className="auth-link-button"
              disabled={busy || resent}
              onClick={() => void resend(sentTo)}
            >
              {resent ? "New link sent" : "Resend the link"}
            </button>
            <button
              type="button"
              className="auth-link-button"
              onClick={() => {
                setSentTo("");
                setResent(false);
              }}
            >
              Use a different email
            </button>
          </div>
          {error && (
            <p className="auth-error" role="alert">
              {error.text}
            </p>
          )}
        </div>
      </div>
    );
  } else {
    const hintId = `auth-password-hint-${mode}`;
    const newPassword = mode === "register" || mode === "reset";
    body = (
      <form onSubmit={submit}>
        {mode !== "reset" && (
          <label>
            Email address
            <input
              type="email"
              autoComplete="email"
              autoFocus
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
            />
          </label>
        )}
        {mode !== "forgot" && (
          <label>
            Password
            {mode === "login" && (
              <Link className="auth-forgot" href="/auth/forgot">
                Forgot password?
              </Link>
            )}
            <span className="auth-password">
              <input
                type={reveal ? "text" : "password"}
                autoComplete={newPassword ? "new-password" : "current-password"}
                required
                minLength={newPassword ? MIN_PASSWORD : undefined}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={newPassword ? "Create a password" : "Enter your password"}
                aria-describedby={newPassword ? hintId : undefined}
              />
              <button
                type="button"
                className="auth-reveal"
                aria-label={reveal ? "Hide password" : "Show password"}
                aria-pressed={reveal}
                onClick={() => setReveal((v) => !v)}
              >
                {reveal ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </span>
            {newPassword && (
              <span id={hintId} className="auth-hint">
                At least {MIN_PASSWORD} characters.
              </span>
            )}
          </label>
        )}
        {error && (
          <p className="auth-error" role="alert">
            {error.text} {error.action && errorAction[error.action]}
          </p>
        )}
        {message && (
          <p className="auth-message" role="status">
            {message}
          </p>
        )}
        <button className="auth-submit" disabled={busy} aria-busy={busy}>
          {busy ? <LoaderCircle size={16} className="auth-spinner" /> : null}
          {mode === "login"
            ? "Log in"
            : mode === "register"
              ? "Create account"
              : mode === "forgot"
                ? "Send reset link"
                : "Update password"}
          {!busy && <ArrowRight size={16} />}
        </button>
      </form>
    );
  }

  return (
    <main className="auth-shell">
      <Link href="/" className="auth-brand" aria-label="Slate home">
        <Brand size={28} />
      </Link>
      <div className="auth-content">
        <div className="auth-mark">
          <BrandMark size={48} />
        </div>
        <h1>{sentTo ? "Almost there." : headings[mode][0]}</h1>
        <p className="auth-subtitle">{sentTo ? "One more step to open your workspace." : headings[mode][1]}</p>
        {body}
        <p className="auth-footer">
          {mode === "login" ? (
            <>
              New to Slate? <Link href="/auth/register">Create an account</Link>
            </>
          ) : mode === "register" ? (
            <>
              Already have an account? <Link href="/auth/login">Log in</Link>
            </>
          ) : (
            <Link href={mode === "reset" ? "/app" : "/auth/login"}>
              <ArrowLeft size={14} /> {mode === "reset" ? "Back to workspace" : "Back to log in"}
            </Link>
          )}
        </p>
        <div className="auth-private">
          <LockKeyhole size={12} /> A quiet space. Only yours. <Link href="/privacy">Privacy</Link>
        </div>
      </div>
      <span className="auth-bottom">Thoughtfully organized. Effortlessly connected.</span>
    </main>
  );
}
