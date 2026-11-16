# Agreements

The company's own agreements: customer and service documents, workforce documents, reusable supporting
documents and business relationships. They live under **Company → Agreements** (`/app/agreements`).
Selestial's own Terms and the company's acceptance of them are a different thing and stay under
**Settings → Selestial Terms & Agreements** (`convex/agreements.ts`).

## What was reused, and what was added

| Reused | How |
|---|---|
| Company Chat (`docs/chat`) | Chat gets agreement tools (`convex/lib/chat/agreementTools.ts`) that call the same functions the workspace uses. An agreement started in Chat is the same record in Agreements (`agreements.conversationId`); a card in the thread opens it. `chatArtifacts` stays for other drafts. |
| Builders, roles, events, tasks | Every public function is a `companyQuery` / `companyMutation`; consequential tools are `confirm` tools bound to a preview hash; renewal reminders are ordinary tasks. |
| Signature provider idea (`lib/recruiter/signature.ts`) | Extended into `lib/agreements/signing.ts` (create, withdraw, remind, fetch signed, verified webhook). Hiring offers keep their own simpler adapter. Both are chosen with `SIGNATURE_PROVIDER`. |
| `companies.plan` | The one plan record (set by Selestial staff). There is no subscription, metering or billing system behind it. |
| Compliance profile | Prefills the legal name, signer and state. |

Added: `convex/lib/agreements/*` (catalog, clauses, variables, compose, intake, legal, access, store, signing,
signingStore, templates, upload, pdf, hash, diff, views, agents), `convex/companyAgreements.ts`,
`agreementTemplates.ts`, `agreementFiles.ts`, `agreementSigning.ts`, `agreementRenewals.ts`, the
`/webhooks/signature` route, three crons, eight tables, and the UI under `src/components/app/agreements`.

## Tables

`agreements` (state, lifecycle, terms, copied clause kit, parties), `agreementVersions` (immutable, hashed),
`agreementLinks` (record lookups), `agreementComments`, `agreementTemplates` + `agreementTemplateVersions`,
`agreementFiles` (originals), `agreementSignatureRequests`, `agreementProviderEvents` (idempotency). All but
the last carry `companyId`; all are in the company export (`lib/trust/exportTables.ts`).

## Four things kept apart

1. **Drafting.** A version is never edited. An answer or an edit saves the next version; `baseVersion` must match.
2. **Workflow.** draft → needs review → approved → sent → partially signed → signed, plus declined, withdrawn, expired, delivery failed. Approval names a version and its hash and is cleared by any new version. A document out for signature or signed cannot be edited; a change is an amendment or replacement (a new agreement pointing back).
3. **Lifecycle.** Effective date, term, renewal decision date, expiry, termination, supersession. `signed` with a future `effectiveOn` is "starts later". A renewal date opens a task; it never renews anything.
4. **Provenance.** `unsigned`, `provider_signed` (the signing service reported every signer), `externally_signed` (a named person verified an uploaded signed copy; Selestial collected nothing).

## Text comes from clauses, facts come from people

`lib/agreements/clauses.ts` is the shared clause library; a document type is a list of clause keys. The
model never writes legal text: it supplies facts through `record_agreement_answers`, which the validators
check (`compose.validate`). A fact nobody gave renders as `[[TO CONFIRM: …]]`. Approval needs every
required answer; sending also needs zero `TO CONFIRM` items, so text that needs a lawyer
(employment terms, background-check disclosure, separation, data terms) cannot go out unedited. A copy of
the clauses is stored on the agreement, so editing a template or the library never changes an existing one.
Hand-edited text is protected: an answer that would rewrite it is held and the clauses it touches are listed.

## Access (`lib/agreements/access.ts`)

| Class | Documents | Office | Manager | Owner |
|---|---|---|---|---|
| company | customer, supporting, scope/authorization/notice types | read, draft | read, draft, approve, send | all |
| workforce | confidentiality, handbook, equipment, keys, safety acknowledgments; vendor and partner agreements | none | read, draft, approve, send | all |
| restricted | contractor, subcontractor, employee offer, employment, compensation change, background-check, separation | none | none | all |

The class is checked on get, list, search (a separate search filter per class), record panels, export, compare,
comments, signing and every Chat tool. A document you may not read is "Not found.", and nothing counts or hints at
hidden ones. Seeing a cleaner's schedule grants nothing. Audit events record actions and small facts, never the
document or a comment.

## Plans

Both: library, standard templates, guided drafting, version history, basic approval, signing as implemented.
Scale only (server-checked): second-approver routing. Template governance across locations and the customer
portal are not built, so they are unavailable on every plan. No usage limits or signature charges exist.

## Signing

`SIGNATURE_PROVIDER` unset: not connected. Drafting, approval, PDF export (client-side, from the exact version)
and uploading an externally signed copy all work. `mock` is a test double only. **No production adapter is
built.** To add one: implement `SigningProvider` (`createRequest`, `withdraw`, `remind`, `fetchSigned`), name it
in `signingProvider()`, set `SIGNATURE_WEBHOOK_SECRET` and point the provider's callbacks at
`POST <convex site>/webhooks/signature` with `x-selestial-signature: sha256=HMAC(body)` and a JSON event
`{eventId, requestId, type, signerEmail?, at}`. Reports are verified, applied once per event id, ignored after the
request ends, and "completed" never overrides a missing signer. Reminders are limited to one a day.

## Uploads

`register` keeps the file; a scheduled action reads its first bytes (so a file that is not what it claims is
removed), extracts plain text only, and suggests a type; a person files it as an agreement or a supporting record
(insurance, license, official forms are never generated). PDF and Word are kept but not read. No malware scanning.
Unfiled uploads are removed after a day.

## Agents

Reads only, and only where they exist: `agreement_terms_for_customer` (scope, access, schedule, cancellation and
corrective terms for Dispatch and Quality; documentation-photo and advertising permission as two separate answers
for Marketing), `worker_document_status` (Team Coordinator), `create_agreement_amendment` and the renewal task
(Retention), `start_agreement` for customer documents (Sales) and permitted workforce documents (Recruiter),
`read_agreement` and `list_agreements` (Customer Care). A clause is never an operating rule: changing a price,
schedule or onboarding setting is its own validated action. Marketing, Quality, Customer Care and Team Coordinator
are not built, so Chat performs these reads for a person today.

## Operational vs external

| Works now | Needs outside setup |
|---|---|
| Library, search, filters, overview, templates, versions, comparison, comments, approval (incl. Scale second approver), PDF export, uploads, supporting records, amendments, lifecycle and renewal reminders, Chat intake and revision, access control, audit, export | An e-signature provider adapter and its credentials; any signing at all. A live model key (`ANTHROPIC_API_KEY`) for Chat's wording (not exercised against the live API). Subscription billing. Customer portal. Counsel to review any template you rely on. |
