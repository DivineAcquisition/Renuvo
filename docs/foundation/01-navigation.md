# Selestial: sidebar navigation

**Status: the owner's structure, recorded November 15, 2026.** This sets the
information architecture before the sidebar is built. Where it differs from
`00-product-brief.md` on departments and agents, this document is the newer
decision.

**What exists:** the navigation definition, the helpers that derive everything
from it, and tests that check it. **What does not exist:** the sidebar itself,
the agent pages, and any new route. The current app shell still shows the
earlier navigation and must not be extended; it is replaced when the sidebar
is built from this definition.

| File | What it is |
|---|---|
| `src/lib/app/navigation.ts` | The one definition: departments, agents, work tabs, company-wide items, paths, availability |
| `src/lib/app/navigation-helpers.ts` | Agent lists, links, active item, breadcrumbs, deep links, sidebar state, badge priority |
| `src/lib/app/navigation.test.ts` | Validation: names and order, unique ids, no conflicting paths, department mappings, availability against real pages |

---

## 1. Structure

Three departments. They are departments, not lifecycle stages. Eight agents
work inside them.

| Department | Agents, in order |
|---|---|
| **Growth** | Marketing, Sales, Retention |
| **Operations** | Dispatch, Quality, Customer Care |
| **Team** | Recruiter, Team Coordinator |

| Agent | Owns |
|---|---|
| Marketing | Generates customer interest. |
| Sales | Turns inquiries into confirmed bookings. |
| Retention | Maintains recurring relationships, follows up on risk, runs win-back and referral workflows. |
| Dispatch | Staffs jobs, manages scheduling and coverage, monitors service progress. |
| Quality | Reviews service evidence, investigates issues, coordinates corrective work. |
| Customer Care | Handles customer communications, setup, requests and scheduling changes. |
| Recruiter | Manages candidate acquisition, screening, interviews and hiring offers. |
| Team Coordinator | Manages cleaner onboarding, documentation, training, readiness and ongoing availability. |

Two pairs of names are close and stay with their owners:

- **Customer Setup** is Customer Care's and is about customers. **Onboarding**
  is Team Coordinator's and is about cleaners.
- **Offers & Agreements** is Recruiter's and is about hiring. **Offers &
  Coverage** is Dispatch's and is about job assignments.

## 2. The sidebar, top to bottom

The order is fixed (`SIDEBAR_SECTIONS`).

1. **Business selector.** The active cleaning company. Switching changes the
   whole workspace and its data. There is no client selector: customers and
   properties are records inside a company. No location selector until
   multi-location support exists.
2. **Department tabs.** Growth | Operations | Team. Choosing one changes which
   agents are listed below. It does not change the business, and it does not
   filter Home, Approvals, Inbox or the shared records.
3. **Persistent navigation.** Home, Approvals, Inbox, Search. Always visible.
4. **The selected department's agents.** Each agent has a name that opens its
   overview, a separate arrow that opens its tabs, the nested work tabs, and
   room for one status or attention badge.
5. **Shared business navigation.** Customers & Properties, Cleaners, Finance,
   Reports. Company-wide.
6. **Footer.** Settings only.

**Shared records are shared.** An agent tab is a view over the company's
records, never a second copy. Dispatch's availability view and Team
Coordinator's Availability tab read the same cleaner records that the Cleaners
page shows.

**Finance is the cleaning company's money.** Selestial's own subscription
billing is separate and lives inside Settings.

## 3. Work tabs

Names and order are the owner's. Playbook is always last. Chat is never a tab.

| Agent | Tabs |
|---|---|
| Marketing | Campaigns · Content & Creative · Promotions · Lead Sources · Performance · Playbook |
| Sales | Pipeline · Quotes & Proposals · Follow-ups · Calls & Messages · Booking Forms · Playbook |
| Retention | Recurring Customers · Customer Health · Feedback & Reviews · Recurring Offers · Win-back · Referrals · Playbook |
| Dispatch | Dispatch Board · Schedule · Offers & Coverage · Live Jobs · Action Links · Playbook |
| Quality | Completion Review · Checklists & Photos · Service Issues · Re-cleans · Playbook |
| Customer Care | Conversations · Customer Setup · Service Requests · Rescheduling & Cancellations · Playbook |
| Recruiter | Hiring Needs · Applicants · Screening · Interviews · Offers & Agreements · Playbook |
| Team Coordinator | Onboarding · Documents & Training · Readiness · Availability · Team Check-ins · Playbook |

