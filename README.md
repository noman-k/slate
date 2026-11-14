# Slate

A dark, desktop-oriented notes and database workspace inspired by the supplied Notion reference. Built with Next.js App Router, React, TypeScript, Tiptap, CodeMirror, TanStack Table/Virtual, Radix, Supabase, and the OpenNext adapter for Cloudflare Workers.

![Slate Rent Ledger preview](docs/preview.jpg)

## Run locally

Use Node.js 22.12 or later (22 LTS recommended) and npm.

If you use nvm, select the version in `.nvmrc` first:

```sh
nvm install
nvm use
```

Check `node --version` in the same terminal before starting the app. Installing a newer Node version does not change terminals that still have an older version first on `PATH`.

```sh
node --version
npm ci
test -f .env.local || cp .env.example .env.local
npm run dev
```

Open http://localhost:3000 for the front page, or http://localhost:3000/app for the workspace. With the Supabase variables empty, the app runs a **browser-local demo** with example rental data. Demo changes belong only to that browser. The demo does not represent authenticated cloud storage and is never automatically imported into a real account.

To use private persistent accounts, set both `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`. These are the project URL and public publishable key from Supabase. **Never use a service-role key in a `NEXT_PUBLIC_` variable.** Configured mode requires authentication, uses Supabase as the authoritative store, and creates an empty private workspace on registration.

### Tailwind / magic-string ESM error

