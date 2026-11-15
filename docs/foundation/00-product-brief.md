# Renuvo: product brief and agent design

**Status: decisions recorded November 15, 2026.** This document is the source
of truth. If a build prompt and this document disagree, this document wins
until we change it on purpose.

**Decisions the owner made on November 15, 2026.** Where one conflicts with a
later section, the decision wins.

1. **Workers.** Contractors paid a share of the job and hourly employees are
   both supported at launch.
2. **Novara is a reference only.** It keeps its own system. Renuvo owes it no
   feature parity.
3. **Channels.** Text, email and web chat first. Voice follows.
4. **Scope of the first release.** Homes, short-term rentals, property
   managers, and offices and commercial.
5. **Pricing.** A monthly plan that includes agent work and texting, with
   top-ups beyond that.
6. **Agent names.** Shown as name and role: Vera · Sales, Atlas · Dispatch,
   Scout · Recruiter, Loop · Retention.
7. **Planned next agents.** Quality, Books and Marketing. Not built.
8. **Stack.** A fresh build on Convex. Nothing from the earlier Supabase build
   is carried forward.
9. **Public site.** Light, brand teal `#2CC5A8`, headline "The agentic platform
   for cleaning companies." Two actions: book a call and join the waitlist.

Two references sit behind it:

- **Novara** (`novaracleaningui`) is the reference operation. It shows what a
  cleaning company actually needs, in working detail. We reuse its rules and
  ideas. We do not copy its code without choosing to, piece by piece.
- **Vistrial** is the reference philosophy: one job per agent, work done as
  checked steps instead of free-running AI, evidence behind every claim, one
  approvals queue, and autonomy the owner sets per action.

---

## 1. What Renuvo is

Renuvo is the operating platform for a cleaning company where agents do the
daily work and people set the rules.

Scheduling software records what a team decided. Renuvo makes the decisions
that can be made by rule, carries them out, shows its reasons, and brings a
person only what needs a person.

**The result an owner should feel in the first week:** every lead answered in
under a minute, every job staffed without a phone call, and a morning screen
that shows a short list of decisions instead of a day of chasing.

**The daily habit that keeps a customer:** the owner opens Renuvo in the
morning and sees what the agents did overnight, what each one is waiting on,
and what today looks like. If Renuvo were gone, they would need to hire an
office manager.

**Who it is for:** residential and light-commercial cleaning companies, from
an owner with three cleaners up to a multi-crew operation with office staff.

## 2. How we are different

We say what Renuvo does. We do not make claims about other products.

1. **Agents own outcomes, not features.** Each agent is measured on a number
   the owner cares about: leads booked, jobs staffed, customers kept, cleaners
   activated.
2. **Renuvo is the system of record.** Agents cannot run dispatch on top of
   someone else's calendar. Customers, properties, jobs, cleaners, money and
   conversations live here. Import tools make switching easy.
3. **Rules are the company's own.** Pricing, pay, service areas, checklists,
   fees and guarantees are settings the owner fills in. Novara proves how deep
   these rules go for one company. Renuvo makes every one of them a setting.
4. **Every action shows its reason and can be checked.** What an agent says it
   did is compared with what the record shows happened.
5. **The four agents work as one loop** (section 9). A staffing gap seen by
   Dispatch becomes a hiring target for Recruiter the same day.

## 3. Principles that hold for every agent

These come from Vistrial and are not optional.

- **One job each.** An agent has one job, one promise about what it never
  does, and one headline number.
- **Skills are checked steps.** A skill is a fixed sequence: read the record,
  compute in code, let the model write or classify where language is needed,
  check the result in code, then act or ask. The model never free-runs.
- **The model never computes numbers.** Prices, pay, scores, distances, fees
  and dates come from code and settings. The model may explain a number. It
  may not produce one.
- **Outside text is data, never instructions.** A customer's message, an
  applicant's answer, or a web page cannot change what an agent is allowed to
  do.
- **Every action is written to the record** with what triggered it, what was
  read, what was decided and why.
- **Agents say they are AI.** No human personas. An agent introduces itself as
  the company's assistant, and gives a straight answer if asked.
- **Honest screens.** If a connection or setting is missing, the screen says
  "not set up yet". It never shows a made-up number.
- **Plain language** in every message and every screen.
- **Consent, opt-out, quiet hours and frequency limits are checked at send
  time**, every time, in one place that every agent must go through.

## 4. Autonomy

The owner sets a level for each kind of action, per agent.