### What Dispatch's tabs must hold

These are requirements for the future workspaces, not work done here.

| Tab | Must accommodate |
|---|---|
| Dispatch Board | Jobs needing staffing; pending dispatch approval; offers sent; partially staffed jobs; confirmed crews; jobs requiring intervention |
| Schedule | Daily and weekly views; arrival windows and projected duration; cleaner availability; conflicts and buffers; changes affecting later jobs |
| Offers & Coverage | Standard offers; broadcast offers; acceptance, decline and expiration; backup coverage; unfilled jobs; urgent-hire requests handed to Recruiter |
| Live Jobs | Check-ins and progress; running-late updates; checklist progress; drops and replacement needs; completion awaiting quality review |
| Action Links | Job offer links; contractor checklist links; before/after photo upload links; coverage response links; ETA response links |

Action Links is a management view. Every link is also reachable from its job;
nobody has to go through Action Links to act.

Six states stay distinct everywhere: an offer **sent**, a cleaner
**accepting**, a job **fully staffed**, a cleaner **finishing**, **quality
review**, and **financial completion**. None is inferred from another. Today
the record separates the first two and job completion; "fully staffed" (more
than one cleaner on a job), quality review and financial completion do not
exist yet.

### Every agent overview

The page an agent's name opens will show: its current responsibilities and
work, items needing the owner's attention, recent outcomes, an "Ask [Agent]"
entry point, and activity history with agent controls. Conversation with the
agent is opened from the page header or a side panel, never from a sidebar
tab.

The **Playbook** says how that agent works within the company's rules. Company
policies have one source of truth (Settings); a Playbook refers to them and
does not keep its own copy.

## 4. Route map

Everything signed-in is under `/app`. Home is the landing page.

**Agents use two route patterns, which will serve all eight agents and 47
tabs:**

- `/app/agents/[agent]` is the overview.
- `/app/agents/[agent]/[tab]` is a work tab. Records beneath a tab continue
  the path, for example `/app/agents/dispatch/live-jobs/<job>`.

The agent's id is in the path and its department is not, so a deep link keeps
working if an agent ever moves department. Departments have no page of their
own.

Three states describe each destination:

- **Live**: a page exists at its own path.
- **Interim**: no page at its own path yet; an existing page serves it in
  whole or part, and links go there until the real page exists.
- **Planned**: not built. It is shown as not built and is never linked as if
  it worked.

### Company-wide destinations

| Destination | Path | Today |
|---|---|---|
| Home | `/app` | **Live.** The Overview. |
| Approvals | `/app/approvals` | **Interim** at `/app/decisions`. The queue works; only the path and heading differ. |
| Inbox | `/app/inbox` | **Planned.** A page exists and says conversations are not built. |
| Search | `/app/search` | **Planned.** |
| Customers & Properties | `/app/customers` | **Interim** at `/app/records`. A list and an add form; no page per customer. |
| Cleaners | `/app/cleaners` | **Interim** at `/app/records`. A list and an add form; no page per cleaner. |
| Finance | `/app/finance` | **Planned.** |
| Reports | `/app/reports` | **Interim** at `/app/insights`. Weekly measures only. |
| Settings | `/app/settings` | **Live.** Company, people and Dispatch settings. |

### Agent destinations

Only Dispatch has a workflow. Every other agent's overview and tabs are
planned.