An error saying `require() of ES Module .../magic-string/dist/index.mjs not supported` can occur when the shell uses an older Node runtime, including Node 20.17. The installed Tailwind dependency needs the ESM `require()` support enabled by default in [Node 22.12](https://nodejs.org/en/blog/release/v22.12.0). Switch to Node 22.12 or newer, stop the failed dev server with Ctrl+C, and run `npm run dev` again. The dev and build scripts check the runtime version before launching the tooling.

### Local Supabase

Install the [Supabase CLI](https://supabase.com/docs/guides/local-development/cli/getting-started) and start Docker:

```sh
supabase start
supabase db reset
supabase status
```

Copy the local API URL and publishable key from `supabase status` into `.env.local`, restart the app, and register. Local email confirmations are disabled by `supabase/config.toml`; hosted projects should enable them. Migrations create the schema, indexes, authorization policies, private Storage bucket, account bootstrap trigger, and transactional persistence functions. No shared demo account is seeded.

## Data and security

Workspaces, pages, documents, databases, properties, records, cell values, views, relations, and attachments are separate PostgreSQL tables. Record values are independently queryable rows; flexible document content and view configuration use JSONB. The application never stores its entire state in one database JSON column.

Every application table has owner-scoped Row Level Security. Composite foreign keys prevent a page, value, or relation from crossing workspace boundaries. A deferred trigger rejects page cycles; relation targets must belong to their configured database. Database record deletion cascades relation links. Workspace operations are owner-only; there are no invitations, public pages, or shared workspace roles.

`load_workspace_state` assembles a consistent snapshot from normalized tables. `save_workspace_state` applies a transaction and increments a revision under a row lock. A stale tab receives a conflict instead of overwriting another tab’s changes. The client journals unsynced changes in a per-account local outbox and warns before closing a tab with pending remote edits. On reload it replays a draft only when its base revision still matches the authoritative server revision. A conflicting draft is offered as a recovery download instead of overwriting newer remote data. Synchronization errors retain the local edits; resolve the conflict before continuing. This snapshot transport is intentionally simple; cursor-based incremental synchronization is a future improvement for very large workspaces.

Session cookies use `@supabase/ssr`; middleware validates/refreshes the session, while Supabase RLS remains the data authorization boundary. Registration, login, logout, password recovery, and recovery callback routes use Supabase Auth. In the hosted Supabase dashboard, set the Site URL to the deployed origin and allow:

- `https://YOUR-ORIGIN/auth/callback`
- `https://YOUR-ORIGIN/auth/callback?next=/auth/reset`

The private `attachments` bucket accepts images, PDFs, and text files up to 20 MB. Object keys must begin with the owning workspace UUID. The editor uploads private images into workspace/page-scoped object keys with attachment metadata. Documents keep stable `/api/attachments/:id` URLs; that authenticated endpoint checks owner RLS, parent page existence, and the scoped object path, then creates a short-lived signed redirect with private no-store headers. Uploads roll back the object if metadata insertion fails. Private files do not become public.

## Development checks

```sh
npm run typecheck
npm run lint
npm test
npm run build
npm run build:worker
supabase test db
npx playwright install chromium
npm run test:e2e
npm run test:auth
```

Unit tests cover document serialization and database computation. The SQL tests cover registration bootstrap, RLS isolation, unauthorized inserts, normalized snapshot ownership, and stale-save rejection. Running database and authentication tests requires the local Supabase Docker stack. The HTTP auth test refuses non-loopback URLs, creates unique temporary accounts, checks registration/login/session refresh, workspace bootstrap, nested-page and relational persistence, per-view column order, cross-account read/write isolation, stale revisions, password changes, reauthentication, and logout, then removes its accounts. `.github/workflows/ci.yml` runs application, database, and HTTP auth checks in CI. Set `SUPABASE_TEST_WORKDIR` to use an isolated Supabase CLI checkout.

## Cloudflare Workers

The repository follows the official [Cloudflare Next.js guide](https://developers.cloudflare.com/workers/framework-guides/web-apps/nextjs/) and [OpenNext adapter setup](https://opennext.js.org/cloudflare/get-started). This is a Workers target with `nodejs_compat`, not a Cloudflare Pages static export.

```sh
npm run build:worker
npm run preview
npm run deploy
```

`preview` builds and serves the Worker through Wrangler. `deploy` builds and publishes the Worker through `scripts/deploy-worker.mjs`. That script loads production environment files, validates that the supplied Supabase key is public, and generates an ignored temporary Wrangler configuration with explicit runtime bindings. The generated configuration is removed after the command. `npm run deploy:check` validates configuration without deploying. Authenticate Wrangler locally or set `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`. The API token needs Worker deployment permissions for the intended account. Change the Worker name in `wrangler.jsonc` as needed.

The Supabase URL and publishable key must exist at build time because Next.js embeds `NEXT_PUBLIC_` values into browser assets. The deployment script explicitly binds the same values to the Worker runtime so authentication middleware receives them; do not deploy a production build without them. `NEXT_PUBLIC_APP_URL` documents the canonical origin; auth redirects use the current origin to support previews. Add each permitted preview origin explicitly to Supabase Auth redirect URLs.

### Production domain: slate.noman.io

Production runs at **https://slate.noman.io**. `wrangler.jsonc` attaches the Worker to that hostname as a [Workers Custom Domain](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/), so the first deploy creates the DNS record and certificate. One-time setup:

1. **Cloudflare:** `noman.io` must be a zone in the same Cloudflare account as the Worker, with no existing DNS record for `slate`. The `CLOUDFLARE_API_TOKEN` needs Workers Scripts edit, plus Workers Routes and DNS edit on the `noman.io` zone.
2. **GitHub:** in the `production` environment, set `NEXT_PUBLIC_APP_URL` to `https://slate.noman.io`.
3. **Supabase Auth → URL Configuration:** set the Site URL to `https://slate.noman.io` and add these redirect URLs:
   - `https://slate.noman.io/auth/callback`
   - `https://slate.noman.io/auth/callback?next=/auth/reset`
4. **Deploy:** run the *Deploy production* workflow (or `npm run deploy`), then open https://slate.noman.io and register to confirm sign-in works.

### GitHub deployment

The production workflow is manually dispatched and uses the GitHub `production` environment. It runs checks, applies Supabase migrations, builds the Worker, and deploys it. Configure:

| Kind | Name | Purpose |
| --- | --- | --- |
| Variable | `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL, build and runtime |
| Variable | `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Public publishable key, build and runtime |
| Variable | `NEXT_PUBLIC_APP_URL` | Production origin: `https://slate.noman.io` |
| Secret | `SUPABASE_DB_URL` | Supabase PostgreSQL connection URI for migration application |
| Secret | `CLOUDFLARE_API_TOKEN` | Deploy the Worker |
| Secret | `CLOUDFLARE_ACCOUNT_ID` | Target Cloudflare account |

Apply migrations to a staging Supabase project before production. No remote project is created, no migrations are applied remotely, and no production deployment occurs merely by running the demo.

## Scope and operational limits

This repository implements an initial single-owner product, not multi-user live collaboration. Remote sync is serialized snapshot transport with optimistic revision checking; realtime merging and cursor-based data loading are not implemented. Documents accept external image URLs and private image uploads. Removing an image block does not delete the object. Recoverable source-page Trash retains owner image access for copied documents. Permanent page/workspace deletion cascades attachment metadata, but object garbage collection is not implemented. Production authentication and cross-user isolation must be verified against your configured Supabase project, and production deployment requires your own Cloudflare/Supabase configuration. The application does not claim that an unconfigured browser demo is a deployed production service.

## Verification performed

The application migration has been applied to an isolated local Supabase stack, and the 14 pgTAP authorization/relation checks passed. HTTP authentication and normalized persistence smoke tests run against that stack, including cross-account denial and reauthentication, plus private image upload, owner signing, foreign object/read-sign denial, and attachment path constraints. An isolated configured Next.js browser session also verified login, creating and editing a page, the saved state after refresh, and uploading a PNG through the editor; its stable authenticated image URL loaded successfully before and after refresh. Disposable test accounts, image objects, and the isolated preview services were removed afterward. Production credentials and a production deployment are not part of these local checks.

The final local checks passed TypeScript, ESLint, 49 unit tests, and the Cloudflare Worker build/runtime smoke check. Browser checks covered 1440px, 1280px, and mobile layouts; Markdown shortcuts and mode switching; inline databases; record editing; refresh persistence; saved filters and board views; and Trash restoration. Against the isolated Supabase stack, browser login, authenticated page saving, refresh persistence, and private image upload/restoration also passed. The Playwright regression suite is configured for CI; these local browser checks used the live preview.