| Level | What happens |
|---|---|
| **Off** | The agent does not do this. |
| **Suggest** | The agent prepares the action and its reason. A person approves, edits or skips. |
| **Act, then tell** | The agent acts at once and reports it. There is an undo window where undo is possible. |
| **Act** | The agent acts. It appears in the activity record only. |

Rules around the levels:

- **Sensible defaults by action.** A reminder text starts at Act. A refund
  starts at Suggest.
- **A trust record is shown before loosening.** For example: "Dispatch staffed
  41 jobs this week. You changed 2."
- **Step-down.** If an agent's actions of one kind are undone or rejected
  often, that kind drops back to Suggest on its own, and the owner is told.
- **Limits.** Money actions carry an owner-set ceiling per action and per day.
- **A closed ceiling.** These never run without a person, at any setting:
  - rejecting or ending a worker on the model's judgment (section 8);
  - any decision that follows a background check;
  - paying out a pay run;
  - refunds or credits above the owner's limit;
  - changing prices, pay rates or policies;
  - anything legal, an injury, property damage or a payment dispute.
- **Pause.** One switch pauses all agents for a company. Staff have a separate
  switch that halts the platform.

## 5. The shared record

All four agents read and write one record. No agent keeps private data.

| Thing | What it holds |
|---|---|
| **Company** | Brand, service areas, hours, time zone, policies, autonomy settings. |
| **Customer** | Contact, consent, payment method on file, lifetime history, risk flags. |
| **Property** | Address, size, rooms, access notes, pets, preferences. A customer can have several. |
| **Lead** | Source, what they asked for, stage, owner, next step and when. |
| **Quote** | Inputs, each price line with its reason, expiry, who or what issued it. |
| **Job** | Property, service, time window, price, crew needed, one status list. |
| **Assignment** | Cleaner, role, offer state, pay snapshot. |
| **Plan** | Recurring cadence, price, next visit, pause state, billing. |
| **Cleaner** | Status, home base, availability, skills, tier, scores, documents and expiries. |
| **Applicant** | Source, answers, screen result, interview scorecard, stage. |
| **Conversation** | Every text, email and call with a person, across all agents, in one thread. |
| **Case** | A complaint, issue or dispute, with evidence and resolution. |
| **Money** | Charges, refunds, credits, tips, pay lines, payouts, as one ledger. |
| **Event** | An append-only log of everything that happens. Agents start from events. |

Lessons taken from Novara: one status list per thing (not two that drift),
customers and properties as real linked records (not matched by email), and a
single ledger for money (not three payout systems).

**Events start the work.** "Lead arrived", "job booked", "cleaner dropped a
job", "payment failed", "visit completed" each wake the agent that owns the
next step. A person does not need to click anything.

## 6. Sales

**Job:** turn a stranger into a paid first booking.

**Promise:** it never quotes a price the pricing rules did not produce, never
promises a discount the checkout will not honor, and never takes a card number
in conversation.

**Headline number:** leads booked, and time to first reply.

### What starts it

A new lead from any source (website form, ad lead, call, text, chat, a
partner), an unfinished booking, a quote that has gone quiet, a reply from a
lead.

### How it works

1. **Reply fast.** Answers on the channel the lead used, inside a minute,
   around the clock. Outside quiet hours for outbound; inbound is always
   answered.
2. **Find out what is needed.** Service area, home size, condition, service
   type, timing. It asks only what the price needs.
3. **Quote.** Calls the pricing rules and gets a price with a reason for each
   line. It speaks only that price. Every quote is saved with its inputs and
   held for a set time.
4. **Book.** Offers real open times that Dispatch can staff, sends a secure
   payment link for the deposit, and confirms once paid.
5. **Follow up.** If the lead goes quiet, it follows a set cadence across text
   and email until booked, lost or opted out. It stops the moment a person on
   the team takes over the thread.
6. **Hand off.** A paid booking becomes a job for Dispatch and a customer for
   Retention.

### Skills

| Skill | What it does |
|---|---|
| Lead response | First reply, qualification, quote, booking link. |
| Call handling | Answers and returns calls by voice with the same rules and tools. |
| Booking recovery | Brings back people who started booking and stopped. |
| Quote follow-up | Works open quotes on a cadence. |
| Waitlist | Records out-of-area demand and contacts people when an area opens. |
| Commercial intake | Gathers site facts, gives a range where the rules allow, and books a walkthrough for a person. |
| Lead scoring | Orders leads by fit and intent, with reasons. |

### Default autonomy

| Action | Default |
|---|---|
| Reply, qualify, quote from the rules, send booking link | Act |
| Follow-up cadence messages | Act |
| Discount inside the owner's allowed band | Act, then tell |
| Discount outside the band, custom or commercial price | Suggest |
| Anything about damage, a dispute or a legal question | Hand to a person |