| Destination | Path | Today |
|---|---|---|
| Dispatch overview | `/app/agents/dispatch` | **Interim** at `/app/team`: its work, outcomes, permissions and pause are one card there. No Ask Dispatch. |
| Dispatch › Schedule | `/app/agents/dispatch/schedule` | **Interim** at `/app/schedule`: visits by day or week, with who accepted. |
| Dispatch › Offers & Coverage | `/app/agents/dispatch/offers-coverage` | **Interim** at `/app/departments/operations`: visits without an accepted cleaner. Offers are made from each visit's panel. |
| Dispatch › Dispatch Board, Live Jobs, Action Links, Playbook | `/app/agents/dispatch/<tab>` | **Planned.** |
| All tabs of the other seven agents | `/app/agents/<agent>/<tab>` | **Planned.** |

The exact path of every tab is `tabPath(agent, tab)` in `navigation.ts`; tab
ids are the kebab-case of the label (`quotes-proposals`, `re-cleans`,
`team-check-ins`).

### Pages that exist and are not a destination's own path

They keep working. Nothing here is removed or redirected by this task.

| Existing page | Becomes |
|---|---|
| `/app/decisions` | Approvals at `/app/approvals`, with a redirect from the old path. |
| `/app/schedule` | Dispatch › Schedule. The top-bar Schedule shortcut should then point at the new path. |
| `/app/records` | Two pages: Customers & Properties, and Cleaners. |
| `/app/insights` | Reports at `/app/reports`. |
| `/app/team` (AI Team) | Each agent's overview, plus agent permissions inside Settings. |
| `/app/departments/[department]` | Nothing directly. It serves the earlier three departments (sales, operations, customer-success). Departments become sidebar tabs with no page; the content moves to agent workspaces. |

## 5. Interaction rules

The helper that implements each rule is named, so the sidebar calls it and
does not re-implement it.

1. **Remembered per person and per company.** The selected department and the
   open agents are stored under `sidebarStorageKey(userId, companyId)`.
   `parseSidebarState` ignores anything malformed or naming an agent that no
   longer exists.
2. **A new workspace starts with Operations selected, on Home.**
   `initialSidebarState()`, `LANDING_PATH`.
3. **Choosing a department does not navigate.** `selectDepartment` returns new
   sidebar state and nothing else. The page stays where it is.
4. **Opening an agent page selects its department, opens that agent and
   highlights the exact tab**, whether reached by a click or a deep link.
   `syncToPath` and `activeFor`. A company-wide page leaves the sidebar as it
   was.
5. **Several agents may be open at once.** `toggleAgent` opens or closes one
   and leaves the rest. No accordion.
