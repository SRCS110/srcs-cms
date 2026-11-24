# SRCS CMS

Inline editor for Sync Race Studios client sites. Clients open their site with `?edit`, sign in by email link, edit outlined areas in place, and press Publish. Each publish is one Git commit to the site's repo; Vercel redeploys it in about a minute. Sites stay plain static HTML.

```
client site (loader.js) ──► cms.srcs.online/api ──► GitHub (commit) ──► Vercel (deploy)
          │                        │
          └── images ──► Supabase Storage      Supabase (auth, sites, roles, audit log)
```

## Layout

| Path | What it is |
| --- | --- |
| `public/loader.js` | Under 1 KB, on every client page. Loads the editor only for `?edit` or signed-in editors. |
| `public/editor.js` | The inline editor (Shadow DOM UI, no dependencies). |
| `public/agent.js` | AI website assistant widget. See `docs/AGENTS.md`. |
| `public/login.html`, `login.js` | Central sign-in page (magic link). |
| `api/*.js` | Vercel functions: `session`, `publish`, `status`, `upload-url`, `history`, `revert`, `members`, `login-link`, `refresh`, `health`, `agent`. |
| `lib/apply.js` | Rewrites only the edited regions of an HTML file (byte-for-byte elsewhere). |
| `lib/sanitize.js` | Allowlist sanitizer for edited content. |
| `lib/publish.js` | Publish and revert logic (repo-agnostic, tested in memory). |
| `lib/github.js` | GitHub App auth, atomic multi-file commits, deploy status. |
| `supabase/migrations/` | Tables: `sites`, `site_users`, `admins`, `edits`, `assets`; bucket `site-assets`. |
| `starter/` | Base files for a new client site, already wired to the CMS. |
| `tools/check-site.mjs` | Validates a site's editable markup before connecting it. |

## Markup

See `starter/CMS.md`. In short: `data-cms="key"` on an element makes it editable; `data-cms-type` is `text` (default), `rich`, `link`, `image` or `list`; `data-cms-global` shares one value across pages.

## Environment (Vercel)

| Variable | Value | Secret |
| --- | --- | --- |
| `SUPABASE_URL` | `https://jhlnvcpfldlnraaoyhkz.supabase.co` | no |
| `SUPABASE_ANON_KEY` | Supabase publishable key | no |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase secret key | **yes** |
| `GITHUB_APP_ID` | The SRCS CMS GitHub App's ID | no |
| `GITHUB_APP_PRIVATE_KEY` | The app's `.pem` contents | **yes** |
| `GITHUB_INSTALLATION_ID` | Default installation (sites can override) | no |
| `CMS_ORIGIN` | `https://cms.srcs.online` | no |

AI assistants also need `ANTHROPIC_API_KEY` and `RESEND_API_KEY` (see `docs/AGENTS.md`).

Optional: `CMS_LIMIT_USER_HOUR` (default 30), `CMS_LIMIT_SITE_DAY` (default 100), `CMS_BUCKET` (default `site-assets`).

## Tests

```
npm install
npm test                    # unit tests: apply, sanitize, publish, revert, paths
node test/e2e/run.mjs       # browser test against a local mock API (needs Playwright + Chrome)
node tools/check-site.mjs starter
```

One-time setup steps are in `docs/SETUP.md`.