### From Novara

The layered pricing engine with a floor, a ceiling and explained lines. Quote
hold and override rules. The speed-to-lead timer and call-back. The call tools
(look up customer, check area, price, open times, create booking, hand to a
person). The reminder cadences. Self-serve quotes for short-term-rental hosts
and property managers.

**What we fix:** Novara has four pricing sources that disagree. Renuvo has
one. Web, voice, text and staff all get the same price for the same home.

## 7. Dispatch

**Job:** get every booked job staffed, done to standard, and closed.

**Promise:** it never books a cleaner into a time they cannot make, never
changes a cleaner's pay, and never penalizes a cleaner on its own.

**Headline number:** jobs staffed without a person, and on-time arrival.

### What starts it

A job is booked, changed or cancelled. A cleaner accepts, declines, drops a
job or reports an absence. An arrival time passes with no check-in. A job is
marked complete.

### How it works

1. **Staff it.** For each job it builds the list of cleaners who can do it:
   active, cleared to work, available, inside travel range, not over their
   weekly limit, and with enough time between jobs including travel. It ranks
   them (distance, quality, workload, reliability, the customer's usual
   cleaner) and sends offers that show each cleaner their own pay.
2. **Fill gaps.** If an offer expires or is declined, it moves to the next
   cleaner. If the list runs out, it tells a person and tells Recruiter.
3. **Confirm.** The day before, it confirms with crew and customer.
4. **Watch the day.** No check-in near the start time: it asks the cleaner,
   then alerts, then declares a no-show and starts cover. If a cleaner is
   running late, it works out which later jobs are affected and tells those
   customers.
5. **Cover.** When a cleaner drops out, it offers the job to backups in order,
   one at a time, with a short window each.
6. **Close.** When the crew marks a job complete, it checks the evidence:
   checklist done, required photos present, time on site reasonable. Clean
   evidence closes the job, charges the balance and locks the pay lines. Weak
   evidence goes to a person with the reason.

### Skills

| Skill | What it does |
|---|---|
| Staffing | Ranks, offers, re-offers. |
| Day plan | Orders each cleaner's day to cut travel and protect time between jobs. |
| Day watch | Check-ins, lateness, knock-on delays, customer heads-up. |
| Cover | Finds a replacement when someone drops out. |
| Completion review | Checks checklist and photos, closes or flags. |
| Reschedule and cancel | Applies the company's fee rules, restaffs, updates everyone. |
| Capacity report | Open hours and gaps by area and day, sent to Recruiter and Sales. |

### Default autonomy

| Action | Default |
|---|---|
| Send offers, re-offer, reminders, confirmations | Act |
| Customer delay notice | Act, then tell |
| Close a job on clean evidence, charge the saved card | Act, then tell |
| Override the time-between-jobs rule | Suggest |
| Declare a no-show and start cover | Act, then tell |
| Any consequence for a cleaner | A person, always |
| Goodwill credit for an uncovered job, inside the limit | Suggest |

### From Novara

The scoring rules. The time-between-jobs guard. The offer, accept and expiry
flow. The late, no-show and cover ladder. The crew pay calculation with a pay
snapshot at offer and a lock at completion. The checklist engine with a
snapshot per job. The re-clean policy.

**What we add:** Novara has every job wait for a person to approve the
offers. Renuvo makes that a setting. Also new: real drive times, location
check-in, a cleaner availability calendar that the main matcher respects, and
checking photos and checklists before close.

## 8. Recruiter

**Job:** keep the roster large enough and good enough for the work.

**Promise:** it never rejects a person on the model's judgment, never makes or
implies a decision from a background check, and never uses protected
characteristics in any step.

**Headline number:** cleaners activated, and days from application to first
job.

### What starts it

A capacity gap reported by Dispatch. A new application. An applicant reply. An
onboarding step going stale. A document nearing expiry. A cleaner going idle.

### How it works

1. **Know the target.** It reads Dispatch's capacity report and sets a hiring
   target by area: "two more cleaners in the north zone on weekdays."
2. **Source.** It prepares job posts from the company's role settings and
   tracks where each applicant came from.
3. **Screen by published rules.** The owner publishes fixed requirements (in
   the service area, of age, has transport if required, minimum availability).
   These are yes-or-no checks in code. An applicant who misses one is told
   plainly, and is put on a waitlist where that fits.
4. **Interview.** For applicants who pass, it runs a structured interview by
   text or voice against the company's scorecard, and records each answer
   beside each score as evidence.
