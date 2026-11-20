#!/usr/bin/env node
/**
 * The build. On Vercel's production build (a merge to main), when the project holds the live backend's
 * deploy key, the Convex backend is deployed in the same step as the site: `npx convex deploy` pushes the
 * functions and schema, then runs `next build` against that backend. A backend change that fails its
 * type check or schema check fails the build, so nothing half-ships.
 *
 * Everywhere else (preview builds, local builds, CI, or production without the key) it is the plain
 * `next build` it always was. A preview never deploys a backend, even if the key is visible to it,
 * because only `main` may change what the live site runs on. See docs/foundation/06-deployments.md.
 */
import { spawnSync } from "node:child_process";

/** The live backend. Keep convex/lib/environment.ts's copy the same (convex/environment.test.ts checks). */
const PRODUCTION_DEPLOYMENTS = ["terrific-avocet-835"];

const production = process.env.VERCEL_ENV === "production";
const key = process.env.CONVEX_DEPLOY_KEY?.trim();

const run = (command, args) => {
  const result = spawnSync(command, args, { stdio: "inherit", env: process.env });
  process.exit(result.status ?? 1);
};

/**
 * A preview must never read or write the live record. Vercel gives previews the production backend address
 * unless its Preview setting says otherwise, so a preview built against the live backend is built with no
 * backend at all: its signed-in and link pages say Selestial isn't available, and nothing reaches real data.
 * Point Preview's NEXT_PUBLIC_CONVEX_URL at the test backend to get working previews.
 */
const backend = /^https?:\/\/([a-z0-9-]+)\.convex\.cloud\/?$/i.exec(process.env.NEXT_PUBLIC_CONVEX_URL?.trim() ?? "");
if (process.env.VERCEL_ENV === "preview" && backend && PRODUCTION_DEPLOYMENTS.includes(backend[1].toLowerCase())) {
  console.log("Preview build: NEXT_PUBLIC_CONVEX_URL is the live backend, so it is left out. This preview shows no live data.");
  delete process.env.NEXT_PUBLIC_CONVEX_URL;
  delete process.env.NEXT_PUBLIC_CONVEX_SITE_URL;
}

if (production && key) {
  console.log("Production build: deploying the Convex backend, then building the site against it.");
  run("npx", ["convex", "deploy", "--cmd", "next build", "--cmd-url-env-var-name", "NEXT_PUBLIC_CONVEX_URL"]);
} else {
  if (production) console.log("Production build without CONVEX_DEPLOY_KEY: building the site only. The backend is not deployed.");
  else if (key) console.log(`Not a production build (${process.env.VERCEL_ENV ?? "local"}): the backend is not deployed.`);
  run("npx", ["next", "build"]);
}
