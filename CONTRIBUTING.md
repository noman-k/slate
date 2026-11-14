# Contributing to Slate

Thanks for helping. Bug reports, small fixes, docs improvements and well-scoped features are all welcome.

## Before you start

- **Bugs:** [open an issue](https://github.com/noman-k/slate/issues/new/choose) with steps to reproduce, what you expected and what happened.
- **Features:** open an issue to discuss it before writing code, so we can agree on the approach and you don't spend time on something that won't be merged.
- **Security problems:** please don't open a public issue. See [SECURITY.md](SECURITY.md).

## Set up

You need Node.js 22.12 or later, npm, Docker and the [Supabase CLI](https://supabase.com/docs/guides/local-development/cli/getting-started).

```sh
npm ci
supabase start
cp .env.example .env.local   # then fill in the URL and publishable key from `supabase status`
npm run dev
```

Open http://localhost:3000 and register. Local email confirmation is off, so you land in the app straight away. The [README](README.md) explains the project layout and how the data model works.

## Making a change

1. Fork the repository and create a branch from `main`.
2. Keep each pull request to one change. Smaller pull requests are reviewed faster.
3. Add or update tests for what you change: unit tests in `tests/*.test.ts`, browser tests in `tests/browser`, database tests in `supabase/tests`.
4. Run the checks:

   ```sh
   npm run typecheck
   npm run lint
   npm test
   supabase test db
   npm run test:auth
   npm run test:e2e   # stop any other `next dev` in this folder first
   ```

5. Open a pull request and fill in the template. CI runs the same checks.

### Database changes

- Add a new file in `supabase/migrations` named `YYYYMMDDHHMMSS_short_name.sql`, dated after the latest one. Never edit a migration that is already on `main`: production has applied it.
- Keep migrations additive (new tables, columns, functions). The app and the database are deployed side by side, so for a moment the running app can meet the new schema; renaming or dropping something it still uses breaks it.
- Every new table needs row level security, owner-scoped policies and explicit grants, like the existing ones. Hosted projects don't expose new tables automatically.
- Apply it locally with `supabase migration up --local`, and add a pgTAP test when it changes access rules.

### Saved formats

Some `slate` names are part of stored data: the `:::slate` and `:::slate-node` lines in page Markdown, the `slate_` prefix on agent keys, and the `slate-*` keys in browser storage. Changing them breaks existing pages, keys or drafts, so keep them as they are.

### Style

- TypeScript, following the existing code. `npm run lint` must pass.
- Phones count as much as desktops. `:hover` styles only apply on devices that can hover (on touch screens they make Safari need two taps): `npm run lint` fails on a `:hover` rule outside `@media (hover: hover)`, and `node scripts/hover-media.mjs` wraps them for you. Anything revealed on hover needs a touch alternative, and fields people type in should be 16px or larger on touch screens, or iPhone Safari zooms in. `tests/browser/mobile.e2e.ts` checks the main screens at phone size.
- User-facing text is short, plain and specific. Prefer "Couldn't save. Try again." over technical wording.
- Commit messages follow the existing style: `feat: …`, `fix: …`, `docs: …`, `style: …`, `chore: …`, written as what the change does for people.

## AI-assisted contributions

You're welcome to use AI tools. You are responsible for every line you submit: read it, understand it and test it. `AGENTS.md` has notes for coding agents (this project uses a recent Next.js with changes that older training data doesn't know about).

## License

Slate is licensed under the [GNU AGPL-3.0](LICENSE). By contributing, you agree that your contributions are licensed under the same terms.
