# Copilot Review Instructions — がんばりクエスト

## Project Overview

がんばりクエスト is a family-use web application that gamifies children's daily activities.
Target users are children aged 3-15 and their parents.
The tech stack is SvelteKit 2 + Svelte 5 (Runes) + Ark UI Svelte + SQLite (Drizzle ORM) + TypeScript strict.
Merging to `main` triggers immediate production deployment via GitHub Actions. Treat every merge as a production release.

## Review Philosophy

You are reviewing code for a **children's product** where quality directly impacts the child's experience and parental trust. Prioritize safety, correctness, and user experience over developer convenience. A surface-level naming or style suggestion is far less valuable than catching a missing validation, a broken age mode, or a hardcoded color that violates the design system.

## Comment Classification (Required)

Use the following prefixes on every comment to indicate severity:

| Prefix | Meaning | Merge Impact |
|--------|---------|-------------|
| `[must]` | Must fix before merge — bugs, security, rule violations | Blocks merge |
| `[imo]` | Design suggestion or alternative approach | Does not block |
| `[ask]` | Clarification question about intent or behavior | Does not block |
| `[nits]` | Minor style or naming suggestion | Does not block |
| `[fyi]` | Reference information, no action needed | Does not block |

Prioritize `[must]` findings. Limit `[nits]` comments — they add noise and distract from critical issues.

## Priority 1: Bugs & Safety

These are the highest-priority review items. Always check for:

- **Exception handling gaps**: Unhandled promise rejections, missing try-catch around DB/API calls, uncaught errors in `+page.server.ts` load functions and form actions
- **Authentication & authorization**: Missing auth checks in `+page.server.ts` or `+server.ts`, exposed admin endpoints without parent PIN verification
- **Input validation**: User-supplied data (form inputs, URL params, query strings) must be validated at system boundaries. Check for SQL injection via raw queries, XSS via unescaped HTML
- **Null/undefined safety**: Optional chaining where required, nullish coalescing with correct fallback values, TypeScript strict compliance
- **Data integrity**: DB transactions where multiple writes must be atomic, race conditions in concurrent operations

## Priority 2: Design System & CSS Rules (ADR-0003, Project Rule)

This project enforces a 3-layer CSS token architecture. Violations are `[must]` findings:

- **No hex colors in `src/routes/`**: `#fff`, `#667eea`, `rgb()`, `rgba()` are all prohibited. Use CSS variables: `var(--color-*)`.
- **No Tailwind default color classes in `src/routes/`**: `bg-red-50`, `text-gray-500`, `border-blue-200` etc. are prohibited. Use `bg-[var(--color-*)]` pattern instead.
- **No inline styles**: `style="..."` attributes are prohibited in route files except for dynamic values (`style:width={pct + '%'}`).
- **Primitive components are mandatory**: All buttons must use `$lib/ui/primitives/Button.svelte`. Raw `<button class="...">` is prohibited. Same for `FormField.svelte` and `Card.svelte`.
- **Ark UI must not be imported directly in routes**: Use wrappers from `$lib/ui/primitives` or `$lib/ui/components`.

If a PR introduces new hardcoded colors or raw HTML elements where primitives exist, mark it `[must]`.

## Priority 3: Lateral Spread & Cross-Cutting Consistency

Changes that affect shared functionality must be applied everywhere. Missing lateral spread is a `[must]` finding:

- **Age modes**: The app has 5 age modes (baby/preschool/elementary/junior/senior). After #664, these are consolidated under `src/routes/(child)/[uiMode=uiMode]/`. If a PR modifies child-facing behavior, verify it works for all 5 modes via the variant system in `src/lib/features/child-home/variants/`.
- **Demo version**: Changes to production app features (`src/routes/(child)/`, `src/routes/(parent)/`) often need corresponding changes in `src/routes/demo/`.
- **Landing page**: UI label or feature name changes must be synced to `site/index.html`, `site/pamphlet.html`, and `site/shared-labels.js`.
- **Navigation**: Navigation changes must cover all 3 nav types: `AdminLayout` (desktop), `AdminMobileNav` (mobile), `BottomNav` (child).
- **Terminology**: UI labels must come from `src/lib/domain/labels.ts` (the terminology dictionary). Hardcoded strings that duplicate dictionary entries are a `[must]` finding.
- **Tutorial**: UI structure changes may break tutorial overlays (`tutorial-chapters.ts`). Check that selectors and step descriptions still match.

## Priority 4: Design Document Sync (ADR-0003 — Merge Blocker)

Design documents are the Single Source of Truth. A PR that changes the following without updating the corresponding design doc is a `[must]` finding:

| Change Type | Required Design Doc Update |
|------------|---------------------------|
| API endpoint add/change | `docs/design/07-API設計書.md` |
| DB table/column add/change | `docs/design/08-データベース設計書.md` |
| UI screen/component add/major change | `docs/design/06-UI設計書.md` |
| AWS infrastructure change | `docs/design/13-AWSサーバレスアーキテクチャ設計書.md` |
| Auth/security change | Security design doc |
| Brand/visual change | `docs/design/15-ブランドガイドライン.md` |

