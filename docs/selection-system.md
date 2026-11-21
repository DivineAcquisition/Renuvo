# Selection system

Every way a person chooses something in Selestial goes through `@/components/ui/selection`. One look, one behaviour, one set of rules for agent help. Staff can see every control and state at `/staff/selection`.

## Which control

| Use | Component |
|---|---|
| Short, predefined single choice | `Select` |
| One record from a long list (customers, properties, cleaners, templates) | `SearchableSelect` |
| Several choices with search, chips, count, clear-all, limit | `MultiSelect` |
| Acknowledgment, simple preference, table row | `Checkbox` |
| Choice with a title and explanation | `CheckboxRow` |
| Important single or multiple decision | `SelectionCards` (`type="single"` is a radio group, `type="multiple"` checkboxes) |
| Mutually exclusive rows | `RadioGroup` |
| A few short alternatives kept in view | `SegmentedControl` |
| A few short independent choices | `ChoiceChips` |
| A continuing behaviour, on or off | `SwitchRow` with `effect="immediate"` or `effect="on-save"` |
| Where a value came from / what an agent proposes / what a choice does | `FieldSource`, `FieldSuggestion`, `Consequence`, `Requirement` |
| Table "this page" vs "all matching" | `tableSelection()` |

Action menus (Edit, Delete) are not selections and keep Menu semantics.

## Look

Accent comes from `--sel-accent`, falling back to Selestial Violet. Selected surfaces are a soft violet tint on white cards (light) or on the card colour (dark), and always carry a mark (tick, dot, dash) so state never rests on colour. Heights use `--spacing-control-md` (default) and `--spacing-control-sm` (compact, for tables and filter bars). Transitions are 150ms and off under reduced motion. No shimmer, animated borders or AI badges on ordinary fields.

Public pages keep the customer's branding: the booking theme sets `--sel-accent` to the customer's brand colour.

## Agent assistance

- Show a source only when the data has one: `agent` (names the agent, "Suggested by Dispatch"), `onboarding`, `import`, `website`, `needs-confirmation`, `confirmed`.
- A suggestion is kept apart from the current value. `Apply` puts it in the form's draft exactly as typing would; the form's own save decides when it is stored. It is never permission and never sends anything.
- An async suggestion never overwrites an owner's edit; it stays an offer. Pass `basedOn` and `inputs` to `useSuggestion`: when they differ the suggestion is stale and can't be applied until refreshed.
- Don't add a recommendation backend to decorate a field. Use the sources the screen already has.
- Searching or opening a field never calls a paid model. `onSearchChange` is for ordinary index queries.

## Consent, authority and saving

- Consent and purchase acknowledgments start unticked. A suggestion is not consent.
- Unset, false and empty stay distinct. `Select` with `emptyLabel` returns `null` for "not answered"; callers remove the answer rather than storing `false`.
- Stored option identifiers never change. Labels and descriptions are display only.
- A switch says when it applies. Explicit-save forms use `effect="on-save"`; nothing became autosave.
- Agent authority choices (Ask me first, Act and notify me, Act automatically) keep their order and ceiling; no level is recommended.
- Consequence lines are written from the real setting and say only what the backend does.

## Accessibility

`Field` connects its label, hint and error to the focusable element. A native control is wrapped in the label as before. A composite control (`Select`, `SearchableSelect`, `MultiSelect`, `RadioGroup`, `SelectionCards`) reads the ids from context and names its own trigger, input or group, since copying aria props onto a non-focusable wrapper leaves the control unnamed. `Field` also takes `aside` for a source chip or suggestion that has its own buttons and must not sit inside the label.

## Audit and migration status

Generated from the code at the time of this change. Counts are occurrences of each pattern in the file.

**Base UI:** `@base-ui/react` 1.7.0 (package-lock). The shared system uses its Select, Combobox, Checkbox, Radio and RadioGroup primitives. The switch stays a native `button role="switch"` and SegmentedControl stays native radios: both already have correct keyboard and form behaviour, and tests rely on their markup.

**Value contracts:** native `SelectInput` handlers read `event.target.value`; shared components call `onValueChange(value)`. Every migration below was rewritten by hand against its own handler. Nothing was search-and-replaced.

