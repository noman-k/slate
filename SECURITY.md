# Security policy

Slate stores people's private notes, so security reports are taken seriously.

## Reporting a vulnerability

Please **don't** open a public issue, discussion or pull request for a security problem.

Report it privately through GitHub instead: on the repository page, open the **Security** tab and choose **Report a vulnerability** ([direct link](https://github.com/noman-k/slate/security/advisories/new)). Include:

- what the problem is and what an attacker could do with it,
- steps to reproduce, or a proof of concept,
- the affected area (for example sign-in, row level security, the MCP endpoint, API steps or attachments).

You'll get a reply as soon as possible. Once the problem is confirmed, it will be fixed and the fix released before anything is disclosed publicly, and you'll be credited if you'd like.

## Scope

In scope: this repository's code, including the database migrations and policies, and the hosted instance at https://slate.noman.io.

Out of scope: problems in Supabase, Cloudflare or other third-party services themselves (report those to them), denial-of-service by volume, and findings that need a compromised device or account.

Please test only against your own accounts and your own self-hosted copy, never against other people's data.

## Supported versions

Only the latest `main` is supported. There are no separate release branches.
