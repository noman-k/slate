import type { Metadata } from 'next';
import Link from 'next/link';
import {
  ArrowRight, Check, ChevronDown, Code2, Command, Download, FileText, FolderTree,
  KanbanSquare, Lock, Search, Star, Table2, Undo2,
} from 'lucide-react';
import { Brand } from '@/components/brand';
import { ThemeSwitcher } from '@/components/theme-switcher';
import { createClient } from '@/lib/supabase/server';
import './landing.css';

const TITLE = 'Slate — a quiet place for your notes and ideas';
const DESCRIPTION =
  'Slate is a private workspace for writing and organizing: calm pages, databases with table, board and list views, and Markdown in and out.';

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  openGraph: { title: TITLE, description: DESCRIPTION, type: 'website', siteName: 'Slate' },
  twitter: { card: 'summary', title: TITLE, description: DESCRIPTION },
};

const configured = Boolean(
  process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
);

/** Who is looking: a visitor, a signed-in user, or the local demo (no Supabase). */
async function audience(): Promise<'demo' | 'member' | 'visitor'> {
  if (!configured) return 'demo';
  try {
    const supabase = await createClient();
    const { data } = await supabase.auth.getUser();
    return data.user ? 'member' : 'visitor';
  } catch {
    return 'visitor';
  }
}

const USE_CASES = ['Personal notes', 'Project plans', 'Reading lists', 'Journals', 'Meeting notes', 'Research'];

const DETAILS = [
  { Icon: Command, title: 'Find anything', text: 'Press ⌘K to search every title and every line you have written.' },
  { Icon: FolderTree, title: 'Pages inside pages', text: 'Nest freely and drag to rearrange. The sidebar keeps your tree tidy.' },
  { Icon: Star, title: 'Favorites & recents', text: 'Keep what matters one click away, and pick up where you left off.' },
  { Icon: Undo2, title: 'Undo that just works', text: 'Every edit can be undone, in the editor and in Markdown alike.' },
  { Icon: Download, title: 'Export any time', text: 'Download any page as Markdown. Your words are never locked in.' },
  { Icon: Lock, title: 'Private by default', text: 'Your workspace is visible to you and no one else.' },
];

const FAQ = [
  {
    q: 'Do I need an account to try it?',
    a: 'No. The demo runs right in your browser with example content, so you can poke around first. Your demo changes stay in that browser.',
  },
  {
    q: 'What is the difference between a page and a database?',
    a: 'A page is for writing. A database is a collection of pages with properties, like status or dates, that you can view as a table, a board or a list. Any new page can become a database with one click.',
  },
  {
    q: 'Who can see my pages?',
    a: 'Only you. Slate is a private workspace: there is no sharing and no public pages.',
  },
  {
    q: 'Can I get my notes out?',
    a: 'Yes. Every page has a Markdown view you can edit or copy, and you can export any page as a Markdown file.',
  },
  {
    q: 'Does it work on my phone?',
    a: 'Slate runs in any modern browser, and the layout adapts to small screens.',
  },
];

