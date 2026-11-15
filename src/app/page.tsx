import type { Metadata } from "next";
import Link from "next/link";
import { GitHubLink } from "@/components/github-link";
import {
  Activity,
  ArrowRight,
  Bot,
  Check,
  CheckCircle2,
  ChevronDown,
  CircleHelp,
  Code2,
  Command,
  Compass,
  FileText,
  GitBranch,
  Globe,
  History,
  House,
  KanbanSquare,
  KeyRound,
  Lock,
  MessageSquare,
  PenLine,
  Play,
  Receipt,
  Search,
  Sparkles,
  Table2,
  Users,
  Zap,
} from "lucide-react";
import { Brand, BrandMark } from "@/components/brand";
import { ThemeSwitcher } from "@/components/theme-switcher";
import { Keys } from "@/components/keys";
import { createClient } from "@/lib/supabase/server";
import { LICENSE_NAME, REPOSITORY_URL } from "@/lib/project";
import "./landing.css";

const TITLE = "Slate — write it down, organize it, run it";
const DESCRIPTION =
  "Slate is a private workspace where notes, databases and runnable playbooks live together — and AI agents like Claude can read it all.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  openGraph: { title: TITLE, description: DESCRIPTION, type: "website", siteName: "Slate" },
  twitter: { card: "summary_large_image", title: TITLE, description: DESCRIPTION },
};

const configured = Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY);

/** Who is looking: a signed-in member, or a visitor who needs to sign up or log in. */
async function audience(): Promise<"member" | "visitor"> {
  if (!configured) return "visitor";
  try {
    const supabase = await createClient();
    const { data } = await supabase.auth.getUser();
    return data.user ? "member" : "visitor";
  } catch {
    return "visitor";
  }
}

/** Plain facts about the product — no invented usage numbers. */
const FACTS = [
  { value: "1", label: "workspace for notes, data and playbooks" },
  { value: "3", label: "database views: table, board and list" },
  { value: "4", label: "kinds of playbook step: check, ask, decide, call" },
  { value: "8", label: "tools for your AI agents: 5 to read, 3 to create" },
];

/** The tools people juggle today — and what Slate puts in one place. */
const SCATTERED = [
  { Icon: FileText, label: "Notes in one app" },
  { Icon: Table2, label: "Spreadsheets in another" },
  { Icon: CheckCircle2, label: "Checklists on sticky notes" },
  { Icon: MessageSquare, label: "“How do we do this again?”" },
];

const AUDIENCES = [
  {
    Icon: House,
    tone: "orange",
    who: "Landlords & property managers",
    story:
      "Rent ledger, tenants and units in linked databases. Run the monthly rent check, move-ins and move-outs the same way every time.",
    tags: ["Monthly rent check", "Tenant move-in", "Chase late rent"],
  },
  {
    Icon: Users,
    tone: "blue",
    who: "Small teams",
    story:
      "Incident response, releases and support playbooks anyone can follow — with a record of every run and who got stuck where.",
    tags: ["Incident response", "Deploy a release", "Refund request"],
  },
  {
    Icon: PenLine,
    tone: "green",
    who: "Writers & planners",
    story:
      "Calm pages for notes, journals and plans. Nest them, link them, and turn any to-do list into a checklist you can run.",
    tags: ["Daily standup note", "Meeting notes", "Reading lists"],
  },
  {
    Icon: Code2,
    tone: "purple",
    who: "Builders & tinkerers",
    story:
      "Markdown both ways, API calls inside playbooks, and an MCP endpoint so your AI agents can read the whole workspace.",
    tags: ["Call an API", "Webhooks", "MCP"],
  },
];