5. **Shortlist for a person.** It presents ranked candidates with the
   evidence. A person decides who moves forward.
6. **Onboard.** It walks each hire through the company's steps: agreement,
   identity, tax form, payout method, supplies, training. It chases what is
   stale and reports who is stuck and where.
7. **First job.** It tells Dispatch the cleaner is ready for a first or trial
   job, then collects the result.
8. **Keep the roster healthy.** It checks in with idle cleaners, flags
   documents about to expire, and proposes tier changes when the numbers
   qualify.

### Skills

| Skill | What it does |
|---|---|
| Hiring plan | Turns capacity gaps into targets by area and day. |
| Sourcing | Drafts posts, tracks sources and cost per hire. |
| Application screen | Fixed-rule checks with a plain reason. |
| Interview | Structured text or voice interview with a scorecard. |
| Onboarding | Chases steps, answers questions, reports blockers. |
| Bench call | Offers urgent paid work to screened people who are not yet active. |
| Roster health | Idle check-ins, document expiries, tier proposals. |

### Default autonomy

| Action | Default |
|---|---|
| Acknowledge, answer questions, send reminders | Act |
| Decline on a published fixed rule | Act, then tell |
| Run the interview and score it | Act |
| Move a candidate forward, activate a cleaner | Suggest |
| Reject after interview, end an engagement | A person, always |
| Any step after a background check | A person, always |
| Tier promotion | Suggest |

### From Novara

The application rules engine. The save-and-resume application. The
phone-screen script and scorecard, which becomes the interview. The versioned
consent record. The onboarding step list with a first-job readiness check. The
in-app training tours. The tax forms. The urgent bench call. The idle check-in.

**What we add:** Novara's recruiting has no AI and no link to dispatch
demand. Also new: a background-check provider (Novara's policy names one but
none is connected), interview scheduling, trial jobs, and more than one
source of applicants.

**A legal note for the owner:** hiring is the most regulated area an agent
touches. Rules on automated hiring decisions and on background checks differ
by state. The closed ceiling above is designed for that. Legal review is
needed before this agent is sold.

## 9. Retention

**Job:** keep customers paying and grow what each one is worth.

**Promise:** it never filters who is asked for a public review, never makes it
hard to cancel, and never charges a card it was told to stop charging.

**Headline number:** customers kept, and one-time customers moved to a plan.

### What starts it

A visit is completed. Feedback arrives. A payment fails. A customer skips,
pauses or asks to cancel. A one-time customer passes their expected rebooking
date. A plan customer shows warning signs.

### How it works

1. **After every visit.** It asks how the visit went. Everyone is invited to
   leave a public review. Anyone unhappy also gets a case opened at once.
2. **Fix what went wrong.** For a complaint, it gathers the facts and the
   job's evidence, applies the company's guarantee rules, and proposes a
   remedy: a re-clean, a credit or a refund. Inside the owner's limit it can
   act. Above it, a person decides.
3. **Offer a plan.** After a good first visit, it offers a recurring plan at
   the company's plan price, on a set cadence.
4. **Run the plan.** It creates upcoming visits ahead of time, keeps the
   customer's usual cleaner where possible, and lets the customer skip, move,
   pause or cancel from a link without calling anyone.
5. **Recover failed payments.** It sends a card-update link, retries on a
   schedule, and pauses visits by the company's rule if the card is not fixed.
6. **Handle a cancel request.** It asks why, offers the options the owner has
   allowed (pause, a less frequent plan, a different cleaner), and if the
   customer still wants to cancel, it cancels both the billing and the visits
   in one step.
7. **Win back.** It contacts lapsed one-time customers around their expected
   rebooking date, and former plan customers on a set schedule.
8. **Watch for risk.** It scores each plan customer from ratings, cases,
   skips, reschedules and cleaner changes, and acts on the high ones.

### Skills

| Skill | What it does |
|---|---|
| Visit follow-up | Feedback, review invitation, tip link. |
| Service recovery | Opens a case, proposes a remedy by rule. |
| Plan offer | Moves one-time customers to recurring. |
| Plan care | Visit creation, skip, pause, change, unused-benefit nudges. |
| Payment recovery | Failed-payment sequence and card update. |
| Cancel handling | Reason, allowed save options, one clean cancel. |
| Win-back | Lapsed and former customers. |
| Risk watch | Scores churn risk and acts or flags. |
| Referrals | One referral offer, stated once, honored at checkout. |

### Default autonomy

