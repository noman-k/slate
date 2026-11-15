import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, LockKeyhole } from "lucide-react";
import { Brand, BrandMark } from "@/components/brand";
import { CONFIRM_TYPES } from "./types";
import "../auth.css";

export const metadata: Metadata = { title: "Confirm your email · Slate" };

/**
 * Where links in Slate's emails land (see supabase/templates). The one-time token is used
 * only when the button is pressed: mail scanners that open every link in an email (Outlook
 * Safe Links and the like) would otherwise use it up before the person clicks. The check runs
 * on the server, so the link works in any browser or device, not just the one that signed up.
 */
export default async function ConfirmPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await searchParams;
  const tokenHash = typeof query.token_hash === "string" ? query.token_hash : "";
  const type = typeof query.type === "string" ? query.type : "";
  const valid = Boolean(tokenHash) && (CONFIRM_TYPES as readonly string[]).includes(type);
  const recovery = type === "recovery";
  return (
    <main className="auth-shell">
      <Link href="/" className="auth-brand" aria-label="Slate home">
        <Brand size={28} />
      </Link>
      <div className="auth-content">
        <div className="auth-mark">
          <BrandMark size={48} />
        </div>
        {valid ? (
          <>
            <h1>{recovery ? "Reset your password." : "One click to go."}</h1>
            <p className="auth-subtitle">
              {recovery
                ? "Continue to choose a new password for your workspace."
                : "Confirm your email address to open your private workspace."}
            </p>
            <form method="post" action="/auth/confirm/verify">
              <input type="hidden" name="token_hash" value={tokenHash} />
              <input type="hidden" name="type" value={type} />
              <button className="auth-submit" autoFocus>
                {recovery ? "Continue" : "Confirm and open Slate"}
                <ArrowRight size={16} />
              </button>
            </form>
          </>
        ) : (
          <>
            <h1>This link isn’t complete.</h1>
            <p className="auth-subtitle">Open the link from your email again, or log in to request a new one.</p>
            <Link className="auth-submit" href="/auth/login">
              Go to log in <ArrowRight size={16} />
            </Link>
          </>
        )}
        <div className="auth-private">
          <LockKeyhole size={12} /> A quiet space. Only yours.
        </div>
      </div>
      <span className="auth-bottom">Thoughtfully organized. Effortlessly connected.</span>
    </main>
  );
}
