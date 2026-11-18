# Deployments

Two Convex backends, with one rule: **only `main` changes what the live site runs on.**

| Backend | Used by | Who deploys to it |
|---|---|---|
| Live: `terrific-avocet-835` | www, app and link.selestial.io (Vercel production). Real companies' data. | Only Vercel's production build, on a merge to `main` (`scripts/build.mjs`). Never by hand. |
| Test: a separate deployment in the same Convex project | Work in progress: Claude sessions, local development, trying a branch. Sample data only. | Anyone, any branch, any time. |

Why: both used to share the live backend, and `npx convex deploy` from one branch replaces every function
and index another branch had deployed. On November 18, 2026 a deploy of `main` removed unmerged onboarding
work (`websiteReads`, `importedRecords`) that had been deployed to the live backend from a branch. No data
was lost, but the work had to be redeployed.

## How a change reaches the live site

1. Merge the pull request to `main`.
2. Vercel's production build runs `npm run build`, which is `scripts/build.mjs`. With `VERCEL_ENV=production`
   and `CONVEX_DEPLOY_KEY` set, it runs `npx convex deploy --cmd "next build"`: the functions and schema
   are type-checked and pushed, then the site is built against that backend. If the backend push fails,
   the build fails and the previous version stays live.
3. Preview builds (pull requests) and local builds only run `next build`. A preview never deploys a
   backend, even if it can see the key.

Without `CONVEX_DEPLOY_KEY` in Vercel's production settings, step 2 builds the site only, as before, and the
backend has to be deployed by hand from `main`.

## One-time setup (the Owner, in the dashboards)

1. **Create the test backend.** In the Convex dashboard, open the project that holds `terrific-avocet-835`,
   open the deployment menu and create a new deployment (for example `work-in-progress`). Or, signed in to
   Convex: `npx convex deployment create dev/work-in-progress --type dev`.
2. **Copy its settings.** In the new deployment's Settings › Environment Variables, add the variables the
   code needs. Use test keys (Stripe test mode, a test email sender), never the live ones: messages and
   payments from the test backend must not reach real people.
3. **Give work-in-progress sessions the test key.** In the new deployment's Settings, generate a deploy key.
   In Claude's environment settings (environment "Selestial"), replace `CONVEX_DEPLOY_KEY` with it. Sessions
   on that environment then deploy only to the test backend.
4. **Give Vercel the live key.** In the live deployment's Settings, generate a deploy key. In Vercel ›
   selestial-ai › Settings › Environment Variables, add `CONVEX_DEPLOY_KEY` with it, for **Production only**
   (not Preview, not Development).
5. Merge anything to `main` and check the production build log for "Production build: deploying the Convex
   backend". From then on, nobody deploys the live backend by hand.

## Notes

- Pull request previews use the live backend's address for reading (`NEXT_PUBLIC_CONVEX_URL`), so a preview
  of a branch with new backend functions shows errors on those pages until it is merged. Convex preview
  deployments (a backend per preview) fix that and need a paid Convex plan.
- Older docs that say "run `npx convex deploy`" (for example `docs/ai/02-status.md`) describe what a deploy
  does. On the live backend it now happens through the merge, not by hand.