export default async function Home() {
  const who = await audience();
  const primary =
    who === 'member'
      ? { href: '/app', label: 'Open Slate' }
      : who === 'demo'
        ? { href: '/app', label: 'Try the demo' }
        : { href: '/auth/register', label: 'Get started' };
  return (
    <div className="landing">
      <a className="skip-link" href="#main">Skip to content</a>
      <header className="landing-header">
        <div className="landing-nav">
          <Link href="/" className="landing-brand" aria-label="Slate home">
            <Brand size={26} />
          </Link>
          <nav className="landing-sections" aria-label="Sections">
            <a href="#features">Features</a>
            <a href="#how">How it works</a>
            <a href="#faq">FAQ</a>
          </nav>
          <div className="landing-account">
            {who === 'visitor' && (
              <Link href="/auth/login" className="landing-link">Log in</Link>
            )}
            <Link href={primary.href} className="landing-button small">
              {who === 'visitor' ? 'Sign up' : primary.label}
            </Link>
          </div>
        </div>
      </header>

      <main id="main">
        <section className="landing-hero">
          <p className="landing-eyebrow">Notes · Docs · Databases</p>
          <h1>A quiet place for your notes, ideas, and everything in between.</h1>
          <p className="landing-lede">
            Write in calm pages. Organize with databases. Slate keeps it all in one private
            workspace that stays out of your way.
          </p>
          <div className="landing-ctas">
            <Link href={primary.href} className="landing-button">
              {primary.label}
              <ArrowRight size={16} />
            </Link>
            <a href="#how" className="landing-button ghost">See how it works</a>
          </div>
          <ul className="landing-assurances" aria-label="Highlights">
            <li><Check size={14} /> Private by default</li>
            <li><Check size={14} /> Markdown in and out</li>
            <li><Check size={14} /> {who === 'demo' ? 'No account needed' : 'Nothing to install'}</li>
          </ul>
        </section>

        <section className="landing-showcase" aria-label="What Slate looks like">
          <div className="preview-window">
            <div className="preview-chrome" aria-hidden>
              <span /><span /><span />
            </div>
            <div className="preview-body">
              <div className="preview-sidebar">
                <div className="preview-brand"><Brand size={16} /></div>
                <div className="preview-search"><Search size={12} /> Search <kbd>⌘K</kbd></div>
                <div className="preview-heading">Private</div>
                <div className="preview-row"><FileText size={13} /> Reading notes</div>
                <div className="preview-row active"><Table2 size={13} /> Projects <em>4</em></div>
                <div className="preview-row"><KanbanSquare size={13} /> Roadmap</div>
                <div className="preview-row"><FileText size={13} /> Journal</div>
              </div>
              <div className="preview-page">
                <div className="preview-title">Projects</div>
                <div className="preview-tabs"><span className="on"><Table2 size={12} /> Table</span><span>Board</span><span>List</span></div>
                <div className="preview-table">
                  {[
                    ['Website refresh', 'In progress', 'blue', 'Mar 4'],
                    ['Q3 planning', 'Not started', 'gray', 'Mar 9'],
                    ['Hiring notes', 'Done', 'green', 'Feb 27'],
                    ['Reading list', 'In progress', 'blue', 'Mar 12'],
                  ].map(([name, status, tone, date]) => (
                    <div className="preview-tr" key={name}>
                      <span><FileText size={12} /> {name}</span>
                      <span className="preview-date">{date}</span>
                      <span className={`preview-tag ${tone}`}>{status}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="landing-usecases" aria-label="Made for">
          <p>Made for</p>
          <ul>
            {USE_CASES.map((item) => <li key={item}>{item}</li>)}
          </ul>
        </section>

        <section id="features" className="landing-section">
          <header className="section-intro">
            <p className="landing-kicker">Features</p>
            <h2>Everything you need to think clearly. Nothing you don’t.</h2>
          </header>

          <div className="feature-row">
            <div className="feature-copy">
              <span className="feature-icon"><FileText size={18} /></span>
              <h3>Pages that stay out of the way</h3>
              <p>A clean editor that formats as you type. Headings, lists, to-dos, code and tables, all a slash away.</p>
              <ul className="feature-points">
                <li><Check size={14} /> Type <code>/</code> for any block</li>
                <li><Check size={14} /> Markdown shortcuts like <code>##</code> and <code>- [ ]</code></li>
                <li><Check size={14} /> Drag blocks to reorder</li>
              </ul>
            </div>
            <div className="feature-visual" aria-hidden>
              <div className="mock-doc">
                <div className="mock-h">Weekly review</div>
                <div className="mock-line w80" />
                <div className="mock-line w60" />
                <div className="mock-todo done"><span /> Ship the new onboarding</div>
                <div className="mock-todo"><span /> Draft Q3 goals</div>
                <div className="mock-slash">
                  <div className="mock-slash-item on"><FileText size={13} /> Text</div>
                  <div className="mock-slash-item"><Table2 size={13} /> Table</div>
                  <div className="mock-slash-item"><Code2 size={13} /> Code</div>
                </div>
              </div>
            </div>
          </div>

          <div className="feature-row reverse">
            <div className="feature-copy">
              <span className="feature-icon"><Table2 size={18} /></span>
              <h3>Databases with views</h3>
              <p>Give any page structure. Track work with properties and switch between a table, a board and a list.</p>
              <ul className="feature-points">
                <li><Check size={14} /> Status, dates, numbers, relations and more</li>
                <li><Check size={14} /> Filters and sorts saved per view</li>
                <li><Check size={14} /> Every record opens as its own page</li>
              </ul>
            </div>
            <div className="feature-visual" aria-hidden>
              <div className="mock-board">
                {[
                  ['Not started', 'gray', ['Q3 planning', 'Team offsite']],
                  ['In progress', 'blue', ['Website refresh', 'Reading list']],
                  ['Done', 'green', ['Hiring notes']],
                ].map(([label, tone, cards]) => (
                  <div className="mock-column" key={label as string}>
                    <span className={`preview-tag ${tone}`}>{label as string}</span>
                    {(cards as string[]).map((card) => (
                      <div className="mock-card" key={card}><FileText size={12} /> {card}</div>
                    ))}
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="feature-row">
            <div className="feature-copy">
              <span className="feature-icon"><Code2 size={18} /></span>
              <h3>Markdown, both ways</h3>
              <p>Flip any page into Markdown, edit the source, and flip back. Nothing is lost on the way.</p>
              <ul className="feature-points">
                <li><Check size={14} /> GitHub-style source editor</li>
                <li><Check size={14} /> Export pages as <code>.md</code> files</li>
                <li><Check size={14} /> Headings, lists, to-dos and code round-trip</li>
              </ul>
            </div>
            <div className="feature-visual" aria-hidden>
              <pre className="mock-code"><span className="c-h"># Weekly review</span>{'\n\n'}<span className="c-p">-</span> [x] Ship the new onboarding{'\n'}<span className="c-p">-</span> [ ] Draft <span className="c-b">**Q3 goals**</span>{'\n\n'}<span className="c-p">&gt;</span> <span className="c-q">Small steps, every week.</span></pre>
            </div>
          </div>

          <div className="detail-grid">
            {DETAILS.map(({ Icon, title, text }) => (
              <article key={title}>
                <Icon size={18} />
                <h3>{title}</h3>
                <p>{text}</p>
              </article>
            ))}
          </div>
        </section>

        <section id="how" className="landing-section">
          <header className="section-intro">
            <p className="landing-kicker">How it works</p>
            <h2>Up and writing in under a minute.</h2>
          </header>
          <ol className="steps">
            <li>
              <span className="step-number">1</span>
              <h3>{who === 'demo' ? 'Open the demo' : 'Create your account'}</h3>
              <p>{who === 'demo' ? 'Everything runs in your browser. No sign-up.' : 'Just an email and a password. Your private workspace is ready right away.'}</p>
            </li>
            <li>
              <span className="step-number">2</span>
              <h3>Start a page</h3>
              <p>Click New page and type. Press <kbd>/</kbd> for blocks, or turn it into a table, board or list.</p>
            </li>
            <li>
              <span className="step-number">3</span>
              <h3>Find it again</h3>
              <p>Nest pages, star favorites, and press <kbd>⌘K</kbd> to jump to anything.</p>
            </li>
          </ol>
        </section>

        <section id="faq" className="landing-section narrow">
          <header className="section-intro">
            <p className="landing-kicker">FAQ</p>
            <h2>Questions, answered.</h2>
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

        <section className="landing-closing">
          <h2>Make some room to think.</h2>
          <p>Your notes, your projects, your pace.</p>
          <div className="landing-ctas">
            <Link href={primary.href} className="landing-button">
              {primary.label}
              <ArrowRight size={16} />
            </Link>
            {who === 'visitor' && (
              <Link href="/auth/login" className="landing-button ghost">Log in</Link>
            )}
          </div>
        </section>
      </main>

      <footer className="landing-footer">
        <div className="footer-brand">
          <Brand size={20} />
          <p>A quiet place for your notes, ideas, and everything in between.</p>
          <ThemeSwitcher compact />
        </div>
        <nav aria-label="Product">
          <h2>Product</h2>
          <a href="#features">Features</a>
          <a href="#how">How it works</a>
          <a href="#faq">FAQ</a>
        </nav>
        <nav aria-label="Account">
          <h2>{who === 'member' ? 'Workspace' : 'Get started'}</h2>
          {who === 'visitor' ? (
            <>
              <Link href="/auth/register">Create an account</Link>
              <Link href="/auth/login">Log in</Link>
              <Link href="/auth/forgot">Reset password</Link>
            </>
          ) : (
            <Link href="/app">{who === 'member' ? 'Open Slate' : 'Try the demo'}</Link>
          )}
        </nav>
      </footer>
    </div>
  );
}
