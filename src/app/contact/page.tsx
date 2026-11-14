import type { Metadata } from "next";
import Link from "next/link";
import { Bug, ShieldAlert } from "lucide-react";
import { SiteFooter, SiteHeader } from "@/components/site-chrome";
import { isTopic } from "@/lib/contact";
import { REPOSITORY_URL } from "@/lib/project";
import { createClient } from "@/lib/supabase/server";
import { ContactForm } from "./contact-form";
import "../landing.css";
import "../docs/docs.css";
import "./contact.css";

export const metadata: Metadata = {
  title: "Contact · Slate",
  description: "Questions about your Slate account, deleting your data, or privacy: send a message.",
};

/** The signed-in member's email, if there is one (filled into the form for them). */
async function memberEmail() {
  try {
    const supabase = await createClient();
    const { data } = await supabase.auth.getUser();
    return data.user?.email ?? null;
  } catch {
    return null;
  }
}

export default async function Contact({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const query = await searchParams;
  const topic = isTopic(query.topic) ? query.topic : null;
  const email = await memberEmail();
  return (
    <div className="landing docs">
      <a className="skip-link" href="#main">Skip to content</a>
      <SiteHeader current="/contact" />
      <main id="main" className="docs-main docs-single contact-page">
        <p className="landing-kicker">Contact</p>
        <h1>How can we help?</h1>
        <p className="docs-lede">
          Questions about your account, deleting your data, or privacy: send a message and you&apos;ll get a reply by email.
        </p>
        <ul className="contact-elsewhere" aria-label="Other ways to reach us">
          <li>
            <Bug size={16} />
            <span>
              Found a bug or have an idea? <a href={`${REPOSITORY_URL}/issues/new/choose`} target="_blank" rel="noreferrer">Open a GitHub issue</a>, so others can follow along.
            </span>
          </li>
          <li>
            <ShieldAlert size={16} />
            <span>
              A security problem? Please <a href={`${REPOSITORY_URL}/security/advisories/new`} target="_blank" rel="noreferrer">report it privately</a>, never in public.
            </span>
          </li>
        </ul>
        <ContactForm initialTopic={topic} signedInEmail={email} />
        <p className="docs-muted contact-privacy">
          Your message and email are stored so they can be answered, and are deleted when no longer needed. See{" "}
          <Link href="/privacy">Privacy</Link>.
        </p>
      </main>
      <SiteFooter />
    </div>
  );
}
