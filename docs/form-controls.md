# Form controls

The small interactions beyond choosing: confirmations, lists, numbers, schedules, writing, contact
details, disclosures, files and save feedback. They live in `@/components/ui/fields` and build on the
selection system (`@/components/ui/selection`, see `selection-system.md`), which already holds the
shared field assistance: `FieldSource`, `FieldSuggestion`, `Consequence`, `Requirement` and `SwitchRow`
with its "Takes effect after you save" line. Staff can see every field and state at `/staff/fields`.

## What each field answers

| Question | Where it is answered |
|---|---|
| What belongs here? | Field label and hint; units inside numeric fields; placeholders that show the format |
| Does Selestial already know it? | `FieldSource` (From your onboarding, Imported from …, Found on your website, Confirmed by you) |
| Is there a useful suggestion, and why? | `FieldSuggestion` (source, reason, Apply, Why this?, Dismiss, stale state); `ListInput` suggestions from the service catalog |
| Who can see this? | `AssistedTextArea` audience line, written from the field's real rule |
| What happens when I save? | `Consequence` from current form values; "In use now: … Takes effect after you save." on changed Dispatch rules |
| What needs attention? | `Requirement`, `AvailabilityStatus`, inline field problems, the save bar |

## Inventory

| Area | Before | Now | Kind of change |
|---|---|---|---|
| Confirmations | 8 `window.confirm` calls | `useConfirm` / `ConfirmDialog` on Base UI AlertDialog: specific title, consequence, record details, named actions, loading and failure in the dialog, retry only when safe | Cosmetic and behavioural; same server calls |
| Leaving with unsaved edits | `window.confirm` on link clicks | Branded "Leave without saving?" naming what is lost; continues to the chosen link. Tab close and reload keep the browser's own warning | Behavioural, client only |
| Lists | Comma-separated text (skills, service areas, preferred areas, requirement services, alert percents, question choices, price-zone ZIP codes) | `ListInput`: chips, suggestions, Enter or comma to add, paste a list, duplicate refused with a reason, ZIP codes kept as five-digit text | Client only; stored arrays unchanged |
| Money, percent, duration, counts | Numeric text inputs | `MoneyField` (uses `centsFrom`), `PercentField`, `DurationField` (reads back as hours), `CountField`, `NumberField`: unit in the field, stepper and arrow keys, blank stays blank, precision checked, no formatting while typing | Client only; same strings reach the same validation |
| Scheduling | Separate date/time inputs, timezone in a sentence | `ScheduleSummary` (day, range, length, company zone, arrival window, deadline, past midnight, clock change), `TimezoneNote`, `AvailabilityStatus` (not checked, checking, available when checked, conflict, could not check) | Client only, reads `jobs.reschedulePreview`; the server still checks on confirm |
| Writing | Plain text areas | `AssistedTextArea`: audience line, explicit actions, proposal shown before anything changes, Apply / Keep original / Undo, edits during preparation protected, changed numbers or prices flagged | Client only for templates; see dependencies |
| Contact | Text inputs with `type` | `PhoneInput`, `EmailInput` (keyboard, autocomplete, format on leaving, plain-language errors), `ContactStatus` keeping format, verification, consent and texting readiness apart | Client only |
| Address | Hint and invalid state copied onto a wrapper | The street input is labelled and described directly; a typed unit survives a suggestion without one; changing city, state or ZIP drops the stale map pin | Client only |
| Disclosures | 50 `<details>` with mixed styling | Shared chevron and focus ring for every `<details>`; `Disclosure` component on Dispatch, texting and import review | Cosmetic |
| Files | Name and row count in a line | `FileDetails`: name, kind, size, the real state, counts, replace / remove / try again | Cosmetic; no simulated progress, no drag-and-drop wording |
| Save feedback | Unsaved, saving, saved, error, stale | Adds "Not saved. Your changes are still here." and "Newer changes are available." to the status line; the general error names a lost connection and never nudges a retry | Cosmetic |

## Reference screens

Cleaner details, visit editing and moving, Dispatch rules, and service import review were done first;
the same fields then went across clients, properties, client services, new-visit forms, finance, team
pay, agent spending limits, retention, sales playbook, billing controls, compliance, agreements,
subcontractors, booking rules and the onboarding importers.

## Intentional exceptions

- **Numeric inputs whose handler transforms the value** (booking rules scheduling numbers and deposits,
  sales playbook settings, booking inspector limits, verification codes, area codes, EIN): their own
  parsing decides blank versus zero today, so they were not rewritten mechanically.
- **Public pay page amounts and tip**: customer-facing payment entry with its own styling; unchanged.
- **Public booking inputs** (`bk-input`): customer-branded; they keep their look and pick up the
  customer's accent through `--sel-accent`.
- **Texting setup business fields**: commit on leaving the field and format phone numbers their own
  way for carrier registration.
- **Compliance SMS number**: may be entered in +1 international format, so it is not reformatted.
- **Internal notes** stay plain text areas: there is nothing to organize and no audience to explain
  beyond the existing hint.

## Dependencies on new backend capability

- **AI writing actions** ("Improve wording", "Shorten", "Draft from confirmed business information").
  There is no server action for general text rewriting today. `AssistedTextArea` accepts
  `kind: "ai"` actions and already shows a proposal, loading, failure, Apply, Keep original and Undo,
  but no AI action is wired: one needs a Convex action that goes through the AI registry, usage
  recording and credit limits, sends only the field's text (no secrets or personal details), and
  returns a proposal. Only template actions ("Organize into steps", "Use service checklist") run now.
- **"Ready to text" on a contact**: `ContactStatus` shows it only when given recorded consent and texting
  readiness together; screens that do not have both from the server do not show it.
