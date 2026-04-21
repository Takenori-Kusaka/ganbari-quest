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

## Priority 2: Design System & CSS Rules ([archive/0014](../docs/decisions/archive/0014-css-token-architecture.md), Project Rule)

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

## Priority 4: Design Document Sync (ADR-0001 — Merge Blocker)

Design documents are the Single Source of Truth. A PR that changes the following without updating the corresponding design doc is a `[must]` finding:

| Change Type | Required Design Doc Update |
|------------|---------------------------|
| API endpoint add/change | `docs/design/07-API設計書.md` |
| DB table/column add/change | `docs/design/08-データベース設計書.md` |
| UI screen/component add/major change | `docs/design/06-UI設計書.md` |
| AWS infrastructure change | `docs/design/13-AWSサーバレスアーキテクチャ設計書.md` |
| Account deletion flow add/change | `docs/design/account-deletion-flow.md` |
| Auth/security change | Security design doc |
| Brand/visual change | `docs/design/15-ブランドガイドライン.md` |

If the PR has no design doc impact, that is acceptable — but the omission should be intentional, not accidental.

## Priority 5: Test Coverage

- **Bug fixes must include regression tests**: A bug fix PR without a corresponding test (unit or E2E) is a `[must]` finding. The fix will be lost in the next refactoring without a test.
- **Critical bug fixes (priority:critical label)** have additional requirements (ADR-0002):
  - E2E regression test in the same PR
  - All Issue Acceptance Criteria completed
  - All proposed countermeasures implemented (or split to separate Issues)
- **Schema changes must update test seeds**: `tests/e2e/global-setup.ts`, `tests/unit/helpers/test-db.ts`, and `src/lib/server/demo/demo-data.ts` must stay in sync with DB schema.
- **Test anti-patterns (ADR-0005)** — the following are `[must]` findings:
  - Coverage threshold decrease in `vite.config.ts` `thresholds` values
  - New `clearDialogGhosts()` usage outside `tests/e2e/helpers.ts` (masks app bugs)
  - New `test.skip()` / `test.fixme()` without documented justification
  - New `waitForTimeout()` in E2E tests (use proper wait conditions instead)
  - Service test files (`*-service.test.ts`) that don't import the service's public API
  - Test code that re-implements business logic (e.g., `Math.random` probability simulation)
- **Feature PRs must include tests**: A PR adding a new service file without a corresponding test file is a `[must]` finding. The test must call the service's public API, not manipulate the DB directly.

## Priority 6: Image Asset Protection ([archive/0007](../docs/decisions/archive/0007-image-asset-protection.md))

This is a children's gamification app where visual quality is core to the product experience:

- **Never replace image assets with emoji**: If `static/assets/` contains images for a feature (stamps, badges, titles, rewards), they must not be replaced with emoji. This is a `[must]` finding (explicit degradation).
- **Check `docs/design/asset-catalog.md`**: The "emoji NG" list defines which elements require image assets.
- **Orphan check**: If a PR removes references to images in `static/assets/`, verify the images are intentionally being retired (not accidentally orphaned).

## Priority 7: Type Safety (Project Rule)

- **`as any` is prohibited** in new code. Flag as `[must]`.
- **Non-null assertions (`!`)** should be avoided unless the invariant is obvious and documented.
- **Server→Client type contracts**: When `+page.server.ts` return types change, verify that client-side type casts in `+page.svelte` (especially inside `enhance` callbacks) are updated to match.
- **Svelte 5 Runes**: Use `$state`, `$derived`, `$effect`, `$props`. Old Svelte 4 patterns (`$:` reactive declarations, `export let`) are prohibited.

## Priority 8: Architecture & Code Organization

- **Business logic must not live in route files** (`src/routes/`). Logic belongs in `$lib/server/services/` or `$lib/domain/`.
- **DB access must go through `$lib/server/db`**, never direct ORM calls from `+server.ts`.
- **API errors** must use `@sveltejs/kit`'s `error()` and `json()` for consistent responses.
- **URL redirects**: When URLs are renamed or retired, add entries to `src/lib/server/routing/legacy-url-map.ts` instead of writing `redirect()` in individual route files ([archive/0001](../docs/decisions/archive/0001-rename-backward-compat.md)).
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

## Priority 11: Documentation Chain Integrity

Documentation in this project forms a chain. Each link must stay in sync:

    ADR (docs/decisions/) ←→ CLAUDE.md ←→ copilot-instructions.md ←→ Design Docs (docs/design/)

Breaking this chain is a `[must]` finding:

- **ADR added/changed → CLAUDE.md + copilot-instructions.md must be updated in same PR**: If a PR adds/modifies a file in `docs/decisions/`, verify that `CLAUDE.md` ADR list and `.github/copilot-instructions.md` ADR list are both updated.
- **Process decision in PR → ADR should be created**: If a PR introduces a new development rule or quality gate, flag as `[ask]`: "Should this be recorded as an ADR?"
- **CLAUDE.md rule change → copilot-instructions.md should reflect it**: If a PR modifies CLAUDE.md rules, check that copilot-instructions.md has corresponding coverage.

## Priority 12: Development Process Compliance

- **Coverage threshold changes (ADR-0005)**: If `vite.config.ts` `thresholds` values are lowered, this is a `[must]` finding. Lowering thresholds requires an ADR with a restoration plan and explicit PO approval.
- **Issue close quality (ADR-0003)**: If a PR closes an Issue that lacks root cause analysis or acceptance criteria, flag as `[ask]`.
- **Dialog management ([archive/0019](../docs/decisions/archive/0019-dialog-fsm-scrap-and-rebuild.md))**: Dialog/overlay display on the child home page must use the FSM scrap-and-rebuild approach. New `xxxOpen = true` direct state manipulation for overlays is a `[must]` finding.
- **Design doc sync (ADR-0001)**: Verify design docs are updated for API/DB/UI changes (see Priority 4).