const FAQ = [
  {
    q: "What makes Slate different from a notes app?",
    a: "Your notes, your databases and your procedures live in one place — and procedures aren’t just written down, they run. A playbook walks you (or a teammate) through each step, branches on your answers, can call other apps, and keeps a record of every run.",
  },
  {
    q: "What is a playbook, exactly?",
    a: "A checklist you can run. Start with a plain list of steps. When you need more, add questions, decisions (“if more than 30 days, offer store credit”), checks with expected results, and calls to other apps. Every run is saved, and a paused run can be picked up later.",
  },
  {
    q: "How do AI agents use my workspace?",
    a: "Create an agent key in Settings and connect any MCP-compatible agent, such as Claude. It can search, read pages, query databases and look up playbooks. If you choose “Read and create” for its key, it can also add new pages, databases and playbooks, but never edit or delete existing ones. Each agent has its own key, which you can revoke at any time.",
  },
  {
    q: "Who can see my pages?",
    a: "Only you. Slate is private by default. Agents only see what you give them a key for, and API tokens in playbooks are kept out of run history and links.",
  },
  {
    q: "Can I get my data out?",
    a: "Yes. Every page has a Markdown view you can copy, and you can export any page as a Markdown file. Databases export to CSV.",
  },
  {
    q: "Is Slate open source?",
    a: "Yes. The code is on GitHub under the AGPL-3.0 license. You can read it, suggest changes, or run your own copy with your own Supabase project and Cloudflare account. If you offer a modified copy to others as a service, the license asks you to share your changes too.",
  },
  {
    q: "Do I need to install anything?",
    a: "No. Slate runs in any modern browser, on desktop or phone, in light or dark mode.",
  },
];

