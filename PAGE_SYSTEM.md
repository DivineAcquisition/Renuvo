# Renuvo — Page Construction & UI System

The repeatable standard for building **any** page so all 30+ surfaces share one
anatomy, one data-flow, one set of states, and one visual rhythm. This adds no
screens; it defines how screens are made. (Prompt 51.)

## 1. Page anatomy

```
<DashboardLayout>                         ← app/(app)/dashboard/layout.tsx (shell, once)
  <PageBody>                              ← max-width + vertical rhythm
    <PageHeader title eyebrow? description? actions? />
    <Section title?>                      ← labeled content region
      { Loading | Empty | FilteredEmpty | Error | Content }   ← the STATE MATRIX
    </Section>
    <Section> … </Section>
  </PageBody>
</DashboardLayout>
```

- `DashboardLayout` (glass sidebar + topbar) is the shell — never re-implemented.
- Customer-facing pages (`(capture)`, `(portal)`) swap to a lighter, tenant-branded
  shell but keep the same header / body / state discipline.

## 2. Data flow: server → client → action → revalidate

- **Fetch** in Server Components + `lib/<domain>/queries.ts`. Never fetch page data
  in a client component (no `useEffect` loads, no client Supabase reads for page data).
- **Interact** in `"use client"` view components (local UI state only).
- **Mutate** via Server Actions that return `{ ok: true } | { error: string }`, after
  re-checking auth/role; then `revalidatePath(...)` to refresh.
- Role is resolved server-side (`getActiveOrg`) and passed down: the client may
  show/hide controls by role, but the **action enforces** it.

```tsx
// page.tsx (server)            → fetch + gate, render <View data isOwner/>
// View.tsx ("use client")      → compose primitives + state matrix; call actions
// app/actions/<thing>.ts       → "use server"; auth + validate + mutate + revalidate
```

## 3. State matrix (no blank screens, ever)

Every content region renders exactly one of:

1. **Loading** → `<Skeleton/>` / `<SkeletonRows/>` shaped like the content (never a
   spinner). Route-level: `loading.tsx` + Suspense.
2. **Empty (true)** → `<EmptyState title body action/>` — explains what appears here
   and offers the first action.
3. **Empty (filtered)** → a *distinct* `<EmptyState/>` ("nothing matches — clear
   filters"); never show "add your first" on a filtered-to-zero list.
4. **Error** → `<ErrorCard onRetry/>` inline, or the route `error.tsx` boundary
   (captures to Sentry via `captureError`). Never a white screen or raw throw.
5. **Content** → the populated UI.

## 4. Visual composition (the design law)

Primitives (compose, never re-style ad hoc): `PageHeader`, `PageBody`, `Section`,
`EmptyState`, `ErrorCard`, `Skeleton`/`SkeletonRows`/`SkeletonStats`, `GlassCard`,
`StatCard`/`AccentStatCard`, `RiskBadge`, `Money`, `Field`/`Textarea`/`Select`,
`Reveal`, `CountUp`, `Sparkline`, the charts.

- Page max-width ~`max-w-5xl`; Sections gap `space-y-6`; cards `rounded-2xl` with the
  shared border + shadow tokens.
- **One signature glass element per view, max.** Purple is an **accent** (primary
  actions, active state, key metrics) — never a background flood. **One ambient wash
  per view, max.**
- Numbers are mono + tabular; money **always** via `<Money/>` (microdollars in,
  `Intl`/`/100` is banned). Headings = display cut (`font-display`), body = Inter.
- Motion: `Reveal` stagger on mount; quick (.15–.4s); `prefers-reduced-motion`
  respected (already global in `globals.css`).

## 5. Interaction patterns

- **Action result contract**: `{ ok: true } | { error: string }`. Client pattern:
  `const r = await act(); if ("error" in r) return toast.error(r.error); toast.success(...)`.
  No throw-to-user; unexpected throws hit `error.tsx` + Sentry.
- **Forms**: dirty tracking, inline validation, pending button state; submit to
  server actions; render field errors from the result.
- **Optimistic UI** for low-risk toggles/selection (revert on error); for
  money/destructive actions, wait for confirmation.
- **Toasts**: `sonner` only (no `alert()`/`console` for user feedback).
- **Dialogs**: destructive/consequential actions confirm; the most destructive
  require typing the count. Pending actions disable the button (no double-fire).

## 6. Navigation & routing

- Route groups: `(app)` dashboard · `(capture)` `r.` · `(portal)` `account.` —
  subdomain middleware routes each.
- Sidebar is the nav source of truth with correct active state + badges.
- **Filters/sort live in `searchParams`** (deep-linkable, survive refresh) and are
  read in the Server Component. Detail routes are `/<thing>/[id]`; back preserves
  filters.

## 7. Responsive · a11y · performance

- Mobile-first (works at 360px): tables collapse to cards; sidebar → drawer; sticky
  action bars stay reachable.
- Semantic elements, labelled controls, visible focus, keyboard-operable, sufficient
  contrast.
- Server Components by default; stream with Suspense; virtualize tables > 200 rows;
  no browser storage (in-memory only).

## 8. Build-a-new-page recipe

1. `app/(app)/dashboard/<thing>/page.tsx` (Server Component).
2. `lib/<thing>/queries.ts` — org-scoped server fetches.
3. `getActiveOrg()` → fetch → pass to `<ThingView>`.
4. `ThingView.tsx` (`"use client"`) → `PageBody` + `PageHeader` + `Section`s, each
   handling the state matrix.
5. States: `loading.tsx` + in-page `Skeleton`; `EmptyState` (true + filtered);
   `ErrorCard` / `error.tsx`.
6. `app/actions/<thing>.ts` — `{ok}|{error}`, auth/role re-check, `revalidatePath`,
   audit for settings/money.
7. Wire forms, optimistic toggles, toasts, confirm dialogs, pending states.
8. Add to the sidebar with active state + badge.
9. Put filters/sort in `searchParams`; read server-side.
10. Polish: `Reveal`, reduced-motion, mobile, `<Money/>`/mono, a11y.
11. Verify against §9.

## 9. Page "done" checklist

- [ ] `PageBody` + `PageHeader` + `Section`s (or branded shell) — no bespoke layout
- [ ] Data fetched server-side; no client page-data fetching
- [ ] Mutations are server actions returning `{ok}|{error}`; actions re-check auth/role
- [ ] All four states handled (skeleton / true-empty / filtered-empty / error) — no blanks
- [ ] P28B primitives reused; one glass + one wash max; purple as accent only
- [ ] Numbers mono; money via `<Money/>`; display headings / Inter body
- [ ] Forms track dirty + pending; destructive actions confirm; toasts via sonner
- [ ] Filters/sort in the URL; detail `/[id]`; sidebar active state correct
- [ ] Mobile-first (360px); keyboard + focus; reduced-motion respected
- [ ] Server Components + Suspense; >200-row tables virtualized; errors captured

## 10. Reference implementations

- `/dashboard/intelligence` and `/dashboard/finances` use `PageBody` + `PageHeader`
  + `EmptyState`.
- `/dashboard/accounts` shows URL-driven filters/sort + a state matrix table.
- `app/(app)/dashboard/{loading,error}.tsx` are the route-level loading/error
  boundaries.