6. **The name navigates; the arrow only opens and closes.** They are two
   controls. The arrow is a button with its own accessible name ("Show
   Dispatch's work tabs") and `aria-expanded`.
7. **Approvals and Inbox are reachable from every department.** They are in
   the persistent section, which department tabs never change.
8. **Badges state something to act on**, in words: "2 unfilled", "3 to
   review". Never a count of messages sent or a decorative activity number.
9. **A problem outranks "working".** `topBadge` shows urgent, then a decision
   needed, then something to look at, and only then working.
10. **Status never depends on color alone.** Every badge has words; a badge
    without words is not shown.
11. **On a phone the sidebar is a drawer** and closes when a destination is
    chosen. Choosing a department or pressing an arrow does not close it.
12. **Permissions decide access; hiding a link does not.** `mayShow` only
    decides whether to draw a link. Every read and write is checked in Convex.
13. **A paused agent's records stay reachable.** Pausing stops the agent from
    acting. Its tabs, and the jobs, cleaners and customers behind them, stay
    open. `mayShow` does not take the paused state as an input, on purpose.

### Badges

The definition holds no counts, no states and no badge values. A badge is
computed from the record when the sidebar is drawn, by a query that does not
exist yet. One badge per agent and one per tab. The first sources will be
what the record already knows for Dispatch: visits without an accepted
cleaner, and proposals waiting on a person.

## 6. Availability rules

- The definition is the full plan. Each destination carries its own
  availability, so the plan and what is built never get confused.
- **An unbuilt agent is never shown as working.** It has no overview link, no
  badge and no status other than "not built yet".
- **A planned destination has no link.** `hrefFor` returns nothing for it. The
  sidebar may list it, marked as not built, so the owner can see what is
  coming.
- **An existing record page can be available before its agent is.** Customers,
  Cleaners and the Schedule work today although Customer Care, Team
  Coordinator and most of Dispatch's tabs do not.
- **The tests keep this honest.** A destination marked live must have a page.
  A planned one must not, unless it is marked as a notice page. Every page
  under `/app` must be a destination or be listed with what replaces it. So
  building a page without updating the definition fails the build, and so does
  marking something live that is not there.
- **Which agents are built comes from the backend's catalog**
  (`convex/lib/departments.ts`). The test fails if the navigation disagrees.

### Access

`minimumRole` on a destination is the least role the link is drawn for.

| Destination | Drawn for | Note |
|---|---|---|
| Everything not listed below | Office, Manager, Owner | Actions inside each page are checked separately. |
| Approvals | Everyone | Owners and Managers decide. Office sees only tasks handed to a person. |
| Cleaners | Everyone | Pay rates are shown to the Owner only. |
| Settings | Everyone | Only the Owner changes company details, people, authority and billing. |
| Finance | **Undecided**, so Owner only for now | See open question 2. |

## 7. Reuse and what remains

### Can be reused

| Existing | Reuse for |
|---|---|
| Overview page (`/app`) | Home, as it is. |
| Decision queue, decision cards, hold-to-approve | Approvals. Move to `/app/approvals`. |
| Schedule table with Today / Tomorrow / Week | Dispatch › Schedule. |
| Coverage list on the Operations workspace | Start of Dispatch › Offers & Coverage and of the Dispatch Board's "needs staffing" column. |
| Dispatch's ranking, run trace, take-over and hand-back in the visit panel | Dispatch Board and Offers & Coverage. |
| AI Team agent card: work, outcomes, permissions, pause | Each agent overview; permissions also in Settings. |
| Dispatch settings in Settings | Dispatch › Playbook, which refers to them. |
| Customer and cleaner lists and add forms | Customers & Properties, and Cleaners. |
| Weekly measures | Reports. |
| The shared detail panel | Every workspace that opens a visit, an approval or a task. |
| Team console | Stays, fed by the same definition. |

### Still to build

- The sidebar itself, the business selector, the department tabs, the drawer.
- The two agent route patterns, and each agent overview.
- 45 of the 47 work tabs. Two (Dispatch's Schedule and Offers & Coverage) are
  served in the meantime by existing pages.
- Search, Finance, Inbox.
- A page per customer and per cleaner.
- The query that feeds badges.
- Agent permissions inside Settings.
- Redirects from the old paths when their replacements exist.

### The backend does not match this structure yet

Nothing in the database was changed by this task. Three gaps need a decision
before the sidebar can be fully live:

1. **The backend knows four agents** (Sales, Recruiter, Dispatch, Retention).
   Marketing, Quality, Customer Care and Team Coordinator have no id in the
   schema, so they cannot own a task, an approval or a permission. Adding them
   is a schema change.
2. **The backend's department catalog is the earlier one** (Sales, Operations,
   Customer Success, with Recruiter under Operations). The Overview's "team at
   work", the current sidebar and `/app/departments/[department]` read it. It
   should become Growth, Operations, Team when the sidebar is built, in the
   same change that retires the old department pages.
3. **Permissions exist only for those four agents.** The permission catalog
   needs actions for the four new agents before they can act.

## 8. Open questions for the owner

1. **Books.** The brief planned a Books agent. It is not among the eight, and
   Finance is now a shared area. Is Books dropped, or does it come later?
2. **Who may open Finance?** The brief keeps billing from Managers. Does that
   cover the cleaning company's own finances, or only Selestial's
   subscription?
3. **`/app/decisions` to `/app/approvals`.** Rename with a redirect when the
   sidebar is built, or keep the current path?
4. **Planned agents in the sidebar.** List all eight from the start, with the
   unbuilt ones marked "not built yet", or show an agent only once it has a
   workflow? The definition supports either.
5. **The AI Team page.** Its content moves to agent overviews and Settings.
   Should a single page comparing all eight agents remain?
