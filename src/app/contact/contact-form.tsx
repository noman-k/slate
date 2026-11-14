"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { ArrowRight, CircleCheck, LoaderCircle, LogIn } from "lucide-react";
import { CONTACT_TOPICS, MESSAGE_MAX, MESSAGE_MIN, validateContact, type ContactErrors, type ContactTopic } from "@/lib/contact";

const DRAFT_KEY = "slate-contact-draft";

export function ContactForm({
  initialTopic,
  signedInEmail,
}: {
  initialTopic: ContactTopic | null;
  /** The signed-in member's email, if any: filled in for them. */
  signedInEmail: string | null;
}) {
  const [topic, setTopic] = useState<ContactTopic | "">(initialTopic ?? "");
  const [email, setEmail] = useState(signedInEmail ?? "");
  const [message, setMessage] = useState("");
  const [website, setWebsite] = useState(""); // stays empty for people; bots fill it in
  const [errors, setErrors] = useState<ContactErrors>({});
  const [problem, setProblem] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState<{ email: string } | null>(null);
  const form = useRef<HTMLFormElement>(null);
  const done = useRef<HTMLDivElement>(null);
  const chosen = CONTACT_TOPICS.find((t) => t.id === topic);

  // Keep an unsent message if the tab is closed by accident.
  useEffect(() => {
    try {
      const draft = sessionStorage.getItem(DRAFT_KEY);
      if (draft) queueMicrotask(() => setMessage((current) => current || draft));
    } catch {}
  }, []);
  useEffect(() => {
    try {
      if (message) sessionStorage.setItem(DRAFT_KEY, message);
      else sessionStorage.removeItem(DRAFT_KEY);
    } catch {}
  }, [message]);
  useEffect(() => {
    if (sent) done.current?.focus();
  }, [sent]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setProblem("");
    const found = validateContact({ topic, email, message });
    setErrors(found);
    if (Object.keys(found).length) {
      // Move to the first thing to fix.
      const first = (["topic", "email", "message"] as const).find((field) => found[field]);
      form.current?.querySelector<HTMLElement>(`[data-field="${first}"]`)?.focus();
      return;
    }
    setBusy(true);
    try {
      const response = await fetch("/api/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic, email, message, website }),
      });
      const data = (await response.json().catch(() => ({}))) as { ok?: boolean; error?: string; errors?: ContactErrors };
      if (response.ok && data.ok) {
        try {
          sessionStorage.removeItem(DRAFT_KEY);
        } catch {}
        setSent({ email: email.trim() });
        setMessage("");
        return;
      }
      if (data.errors) setErrors(data.errors);
      setProblem(data.error || (data.errors ? "" : "Your message couldn’t be sent just now. Please try again in a moment."));
    } catch {
      setProblem("Couldn’t reach Slate. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  if (sent)
    return (
      <div className="contact-sent" role="status" tabIndex={-1} ref={done}>
        <CircleCheck size={28} />
        <h2>Thanks, your message is in.</h2>
        <p>
          You&apos;ll get a reply at <strong>{sent.email}</strong>. Slate is run by one person, so it can take a few days.
        </p>
        <div className="contact-sent-actions">
          <button type="button" className="landing-button small outline" onClick={() => setSent(null)}>
            Send another message
          </button>
          <Link href={signedInEmail ? "/app" : "/"} className="docs-inline-link">
            {signedInEmail ? "Back to your workspace" : "Back to the front page"} <ArrowRight size={13} />
          </Link>
        </div>
      </div>
    );

  // Each field is described by its hint, or by its error when there is one.
  const field = (name: keyof ContactErrors) => ({
    "aria-invalid": errors[name] ? true : undefined,
    "aria-describedby": errors[name] ? `contact-${name}-error` : name === "topic" ? undefined : `contact-${name}-hint`,
  });

  return (
    <form ref={form} className="contact-form" onSubmit={submit} noValidate>
      <fieldset className="contact-topics" {...field("topic")}>
        <legend>What&apos;s it about?</legend>
        <div>
          {CONTACT_TOPICS.map((option, index) => (
            <label key={option.id} className={topic === option.id ? "is-on" : undefined}>
              <input
                type="radio"
                name="topic"
                value={option.id}
                checked={topic === option.id}
                onChange={() => {
                  setTopic(option.id);
                  setErrors((e) => ({ ...e, topic: undefined }));
                }}
                data-field={index === 0 ? "topic" : undefined}
              />
              <span>
                <strong>{option.label}</strong>
                <small>{option.hint}</small>
              </span>
            </label>
          ))}
        </div>
        {errors.topic && <p className="contact-error" id="contact-topic-error">{errors.topic}</p>}
      </fieldset>

      {topic === "delete" && !signedInEmail && (
        <p className="contact-callout">
          <LogIn size={16} />
          <span>
            <Link href="/auth/login?next=%2Fcontact%3Ftopic%3Ddelete">Log in first</Link> and send this from your account, so
            we know the request really comes from you. That makes it quicker.
          </span>
        </p>
      )}

      <div className="contact-field">
        <label htmlFor="contact-email">Your email</label>
        <input
          id="contact-email"
          type="email"
          autoComplete="email"
          value={email}
          onChange={(e) => {
            setEmail(e.target.value);
            if (errors.email) setErrors((x) => ({ ...x, email: undefined }));
          }}
          placeholder="you@example.com"
          data-field="email"
          {...field("email")}
        />
        {errors.email ? (
          <span className="contact-error" id="contact-email-error">{errors.email}</span>
        ) : (
          <span className="contact-hint" id="contact-email-hint">{signedInEmail ? "Your account’s email. Change it if you’d like the reply elsewhere." : "Only used to reply to you."}</span>
        )}
      </div>

      <div className="contact-field">
        <label htmlFor="contact-message">Message</label>
        <textarea
          id="contact-message"
          value={message}
          rows={7}
          maxLength={MESSAGE_MAX}
          onChange={(e) => {
            setMessage(e.target.value);
            if (errors.message && e.target.value.trim().length >= MESSAGE_MIN) setErrors((x) => ({ ...x, message: undefined }));
          }}
          placeholder={chosen?.placeholder ?? "How can we help?"}
          data-field="message"
          {...field("message")}
        />
        <span className="contact-meta">
          {errors.message ? (
            <span className="contact-error" id="contact-message-error">{errors.message}</span>
          ) : (
            <span className="contact-hint" id="contact-message-hint">Please leave out passwords, agent keys and card numbers.</span>
          )}
          <span className={message.length > MESSAGE_MAX * 0.9 ? "contact-count is-near" : "contact-count"} aria-live="polite">
            {message.length > MESSAGE_MAX * 0.9 ? `${MESSAGE_MAX - message.length} left` : ""}
          </span>
        </span>
      </div>

      {/* Hidden from people (and screen readers); bots fill it in. */}
      <label className="contact-trap" aria-hidden="true">
        Website
        <input type="text" tabIndex={-1} autoComplete="off" value={website} onChange={(e) => setWebsite(e.target.value)} />
      </label>

      {problem && <p className="contact-problem" role="alert">{problem}</p>}

      <div className="contact-actions">
        <button className="landing-button" disabled={busy} aria-busy={busy}>
          {busy ? <LoaderCircle size={16} className="contact-spinner" /> : null}
          {busy ? "Sending…" : "Send message"}
          {!busy && <ArrowRight size={16} />}
        </button>
        <span className="contact-hint">Replies usually take a few days.</span>
      </div>
    </form>
  );
}
