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

## Rollout status

Every selection control in the app now draws from the shared system:

- **Dropdowns:** 237 uses. `SelectInput` keeps the native contract (`<option>` children, `event.target.value`) and renders the shared Select, or SearchableSelect past 15 options. Every raw `<select>` goes through it.
- **Checkboxes:** 108 uses of the shared Checkbox / CheckboxRow. Handlers take the checked value.
- **Choice cards:** 23. **Segmented controls:** 50. **Chips:** 11. **Switches:** 32. **Radio groups:** 20 (`RadioButtonGroup` gives custom-styled radio buttons arrow keys, Home/End and one tab stop).

### Kept on purpose

- **Native radios (32):** native `<input type="radio">` groups inside styled labels already have correct semantics, arrow keys, form submission and focus, and take the shared accent through `--sel-accent`.
- **Native select (1):** the marketing early-access form relies on the browser's own required-field validation and FormData.
- **Native checkbox (1):** the early-access SMS consent box, read from FormData on submit.
- **Toggle buttons (19 `aria-pressed`):** actions or view filters, not form values. Show password, mute, captions, full screen, import add/skip, dashboard focus tiles, recruiter pipeline steps, integration cards, booking date and time pickers, texting number picking, the clients view nav and attention filters.
- **Action menus:** keep Menu semantics.

