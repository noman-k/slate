import Link from "next/link";
import { Brand } from "./brand";
import { ThemeSwitcher } from "./theme-switcher";
import { REPOSITORY_URL } from "@/lib/project";

/** Header for the public pages around the app (docs, privacy, contact). Needs landing.css. */
export function SiteHeader({ current }: { current?: "/docs/mcp" | "/privacy" | "/contact" }) {
  const link = (href: NonNullable<typeof current>, label: string) => (
    <Link href={href} aria-current={current === href ? "page" : undefined}>
      {label}
    </Link>
  );
  return (
    <header className="landing-header">
      <div className="landing-nav">
        <Link href="/" className="landing-brand" aria-label="Slate home">
          <Brand size={26} />
        </Link>
        <nav className="landing-sections" aria-label="Site">
          <Link href="/">Product</Link>
          {link("/docs/mcp", "AI agents (MCP)")}
          {link("/privacy", "Privacy")}
          {link("/contact", "Contact")}
        </nav>
        <div className="landing-account">
          <Link href="/app" className="landing-button small outline">
            Open Slate
          </Link>
        </div>
      </div>
    </header>
  );
}

/** Footer for the public pages around the app. Needs landing.css. */
export function SiteFooter() {
  return (
    <footer className="landing-footer docs-footer">
      <div className="footer-brand">
        <Brand size={20} />
        <p>Write it down. Organize it. Run it.</p>
        <ThemeSwitcher compact />
      </div>
      <nav aria-label="Product">
        <h2>Product</h2>
        <Link href="/">Home</Link>
        <Link href="/docs/mcp">AI agents (MCP)</Link>
        <a href={REPOSITORY_URL} target="_blank" rel="noreferrer">
          Source code (GitHub)
        </a>
      </nav>
      <nav aria-label="Account">
        <h2>Workspace</h2>
        <Link href="/app">Open Slate</Link>
        <Link href="/auth/register">Create an account</Link>
      </nav>
      <nav aria-label="About">
        <h2>About</h2>
        <Link href="/privacy">Privacy</Link>
        <Link href="/contact">Contact</Link>
      </nav>
    </footer>
  );
}