| Action | Default |
|---|---|
| Feedback request, review invitation, reminders | Act |
| Plan offer at the standard price | Act |
| Payment recovery messages and retries | Act |
| Re-clean or credit inside the owner's limit | Act, then tell |
| Refund, or anything above the limit | Suggest |
| Save offer from the owner's allowed list | Act |
| Cancel on request | Act |
| Payment dispute or damage claim | A person, always |

### From Novara

The email rules engine (consent, suppression, footers, delivery log). The
recurring visit generator. The manage-my-plan link pages. The feedback, tip and
testimonial flows. The credit ledger. The re-clean classification. The
dispute evidence builder.

**What we fix and add:** Novara sends only happy customers to public review;
Renuvo invites everyone. Novara's link-page cancel stops visits but not
billing; Renuvo's does both. Novara has no failed-payment recovery, no
win-back and no acted-on risk score in code; these are core here.

## 10. How the four work as one loop

| From | To | What is passed |
|---|---|---|
| Sales | Dispatch | A paid booking becomes a job. Sales only offers times Dispatch can staff. |
| Sales | Retention | A new customer, with what they were promised. |
| Dispatch | Recruiter | Capacity gaps by area and day. Jobs it could not staff. |
| Dispatch | Sales | Open capacity, so Sales can push quiet days and slow busy ones. |
| Dispatch | Retention | Visit completed, with evidence. Late arrivals and cleaner changes. |
| Retention | Dispatch | Re-clean jobs. Customer and cleaner pairings to keep or avoid. |
| Retention | Sales | Referrals and win-back replies that want a new quote. |
| Recruiter | Dispatch | New cleaners ready for a first job. The screened bench for urgent cover. |

One conversation thread per person is shared by all four. A customer never
gets two agents texting them about different things on the same afternoon:
the single send gate enforces frequency limits across agents.

## 11. What a person sees

**The owner or manager** opens to a decisions queue: each item has what the
agent wants to do, why, the evidence, and Approve, Edit or Skip. Above it is a
short briefing. Beside it, a band shows what each agent is doing now.

**Each agent has a page:** its headline number, its work in progress, its
activity record, its settings and autonomy levels.

**The scorecard.** For each agent, what it reported is shown beside what the
record confirms: bookings against payments received, jobs staffed against
check-ins, saves against plans still active a month later. A source that
cannot be reached reads "unverified", never zero. This idea comes from how
Novara checks its office staff's daily reports.

**Cleaners** get a phone-first view: offers, today's jobs, checklist, photos,
pay. **Customers** get link pages that need no login: book, pay, manage plan,
give feedback. **Applicants** get the application and onboarding steps.

**Roles inside a company:** Owner (everything), Manager (operations and
approvals, no billing or autonomy settings), Office (work the queue and
conversations). Renuvo staff sit outside every company and enter only through
a separate, logged path.

## 12. Planned next agents

The platform is designed for more agents on the same record. Three are
planned and not built:

- **Quality.** Owns checklists, inspections, cases and cleaner coaching.
  Today this work is split between Atlas and Loop.
- **Books.** Owns invoices, pay runs, tax forms and the profit view. Today
  pay lines are locked by Atlas and paid out by a person.
- **Marketing.** Owns ads, reviews, referrals and local search, and feeds
  Vera.

Each can be split out later without a rewrite, because agents share one
record and own skills, not data.

## 13. Stack and build pattern

Same as Vistrial: Next.js, Convex as the system of record and job runner,
Clerk for sign-in, Vercel. Each capability goes brief, data shapes, functions,
skill, screen, tests, screenshots. Every function is registered through access
wrappers, and a test fails the build if one is not. A company's data returns
"not found" to anyone outside it.

New for Renuvo, not present in Vistrial:

1. Owned texting and voice, in and out, with carrier registration per company.
2. Agent runs started by events, with a system actor.
3. Autonomy levels per action (section 4).
4. Fast replies: a conversation path that answers in seconds.
5. Users who are not staff: cleaners, customers, applicants.
6. Payments: customer charges and cleaner payouts per company.
7. A phone-first field experience.

**Start carrier registration for texting on day one.** It takes the longest
and nothing else can speed it up.

## 14. Order of work

1. This brief, agreed.
2. The public landing page, to take calls and read the market.
3. The spine: companies, the shared record, events, the send gate, the
   decisions queue, autonomy settings.
4. Sales.
5. Dispatch.
6. Retention.
7. Recruiter.

Each step is done when a real company is using it and one agent has acted on
real data.

## 15. Still open

1. The scheduling link behind "Book a call" and where waitlist entries are
   sent. Both are settings on the public site and are empty today.
2. The legal name, domain and contact address for the footer and legal pages.
3. Legal review of the Recruiter agent before it is sold.
4. The price of the monthly plan.
