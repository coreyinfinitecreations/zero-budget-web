# Zero Budget — Web

Next.js (App Router) web app for Zero Budget. Hosts the marketing/landing page,
login, the budget dashboard, and the public **Privacy Policy** at `/privacy`
(the URL provided to Plaid for production access).

## Tech stack

- **Next.js 14** (App Router)
- **React 18**
- **Supabase** for auth (browser client) — per-user data is served by the
  separate Zero Budget API.

## Local development

```bash
npm install
cp .env.local.example .env.local   # then fill in the values below
npm run dev                         # http://localhost:3000
```

## Environment variables

All three are required, in every environment (Production, Preview, Development).
They are `NEXT_PUBLIC_*`, so they ship to the browser — only put publishable
values here, never secrets.

| Variable | Description | Example |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL | `https://vganhnvojatuzvwojjbd.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Supabase publishable (anon) key | `sb_publishable_…` |
| `NEXT_PUBLIC_API_URL` | Deployed Zero Budget API base URL | `https://zero-budget-api.vercel.app` |

## Push this repo to GitHub

The repo is initialized locally with `origin` already set to
`https://github.com/coreyinfinitecreations/zero-budget-web.git`. The Vercel
project tracks the **`master`** branch for production, so push `master` (do
**not** rename to `main`, or Vercel won't auto-deploy it to production):

```bash
find .git -name '*.lock' -delete   # clear leftover lock files
git push -u origin master
```

This populates the GitHub repo and triggers a Vercel production build.

## Vercel deployment (already configured)

The Vercel project `infinitecreations-projects-7c431176/zero-budget-web` is
already set up:

- Live at **https://zero-budget-web.vercel.app** (status: Ready).
- Git repository connected; production branch is **`master`** — every push to
  `master` redeploys production.
- All three environment variables above are set for the **Production**
  environment.

Nothing further to configure. The current live deployment predates the privacy
policy update, so the next push to `master` is what publishes it.

> If you also want Preview deployments (per-branch URLs) to work, add the same
> three environment variables to the **Preview** environment in
> Settings → Environment Variables.

## Plaid production access

Once deployed, your privacy policy is publicly available at:

```
https://<your-domain>/privacy
```

Submit that URL in the Plaid Dashboard as your privacy policy link. The page
describes the data collected via Plaid, server-side storage (Vercel + Supabase
Postgres), encryption in transit/at rest, data sharing, retention/deletion, and
how users disconnect or revoke access — the disclosures Plaid reviews for
production approval.

> Tip: keep the privacy policy's "Effective date" current whenever you make
> material changes, and make sure it stays consistent with the policy in the
> `zero-budget-api` repo (or remove that older copy to avoid conflicting
> versions during Plaid's review).
