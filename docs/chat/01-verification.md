# Company Chat: verification

All tests use synthetic records and test identities. No real customer, cleaner or applicant is
contacted, and nothing is deployed. The model is the scripted mock (`CHAT_MODEL=mock`), so each test
fixes what the model "says" and checks everything around it.

| Acceptance criterion (brief §13) | Where it is checked |
|---|---|
| A general question gets a direct answer, with no forced agent choice | `convex/chat.test.ts` "answers a general question directly…" |
| A pricing question produces a correct calculation with visible inputs | "prices with the calculator…"; `convex/lib/chat/libs.test.ts` (labor-hours vs elapsed time, margin vs markup, refusing inconsistent inputs) |
| An agreement is drafted, revised, saved, reopened and exported | "drafts an agreement…" (versions, stale-edit refusal, approval bound to a version, a revision from a later chat). Export (Markdown, text, copy) is client-side in `workspace.tsx`. |
| A requested task is created once and appears in the shared task system | "creates a requested task once, even when the answer fails and is retried" |
| A supported action produces a real result and a linked receipt | "runs a Dispatch action only on an approval bound to what was shown…" (approval in the shared queue, `toolRuns` row, one only) |
| An unavailable action explains the blocker | "explains an action that is not available…" (no message queued) |
| One chat appears once across sidebar, full page and side panel | "keeps one copy of each chat…". The UI reads one stored conversation per person and company (`chat-context.tsx`). |
| Old sessions stay searchable through pagination | "keeps one copy of each chat, finds old ones by search, and pages through all of them" (25 chats, pages of 10) |
| Refreshing mid-response loses nothing and duplicates nothing | "keeps a message sent twice once, and closes an interrupted answer…"; text is saved as it streams; tool calls are idempotent (task test) |
| Wrong company, revoked membership and sensitive records are rejected | "keeps chats private to the person, the company and current members" |
| Switching company clears what was on screen | The workspace remounts per company (`gate.tsx` keys `Workspace` by company), and storage is keyed per person and company (`src/lib/app/chat/chat.test.ts`). Sessions are listed per company (same test as above). |
| Prompt injection in an attachment cannot authorize an operation | "treats instructions inside an attachment as data…" |
| Approval binds to the action; changed terms need a new approval | "does not apply an approval once what it would change has changed"; draft state is bound to the version |
| Cancellation reports what was already done | "reports exactly what was already done when the person presses Stop" |
| An unbuilt agent does not block advice on its topic | "gives advice on an unbuilt specialist's topic…" |
| No model connected is said honestly | "says honestly when no model is connected…" |
| Mobile, keyboard, focus and announced errors | Checked by hand in a browser (below). Errors use `role="alert"`; run status changes are announced in a polite live region; the panel moves focus to the composer and returns it to "Ask Selestial" on close; Escape closes menus and the panel; Enter sends and Shift+Enter makes a new line. |

Navigation: `src/lib/app/navigation.test.ts` checks that Chat is under Company for every role, that
`/app/chat`, `/app/chat/[id]` and `/app/chats` highlight it, that it is never an agent tab, and that its
pages exist.

## Commands

```bash
npm test
```

```bash
npm run typecheck
```

```bash
npm run lint
```

## Visual check

The screens in `docs/screenshots/chat/` were rendered from the real components in a local browser. A
temporary page fed them fixture data through a fake Convex client: this environment has no sign-in
service or Convex deployment. The page was not committed. Covered:

- a conversation with a live work log, a calculator table, an approval card, an unavailable action and
  a draft card (1440 wide);
- the side panel;
- the draft workspace with unresolved terms;
- the new-chat landing with company knowledge;
- the same conversation at 390 wide.

**Not checked end to end:** a real Claude response, and a real browser session against a deployment.
Both need the setup in `02-setup-and-decisions.md`.