If the PR has no design doc impact, that is acceptable — but the omission should be intentional, not accidental.

## Priority 5: Test Coverage

- **Bug fixes must include regression tests**: A bug fix PR without a corresponding test (unit or E2E) is a `[must]` finding. The fix will be lost in the next refactoring without a test.
- **Critical bug fixes (priority:critical label)** have additional requirements (ADR-0005):
  - E2E regression test in the same PR
  - All Issue Acceptance Criteria completed
  - All proposed countermeasures implemented (or split to separate Issues)
- **Schema changes must update test seeds**: `tests/e2e/global-setup.ts`, `tests/unit/helpers/test-db.ts`, and `src/lib/server/demo/demo-data.ts` must stay in sync with DB schema.

## Priority 6: Image Asset Protection (ADR-0007)

This is a children's gamification app where visual quality is core to the product experience:

- **Never replace image assets with emoji**: If `static/assets/` contains images for a feature (stamps, badges, titles, rewards), they must not be replaced with emoji. This is a `[must]` finding (explicit degradation).
- **Check `docs/design/asset-catalog.md`**: The "emoji NG" list defines which elements require image assets.
- **Orphan check**: If a PR removes references to images in `static/assets/`, verify the images are intentionally being retired (not accidentally orphaned).

## Priority 7: Type Safety (ADR-0009)

- **`as any` is prohibited** in new code. Flag as `[must]`.
- **Non-null assertions (`!`)** should be avoided unless the invariant is obvious and documented.
- **Server→Client type contracts**: When `+page.server.ts` return types change, verify that client-side type casts in `+page.svelte` (especially inside `enhance` callbacks) are updated to match.
- **Svelte 5 Runes**: Use `$state`, `$derived`, `$effect`, `$props`. Old Svelte 4 patterns (`$:` reactive declarations, `export let`) are prohibited.

## Priority 8: Architecture & Code Organization

- **Business logic must not live in route files** (`src/routes/`). Logic belongs in `$lib/server/services/` or `$lib/domain/`.
- **DB access must go through `$lib/server/db`**, never direct ORM calls from `+server.ts`.
- **API errors** must use `@sveltejs/kit`'s `error()` and `json()` for consistent responses.
- **URL redirects**: When URLs are renamed or retired, add entries to `src/lib/server/routing/legacy-url-map.ts` instead of writing `redirect()` in individual route files (ADR-0001).
- **Data fetching**: Use `+page.ts` / `+layout.ts` `load` functions. No direct `fetch()` inside components.

## Priority 9: Performance

- **N+1 queries**: Check `+page.server.ts` load functions for loops that execute individual DB queries.
- **Unnecessary re-renders**: Large `$effect` blocks that trigger on unrelated state changes.
- **Bundle size**: Importing large libraries where a smaller alternative exists.
- **Image optimization**: New image assets should be appropriately sized and compressed.

## Priority 10: Accessibility & Security

- **ARIA attributes**: Interactive elements need appropriate ARIA labels, especially for child-facing UI.
- **Keyboard navigation**: All interactive elements must be keyboard-accessible.
- **COPPA considerations**: This is a children's app. Be alert to data collection or tracking that might raise compliance concerns.
- **Secrets**: `.env` files, API keys, credentials must never be committed.

## Additional Context

### Architecture Decision Records (ADRs)

The project maintains ADRs in `docs/decisions/`. Key decisions to be aware of:

- **ADR-0001**: Renames must maintain backward compatibility via `LEGACY_URL_MAP`
- **ADR-0002**: Only one dialog/overlay at a time (queue required)
- **ADR-0003**: Design docs are Single Source of Truth (merge blocker)
- **ADR-0004**: Stamp card spec — 5 slots, image-based, redeem flow
- **ADR-0005**: Critical fix quality gate — 5 mandatory conditions
- **ADR-0006**: PR review must document findings (no silent approvals)
- **ADR-0007**: Image assets must not be replaced with emoji
- **ADR-0008**: Age mode changes carry 5x duplication risk (mitigated by #664 consolidation)
- **ADR-0009**: Server-client type contracts must be explicitly maintained

### Team Structure

- **Product Owner / Test Manager**: Reviews PRs with full checklist (A-H), makes merge decisions
- **Development Team**: Creates Issues, implements features, submits PRs
- **Copilot (you)**: First-pass automated review — catch rule violations, missing tests, CSS issues, and lateral spread gaps before human review

### What Copilot Should NOT Do

- Do not suggest adding JSDoc or comments to code that is self-explanatory
- Do not suggest renaming variables unless the current name is actively misleading
- Do not flag Tailwind utility classes as "too long" — the project uses Tailwind intentionally
- Do not suggest `try-catch` around every function call — only at actual system boundaries
- Do not recommend alternative libraries or frameworks — the tech stack is fixed

### Dependabot PRs

Dependabot version upgrade PRs should generally be approved, even for breaking changes. If the upgrade requires code changes beyond a simple merge, flag it as `[ask]` with details about what needs to change.