## Additional Context

### Architecture Decision Records (ADRs)

The project maintains ADRs in `docs/decisions/`. #1262 で旧 0001-0044 を 10 件の active ADR に再編済み。active は `docs/decisions/NNNN-*.md`、archived (25 件) は `docs/decisions/archive/NNNN-*.md`、supersede chain 終端 5 件 (旧 0002 / 0008 / 0009 / 0016 / 0027) は削除済み。

#### Active ADRs (TOP 10)

- **ADR-0001**: [設計書は Single Source of Truth](../docs/decisions/0001-design-doc-as-source-of-truth.md) — 会話で決まった仕様は設計書に反映、Issue だけでは不十分
- **ADR-0002**: [Critical 修正の品質ゲート](../docs/decisions/0002-critical-fix-quality-gate.md) — 5 年齢モード実機検証 + 回帰 E2E + AC 全項目完了
- **ADR-0003**: [Issue 起票・クローズ品質](../docs/decisions/0003-issue-quality-standard.md) — 根本原因特定 + 構造的解決 + スクラップ&ビルド + 単一解決策
- **ADR-0004**: [レビュー & AC 検証品質](../docs/decisions/0004-review-and-ac-verification.md) — Issue `ac-verification-plan` 必須、PR「AC 検証マップ」、CI 3 本 (`pr-ac-verification-check` / `issue-close-gate` / `ac-audit-monthly`) で機械強制
- **ADR-0005**: [テスト品質 ratchet](../docs/decisions/0005-test-quality-ratchet.md) — カバレッジ閾値は上げるのみ、アンチパターン検出は `[must]` 所見化
- **ADR-0006**: [Safety Assertion Erosion Ban](../docs/decisions/0006-safety-assertion-erosion-ban.md) — production guard 劣化禁止 5 項目 (warn 化 / NODE_ENV skip / `ALLOW_*=true` / retry 延長 / `.skip` 追加)。新規必須 env は PR 本文に「配布済み:」証跡必須 (`scripts/check-new-required-env.mjs`)
- **ADR-0007**: [静的解析 tier ポリシー](../docs/decisions/0007-static-analysis-tier-policy.md) — T1 PR ゲート (< 30s、merge block) / T2 並行レーン / T3 nightly / T4 四半期。T1 合計予算 3min 以下、新規追加は +30s 以下目安
- **ADR-0008**: [設計ポリシー先行確認フロー](../docs/decisions/0008-design-policy-pre-approval.md) — 新テーブル / 新 interface / セキュリティ機能 / 課金変更 / AWS リソース追加 / 3 人日以上は実装着手前に PO 合意必須
- **ADR-0009**: [labels.ts SSOT 化原則](../docs/decisions/0009-labels-ssot-principle.md) — プラン名 / 年齢モード名 / 機能名は `src/lib/domain/labels.ts` / LP は `site/shared-labels.js` 経由。BANNED_TERMS を CI (`scripts/check-banned-terms.mjs`) で自動検出
- **ADR-0010**: [Pre-PMF スコープ判断](../docs/decisions/0010-pre-pmf-scope-judgment.md) — 3 バケット (A 実装+LP / B LP のみ / C 沈黙) + セキュリティ最小化 + `type:feat` 優先度チェックリスト。汎用監査ログ / WAF / IP 単位ブルートフォース検知は不採用
- **ADR-0012**: [Anti-engagement 原則](../docs/decisions/0012-anti-engagement-principle.md) — 子供側 UI の滞在時間は価値毀損指標。連続ガチャ / インフィニットスクロール / 通知連打 / 自動再生 / サプライズ濫用は原則不採用。日 1 回 cap の短時間 interaction は許容。LP / 販促文言も同じ審査対象 (#1309)

#### Archived ADRs (参照のみ)

archive 配下のファイルは supersede ヘッダで新 ADR への統合先を明示。参照が必要な場合のみ `docs/decisions/archive/` を辿ること。代表例:

- 技術スタック採用: SvelteKit 2 + Svelte 5 / DynamoDB 単一テーブル / Cognito + Google OAuth / 3-layer CSS トークン / Repository pattern → [archive/0011-0015](../docs/decisions/archive/)
- Dialog FSM scrap-and-rebuild → [archive/0019-dialog-fsm-scrap-and-rebuild.md](../docs/decisions/archive/0019-dialog-fsm-scrap-and-rebuild.md)
- Billing/License: Stripe causality / license key HMAC / retention physical delete → [archive/0022 / 0025 / 0026 / 0028](../docs/decisions/archive/)
- E2E / schema / ops authz: Cognito E2E user lifecycle / schema change compat testing / ops dashboard authz → [archive/0030 / 0031 / 0033](../docs/decisions/archive/)
- Marketplace: public access / naming / gender variant → [archive/0036 / 0041 / 0042](../docs/decisions/archive/)
- Demo mode / runtime mode: demo 統合 / 実行モード × license 統括 → [archive/0039-0040](../docs/decisions/archive/)
- Primitive / bypass evidence: native select / admin bypass evidence → [archive/0043-0044](../docs/decisions/archive/)

### ADR 棚卸レポート

- [adr-inventory-2026-04-19.md](../docs/decisions/adr-inventory-2026-04-19.md) — 旧 0001〜0039 棚卸。0008 / 0009 / 0016 を supersede、active-primary 12 件特定
- [adr-inventory-2026-04-20.md](../docs/decisions/adr-inventory-2026-04-20.md) — 新体系 0001-0010 + archive 25 件の最終棚卸 (#1262 sub-7 完了)

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
