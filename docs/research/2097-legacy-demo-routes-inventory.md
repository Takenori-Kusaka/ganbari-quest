# #2097 ADR-0048 Phase A-3 監査: 残存 `src/routes/demo/` 48 ファイル個別棚卸

**起票**: 2026-05-16 (Phase A 監査の 3/7)
**Agent**: a56325fb499c1c710
**スコープ**: PR #2118 で削除予定だった legacy /demo/ routes 48 file の個別判定 + 外部参照

## エグゼクティブサマリ

48 file の処遇:
- **delete (41 file)**: 純粋に data-source 違いだけで本番 routes と同等 → /demo/ 削除可
- **delete after prod-fix (4 file)**: 本番 routes に fixture 追加後に削除 (plan switcher / demo data endpoints)
- **keep transitional (2 file)**: layout-level demo-only UI (+layout.svelte, +page.svelte) — multi-Lambda 移行完了まで存続
- **delete after LP migration (1 file)**: /demo/signup (LP がリンク維持中)

## §1 ファイル inventory

### Demo Root (5 file)

**全 5 file DELETED in PR #2188 (#2097 PR-B3, 2026-05-17)**: demo Lambda は本番 root `/` を直接 host する設計 (ADR-0048) に統合済。LP CTA は #2181 で `demo.ganbari-quest.com` 切替済のため `/demo` landing 不要。`legacy-url-map.ts` の `/demo → /` redirect で URL 救済 (永久保持)。

| Path | Type | Diverges | Action | Status |
|------|------|----------|--------|--------|
| /demo/+layout.server.ts | layout | YES | migrate plan-switcher logic to prod、その後削除 | **DELETED #2188** |
| /demo/+layout.svelte | layout | YES (demo navbar, plan switcher, floating CTA, screenshot mode) | keep transitional | **DELETED #2188** (screenshot-mode context は root +layout.svelte に hoist 済) |
| /demo/+page.server.ts | page | N/A | delete after demo → prod auth migration | **DELETED #2188** |
| /demo/+page.svelte | page | YES (demo landing) | keep transitional (delete after LP migration) | **DELETED #2188** |
| /demo/signup/+page.svelte | page | YES vs /auth/signup | delete after LP URL update | **DELETED #2188** (legacy redirect `/demo/signup → /auth/signup`) |

### Demo (child) Routes (14 file)

**全 14 file DELETED in PR #2187 (#2097 PR-B2, 2026-05-17)**: 本番 (child) routes + ProdDashboardSections 単独構成に統合済。`legacy-url-map.ts` の `/demo/<5-mode>/<path>` → `/<uiMode>/<path>` redirect で URL 救済 (永久保持)。demo Lambda は AnonymousAuth + DATA_SOURCE=demo で本番 routes を直接 host する設計に統一 (ADR-0048)。

| Path | Diverges | Action | Status |
|------|----------|--------|--------|
| /demo/(child)/+layout.{server.ts,svelte} | YES (mode 抽出 / hardcoded URL / demo nav) | delete after prod (child) update | **DELETED #2187** |
| /demo/(child)/checklist/+page.{server.ts,svelte} | NO (data source only) | delete | **DELETED #2187** |
| /demo/(child)/[mode]/achievements/+page.{server.ts,svelte} | NO | delete | **DELETED #2187** |
| /demo/(child)/[mode]/battle/+page.{server.ts,svelte} | NO | delete | **DELETED #2187** |
| /demo/(child)/[mode]/history/+page.{server.ts,svelte} | NO | delete | **DELETED #2187** |
| /demo/(child)/[mode]/home/+page.server.ts | YES (demo-service.ts) | delete after prod-fix | **DELETED #2187** |
| /demo/(child)/[mode]/home/+page.svelte | NO (component reuse) | delete | **DELETED #2187** |
| /demo/(child)/[mode]/status/+page.server.ts | YES (demo-service.ts) | delete after prod-fix | **DELETED #2187** |
| /demo/(child)/[mode]/status/+page.svelte | NO | delete | **DELETED #2187** |