/** The hero's product shot: a page, a board and a playbook run, layered. */
function HeroShot() {
  return (
    <div className="shot" aria-hidden>
      <div className="shot-frame">
        <div className="shot-window">
          <div className="shot-chrome">
            <span />
            <span />
            <span />
            <em>
              <Lock size={9} /> slate.app
            </em>
          </div>
          <div className="shot-body">
            <aside className="shot-sidebar">
              <div className="shot-brand">
                <Brand size={14} />
              </div>
              <div className="shot-search">
                <Search size={11} /> Search <Keys combo="Mod+K" />
              </div>
              <div className="shot-row">
                <House size={12} /> Home
              </div>
              <div className="shot-row">
                <Compass size={12} /> Playbooks <i>5</i>
              </div>
              <div className="shot-heading">Private</div>
              <div className="shot-row">
                <House size={12} className="t-orange" /> Rental Property Hub
              </div>
              <div className="shot-row sub">
                <Receipt size={12} className="t-green" /> Rent Ledger <i>9</i>
              </div>
              <div className="shot-row sub active">
                <Compass size={12} className="t-blue" /> Monthly rent check
              </div>
              <div className="shot-row sub">
                <Users size={12} /> Tenants
              </div>
              <div className="shot-row">
                <FileText size={12} /> Weekly review
              </div>
              <div className="shot-row">
                <FileText size={12} /> Reading list
              </div>
            </aside>
            <div className="shot-page">
              <div className="shot-title">Monthly rent check</div>
              <div className="shot-meta">
                <span className="shot-run">
                  <Play size={10} /> Run
                </span>
                <span>7 steps · 12 runs · last run 3 days ago</span>
              </div>
              <div className="shot-section">
                <b>1</b> Check payments
              </div>
              {[
                ["CHECK", "check", "Open the Rent Ledger and look at November"],
                ["CHECK", "check", "Match each payment against your bank statement"],
                ["ASK", "ask", "Did anyone pay late or less than they owe?"],
                ["DECIDE", "if", "When anyone behind is Yes → Chase late rent"],
                ["CALL", "api", "POST a reminder to your messaging webhook"],
              ].map(([label, tone, text]) => (
                <div className={`shot-step is-${tone}`} key={text}>
                  <span>{label}</span>
                  {text}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
      <div className="shot-card shot-board">
        <div className="shot-card-head">
          <KanbanSquare size={12} /> Rent Ledger · By status
        </div>
        <div className="shot-columns">
          {[
            ["Paid", "green", ["Unit 1A · Nov", "Unit 2B · Nov"]],
            ["Late", "red", ["Unit 3C · Nov"]],
          ].map(([label, tone, cards]) => (
            <div key={label as string}>
              <span className={`tag ${tone}`}>{label as string}</span>
              {(cards as string[]).map((card) => (
                <p key={card}>{card}</p>
              ))}
            </div>
          ))}
        </div>
      </div>
      <div className="shot-card shot-runcard">
        <div className="shot-runtop">
          <span className="dot" /> Running · step 4 of 7
        </div>
        <p className="shot-q">Did anyone pay late or less than they owe?</p>
        <div className="shot-answers">
          <span className="on">Yes</span>
          <span>No</span>
        </div>
        <div className="shot-progress">
          <span />
        </div>
      </div>
    </div>
  );
}

/** A chapter on the rail: a glowing node, a kicker, a headline. */
function Chapter({
  id,
  tone,
  Icon,
  kicker,
  title,
  lede,
  children,
}: {
  id: string;
  tone: "blue" | "orange" | "purple";
  Icon: typeof FileText;
  kicker: string;
  title: React.ReactNode;
  lede: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className={`chapter tone-${tone}`} aria-labelledby={`${id}-title`}>
      <div className="chapter-head">
        <span className="chapter-node" aria-hidden>
          <Icon size={18} />
        </span>
        <p className="landing-kicker">{kicker}</p>
        <h2 id={`${id}-title`}>{title}</h2>
        <p className="chapter-lede">{lede}</p>
      </div>
      {children}
    </section>
  );
}

export default async function Home() {
  const who = await audience();
  const primary =
    who === "member"
      ? { href: "/app", label: "Open Slate" }
      : { href: "/auth/register", label: "Get started for free" };
  return (
    <div className="landing">
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <header className="landing-header">
        <div className="landing-nav">
          <Link href="/" className="landing-brand" aria-label="Slate home">
            <Brand size={26} />
          </Link>
          <nav className="landing-sections" aria-label="Sections">
            <a href="#write">Product</a>
            <a href="#run">Playbooks</a>
            <a href="#connect">AI agents</a>
            <a href="#faq">FAQ</a>
            <Link href="/docs/mcp">Docs</Link>
          </nav>
          <div className="landing-account">
            <GitHubLink />
            {who === "visitor" && (
              <Link href="/auth/login" className="landing-link">
                Log in
              </Link>
            )}
            <Link href={primary.href} className="landing-button small outline">
              {who === "visitor" ? "Sign up" : primary.label}
            </Link>
          </div>
        </div>
      </header>

      <main id="main">
        {/* Hero: the outcome, centered, then the product. */}
        <section className="hero">
          <div className="hero-backdrop" aria-hidden />
          <div className="hero-copy">
            <Link href="#run" className="hero-pill">
              <span className="hero-pill-badge">
                <Sparkles size={12} /> New
              </span>
              <span className="hero-pill-text">
                <span className="hero-pill-long">Playbooks you can run, and AI agents that read your workspace</span>
                <span className="hero-pill-short">Playbooks and AI agents</span>
              </span>
              <ArrowRight size={13} />
            </Link>
            <h1>
              <span className="nowrap">Write it down.</span> <span className="nowrap">Organize it.</span>{" "}
              <span className="hero-gradient nowrap">Run it.</span>
            </h1>
            <p className="hero-lede">
              The private workspace where your notes, your databases and the way you get things done live together —
              with checklists that walk you through, and remember every run.
            </p>
            <div className="landing-ctas">
              <Link href={primary.href} className="landing-button">
                {primary.label}
                <ArrowRight size={16} />
              </Link>
              <a href="#run" className="landing-button ghost">
                <Play size={14} />
                See how playbooks work
              </a>
            </div>
            <ul className="hero-assurances" aria-label="Highlights">
              <li>
                <Check size={14} /> Private by default
              </li>
              <li>
                <Check size={14} /> Nothing to install
              </li>
              <li>
                <Check size={14} /> Markdown in and out
              </li>
            </ul>
          </div>
          <HeroShot />
        </section>

        <section className="facts" aria-label="Slate at a glance">
          <ul>
            {FACTS.map(({ value, label }) => (
              <li key={label}>
                <strong>{value}</strong>
                <span>{label}</span>
              </li>
            ))}
          </ul>
        </section>

        <section className="problem" aria-labelledby="problem-title">
          <h2 id="problem-title">
            Your work is scattered across four tools. <span>Slate puts it in one.</span>
          </h2>
          <ul className="scattered">
            {SCATTERED.map(({ Icon, label }) => (
              <li key={label}>
                <Icon size={15} /> {label}
              </li>
            ))}
          </ul>
        </section>

        <div className="rail">
          <Chapter
            id="write"
            tone="blue"
            Icon={FileText}
            kicker="Write & organize"
            title={
              <>
                Notes, databases, checklists. <span className="muted">One calm workspace.</span>
              </>
            }
            lede="A clean editor for your thinking, databases for everything that needs structure, and search that finds it all."
          >
            <div className="bento">
              <article className="bento-card span-2">
                <span className="bento-icon tone-blue">
                  <FileText size={18} />
                </span>
                <h3>Pages that stay out of your way</h3>
                <p>
                  A clean editor that formats as you type. Headings, to-dos, tables, code and callouts are a{" "}
                  <kbd>/</kbd> away — or flip to Markdown and write the source.
                </p>
                <div className="mini-doc" aria-hidden>
                  <div className="mini-h">Weekly review</div>
                  <div className="mini-todo done">
                    <span /> Ship the new onboarding
                  </div>
                  <div className="mini-todo">
                    <span /> Draft Q3 goals
                  </div>
                  <div className="mini-slash">
                    <div className="on">
                      <FileText size={11} /> Text
                    </div>
                    <div>
                      <Table2 size={11} /> Database
                    </div>
                    <div>
                      <Compass size={11} /> Playbook
                    </div>
                  </div>
                </div>
              </article>
              <article className="bento-card">
                <span className="bento-icon tone-green">
                  <Table2 size={18} />
                </span>
                <h3>Databases with views</h3>
                <p>
                  Table, board and list. Status, dates, money, relations and formulas — and every record opens as a
                  page.
                </p>
                <div className="mini-tags" aria-hidden>
                  <span className="tag green">Paid</span>
                  <span className="tag blue">In progress</span>
                  <span className="tag gray">Not started</span>
                </div>
              </article>
              <article className="bento-card">
                <span className="bento-icon tone-orange">
                  <Compass size={18} />
                </span>
                <h3>Checklists you can run</h3>
                <p>Go step by step, branch on answers, and see every run in a history you can search and resume.</p>
                <div className="mini-steps" aria-hidden>
                  <span className="is-check">CHECK</span>
                  <span className="is-ask">ASK</span>
                  <span className="is-if">DECIDE</span>
                  <span className="is-api">CALL</span>
                </div>
              </article>
              <article className="bento-card">
                <span className="bento-icon">
                  <Command size={18} />
                </span>
                <h3>
                  Find anything with <Keys combo="Mod+K" />
                </h3>
                <p>Every title and every line you’ve written, a keystroke away.</p>
              </article>
              <article className="bento-card">
                <span className="bento-icon">
                  <Lock size={18} />
                </span>
                <h3>Private by default</h3>
                <p>Your workspace is yours alone. Secrets in playbooks stay out of run history and links.</p>
              </article>
              <article className="bento-card">
                <span className="bento-icon">
                  <Code2 size={18} />
                </span>
                <h3>Markdown in and out</h3>
                <p>Paste Markdown in, copy it out, export any page as a file. Databases export to CSV.</p>
              </article>
            </div>
          </Chapter>

          <Chapter
            id="run"
            tone="orange"
            Icon={Compass}
            kicker="Playbooks"
            title={
              <>
                The checklist <span className="muted">that remembers.</span>
              </>
            }
            lede="The steps you repeat — the rent check, the move-in, the release, the refund — shouldn’t live in your head. Write them once. Run them every time."
          >
            <div className="spotlight">
              <ul className="spotlight-points">
                <li>
                  <span>
                    <CheckCircle2 size={16} />
                  </span>
                  <div>
                    <strong>Start as a simple list.</strong> Three steps and Run. Turn any to-do list into one with a
                    click.
                  </div>
                </li>
                <li>
                  <span>
                    <GitBranch size={16} />
                  </span>
                  <div>
                    <strong>Grow it when you need to.</strong> Ask questions, branch on the answers, check results, jump
                    to a “roll back” section.
                  </div>
                </li>
                <li>
                  <span>
                    <Globe size={16} />
                  </span>
                  <div>
                    <strong>Call other apps.</strong> Post to a webhook, look up an order, create a task — with secrets
                    kept safe.
                  </div>
                </li>
                <li>
                  <span>
                    <History size={16} />
                  </span>
                  <div>
                    <strong>Every run is remembered.</strong> Inputs, answers, results and who stopped where. Pause and
                    pick up later.
                  </div>
                </li>
              </ul>
              <div className="run-demo" aria-hidden>
                <div className="run-demo-head">
                  <Compass size={14} className="t-blue" /> Monthly rent check
                  <span className="run-demo-chip">Month · November</span>
                </div>
                <div className="run-demo-body">
                  <ol className="run-demo-outline">
                    <li className="done">
                      <i>
                        <Check size={9} />
                      </i>{" "}
                      Open the Rent Ledger
                    </li>
                    <li className="done">
                      <i>
                        <Check size={9} />
                      </i>{" "}
                      Match each payment
                    </li>
                    <li className="current">
                      <i /> Anyone behind?
                    </li>
                    <li>
                      <i /> Send a reminder
                    </li>
                    <li>
                      <i /> Note it in the ledger
                    </li>
                  </ol>
                  <div className="run-demo-card">
                    <span className="run-demo-kind">
                      <CircleHelp size={12} /> ASK · Step 3 of 7
                    </span>
                    <p>Did anyone pay late or less than they owe?</p>
                    <div className="run-demo-answers">
                      <span className="on">Yes</span>
                      <span>No</span>
                    </div>
                    <div className="run-demo-decision">
                      <strong>Yes</strong> — going to <b>Chase late rent</b>
                    </div>
                  </div>
                </div>
              </div>
            </div>
            <div className="spotlight-templates">
              <span>Start from a template</span>
              {[
                "Monthly rent check",
                "Tenant move-in",
                "Incident response",
                "Daily standup note",
                "Refund request",
              ].map((t) => (
                <em key={t}>{t}</em>
              ))}
            </div>
          </Chapter>

          <Chapter
            id="connect"
            tone="purple"
            Icon={Bot}
            kicker="AI agents"
            title={
              <>
                Give your AI <span className="muted">the context it’s missing.</span>
              </>
            }
            lede="Agents make things up when they can’t see your work. Connect Claude — or any MCP-compatible agent — and it reads your pages, databases and playbooks instead of guessing."
          >
            <div className="agents">
              <ul className="agents-points">
                <li>
                  <span>
                    <KeyRound size={16} />
                  </span>
                  <div>
                    <strong>One key per agent.</strong> Revoke any of them, any time.
                  </div>
                </li>
                <li>
                  <span>
                    <Lock size={16} />
                  </span>
                  <div>
                    <strong>Read-only, unless you say so.</strong> Give a key permission and agents can add pages,
                    databases and playbooks. They never edit or delete anything that’s already there.
                  </div>
                </li>
                <li>
                  <span>
                    <Zap size={16} />
                  </span>
                  <div>
                    <strong>Works with any MCP client.</strong> Claude, Cursor, VS Code, Codex or your own.{" "}
                    <Link href="/docs/mcp" className="agents-guide">
                      See the setup guide
                    </Link>
                  </div>
                </li>
              </ul>
              <div className="agent-chat" aria-hidden>
                <div className="chat-row user">Which units are late on rent this month?</div>
                <div className="chat-tool">
                  <Activity size={12} /> query_database · Rent Ledger · Status is Late
                </div>
                <div className="chat-row agent">
                  Unit 3C is late — $1,200, 6 days overdue. Your <b>Chase late rent</b> playbook says to send a friendly
                  reminder before 14 days.
                </div>
              </div>
            </div>
          </Chapter>
        </div>

        <section className="landing-section" aria-labelledby="audience-title">
          <header className="section-intro">
            <p className="landing-kicker">Made for</p>
            <h2 id="audience-title">
              People with work <span className="muted">worth doing right.</span>
            </h2>
          </header>
          <div className="audiences">
            {AUDIENCES.map(({ Icon, tone, who: name, story, tags }) => (
              <article key={name} className={`tone-${tone}`}>
                <span className={`bento-icon tone-${tone}`}>
                  <Icon size={18} />
                </span>
                <h3>{name}</h3>
                <p>{story}</p>
                <div className="audience-tags">
                  {tags.map((t) => (
                    <em key={t}>{t}</em>
                  ))}
                </div>
              </article>
            ))}
          </div>
        </section>

        <section className="landing-section" aria-labelledby="how-title">
          <header className="section-intro">
            <p className="landing-kicker">How it works</p>
            <h2 id="how-title">
              Up and running <span className="muted">in a minute.</span>
            </h2>
          </header>
          <ol className="steps">
            <li>
              <span className="step-number">1</span>
              <h3>Create your account</h3>
              <p>An email and a password. Your private workspace is ready straight away.</p>
            </li>
            <li>
              <span className="step-number">2</span>
              <h3>Write, then organize</h3>
              <p>
                Start a page and press <kbd>/</kbd>. When a list needs structure, make it a database.
              </p>
            </li>
            <li>
              <span className="step-number">3</span>
              <h3>Run what you repeat</h3>
              <p>Pick a playbook template — or turn a to-do list into one — and press Run.</p>
            </li>
          </ol>
        </section>

        <section id="faq" className="landing-section faq-section" aria-labelledby="faq-title">
          <header>
            <p className="landing-kicker">FAQ</p>
            <h2 id="faq-title">
              Questions, <span className="muted">answered.</span>
            </h2>
            <p className="faq-aside">
              Still curious? <Link href={primary.href}>{who === "visitor" ? "Create a workspace" : "Open Slate"}</Link>{" "}
              and look around — it takes a minute.
            </p>
          </header>
          <div className="faq">
            {FAQ.map(({ q, a }) => (
              <details key={q}>
                <summary>
                  {q}
                  <ChevronDown size={16} aria-hidden />
                </summary>
                <p>{a}</p>
              </details>
            ))}
          </div>
        </section>

        <section className="closing" aria-labelledby="closing-title">
          <div className="closing-inner">
            <span className="closing-mark" aria-hidden>
              <BrandMark size={30} />
            </span>
            <h2 id="closing-title">
              Stop re-explaining
              <br />
              <span className="hero-gradient">how things get done.</span>
            </h2>
            <p>Write it down once. Run it every time. Let your agents read it too.</p>
            <div className="landing-ctas">
              <Link href={primary.href} className="landing-button">
                {primary.label}
                <ArrowRight size={16} />
              </Link>
              {who === "visitor" ? (
                <Link href="/auth/login" className="landing-button ghost">
                  Log in
                </Link>
              ) : (
                <a href="#run" className="landing-button ghost">
                  See playbooks
                </a>
              )}
            </div>
          </div>
        </section>
      </main>

      <footer className="landing-footer">
        <div className="footer-brand">
          <Brand size={20} />
          <p>Write it down. Organize it. Run it.</p>
          <p className="footer-license">Open source under {LICENSE_NAME}.</p>
          <ThemeSwitcher compact />
        </div>
        <nav aria-label="Product">
          <h2>Product</h2>
          <a href="#write">Pages & databases</a>
          <a href="#run">Playbooks</a>
          <a href="#connect">AI agents</a>
          <a href="#faq">FAQ</a>
          <Link href="/docs/mcp">MCP setup guide</Link>
          <a href={REPOSITORY_URL} target="_blank" rel="noreferrer">
            Source code (GitHub)
          </a>
        </nav>
        <nav aria-label="Account">
          <h2>{who === "member" ? "Workspace" : "Get started"}</h2>
          {who === "visitor" ? (
            <>
              <Link href="/auth/register">Create an account</Link>
              <Link href="/auth/login">Log in</Link>
              <Link href="/auth/forgot">Reset password</Link>
            </>
          ) : (
            <Link href="/app">Open Slate</Link>
          )}
        </nav>
        <nav aria-label="About">
          <h2>About</h2>
          <Link href="/privacy">Privacy</Link>
          <Link href="/contact">Contact</Link>
        </nav>
      </footer>
    </div>
  );
}
