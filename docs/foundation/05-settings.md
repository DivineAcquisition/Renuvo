# Settings

Settings is a routed workspace under `/app/settings`. The section catalog is `src/lib/app/settings.ts`;
the navigation catalog derives its settings destinations from it. The layout gives a searchable,
responsive secondary navigation. Old `#security` and `#agents` links redirect to their pages.

| Section | Source of truth |
| --- | --- |
| Business & hours | `companies.name`, `timezone`, optional `businessSettings` (areas, hours) |
| (moved) Services & pricing | Company › Services & Pricing since November 16, 2026 (`docs/services/00-architecture.md`). `/app/settings/services` redirects there. `businessSettings.services` is copied once into the new catalog and then kept only as a record |
| People & access | `members`, `invitations` (Owner changes roles and removes access) |
| Agent permissions | `permissions`, `companies.pausedAgents`; four later agents shown as unavailable |
| Dispatch rules | `companies.dispatch`, `companies.dispatchPolicy` |
| Recruiting rules | `companies.recruiter` (`recruiter.updatePlaybook` refuses invalid ranges, duplicate reminders, empty requirement sets) |
| Connections | Deployment configuration only. No credentials, no live health check |
| Plan & billing | Owner-only catalog ($299 Growth, $499 Scale). No plan, charge or entitlement |
| Account security, Trust & compliance, Agreements | Existing screens, on their own routes |
| Activity log | Owner-only, paginated `events`, in words, no message bodies |

## Persistence

`companies.businessSettings`, `companies.settingsRevision` and `jobs.serviceSnapshot` are optional; no
backfill is needed. `settings.saveBusiness` is Owner-only: it validates the whole draft, checks
`expectedRevision`, writes and appends an event in one transaction. An unchanged normalized draft writes
nothing. A saved service can be archived, never removed. Deploy the Convex functions before the frontend.

## Rules

- Hours are appointment windows, not cleaner availability or quiet hours. Empty hours or areas mean no
  company-wide restriction. A visit must fit one window; overnight is not supported.
- Areas and hours are enforced when a visit is created or rescheduled. Existing visits are never moved.
- Services and prices live in Services & Pricing, with one pricing engine and a reviewed change workflow. Archived services are refused for new visits.
- The unsaved draft survives moving between Settings pages and warns on leaving Settings or unloading.
  Browser history navigation is not blocked. Other settings keep their existing, unversioned APIs.
- `convex/_generated/api.d.ts` was extended by hand (codegen needs a deployment). Regenerate it against
  the development deployment before publishing the backend.