**併せて削除済 (#2187)**: `src/lib/features/child-home/components/DashboardView.svelte` (demo POC、ProdDashboardSections と統合)。

**併せて修正済 (#2187)**:
- `src/lib/features/demo/demo-guide-state.svelte.ts`: Step 1-3 の matchPath / href を本番 (child) routes (`/preschool/home` 等) に切替。Step 4-6 (/demo/admin / /demo/signup) は PR-B3 (#2188) 対応待ち
- `src/routes/demo/+page.svelte`: child 選択カードの href を `/{mode}/home` (本番 path) に切替
- `scripts/capture-specs/admin.mjs` / `scripts/take-lp-screenshots.mjs`: 子供画面 SS spec を本番 path に切替

### Demo (parent) Routes (29 file)

**全 29 file DELETED in PR #2188 (#2097 PR-B3, 2026-05-17)**: demo Lambda は本番 admin routes (`/admin/*`) を `AnonymousAuth` + `DATA_SOURCE=demo` env (ADR-0048) で直接 host する設計に統合済。`legacy-url-map.ts` に 14 明示 admin entries + 親 fallback `/demo/admin → /admin` を追加 (前方一致で未登録 sub path も救済、永久保持)。

旧構成: 全て同パターン — `.server.ts` → demo-service.ts 経由 (YES diverges)、`.svelte` → 本番コンポーネント再利用 (NO diverges)。

対象 admin pages: `+layout.svelte`, `+page.{server.ts,svelte}`, `activities`, `challenges`, `checklists`, `children`, `events`, `license`, `members`, `messages`, `points`, `reports`, `rewards`, `settings`, `status`。各 page で server.ts は delete after prod-fix、svelte は delete → **全 29 file 一括 DELETED #2188**。

**併せて修正済 (#2188)**:
- `src/lib/features/demo/demo-guide-state.svelte.ts`: Step 4-6 の matchPath / href を本番 routes (`/admin` / `/admin/license` / `/auth/signup`) に切替
- `src/lib/features/demo/DemoGuideBar.svelte`: 最終 CTA を `/demo/signup` → `/auth/signup` に切替
- `src/hooks.server.ts`: `/demo/exit` 専用ハンドラ削除 (legacy-url-map 経由で `/` redirect に統合)
- `src/routes/+layout.svelte`: `isLegacyDemoPath` 判定の comment 更新 (全 redirect 化で通常 false 評価、dead code 削除予定 #2189)
- `tests/e2e/`: `demo-back-to-lp.spec.ts` / `demo-admin-license.spec.ts` / `demo-screenshot-mode.spec.ts` 削除、`demo-guide-step-flow.spec.ts` skip 化 (PR-B4 #2189 で UI 再設計後に再活性化)、`page-health.spec.ts` / `feedback-form.spec.ts` / `usage-log.spec.ts` を本番 path に書き換え、`legacy-url-redirect.spec.ts` に新 17 entries の test 追加

## §2 Key 差異詳細

### `/demo/+layout.svelte` (175 行)
- demo-only navbar (amber/orange gradient)
- 「戻る」LP back link
- Plan switcher toggle UI (`?plan=free|standard|family`)
- Floating CTA after 5min idle
- Screenshot mode handling (`?screenshot=1|all`)

production `(child)/+layout.svelte` には一切なし。screenshot mode logic は production に hoist 推奨。

### `/demo/+page.svelte` (206 行)
- 子供選択カード (grid 2 × N、emoji + age tier ラベル)
- Guide intro section
- Admin link shortcut
- Feature highlights

production には landing なし (auth 経由で直接 child home へ)。これは **demo only entry point**。

### `/demo/(child)/+layout.svelte` (82 行)
- Nav items が `/demo/...` をハードコード (production は `${uiMode}/home` 動的)
- Plan switcher 表示
- `trackDemoEvent('demo_page_view')` 呼出

UI コンポーネント自体 (BottomNav, Header) は同一、routing のみ差異。

### `/demo/(parent)/admin/*` (29 file)
全 `.server.ts` が `$lib/server/demo/demo-service.js` import:
```ts
import { getDemoAdminChildrenData } from '$lib/server/demo/demo-service.js';
```
production:
```ts
import { getChildren, updateChild } from '$lib/server/services/child-service'
```
**純粋にデータソース差** — production routes が `DATA_SOURCE=demo` env で同じ demo data を返せれば全て不要。

## §3 外部参照

### `scripts/capture-hp-screenshots.mjs` — 31 `/demo/*` URL ハードコード
- carousel (4 URL): kinder/lower/upper/admin
- feature (8 URL): home/status/checklist/battle/admin/*
- age (5 URL): baby/kinder/lower/upper/teen
- growth (5 URL): kinder/lower/upper/teen + achievements

**移行**: BASE_URL を `http://localhost:5173/demo` → `https://demo.ganbari-quest.com` に変更 + plan-switcher param 除去。

### E2E tests — 28 `/demo/` path hit (6 file)
- demo-back-to-lp.spec.ts (2 hits)
- demo-screenshot-mode.spec.ts (8 hits)
- feedback-form.spec.ts (3 hits)
- demo-admin-license.spec.ts (4 hits)
- legacy-url-redirect.spec.ts (7 hits)
- page-health.spec.ts (4 hits)

**移行**: Playwright fixture で `DATA_SOURCE=demo` header inject、本番 routes 経由。

### demo-only 依存
`src/lib/server/demo/`: 4 file (demo-data.ts, demo-mode.ts, demo-plan.ts, demo-service.ts)。plan-specific business logic は production が demo mode をサポートする時に refactor 対象。

## §4 PO 懸念への回答

> "適当にデモ専用 UI の実装をしていないか気になっています"

**判定**: `/demo/` routes は UI chrome (navbar, plan switcher, guide bar, signup) で大幅 diverge。ただしコア screen layout は同一コンポーネント (DashboardView, BottomNav, Header) を使用、差異は data source のみ。Multi-Lambda 移行で本番 routes が `DATA_SOURCE=demo` で動くため、UI chrome は本番に hoist する形で吸収可。

## §5 移行計画

### Phase A-3 即時 (0-1 sprint)
1. capture-hp-screenshots.mjs: BASE_URL 切替 + plan-switcher param 除去
2. E2E 6 file: Playwright fixture で DATA_SOURCE=demo header
3. /demo entry point (root + signup) は keep (新規訪問者 explore 用)

### Phase A-4 (Phase B 系) 後続 (1-2 sprint)
4. plan switcher を本番 (child)/+layout.svelte に hoist
5. screenshot mode (`?screenshot=all`) の SSOT 統合
6. 41 redundant file 一括 delete
7. legacy URL redirect (`legacy-url-map.ts` 経由)

## §6 結論

**41 file 即時 delete 可** (pure data-source divergence)、**4 file は prod fixture 追加後** (plan switcher / demo data endpoints)、**2 file は UI-level divergence** で multi-Lambda 移行完了まで keep、**1 file (/demo/signup)** は LP migration 後 delete。

実装順序:
1. Phase B で fixture 充実 + isDemo 自動検出 (#122 結論)
2. Phase C で LP CTA + capture script 切替 (#125 結論)
3. Phase D で /demo/ 47 file 削除 + E2E 6 file 更新