| File | select | checkbox | radio | switch | aria-pressed | Status |
|---|---|---|---|---|---|---|
| `app/activation/home.tsx` |  |  | 1 |  |  | Native controls, shared accent applied by CSS. Candidate for CheckboxRow/RadioGroup/SwitchRow in a follow-up. |
| `app/agreements/document.tsx` |  |  |  |  | 1 | Native controls, shared accent applied by CSS. Candidate for CheckboxRow/RadioGroup/SwitchRow in a follow-up. |
| `app/agreements/library.tsx` | 5 |  |  |  |  | Native SelectInput, restyled by the shared chevron/height. Candidate for Select/SearchableSelect in a follow-up. |
| `app/agreements/new.tsx` | 9 | 1 |  |  |  | Native controls, shared accent applied by CSS. Candidate for CheckboxRow/RadioGroup/SwitchRow in a follow-up. |
| `app/agreements/question.tsx` | 2 |  |  |  |  | Native SelectInput, restyled by the shared chevron/height. Candidate for Select/SearchableSelect in a follow-up. |
| `app/agreements/review.tsx` |  | 2 |  |  |  | Native controls, shared accent applied by CSS. Candidate for CheckboxRow/RadioGroup/SwitchRow in a follow-up. |
| `app/agreements/templates.tsx` | 3 |  |  |  |  | Native SelectInput, restyled by the shared chevron/height. Candidate for Select/SearchableSelect in a follow-up. |
| `app/agreements/terms.tsx` | 3 | 1 |  |  |  | Native controls, shared accent applied by CSS. Candidate for CheckboxRow/RadioGroup/SwitchRow in a follow-up. |
| `app/billing/ai-features.tsx` |  |  |  | 1 |  | Native controls, shared accent applied by CSS. Candidate for CheckboxRow/RadioGroup/SwitchRow in a follow-up. |
| `app/billing/messaging.tsx` | 1 | 1 |  |  |  | Native controls, shared accent applied by CSS. Candidate for CheckboxRow/RadioGroup/SwitchRow in a follow-up. |
| `app/billing/usage.tsx` | 5 | 2 |  |  | 3 | Retained native: the top-up authorization checkbox must start unticked and is asserted by tests; shared accent applies. |
| `app/booking/builder.tsx` |  | 1 | 1 |  | 1 | Native controls, shared accent applied by CSS. Candidate for CheckboxRow/RadioGroup/SwitchRow in a follow-up. |
| `app/booking/home.tsx` |  | 1 |  |  |  | Native controls, shared accent applied by CSS. Candidate for CheckboxRow/RadioGroup/SwitchRow in a follow-up. |
| `app/booking/inspector.tsx` | 8 | 1 |  | 11 | 1 | Native controls, shared accent applied by CSS. Candidate for CheckboxRow/RadioGroup/SwitchRow in a follow-up. |
| `app/booking/rules.tsx` |  |  |  |  |  | Migrated: Select (payment kind with descriptions, template, standing answers). Fixed: clearing a yes/no answer stored "No"; it now removes the answer. Consequence line per payment policy. |
| `app/chat/workspace.tsx` | 2 |  |  |  |  | Native SelectInput, restyled by the shared chevron/height. Candidate for Select/SearchableSelect in a follow-up. |
| `app/cleaners/add.tsx` | 1 |  | 1 |  | 1 | Native controls, shared accent applied by CSS. Candidate for CheckboxRow/RadioGroup/SwitchRow in a follow-up. |
| `app/cleaners/availability-edit.tsx` |  | 1 | 1 |  |  | Native controls, shared accent applied by CSS. Candidate for CheckboxRow/RadioGroup/SwitchRow in a follow-up. |
| `app/cleaners/crews.tsx` | 2 | 2 | 1 |  | 1 | Native controls, shared accent applied by CSS. Candidate for CheckboxRow/RadioGroup/SwitchRow in a follow-up. |
| `app/cleaners/directory.tsx` | 1 |  |  |  | 2 | Native SelectInput, restyled by the shared chevron/height. Candidate for Select/SearchableSelect in a follow-up. |
| `app/cleaners/import.tsx` | 1 |  |  |  | 2 | Native SelectInput, restyled by the shared chevron/height. Candidate for Select/SearchableSelect in a follow-up. |
| `app/cleaners/onboarding-review.tsx` |  | 1 |  |  |  | Native controls, shared accent applied by CSS. Candidate for CheckboxRow/RadioGroup/SwitchRow in a follow-up. |
| `app/cleaners/performance.tsx` | 2 |  |  |  |  | Native SelectInput, restyled by the shared chevron/height. Candidate for Select/SearchableSelect in a follow-up. |
| `app/cleaners/profile.tsx` | 1 | 1 |  |  |  | Native controls, shared accent applied by CSS. Candidate for CheckboxRow/RadioGroup/SwitchRow in a follow-up. |
| `app/cleaners/template.tsx` | 4 | 2 |  |  |  | Native controls, shared accent applied by CSS. Candidate for CheckboxRow/RadioGroup/SwitchRow in a follow-up. |
| `app/clients/add-client.tsx` | 3 | 1 | 1 |  |  | Native controls, shared accent applied by CSS. Candidate for CheckboxRow/RadioGroup/SwitchRow in a follow-up. |
| `app/clients/conversations.tsx` | 3 | 1 | 1 |  | 1 | Native controls, shared accent applied by CSS. Candidate for CheckboxRow/RadioGroup/SwitchRow in a follow-up. |
| `app/clients/directory.tsx` | 4 | 3 | 1 |  | 3 | Native controls, shared accent applied by CSS. Candidate for CheckboxRow/RadioGroup/SwitchRow in a follow-up. |
| `app/clients/edit.tsx` | 4 | 2 | 1 |  |  | Native controls, shared accent applied by CSS. Candidate for CheckboxRow/RadioGroup/SwitchRow in a follow-up. |
| `app/clients/menu.tsx` |  |  |  |  |  | Not a selection: action menu, keeps Menu semantics. |
| `app/clients/profile.tsx` | 1 |  |  |  |  | Native SelectInput, restyled by the shared chevron/height. Candidate for Select/SearchableSelect in a follow-up. |
| `app/clients/properties.tsx` | 2 | 2 |  |  |  | Native controls, shared accent applied by CSS. Candidate for CheckboxRow/RadioGroup/SwitchRow in a follow-up. |
| `app/clients/services.tsx` | 6 | 1 | 1 |  | 1 | Native controls, shared accent applied by CSS. Candidate for CheckboxRow/RadioGroup/SwitchRow in a follow-up. |
| `app/coming-soon/agent-page.tsx` |  | 1 |  |  |  | Native controls, shared accent applied by CSS. Candidate for CheckboxRow/RadioGroup/SwitchRow in a follow-up. |
| `app/creative/studio.tsx` | 10 | 1 | 1 |  |  | Native controls, shared accent applied by CSS. Candidate for CheckboxRow/RadioGroup/SwitchRow in a follow-up. |
| `app/detail-actions.tsx` | 1 |  |  |  |  | Native SelectInput, restyled by the shared chevron/height. Candidate for Select/SearchableSelect in a follow-up. |
| `app/finance/actions.tsx` | 1 | 2 | 2 |  |  | Native controls, shared accent applied by CSS. Candidate for CheckboxRow/RadioGroup/SwitchRow in a follow-up. |
| `app/finance/expenses.tsx` | 11 | 4 | 1 |  |  | Native controls, shared accent applied by CSS. Candidate for CheckboxRow/RadioGroup/SwitchRow in a follow-up. |
| `app/finance/invoice-sheet.tsx` |  | 2 |  |  |  | Native controls, shared accent applied by CSS. Candidate for CheckboxRow/RadioGroup/SwitchRow in a follow-up. |
| `app/finance/invoices.tsx` |  |  | 1 |  |  | Native controls, shared accent applied by CSS. Candidate for CheckboxRow/RadioGroup/SwitchRow in a follow-up. |
| `app/finance/messages.tsx` | 1 |  |  |  |  | Native SelectInput, restyled by the shared chevron/height. Candidate for Select/SearchableSelect in a follow-up. |
| `app/finance/new-invoice.tsx` | 1 |  | 1 |  |  | Native controls, shared accent applied by CSS. Candidate for CheckboxRow/RadioGroup/SwitchRow in a follow-up. |
| `app/finance/overview.tsx` | 1 |  |  |  |  | Native SelectInput, restyled by the shared chevron/height. Candidate for Select/SearchableSelect in a follow-up. |
| `app/finance/setup.tsx` | 1 | 4 |  |  |  | Native controls, shared accent applied by CSS. Candidate for CheckboxRow/RadioGroup/SwitchRow in a follow-up. |
| `app/finance/team-pay.tsx` | 2 | 4 | 4 |  |  | Native controls, shared accent applied by CSS. Candidate for CheckboxRow/RadioGroup/SwitchRow in a follow-up. |
| `app/form.tsx` | 1 |  |  |  |  | Native SelectInput, restyled by the shared chevron/height. Candidate for Select/SearchableSelect in a follow-up. |
| `app/gate.tsx` |  | 1 |  |  |  | Native controls, shared accent applied by CSS. Candidate for CheckboxRow/RadioGroup/SwitchRow in a follow-up. |
| `app/integrations/google-tool.tsx` | 2 | 2 |  |  |  | Native controls, shared accent applied by CSS. Candidate for CheckboxRow/RadioGroup/SwitchRow in a follow-up. |
| `app/integrations/inboxes.tsx` |  | 2 |  |  | 1 | Native controls, shared accent applied by CSS. Candidate for CheckboxRow/RadioGroup/SwitchRow in a follow-up. |
| `app/sales/cadence-picker.tsx` | 3 |  | 1 |  | 1 | Native controls, shared accent applied by CSS. Candidate for CheckboxRow/RadioGroup/SwitchRow in a follow-up. |
| `app/sales/customer-section.tsx` |  |  | 1 |  |  | Native controls, shared accent applied by CSS. Candidate for CheckboxRow/RadioGroup/SwitchRow in a follow-up. |
| `app/sales/kit.tsx` |  |  | 1 |  |  | Restyled: ChoiceCard keeps its native radio, uses shared tokens. |
| `app/sales/payment-section.tsx` | 1 | 1 |  |  |  | Native controls, shared accent applied by CSS. Candidate for CheckboxRow/RadioGroup/SwitchRow in a follow-up. |
| `app/sales/pipeline-screen.tsx` | 2 |  |  |  |  | Native SelectInput, restyled by the shared chevron/height. Candidate for Select/SearchableSelect in a follow-up. |
| `app/sales/proposal-sections.tsx` | 6 | 2 | 1 |  |  | Native controls, shared accent applied by CSS. Candidate for CheckboxRow/RadioGroup/SwitchRow in a follow-up. |
| `app/sales/schedule-section.tsx` | 3 | 1 |  |  |  | Native controls, shared accent applied by CSS. Candidate for CheckboxRow/RadioGroup/SwitchRow in a follow-up. |
| `app/sales/workspace.tsx` | 1 |  |  |  |  | Migrated: local Segmented replaced by SegmentedControl. |
| `app/screens/agent-permissions.tsx` |  |  |  |  |  | Migrated: Select with each level's meaning; visible "applies as soon as you choose" note. Order unchanged, no level recommended. |
| `app/screens/compliance.tsx` | 5 | 3 |  |  |  | Native controls, shared accent applied by CSS. Candidate for CheckboxRow/RadioGroup/SwitchRow in a follow-up. |
| `app/screens/dispatch/playbook.tsx` | 1 | 2 |  |  |  | Native controls, shared accent applied by CSS. Candidate for CheckboxRow/RadioGroup/SwitchRow in a follow-up. |
| `app/screens/dispatch/shared.tsx` | 1 |  |  |  |  | Native SelectInput, restyled by the shared chevron/height. Candidate for Select/SearchableSelect in a follow-up. |
| `app/screens/forms.tsx` | 7 | 1 |  |  | 1 | Native controls, shared accent applied by CSS. Candidate for CheckboxRow/RadioGroup/SwitchRow in a follow-up. |
| `app/screens/integrations.tsx` |  |  |  |  | 1 | Native controls, shared accent applied by CSS. Candidate for CheckboxRow/RadioGroup/SwitchRow in a follow-up. |
| `app/screens/misc.tsx` | 1 |  |  |  |  | Native SelectInput, restyled by the shared chevron/height. Candidate for Select/SearchableSelect in a follow-up. |
| `app/screens/recruiter/applicants.tsx` | 2 |  |  |  |  | Native SelectInput, restyled by the shared chevron/height. Candidate for Select/SearchableSelect in a follow-up. |
| `app/screens/recruiter/hiring-needs.tsx` | 2 |  |  |  |  | Native SelectInput, restyled by the shared chevron/height. Candidate for Select/SearchableSelect in a follow-up. |
| `app/screens/recruiter/interviews.tsx` | 2 |  |  |  |  | Native SelectInput, restyled by the shared chevron/height. Candidate for Select/SearchableSelect in a follow-up. |
| `app/screens/recruiter/offers.tsx` |  | 1 |  |  |  | Native controls, shared accent applied by CSS. Candidate for CheckboxRow/RadioGroup/SwitchRow in a follow-up. |
| `app/screens/recruiter/screening.tsx` | 1 |  |  |  |  | Native SelectInput, restyled by the shared chevron/height. Candidate for Select/SearchableSelect in a follow-up. |
| `app/screens/recruiter/shared.tsx` |  |  |  |  | 1 | Native controls, shared accent applied by CSS. Candidate for CheckboxRow/RadioGroup/SwitchRow in a follow-up. |
| `app/screens/retention/continuity.tsx` | 1 |  |  |  |  | Native SelectInput, restyled by the shared chevron/height. Candidate for Select/SearchableSelect in a follow-up. |
| `app/screens/retention/drawer.tsx` | 5 | 1 |  |  |  | Native controls, shared accent applied by CSS. Candidate for CheckboxRow/RadioGroup/SwitchRow in a follow-up. |
| `app/screens/retention/playbook.tsx` |  | 3 |  |  |  | Native controls, shared accent applied by CSS. Candidate for CheckboxRow/RadioGroup/SwitchRow in a follow-up. |
| `app/screens/retention/recovery.tsx` | 3 | 1 |  |  |  | Native controls, shared accent applied by CSS. Candidate for CheckboxRow/RadioGroup/SwitchRow in a follow-up. |
| `app/screens/sales-agent/conversations.tsx` |  |  |  |  | 1 | Native controls, shared accent applied by CSS. Candidate for CheckboxRow/RadioGroup/SwitchRow in a follow-up. |
| `app/screens/sales-agent/drawer.tsx` | 7 |  |  |  | 2 | Native SelectInput, restyled by the shared chevron/height. Candidate for Select/SearchableSelect in a follow-up. |
| `app/screens/sales-agent/import-prospects.tsx` | 1 |  |  |  |  | Native SelectInput, restyled by the shared chevron/height. Candidate for Select/SearchableSelect in a follow-up. |
| `app/screens/sales-agent/new-inquiry.tsx` | 4 |  |  |  |  | Native SelectInput, restyled by the shared chevron/height. Candidate for Select/SearchableSelect in a follow-up. |
| `app/screens/sales-agent/playbook.tsx` | 1 | 4 | 1 |  |  | Native controls, shared accent applied by CSS. Candidate for CheckboxRow/RadioGroup/SwitchRow in a follow-up. |
| `app/screens/sales-agent/review.tsx` |  |  |  |  | 1 | Native controls, shared accent applied by CSS. Candidate for CheckboxRow/RadioGroup/SwitchRow in a follow-up. |
| `app/services/builder.tsx` |  |  |  | 4 |  | Native controls, shared accent applied by CSS. Candidate for CheckboxRow/RadioGroup/SwitchRow in a follow-up. |
| `app/services/imports.tsx` | 2 |  |  |  |  | Native SelectInput, restyled by the shared chevron/height. Candidate for Select/SearchableSelect in a follow-up. |
| `app/services/new.tsx` |  |  | 3 |  |  | Native controls, shared accent applied by CSS. Candidate for CheckboxRow/RadioGroup/SwitchRow in a follow-up. |
| `app/services/preview.tsx` | 3 | 1 |  |  |  | Native controls, shared accent applied by CSS. Candidate for CheckboxRow/RadioGroup/SwitchRow in a follow-up. |
| `app/services/property-prices.tsx` | 4 |  |  |  |  | Native SelectInput, restyled by the shared chevron/height. Candidate for Select/SearchableSelect in a follow-up. |
| `app/services/research.tsx` | 2 | 1 |  |  |  | Native controls, shared accent applied by CSS. Candidate for CheckboxRow/RadioGroup/SwitchRow in a follow-up. |
| `app/services/setup.tsx` |  | 3 |  | 1 |  | Native controls, shared accent applied by CSS. Candidate for CheckboxRow/RadioGroup/SwitchRow in a follow-up. |
| `app/services/shared.tsx` |  |  |  |  |  | Migrated: SwitchButton, Toggle and Segmented delegate to shared Switch and SegmentedControl, so every Services screen uses them. |
| `app/services/steps.tsx` | 7 | 6 | 1 | 3 |  | Native controls, shared accent applied by CSS. Candidate for CheckboxRow/RadioGroup/SwitchRow in a follow-up. |
| `app/services/studio.tsx` | 2 |  |  |  |  | Native SelectInput, restyled by the shared chevron/height. Candidate for Select/SearchableSelect in a follow-up. |
| `app/settings/business-sections.tsx` | 1 | 1 | 1 |  |  | Retained native for now: tests assert native radio/checkbox markup; restyled through shared CSS. |
| `app/settings/dispatch.tsx` |  |  |  |  |  | Migrated: SwitchRow with on-save timing, consequence from the form values, texting requirement from texting readiness. |
| `app/settings/email-previews.tsx` | 1 |  | 1 | 3 |  | Native controls, shared accent applied by CSS. Candidate for CheckboxRow/RadioGroup/SwitchRow in a follow-up. |
| `app/settings/notification-preferences.tsx` |  |  |  | 1 |  | Native controls, shared accent applied by CSS. Candidate for CheckboxRow/RadioGroup/SwitchRow in a follow-up. |
| `app/settings/people.tsx` | 1 |  |  |  |  | Native SelectInput, restyled by the shared chevron/height. Candidate for Select/SearchableSelect in a follow-up. |
| `app/settings/recruiting.tsx` | 2 | 2 |  |  |  | Native controls, shared accent applied by CSS. Candidate for CheckboxRow/RadioGroup/SwitchRow in a follow-up. |
| `app/settings/support-access.tsx` | 1 |  |  |  |  | Native SelectInput, restyled by the shared chevron/height. Candidate for Select/SearchableSelect in a follow-up. |
| `app/setup/flow.tsx` |  |  |  |  |  | Migrated: SelectionCards (methods, categories, workforce, priority, questions), CheckboxRow + FieldSource (website finds), SearchableSelect (time zone), SegmentedControl (team size), ChoiceChips (tools), FieldSuggestion (website values). |
| `app/setup/import.tsx` | 1 | 1 |  |  |  | Native controls, shared accent applied by CSS. Candidate for CheckboxRow/RadioGroup/SwitchRow in a follow-up. |
| `app/setup/records-import.tsx` | 1 |  |  |  |  | Native SelectInput, restyled by the shared chevron/height. Candidate for Select/SearchableSelect in a follow-up. |
| `app/texting/assistant.tsx` |  | 2 |  |  |  | Native controls, shared accent applied by CSS. Candidate for CheckboxRow/RadioGroup/SwitchRow in a follow-up. |
| `app/texting/parts.tsx` |  |  |  |  |  | Migrated: ChoiceCard and SourceChip now render SelectionCard and FieldSource. |
| `app/texting/step-business.tsx` |  |  |  |  |  | Migrated: SelectionCards (entity type, arrow keys), Select (exchange, industry), FieldSource via SourceChip. |
| `app/texting/step-number.tsx` |  |  |  |  | 1 | Native controls, shared accent applied by CSS. Candidate for CheckboxRow/RadioGroup/SwitchRow in a follow-up. |
| `app/texting/step-review.tsx` |  | 1 |  |  |  | Native controls, shared accent applied by CSS. Candidate for CheckboxRow/RadioGroup/SwitchRow in a follow-up. |
| `app/tutorials/directory.tsx` |  |  |  |  | 1 | Native controls, shared accent applied by CSS. Candidate for CheckboxRow/RadioGroup/SwitchRow in a follow-up. |
| `app/tutorials/offer.tsx` |  |  | 1 |  |  | Native controls, shared accent applied by CSS. Candidate for CheckboxRow/RadioGroup/SwitchRow in a follow-up. |
| `app/tutorials/player.tsx` | 1 |  |  |  | 2 | Native SelectInput, restyled by the shared chevron/height. Candidate for Select/SearchableSelect in a follow-up. |
| `applicant/apply-page.tsx` | 1 | 3 | 1 |  |  | Upgraded in place: yes/no are radios (were aria-pressed), multi chips are checkboxes with a tick, native select gets the shared chevron. data-testid kept. |
| `auth/fields.tsx` |  | 1 |  |  | 1 | Native controls, shared accent applied by CSS. Candidate for CheckboxRow/RadioGroup/SwitchRow in a follow-up. |
| `auth/security.tsx` |  | 1 |  |  |  | Native controls, shared accent applied by CSS. Candidate for CheckboxRow/RadioGroup/SwitchRow in a follow-up. |
| `booking/step-finish.tsx` | 1 | 1 | 1 |  | 1 | Retained native: public agreement/consent checkboxes, customer-branded. |
| `booking/step-service.tsx` |  | 1 |  |  | 8 | Retained native: public add-on checkboxes, customer-branded. |
| `booking/step-start.tsx` |  | 1 | 1 |  | 2 | Retained native: public consent checkbox on the customer's branded page; picks up the customer colour via --sel-accent. |
| `cleaner/contact-portal.tsx` | 1 |  |  |  |  | Native SelectInput, restyled by the shared chevron/height. Candidate for Select/SearchableSelect in a follow-up. |
| `cleaner/portal-page.tsx` |  | 2 | 1 |  |  | Native controls, shared accent applied by CSS. Candidate for CheckboxRow/RadioGroup/SwitchRow in a follow-up. |
| `consent/banner.tsx` |  | 1 |  | 1 |  | Retained: cookie consent, legal wording and behaviour unchanged. |
| `marketing/autonomy-dial.tsx` |  |  | 2 |  |  | Native controls, shared accent applied by CSS. Candidate for CheckboxRow/RadioGroup/SwitchRow in a follow-up. |
| `marketing/early-access-form.tsx` | 1 | 1 | 1 |  |  | Native controls, shared accent applied by CSS. Candidate for CheckboxRow/RadioGroup/SwitchRow in a follow-up. |
| `pay/pay-page.tsx` |  |  | 3 |  |  | Native controls, shared accent applied by CSS. Candidate for CheckboxRow/RadioGroup/SwitchRow in a follow-up. |
| `public/assess-page.tsx` | 2 |  |  |  |  | Native SelectInput, restyled by the shared chevron/height. Candidate for Select/SearchableSelect in a follow-up. |
| `public/care-page.tsx` |  | 2 | 1 |  | 1 | Native controls, shared accent applied by CSS. Candidate for CheckboxRow/RadioGroup/SwitchRow in a follow-up. |
| `public/proposal-document.tsx` |  |  | 2 |  |  | Native controls, shared accent applied by CSS. Candidate for CheckboxRow/RadioGroup/SwitchRow in a follow-up. |
| `public/proposal-page.tsx` |  | 2 | 1 |  |  | Native controls, shared accent applied by CSS. Candidate for CheckboxRow/RadioGroup/SwitchRow in a follow-up. |
| `public/sign-page.tsx` |  | 1 |  |  |  | Native controls, shared accent applied by CSS. Candidate for CheckboxRow/RadioGroup/SwitchRow in a follow-up. |
| `sales/quote-page.tsx` |  |  | 3 |  |  | Native controls, shared accent applied by CSS. Candidate for CheckboxRow/RadioGroup/SwitchRow in a follow-up. |
| `staff/ai-models.tsx` | 1 |  |  | 2 |  | Native controls, shared accent applied by CSS. Candidate for CheckboxRow/RadioGroup/SwitchRow in a follow-up. |
| `staff/console.tsx` | 10 | 1 |  |  |  | Native controls, shared accent applied by CSS. Candidate for CheckboxRow/RadioGroup/SwitchRow in a follow-up. |
| `staff/operations.tsx` | 2 | 1 |  |  |  | Native controls, shared accent applied by CSS. Candidate for CheckboxRow/RadioGroup/SwitchRow in a follow-up. |
| `staff/selection-preview.tsx` |  |  |  |  |  | New: internal preview of every control and state at /staff/selection. |
| `staff/setup-funnel.tsx` |  |  |  |  | 1 | Native controls, shared accent applied by CSS. Candidate for CheckboxRow/RadioGroup/SwitchRow in a follow-up. |
| `staff/tutorials.tsx` | 1 |  |  |  | 1 | Native SelectInput, restyled by the shared chevron/height. Candidate for Select/SearchableSelect in a follow-up. |
| `texting/signup-form.tsx` |  | 2 |  |  |  | Native controls, shared accent applied by CSS. Candidate for CheckboxRow/RadioGroup/SwitchRow in a follow-up. |
| `trust/request-form.tsx` | 1 |  |  |  |  | Native SelectInput, restyled by the shared chevron/height. Candidate for Select/SearchableSelect in a follow-up. |