| File | Select | Checkbox | Cards | Segmented | Chips | Switch | Radio group | native radio | native select | native checkbox | toggle button |
|---|---|---|---|---|---|---|---|---|---|---|---|
| `app/activation/home.tsx` |  |  |  |  |  |  | 1 |  |  |  |  |
| `app/agreements/document.tsx` |  |  |  |  |  |  |  |  |  |  | 1 |
| `app/agreements/library.tsx` | 5 |  |  |  |  |  |  |  |  |  |  |
| `app/agreements/new.tsx` | 9 | 1 |  |  |  |  |  |  |  |  |  |
| `app/agreements/question.tsx` | 2 |  |  |  |  |  |  |  |  |  |  |
| `app/agreements/review.tsx` |  | 2 |  |  |  |  |  |  |  |  |  |
| `app/agreements/templates.tsx` | 3 |  |  |  |  |  |  |  |  |  |  |
| `app/agreements/terms.tsx` | 3 | 1 |  |  |  |  |  |  |  |  |  |
| `app/billing/ai-features.tsx` |  |  |  |  |  | 1 |  |  |  |  |  |
| `app/billing/messaging.tsx` | 1 | 1 |  |  |  |  |  |  |  |  |  |
| `app/billing/usage.tsx` | 5 | 2 |  | 3 |  |  |  |  |  |  |  |
| `app/booking/builder.tsx` |  | 1 |  | 1 |  |  | 1 |  |  |  |  |
| `app/booking/home.tsx` |  | 1 |  |  |  |  |  |  |  |  |  |
| `app/booking/inspector.tsx` | 8 | 1 |  | 8 | 1 | 11 |  |  |  |  |  |
| `app/booking/rules.tsx` | 4 |  |  | 1 |  |  |  |  |  |  |  |
| `app/chat/workspace.tsx` | 2 |  |  |  |  |  |  |  |  |  |  |
| `app/cleaners/add.tsx` | 1 |  |  |  | 1 |  |  | 1 |  |  |  |
| `app/cleaners/availability-edit.tsx` |  | 1 |  |  |  |  |  | 1 |  |  |  |
| `app/cleaners/crews.tsx` | 2 | 2 |  |  |  |  |  | 1 |  |  | 1 |
| `app/cleaners/directory.tsx` | 9 |  |  |  |  |  |  |  |  |  | 2 |
| `app/cleaners/import.tsx` | 1 |  |  |  |  |  |  |  |  |  | 2 |
| `app/cleaners/onboarding-review.tsx` |  | 1 |  |  |  |  |  |  |  |  |  |
| `app/cleaners/performance.tsx` | 2 |  |  |  |  |  |  |  |  |  |  |
| `app/cleaners/profile.tsx` | 1 | 1 |  |  |  |  |  |  |  |  |  |
| `app/cleaners/template.tsx` | 4 | 2 |  |  |  |  |  |  |  |  |  |
| `app/clients/add-client.tsx` | 3 | 1 |  |  |  |  |  | 1 |  |  |  |
| `app/clients/conversations.tsx` | 3 | 1 |  | 1 |  |  |  | 1 |  |  |  |
| `app/clients/directory.tsx` | 4 | 3 |  |  |  |  |  | 1 |  |  | 3 |
| `app/clients/edit.tsx` | 4 | 2 |  |  |  |  |  | 1 |  |  |  |
| `app/clients/profile.tsx` | 1 |  |  |  |  |  |  |  |  |  |  |
| `app/clients/properties.tsx` | 2 | 2 |  |  |  |  |  |  |  |  |  |
| `app/clients/services.tsx` | 6 | 1 |  | 1 |  |  |  | 1 |  |  |  |
| `app/coming-soon/agent-page.tsx` |  | 1 |  |  |  |  |  |  |  |  |  |
| `app/creative/studio.tsx` | 10 | 1 |  | 1 |  |  |  |  |  |  |  |
| `app/detail-actions.tsx` | 1 |  |  |  |  |  |  |  |  |  |  |
| `app/finance/actions.tsx` | 1 | 2 |  |  |  |  |  | 2 |  |  |  |
| `app/finance/expenses.tsx` | 11 | 4 |  | 1 |  |  |  |  |  |  |  |
| `app/finance/invoice-sheet.tsx` |  | 2 |  |  |  |  |  |  |  |  |  |
| `app/finance/invoices.tsx` |  |  |  | 1 |  |  |  |  |  |  |  |
| `app/finance/messages.tsx` | 1 |  |  |  |  |  |  |  |  |  |  |
| `app/finance/new-invoice.tsx` | 1 |  |  |  |  |  | 1 |  |  |  |  |
| `app/finance/overview.tsx` | 1 |  |  |  |  |  |  |  |  |  |  |
| `app/finance/setup.tsx` | 1 | 4 |  |  |  |  |  |  |  |  |  |
| `app/finance/team-pay.tsx` | 2 | 4 |  | 1 |  |  | 3 |  |  |  |  |
| `app/form.tsx` | 2 |  |  |  |  |  |  |  |  |  |  |
| `app/gate.tsx` |  | 1 |  |  |  |  |  |  |  |  |  |
| `app/integrations/google-tool.tsx` | 2 | 2 |  |  |  |  |  |  |  |  |  |
| `app/integrations/inboxes.tsx` |  | 2 |  | 1 |  |  |  |  |  |  |  |
| `app/sales/cadence-picker.tsx` | 3 |  |  |  | 1 |  |  | 1 |  |  |  |
| `app/sales/customer-section.tsx` |  |  |  |  |  |  |  | 1 |  |  |  |
| `app/sales/kit.tsx` |  |  |  |  |  |  |  | 1 |  |  |  |
| `app/sales/payment-section.tsx` | 1 | 1 | 3 |  |  |  |  |  |  |  |  |
| `app/sales/pipeline-screen.tsx` | 2 |  |  |  |  |  |  |  |  |  |  |
| `app/sales/proposal-sections.tsx` | 6 | 2 |  |  |  |  |  | 1 |  |  |  |
| `app/sales/schedule-section.tsx` | 3 | 1 |  |  |  |  |  |  |  |  |  |
| `app/sales/service-section.tsx` |  |  | 4 |  |  |  |  |  |  |  |  |
| `app/sales/workspace.tsx` | 1 |  |  | 3 |  |  |  |  |  |  |  |
| `app/screens/agent-permissions.tsx` | 1 |  |  |  |  |  |  |  |  |  |  |
| `app/screens/compliance.tsx` | 5 | 3 |  |  |  |  |  |  |  |  |  |
| `app/screens/dispatch/playbook.tsx` | 1 | 2 |  |  |  |  |  |  |  |  |  |
| `app/screens/dispatch/shared.tsx` | 1 |  |  |  |  |  |  |  |  |  |  |
| `app/screens/forms.tsx` | 7 | 1 |  |  | 1 |  |  |  |  |  |  |
| `app/screens/integrations.tsx` |  |  |  |  |  |  |  |  |  |  | 1 |
| `app/screens/misc.tsx` | 1 |  |  |  |  |  |  |  |  |  |  |
| `app/screens/recruiter/applicants.tsx` | 2 |  |  |  |  |  |  |  |  |  |  |
| `app/screens/recruiter/hiring-needs.tsx` | 2 |  |  |  |  |  |  |  |  |  |  |
| `app/screens/recruiter/interviews.tsx` | 2 |  |  |  |  |  |  |  |  |  |  |
| `app/screens/recruiter/offers.tsx` |  | 1 |  |  |  |  |  |  |  |  |  |
| `app/screens/recruiter/screening.tsx` | 1 |  |  |  |  |  |  |  |  |  |  |
| `app/screens/recruiter/shared.tsx` |  |  |  |  |  |  |  |  |  |  | 1 |
| `app/screens/retention/continuity.tsx` | 1 |  |  |  |  |  |  |  |  |  |  |
| `app/screens/retention/drawer.tsx` | 5 | 1 |  |  |  |  |  |  |  |  |  |
| `app/screens/retention/playbook.tsx` |  | 3 |  |  |  |  |  |  |  |  |  |
| `app/screens/retention/recovery.tsx` | 3 | 1 |  |  |  |  |  |  |  |  |  |
| `app/screens/sales-agent/conversations.tsx` |  |  |  | 1 |  |  |  |  |  |  |  |
| `app/screens/sales-agent/drawer.tsx` | 7 |  |  | 1 |  |  |  |  |  |  | 1 |
| `app/screens/sales-agent/import-prospects.tsx` | 1 |  |  |  |  |  |  |  |  |  |  |
| `app/screens/sales-agent/new-inquiry.tsx` | 4 |  |  |  |  |  |  |  |  |  |  |
| `app/screens/sales-agent/playbook.tsx` | 1 | 4 |  |  |  |  |  | 1 |  |  |  |
| `app/screens/sales-agent/review.tsx` |  |  |  |  |  |  | 1 |  |  |  |  |
| `app/services/builder.tsx` |  |  |  |  |  | 4 |  |  |  |  |  |
| `app/services/imports.tsx` | 2 |  |  |  |  |  |  |  |  |  |  |
| `app/services/new.tsx` |  |  |  |  |  |  |  | 3 |  |  |  |
| `app/services/preview.tsx` | 3 | 1 |  | 1 |  |  |  |  |  |  |  |
| `app/services/property-prices.tsx` | 4 |  |  | 1 |  |  |  |  |  |  |  |
| `app/services/research.tsx` | 2 | 1 |  |  |  |  |  |  |  |  |  |
| `app/services/setup.tsx` |  | 1 |  | 4 | 2 | 1 |  |  |  |  |  |
| `app/services/shared.tsx` |  |  |  | 1 |  | 2 |  |  |  |  |  |
| `app/services/steps.tsx` | 7 | 5 |  | 12 | 1 | 3 |  | 1 |  |  |  |
| `app/services/studio.tsx` | 2 |  |  |  |  |  |  |  |  |  |  |
| `app/settings/business-sections.tsx` | 1 | 1 |  |  |  |  |  | 1 |  |  |  |
| `app/settings/dispatch.tsx` |  |  |  |  |  | 2 |  |  |  |  |  |
| `app/settings/email-previews.tsx` | 1 |  |  | 1 |  | 3 |  |  |  |  |  |
| `app/settings/notification-preferences.tsx` |  |  |  |  |  | 1 |  |  |  |  |  |
| `app/settings/people.tsx` | 1 |  |  |  |  |  |  |  |  |  |  |
| `app/settings/recruiting.tsx` | 2 | 2 |  |  |  |  |  |  |  |  |  |
| `app/settings/support-access.tsx` | 1 |  |  |  |  |  |  |  |  |  |  |
| `app/setup/flow.tsx` | 1 | 2 | 7 | 1 | 1 |  |  |  |  |  |  |
| `app/setup/import.tsx` | 1 | 1 |  |  |  |  |  |  |  |  |  |
| `app/setup/records-import.tsx` | 1 |  |  |  |  |  |  |  |  |  |  |
| `app/texting/assistant.tsx` |  | 2 |  |  |  |  |  |  |  |  |  |
| `app/texting/parts.tsx` |  |  | 1 |  |  |  |  |  |  |  |  |
| `app/texting/step-activities.tsx` |  |  | 2 |  |  |  |  |  |  |  |  |
| `app/texting/step-business.tsx` | 2 |  | 1 |  |  |  |  |  |  |  |  |
| `app/texting/step-number.tsx` |  |  |  |  |  |  |  |  |  |  | 1 |
| `app/texting/step-permission.tsx` |  |  | 3 |  |  |  |  |  |  |  |  |
| `app/texting/step-review.tsx` |  | 1 |  |  |  |  |  |  |  |  |  |
| `app/tutorials/directory.tsx` |  |  |  | 1 |  |  |  |  |  |  |  |
| `app/tutorials/offer.tsx` |  |  |  |  |  |  |  | 1 |  |  |  |
| `app/tutorials/player.tsx` | 1 |  |  |  |  |  |  |  |  |  | 2 |
| `applicant/apply-page.tsx` | 1 | 2 |  |  |  |  | 1 |  |  |  |  |
| `auth/fields.tsx` |  | 1 |  |  |  |  |  |  |  |  | 1 |
| `auth/security.tsx` |  | 1 |  |  |  |  |  |  |  |  |  |
| `booking/step-finish.tsx` | 1 | 1 |  |  | 1 |  | 1 |  |  |  |  |
| `booking/step-service.tsx` |  | 1 |  |  |  |  | 4 |  |  |  | 3 |
| `booking/step-start.tsx` |  | 1 |  |  |  |  | 3 |  |  |  |  |
| `cleaner/contact-portal.tsx` | 1 |  |  |  |  |  |  |  |  |  |  |
| `cleaner/portal-page.tsx` |  | 2 |  |  |  |  | 1 |  |  |  |  |
| `consent/banner.tsx` |  |  |  |  |  | 1 |  |  |  |  |  |
| `marketing/autonomy-dial.tsx` |  |  |  |  |  |  |  | 2 |  |  |  |
| `marketing/early-access-form.tsx` |  |  |  |  |  |  |  | 1 | 1 | 1 |  |
| `pay/pay-page.tsx` |  |  |  |  |  |  | 1 | 2 |  |  |  |
| `public/assess-page.tsx` | 2 |  |  |  |  |  |  |  |  |  |  |
| `public/care-page.tsx` |  | 2 |  |  | 1 |  | 1 |  |  |  |  |
| `public/proposal-document.tsx` |  |  |  |  |  |  |  | 2 |  |  |  |
| `public/proposal-page.tsx` |  | 2 |  |  |  |  |  | 1 |  |  |  |
| `public/sign-page.tsx` |  | 1 |  |  |  |  |  |  |  |  |  |
| `sales/quote-page.tsx` |  |  |  |  |  |  |  | 3 |  |  |  |
| `staff/ai-models.tsx` | 1 |  |  |  |  | 2 |  |  |  |  |  |
| `staff/console.tsx` | 10 | 1 |  |  |  |  |  |  |  |  |  |
| `staff/operations.tsx` | 2 | 1 |  |  |  |  |  |  |  |  |  |
| `staff/selection-preview.tsx` | 6 | 3 | 2 | 1 | 1 | 1 | 1 |  |  |  |  |
| `staff/setup-funnel.tsx` |  |  |  | 1 |  |  |  |  |  |  |  |
| `staff/tutorials.tsx` | 1 |  |  | 1 |  |  |  |  |  |  |  |
| `texting/signup-form.tsx` |  | 2 |  |  |  |  |  |  |  |  |  |
| `trust/request-form.tsx` | 1 |  |  |  |  |  |  |  |  |  |  |
