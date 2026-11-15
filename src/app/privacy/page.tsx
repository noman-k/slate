import type { Metadata } from "next";
import Link from "next/link";
import { MessageSquare } from "lucide-react";
import { SiteFooter, SiteHeader } from "@/components/site-chrome";
import { LICENSE_NAME, REPOSITORY_URL, SITE_URL } from "@/lib/project";
import "../landing.css";
import "../docs/docs.css";

export const metadata: Metadata = {
  title: "Privacy · Slate",
  description: "What Slate stores, where it lives, who can see it, and how to get it deleted.",
};

const UPDATED = "14 November 2026";

/**
 * Plain-language privacy notice for the hosted copy. It describes what the code in this
 * repository actually does; if you run a modified copy, update it to match yours.
 */
export default function Privacy() {
  return (
    <div className="landing docs">
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <SiteHeader current="/privacy" />

      <main id="main" className="docs-main docs-single">
        <section aria-labelledby="privacy-title">
          <p className="landing-kicker">Last updated {UPDATED}</p>
          <h1 id="privacy-title">Privacy</h1>
          <p className="docs-lede">
            Slate is a private workspace. This page explains, in plain words, what the hosted version at{" "}
            <a href={SITE_URL}>{SITE_URL.replace("https://", "")}</a> stores, where it lives, who can see it, and how to
            get it deleted. Slate is open source, so you can also check all of this in the{" "}
            <a href={REPOSITORY_URL} target="_blank" rel="noreferrer">
              code
            </a>
            .
          </p>
          <div className="docs-endpoint docs-contact">
            <MessageSquare size={16} />
            <span>Questions or requests about your account or data?</span>
            <Link href="/contact?topic=privacy">Send a message</Link>
          </div>
        </section>

        <section aria-labelledby="short-title">
          <h2 id="short-title">The short version</h2>
          <ul className="docs-bullets">
            <li>Your pages, databases and playbooks are visible only to your account.</li>
            <li>No ads, no analytics, no tracking, and nothing is sold or shared for marketing.</li>
            <li>The only cookies are the ones that keep you signed in.</li>
            <li>You can delete your workspaces any time, and ask for your whole account to be deleted.</li>
          </ul>
        </section>

        <section aria-labelledby="stores-title">
          <h2 id="stores-title">What Slate stores</h2>
          <ul className="docs-bullets">
            <li>
              <strong>Your account:</strong> your email address and a securely hashed password. Your display name starts
              as the part of your email before the @.
            </li>
            <li>
              <strong>Your content:</strong> workspaces, pages, databases and their records, playbooks and their run
              history (inputs and answers), and images you upload.
            </li>
            <li>
              <strong>Messages you send us</strong> through the contact form: your email, the topic and the message, and
              which account sent it if you were signed in. They&apos;re used only to answer you.
            </li>
            <li>
              <strong>Agent keys:</strong> the name you give each key and when it was last used. The key itself
              isn&apos;t stored, only a fingerprint of it.
            </li>
            <li>
              <strong>In your browser:</strong> sign-in cookies, plus a few preferences (theme, sidebar, recently used
              icons) and unsaved edits waiting to sync, kept in your browser&apos;s local storage.
            </li>
          </ul>
        </section>

        <section aria-labelledby="where-title">
          <h2 id="where-title">Where it lives</h2>
          <ul className="docs-bullets">
            <li>
              <strong>Supabase</strong> stores your account, content and uploads in its database and file storage,
              hosted in the United States.
            </li>
            <li>
              <strong>Cloudflare</strong> runs the app and handles every request. Like most hosts it keeps short-lived
              request logs (such as addresses and times) to keep the service running and protected.
            </li>
            <li>
              <strong>An email provider</strong> sends the messages you ask for, such as sign-up confirmation and
              password reset.
            </li>
          </ul>
          <p>These services process data only to run Slate for you.</p>
        </section>

        <section aria-labelledby="sends-title">
          <h2 id="sends-title">When data leaves Slate</h2>
          <ul className="docs-bullets">
            <li>
              <strong>Playbook API steps</strong> send requests to the addresses you set in them, with the values you
              fill in, and keep the response in the run&apos;s history. Header values marked as secret are hidden in run
              history and links.
            </li>
            <li>
              <strong>AI agents</strong> can read your workspace only with a key you create. A key you create with “Read
              and create” also lets an agent add new pages, databases and playbooks; agents never edit or delete
              what&apos;s there. What an agent does with what it reads is up to that agent&apos;s provider (for example
              Anthropic or OpenAI) and their policies. Revoke a key in Settings › AI agents to stop access.
            </li>
          </ul>
        </section>

        <section aria-labelledby="access-title">
          <h2 id="access-title">Who can see your content</h2>
          <p>
            Only you. There is no sharing, no public pages and no team access; the database itself enforces that each
            account can reach only its own data. As the person running Slate, I could technically access the database,
            but I don&apos;t look at anyone&apos;s content unless you ask me to (for example to help with a problem) or
            the law requires it.
          </p>
        </section>

        <section aria-labelledby="delete-title">
          <h2 id="delete-title">Keeping and deleting your data</h2>
          <ul className="docs-bullets">
            <li>
              Your data stays until you delete it. Pages you delete go to Trash first, where you can restore or delete
              them for good.
            </li>
            <li>You can delete a workspace and everything in it from Settings.</li>
            <li>
              To delete your whole account, or to get a copy of your data,{" "}
              <Link href="/contact?topic=delete">send a request</Link>, ideally while signed in, so it&apos;s clear it
              comes from you. You can also export any page as Markdown and any database as CSV yourself.
            </li>
            <li>Deleted data can remain in backups for a short time before they expire.</li>
          </ul>
        </section>

        <section aria-labelledby="changes-title">
          <h2 id="changes-title">Changes and contact</h2>
          <p>
            If this page changes, the date at the top changes too, and the history is public in the repository. For any
            question about privacy or your data, <Link href="/contact?topic=privacy">send a message</Link>. Bugs and
            ideas are welcome as{" "}
            <a href={`${REPOSITORY_URL}/issues`} target="_blank" rel="noreferrer">
              GitHub issues
            </a>
            ; security problems, please report privately as described in the{" "}
            <a href={`${REPOSITORY_URL}/security/policy`} target="_blank" rel="noreferrer">
              security policy
            </a>
            .
          </p>
          <p className="docs-muted">
            Running your own copy of Slate? This page describes the hosted version. Update it, and the contact address
            settings in <code>src/lib/project.ts</code>, to match yours. Slate is licensed under the {LICENSE_NAME}.
          </p>
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}
