# 並行実装マップ — がんばりクエスト

**ステータス**: 🟥 **注意** — 本プロジェクトには同じ概念を扱う並行実装が 8 カテゴリ以上存在する。
修正時には必ずこのマップを参照し、すべての並行実装ペアに対応を行うこと。

**最終更新**: 2026-04-07（#564 Tier 1 対策として新設）

---

## なぜこのマップが必要か

同じ概念を扱う並行実装が複数存在するため、片方だけ修正して片方が放置される「同期漏れ」が繰り返し発生している。

### 直近の同期漏れ事例

| Issue | 事象 | 原因の並行実装ペア |
|-------|------|------------------|
| [#531](https://github.com/Takenori-Kusaka/ganbari-quest/issues/531) | 「ちゃんの」suffix修正の横展開漏れ | 5 つの年齢モードディレクトリ |
| [#561](https://github.com/Takenori-Kusaka/ganbari-quest/issues/561) | LP の「ようちえんキッズ」が #537 年齢区分再設計時に漏れた | アプリラベル vs LPラベル |
| [#562](https://github.com/Takenori-Kusaka/ganbari-quest/issues/562) | デモシードが年齢区分再設計に追従せず矛盾 | 本番コード vs デモシード |
| [#563](https://github.com/Takenori-Kusaka/ganbari-quest/issues/563) | デモガイドが Step 2 で停止 | 本番チュートリアル vs デモガイド |

---

## 並行実装ペア一覧

### 🔴 優先度: 最高 — 同期漏れが頻発

#### 1. アプリ (src/) vs LP (site/)

| 場所 | 内容 | 技術 |
|------|------|------|
| `src/lib/domain/labels.ts` | アプリの用語辞書（Single Source of Truth） | TypeScript |
| `src/lib/domain/validation/age-tier-types.ts` | UiMode 型・LEGACY_UI_MODE_MAP・normalizeUiMode（#980: labels.ts / age-tier.ts 共通基盤） | TypeScript |
| `site/index.html` | LP トップページの用語直書き | 静的 HTML |
| `site/pamphlet.html` | パンフレットページの用語直書き | 静的 HTML |
| `site/shared-labels.js` | LP 共通用語ラッパ（2026-04-07 新設、#561） | JavaScript |

**同期メカニズム**:
- **現状（半自動）**: `scripts/generate-lp-labels.mjs` で `labels.ts` から `site/shared-labels.js` を生成。`--check` モード (CI) で diff があれば fail
- **CI 検出層 (#1739 R25)**: `scripts/check-ssot-parallel-impl.mjs` が **key-set 比較**で silent drift を検出。生成器 (`generate-lp-labels.mjs`) の parser が未対応な新規 `LP_*_LABELS` namespace を labels.ts に追加した瞬間に CI red になる。両者を CI に並べることで「parser バグ」と「反映漏れ」の両面を捕捉
- **Tier 3（#566 で予定）**: LP ビルド時の Svelte から静的 HTML 生成（SSG 統合）

**修正時チェック**:
```bash
# アプリ側の用語変更が LP に影響していないか grep
grep -rn "変更前の用語" site/ src/lib/domain/labels.ts

# labels.ts に新規 LP_*_LABELS を追加した場合、shared-labels.js への反映を確認
node scripts/generate-lp-labels.mjs        # shared-labels.js 再生成
node scripts/check-ssot-parallel-impl.mjs  # 集合比較で整合検証
```

**新規 LP_\*_LABELS namespace 追加時の手順**:
1. `src/lib/domain/labels.ts` に `export const LP_FOO_LABELS = { ... }` を追加
2. `scripts/generate-lp-labels.mjs` の `parseLabelsTs()` で `parseBlock(src, 'LP_FOO_LABELS')` を追加し、`lpLabels` ネストに組み込む
3. `node scripts/generate-lp-labels.mjs` で `site/shared-labels.js` 再生成
4. `node scripts/check-ssot-parallel-impl.mjs` で整合確認 (CI が同じ検証を実行)
5. shared-labels.js に注入しない方針 (例: hero band は Svelte 化待ち) なら `check-ssot-parallel-impl.mjs` の `LABELS_TS_EXCLUDED_NAMESPACES` に追加

---

#### 2. 年齢モード 5 ディレクトリ

| 場所 | 内容 |
|------|------|
| `src/routes/(child)/baby/` | 乳幼児モード（0〜2歳）— **ADR-0011 で「親の準備モード」として別軸扱い** (#1299) |
| `src/routes/(child)/preschool/` | 幼児モード（3〜5歳） |
| `src/routes/(child)/elementary/` | 小学生モード（6〜12歳） |
| `src/routes/(child)/junior/` | 中学生モード（13〜15歳） |
| `src/routes/(child)/senior/` | 高校生モード（16〜18歳） |

**差別化軸の実態** (#1320 §2.1、`lp-content-map.md` §2.1):

- **preschool vs 小学生以降 (elementary/junior/senior)**: UI 軸差 (ひらがな vs 漢字 / タップ 80px vs 44-56px / fontScale 1.2 vs 1.0)
- **elementary / junior / senior の相互差**: コード上は **ゼロ** (活動プリセットの差のみ)
- **baby**: 準備モード (ADR-0011)、コアゲーム体験なし
- **機能差別化**: LP で「中学生から解放」「upper 専用機能」等の訴求を書かないこと (LP truth、ADR-0013)

**同期メカニズム**:
- **現状（手動）**: 1 モード修正 → 残り 4 モードを手動で横展開
- **Tier 3（#566 で予定）**: `src/routes/(child)/[uiMode]/` のパラメータルートに集約

**修正時チェック**:
```bash
# 特定機能のファイル横串検索
grep -rn "修正対象のコンポーネント名" src/routes/\(child\)/
```

**旧名称との対応** (2026-04-06 #537 で改名):
- `baby` ← 旧 `baby`（変更なし）
- `preschool` ← 旧 `kinder`
- `elementary` ← 旧 `lower` + 一部 `upper`
- `junior` ← 旧 `upper` の 13 歳以上 + 旧 `teen` の 15 歳
- `senior` ← 旧 `teen` の 16 歳以上

---

#### 3. 本番コード vs デモ

| 場所 | 内容 |
|------|------|
| `src/routes/(child)/`, `src/routes/(parent)/` | 本番コード（demo Lambda は AUTH_MODE=anonymous + DATA_SOURCE=demo で本番 routes を直接 host、ADR-0048）。`src/routes/demo/` 配下の並行実装は存在しない（新規追加禁止） |
| `src/lib/server/demo/demo-data.ts` | デモ用シードデータ（静的、`src/lib/server/db/demo/*.ts` factory pattern 経由で本番 routes に注入予定 ADR-0048） |

**同期メカニズム**:
- **本番 / demo の UI 並行は存在しない (#2097 / ADR-0046 / ADR-0048)**: child home は `ProdDashboardSections.svelte` 単独構成、demo Lambda は AnonymousAuth + DATA_SOURCE=demo で本番 routes を直接 host。`src/routes/demo/**` 配下は 0 file
- **legacy URL 救済 (永久保持)**: `legacy-url-map.ts` に `/demo/<5-mode>/<path>` → `/<uiMode>/<path>` / `/demo/checklist` → `/checklist` / `/demo/admin/**` → `/admin/**` 等を保持

**修正時チェック**:
- 本番 (child) routes (`src/routes/(child)/[uiMode=uiMode]/`) のみが UI SSOT。`src/routes/demo/(child)/**` は #2187 で撤去済み、デモ専用 child ページの新規追加は禁止
- デモシードのデータ構造がスキーマと整合しているか `tests/unit/demo/demo-data-integrity.test.ts` で検証

**本番 admin ⇔ デモ admin の並行ペア (#2097 PR-B3 / #2188)**:

| 本番 | デモ | 状態 |
|------|------|------|
| `src/routes/(parent)/admin/**` | （並行実装なし） | 本番 admin routes のみが SSOT。`legacy-url-map.ts` 14 明示 entries + 親 fallback `/demo/admin → /admin` で旧 URL 救済 (永久保持) |

> `AdminLayout.svelte` の `basePath` は `/admin` 単一系統。
> demo 側に新規 admin ページを追加することは禁止（demo Lambda は本番 routes を直接 host、
> ADR-0048）。本番 admin にページを追加した際は通常通り `(parent)/admin/<slug>/` を作成し、
> demo Lambda は ECR 同 image で自動追従する。

---

### 🟡 優先度: 高 — 定期的な漏れがある

#### 4. デスクトップナビ vs モバイルナビ（管理画面 + 子供画面）

| 場所 | 内容 |
|------|------|
| `src/lib/features/admin/components/AdminLayout.svelte` | 管理画面の Desktop ドロップダウン + **Mobile ボトムナビ（同居）** |
| `src/lib/ui/components/BottomNav.svelte` | 子供画面の BottomNav（ホーム / つよさ / かぞく） |

> **実態**: `AdminMobileNav.svelte` は**存在しない**。
> 管理画面のモバイルナビは `AdminLayout.svelte` の同一ファイル内に Desktop ドロップダウンと並列で定義されており、
> `md:hidden` / `md:block` の Tailwind responsive クラスで表示切替している
> （`navCategories` は `$derived` で 1 回だけ構築し両方で共有）。
> 以前の計画では `AdminMobileNav.svelte` の分離を想定していたが、
> ナビ項目の多重化を避けるため単一ファイルで統合する現行設計を採用している。
>
> **#1396 時点の tab 構成（ホーム + 3 カテゴリ = 4 tab）**:
> - ホーム（🏠、直接 `basePath` へ遷移、dropdown なし）
> - 活動（🎮）: 活動管理 / チェックリスト / イベント / チャレンジ / マケプレ / こども
> - 記録（📊）: レポート / グロースブック / チャレンジ履歴 / アナリティクス / ポイント / おうえん / ごほうび
> - 設定（⚙️）: 設定 / プラン / 請求管理 / メンバー

**BottomNav との棲み分け**:
- `BottomNav.svelte` は**子供画面専用**（ホーム / つよさ / かぞく）で、管理画面のナビではない
- 管理画面への導線（マケプレ等の親向け機能）は `BottomNav` の対象外
- よってマケプレのような親向け機能を追加する際は `AdminLayout` のみ更新し、`BottomNav` への追加は不要

**同期メカニズム**:
- **現状（手動）**: 管理画面ナビ項目追加 → `AdminLayout.svelte` の `navCategories` 配列に 1 エントリ追記（Desktop / Mobile の両方が自動で反映される）
- 子供画面ナビが変わる場合のみ `BottomNav.svelte` を別途更新
- **Tier 2（#565 で予定）**: `src/lib/domain/navigation.ts` に一元化（現行は `AdminLayout` 内同居で十分機能しているため優先度低）

**修正時チェック**:
```bash
# 管理画面ナビ項目の横串検索（AdminLayout 1 ファイルで Desktop+Mobile 両方に効く）
grep -n "navCategories\|NAV_ITEM_LABELS" src/lib/features/admin/components/AdminLayout.svelte

# 子供画面 BottomNav は独立
grep -n "bottom-nav\|data-testid" src/lib/ui/components/BottomNav.svelte
```

---

#### 5. 本番ナビ vs デモナビ

| 場所 | 内容 |
|------|------|
| 本番 admin | `src/routes/(parent)/admin/` |
| デモ admin | 並行実装なし — demo Lambda は本番 admin routes を直接 host (ADR-0048) |

**同期メカニズム**:
- **デモ admin 並行ナビは存在しない**: 本番 `AdminLayout` のみが唯一の admin ナビ SSOT
- **demo Lambda 環境**: `AnonymousAuth` + `DATA_SOURCE=demo` env で本番 admin routes が demo データで稼働 (ADR-0048)
- **Tier 3 (旧 #566)**: 不要 (デモアダプタは Multi-Lambda 構成で代替された)

---

#### 6. 本番チュートリアル vs デモガイド

| 場所 | 内容 |
|------|------|
| `src/lib/features/tutorial/tutorial-chapters.ts` | 本番チュートリアル |
| `src/lib/features/demo/demo-guide-state.svelte.ts` | デモガイドツアー |

**同期メカニズム**:
- **現状（別ロジック）**: UI も進行ロジックも独立
- 将来的に共通化を検討

**修正時チェック**:
- ナビ構造変更 → 両方のセレクタ更新が必要
- ページ追加 → 両方のステップ定義更新が必要

---

#### 6.5 親 PIN gate (`/switch` modal + `/admin/*` middleware + reset + onboarding) (EPIC #2310 / #2353)

| 場所 | 内容 |
|------|------|
| `src/routes/switch/+page.svelte` | PIN modal UI (Dialog + PinInput primitive) + 「PINを忘れた方」link (#2353) |
| `src/routes/switch/+page.server.ts` `select` action | 子供モード切替時の cookie 明示削除 (構造的核心) |
| `src/routes/(parent)/admin/+layout.server.ts` | PIN gate middleware (未認証時 `/switch?pinRequired=1&next=…` redirect + sliding refresh) |
| `src/lib/server/services/parent-gate-session.ts` | 署名 cookie 発行 / 検証 / sliding refresh の SSOT |
| `src/routes/api/v1/parent-gate/verify/+server.ts` | PIN verify endpoint + cookie 発行 |
| `src/routes/api/v1/parent-gate/logout/+server.ts` | cookie 削除 endpoint |
| `src/lib/server/services/pin-reset-service.ts` (#2353) | jose JWT 30 分 token 発行 / 検証 / JTI consume (1 回限り) |
| `src/lib/server/services/email-service.ts` `sendPinResetEmail` (#2353) | SES magic link 配信 |
| `src/routes/api/v1/parent-gate/reset/request/+server.ts` (#2353) | reset 要求 (email 入力、enumeration 防止 200 維持) |
| `src/routes/api/v1/parent-gate/reset/verify/+server.ts` (#2353) | reset 完了 (token + 新 PIN → setupPin + consume) |
| `src/routes/auth/forgot-pin/+page.svelte` (#2353) | reset Step 1 (email 入力) |
| `src/routes/auth/reset-pin/[token]/+page.svelte` (#2353) | reset Step 2 (新 PIN 設定、PinInput primitive 再利用) |
| `src/lib/domain/labels.ts` `OYAKAGI_LABELS` / `PIN_RESET_LABELS` / `PIN_GATE_ONBOARDING_LABELS` (#2353) | 全文言 SSOT (atom 経由化、ADR-0045 §3.3 整合) |
| `src/lib/domain/terms.ts` `OYAKAGI_TERMS` / `PIN_DEFAULT_TERMS` (#2353) | atom (おやカギコード / 初期値 5086 ヒント) |
| `src/routes/(child)/+layout.server.ts` `loadPinGateOnboardingSeen` (#2353) | onboarding dialog 表示要否 (settings.pin_gate_onboarding_seen) |
| `src/routes/(child)/+layout.svelte` (#2353) | PIN gate 初心者導線 dialog (baby モード除外) |
| `src/routes/api/v1/settings/pin-gate-onboarding/+server.ts` (#2353) | onboarding 既読 persist endpoint |

**修正時チェック**:
- Cookie 名 `gq_parent_session` の追加変更は全 4 箇所同時更新 (service の `PARENT_SESSION_COOKIE_NAME` SSOT 経由で参照、文字列直書き禁止)
- timeout 値 (`INACTIVITY_TIMEOUT_MS=15min` / `MAX_SESSION_MS=24h`) 変更は ADR-0050 §4 + 14-セキュリティ設計書.md §4.3 と同期
- 新規 `/admin/*` ページ追加: middleware は layout で一括適用されるため個別 page 側の対応不要 (PIN gate は config-free)
- 新規 PO 系 endpoint で「子供モード切替時 cookie 破棄」相当ロジックが必要になった場合は `/api/v1/parent-gate/logout` を呼ぶ
- reset token TTL (30 分) 変更は ADR-0050 §4 補論 + 14-セキュリティ設計書.md §4.4 と同期、`RESET_TOKEN_TTL_SEC` 定数経由で参照
- onboarding dialog 文言変更は `PIN_GATE_ONBOARDING_LABELS` SSOT 経由 (Svelte 直書き禁止)
- PIN 初期値 5086 ヒントは setup 完了画面 / onboarding dialog / `/admin/settings` PIN 変更画面でのみ表示。`/switch` PIN gate modal では非表示 (#2353 設計欠陥 5)

---

#### 6.6 NUC (nuc-prod) vs SaaS (aws-prod) UI 分岐 (EPIC #2327 / ADR-0051)

| 場所 | 内容 |
|------|------|
| `src/hooks.server.ts` | `event.locals.runtimeMode` 解決 (ADR-0040 SSOT、既存) |
| `src/app.d.ts` | `App.Locals.runtimeMode` 型定義 (既存) |
| `src/routes/(parent)/admin/+layout.server.ts` | `data.runtimeMode = locals.runtimeMode` 配布 (#2328) |
| `src/routes/(parent)/admin/license/+page.svelte` | 薄ラッパー、`{#if data.runtimeMode === 'nuc-prod'}` 2 分岐 (#2331) |
| `src/lib/features/admin/components/NucLicensePanel.svelte` | NUC 専用 (Edition badge + 簡略 3 セクション、#2329) |
| `src/lib/features/admin/components/SaasLicensePanel.svelte` | SaaS 専用 (AWS 用 7 セクション、`planTier` SSOT 統一 + placeholder 削除、#2330) |

**同期メカニズム**:
- **現状 (集約)**: `locals.runtimeMode` を `+layout.server.ts` 1 箇所で `data` に配布、`+page.svelte` 1 箇所で 2 分岐
- **拡張時**: 他 admin route に NUC/SaaS 分岐が必要になったら同パターンを踏襲 (ADR-0051 §3.4)

**修正時チェック**:
- `runtime-mode.ts` (ADR-0040) の値変更 → 全 panel の `{#if data.runtimeMode === ...}` を grep で全件確認
- panel 内で mode 分岐を散在させない (ADR-0015 年齢帯 variant と同型のアンチパターン回避)
- 共通ロジック (LICENSE_PAGE_LABELS 等) は labels.ts SSOT、NUC 専用 atom (NUC_EDITION_TERMS) は terms.ts に分離 (ADR-0045)
- 詳細: [docs/design/nuc-saas-runtime-bifurcation.md](nuc-saas-runtime-bifurcation.md)

---

### 🟢 優先度: 中 — スキーマ変更時に注意

#### 7. シードデータ vs マイグレーション

| 場所 | 内容 |
|------|------|
| `tests/e2e/global-setup.ts` | E2E テスト用シードデータ |
| `tests/unit/helpers/test-db.ts` | ユニットテスト用 DB 初期化 |
| `drizzle/` | 本番マイグレーション |
| `src/lib/server/demo/demo-data.ts` | デモ用シードデータ |

**同期メカニズム**:
- **現状（手動）**: スキーマ変更 → シード 3 箇所を手動更新
- **Tier 2（#565 で予定）**: シード生成の一元化

**修正時チェック**:
- DB テーブル追加 → `tests/e2e/global-setup.ts` + `test-db.ts` + `demo-data.ts` 全て更新
- DB カラム追加 / 削除 → 上記 3 箇所 + 各種 integration テストの `CREATE TABLE` (`tests/integration/api/*.test.ts`, `tests/integration/services/*.test.ts`, `tests/unit/db/schema.test.ts`) 全て更新

##### 既知の並行ペア（DB スキーマ）

| 列 | SQLite schema | E2E setup ALTER | test-db.ts | demo-data.ts | 関連 Issue |
|----|--------------|-----------------|------------|--------------|-----------|
| `activities.priority` (#1755) | `src/lib/server/db/schema.ts` | `tests/e2e/global-setup.ts` (ALTER + must seed) | `tests/unit/helpers/test-db.ts` | `src/lib/server/demo/demo-data.ts` (must=はみがきした/おきがえした/おかたづけした) | #1755 (#1709-A) |
| `checklist_templates.kind` 削除 (#1755) | 同上（列削除済） | 同上（DROP COLUMN + DELETE WHERE 旧ルーチン枠レコード） | 同上（列なし） | 同上（kind プロパティ削除済 + 旧ルーチン枠テンプレート削除） | #1755 (#1709-A) |
| `child_activities` 並存（旧 `activities` と並列保持） (#2362 PR-3 / ADR-0055) | `src/lib/server/db/schema.ts` (`child_activities` table 追加、`childId NOT NULL ON DELETE CASCADE`) | `tests/e2e/global-setup.ts` (CREATE TABLE + 2 INDEX) | `tests/unit/helpers/test-db.ts` (CREATE TABLE) + `src/lib/server/db/create-tables.ts` (CREATE TABLE + 2 INDEX) | `src/lib/server/demo/demo-data.ts` (Phase 6 で各 child fixture 追加) | #2362 PR-3 (Phase 7 で旧 `activities` drop 予定) |
| `child_challenges` (#2362 PR-7 / ADR-0055、User §6、#2458 Path B sibling drop で旧 `sibling_challenges` / `sibling_challenge_progress` 物理撤去済 2026-05-26) | `src/lib/server/db/schema.ts` (`child_challenges` table のみ、`childId NOT NULL ON DELETE CASCADE` + `sourceTemplateId` で兄弟連動 group) | `tests/e2e/global-setup.ts` (CREATE TABLE + 3 INDEX) | `tests/unit/helpers/test-db.ts` (CREATE TABLE + 3 INDEX + ALL_TABLES に追加) | `src/lib/server/demo/demo-data.ts` (`DEMO_CHILD_CHALLENGES` 4 件 + 兄弟連動 demo group) | #2362 PR-7 + #2458 (Path B sibling drop 完了) |
| `checklist_templates` family master 化 (#2362 PR-5 Phase 1 / ADR-0055) | `src/lib/server/db/schema.ts` (`child_id` 列削除 + `tenant_id` 列追加 + `checklist_template_assignments` 中間 table 新規) | `tests/e2e/global-setup.ts` (Phase 1 で migration 実装済) | `tests/unit/helpers/test-db.ts` (同上) | `src/lib/server/demo/demo-data.ts` (`DemoLegacyChecklistTemplate` 局所拡張型 + demo-repo で family scope view 変換) | #2362 PR-5 Phase 2 (#2481、admin UX / 子供画面 / E2E 整備) |
| `stripe_webhook_events` (#2641 / Phase 5 子 3 / Phase 7 PR-1) | `src/lib/server/db/schema.ts` (新規 table + 2 index、`stripeWebhookEvents`) + `src/lib/server/db/create-tables.ts` (CREATE TABLE + 2 INDEX) + `src/lib/server/db/migration/lazy-startup-migrations.ts` (`migrateBillingPhase6` で旧 production DB に新規作成、idempotent) | `tests/e2e/global-setup.ts` (CREATE TABLE + 2 INDEX) | `tests/unit/helpers/test-db.ts` (CREATE TABLE + 2 INDEX + `ALL_TABLES` に追加) | `src/lib/server/db/demo/webhook-event-repo.ts` (in-memory `Map<string, WebhookEventRecord>`) + `src/lib/server/db/dynamodb/keys.ts` (`STRIPE_WEBHOOK_EVENT_PK` + `stripeWebhookEventKey` + `STRIPE_WEBHOOK_EVENT_TTL_DAYS=30`、CDK は `storage-stack.ts:29` 既設定) | #2641 (Phase 5 子 3 webhook 冪等性) + #2675 (Phase 6 子 3 DB migration plan) + #2685 (Phase 7 PR-1) |
| `archived_reason` enum 3 値 (#2642 / Phase 5 子 4 / Phase 7 PR-1 / **PR-2a #2688 で drizzle enum + repo 型強制適用済**) | `src/lib/server/db/schema.ts` 4 location (`children:45` / `activities:79` / `child_activities:123` / `checklist_templates:448`、**PR-2a #2688 で `text('archived_reason', { enum: ARCHIVED_REASONS })` 適用済**) + `src/lib/domain/archive-types.ts` (SSOT、`as const` array + `ArchivedReason` 型 + `getRetentionDays`) + `src/lib/server/db/migration/lazy-startup-migrations.ts` (`migrateBillingPhase6` で既存 NULL row を `'downgrade_user_selected'` で補充、4 location × idempotent + 列存在 guard) | `tests/e2e/global-setup.ts` (NULL 補充 UPDATE 追加、4 location) | `tests/unit/helpers/test-db.ts` (CREATE TABLE 4 location は既存、列定義は `archived_reason TEXT`、enum 制約は drizzle schema 経由) + `src/lib/server/db/create-tables.ts` (同上) | **PR-2a #2688 で 3 backend 同期型強制完了**: `src/lib/server/db/sqlite/{child,activity,child-activity,checklist}-repo.ts` + `src/lib/server/db/dynamodb/{child,activity,child-activity,checklist}-repo.ts` + `src/lib/server/db/demo/{child,activity,child-activity,checklist}-repo.ts` 全 12 file の `archive*` / `restoreArchived*` 引数を `reason: string` → `reason: ArchivedReason` 型強制 + 3 facade (`activity-repo.ts` / `child-repo.ts` / `checklist-repo.ts`) + 2 caller (`resource-archive-service.ts` / `downgrade-service.ts`) の型注釈同期 | #2642 (Phase 5 子 4 archive 統合) + #2675 (Phase 6 子 3 DB migration plan) + #2685 (Phase 7 PR-1) + **#2688 (Phase 7 PR-2a)** |

###### `child_activities` per-child instance への移行 (#2362 PR-3 / ADR-0055)

旧 `activities` table (family-wide master + age filter) は Phase 7 で drop 予定。それまでは並存:

- **schema**: 旧 `activities` table + 新 `child_activities` table が並存。FK 切替 (`activity_logs.activity_id` → `child_activity_id` 等 4 件) も Phase 7
- **services**: `activity-import-service.ts` は `options.childIds` 受領 (後方互換維持)、`child-activity-copy-service.ts` 新規 (SRP)。`Activity` 型 / `IActivityRepo` interface は並存
- **routes**: `/admin/activities` は per-child UX (子供別タブ + ChildSelectionDialog auto-open + copy / bulk)。`/marketplace/[type]/[itemId]` activity-pack は admin redirect 動線 (CWE-598 排除、Phase 5)
- **demo**: `child_activities` fixture (per-child instance) を Phase 6 で各 child に追加。旧 `activities` fixture も並存
- **Phase 7 で実施**: 旧 `activities` drop + `Activity` / `IActivityRepo` 削除 + FK 切替 + 86 test files signature 追従

###### `child_challenges` per-child instance への移行 (#2362 PR-7 / ADR-0055、User §6)

旧 `sibling_challenges` (family-wide + 別 `sibling_challenge_progress` table、全 child を自動 enroll) は **#2458 (Path B sibling drop、本 PR、2026-05-26) で物理撤去完了**。child_challenges 単独経路:

- **schema**: 旧 `sibling_challenges` / `sibling_challenge_progress` table 撤去済、`child_challenges` table のみ
- **services**: `child-challenge-service.ts` / `child-challenge-copy-service.ts` (SRP 分離) のみ。`sibling-challenge-service.ts` / `sibling-challenge-repo.ts` facade / 3 backend 実装 / `ISiblingChallengeRepo` interface / `SiblingChallenge*` 型は #2458-B (PR #2488) + Path B sibling drop で完全撤去
- **routes**: `/admin/challenges` は per-child instance + 子供別タブ + 兄弟連動表示 (SiblingChallengeComparison.svelte) + 一括追加 + cross-child copy。`/marketplace/[type]/[itemId]` challenge-set は admin redirect 動線 (CWE-598 排除、`?marketplace-import=<presetId>` のみ、#2458-B で reward-set / checklist と同型化)
- **子供画面 (#2458-B caller migration)**:
  - `(child)/[uiMode]/home` + `(child)/[uiMode]/(character)/history` は `getActiveChildChallengesWithSiblings(childId, tenantId)` で per-child instance + 同 group key (sourceTemplateId / `title::start::end`) 兄弟連動情報 (`siblings[]`) を取得
  - `ChallengeBanner.svelte` / `SiblingCelebration.svelte` は `ChildChallengeWithSiblings` 型に統合 (自身の `currentValue` / `targetValue` / `rewardClaimed` + `siblings[]` で他兄弟進捗 + `allCompleted` 判定)
  - `claimChallengeReward` action は `claimChildChallengeReward(challengeId, childId, tenantId)` を呼ぶ (per-child instance の `rewardClaimed` flip + 自分のみ tenant-scoped point ledger 加算)
- **setup wizard (#2458-B)**: `/setup/challenges` は preset 選択 → `getAllChildren` で全 child 取得 → `buildPerChildTargets` で age-adjusted target 計算 → `createChildChallengesBulk` で全 child に同 spec instance を bulk insert (sourceTemplateId = `setup-preset:<presetId>` で admin 兄弟連動表示)
- **demo**: `DEMO_CHILD_CHALLENGES` 4 件 fixture (3 件は `sourceTemplateId: 'challenge-100pt'` を共有して兄弟連動表示 demo、1 件は個別)
- **兄弟連動 UI 工夫 (User §6)**: 同じ `sourceTemplateId` (または `title + startDate + endDate`) を共有する per-child instance を admin/challenges + 子供 home / history で group 表示。SiblingChallengeComparison は admin 画面でのみ使用し、子供 home は `ChallengeBanner` 内に `siblings[]` 一覧表示 (ADR-0012 Anti-engagement 整合: 1 件 banner 内集約、連続演出なし)
- **LP 整合性 (ADR-0013)**: LP / pricing / faq の「チャレンジ」訴求は per-child 体験ベース (「自分から目標を立てる」「ウィークリーチャレンジ」) のため per-child 化と既に整合済み。LP 文言修正不要
- **family-only gate**: 既存の `tier !== 'family'` server-side gate は本 PR では維持

---

#### 7b. marketplace プリセット → labels / import / setup フロー (#1758 / #1709-D)

`src/lib/data/marketplace/activity-packs/*.json` の `mustDefault` 候補と、UI / import service / setup フローでの参照は同期させること。`mustDefault` の意味は #1755 で導入された `activities.priority='must'` と整合している必要がある。

**並行実装ペア**:

| 場所 | 内容 | 技術 |
|------|------|------|
| `src/lib/data/marketplace/activity-packs/*.json` (12 件) | `mustDefault: true/false` フラグを持つ活動 | JSON |
| `src/lib/domain/activity-pack.ts` | `ActivityPackItem.mustDefault?: boolean` 型 | TypeScript |
| `src/lib/domain/marketplace-item.ts` | `ActivityPackPayload.activities[].mustDefault?` 型 | TypeScript |
| `src/lib/server/services/activity-import-service.ts` | `ImportActivitiesOptions.applyMustDefault` で `priority='must'` 制御 | TypeScript |
| `src/routes/(parent)/admin/packs/+page.{svelte,server.ts}` | チェックボックス + must Badge + form action 受信 | Svelte / TS |
| `src/routes/setup/packs/+page.{svelte,server.ts}` | setup フローのチェックボックス + must Badge | Svelte / TS |
| `src/lib/domain/labels.ts` | `PACKS_PAGE_LABELS.mustDefault*` / `SETUP_PACKS_LABELS.mustDefault*` | TypeScript |

**同期メカニズム**: 静的型チェック (`svelte-check`) と `tests/unit/services/activity-import-service.test.ts` の `#1758` セクション + E2E `tests/e2e/setup-marketplace-must.spec.ts` (3 シナリオ) で検証。

**修正時チェック**:
- 新しい mustDefault 候補を JSON に追加 → import-service テストで該当パターンが網羅されているか確認
- mustDefault のラベル/Badge 文言を変更 → `labels.ts` の SSOT 経由で一元修正（admin と setup 両方）
- `priority` enum を拡張するなら `activities.priority` schema (#1755) と整合チェック

#### 7c. checklist 系 marketplace の純化 (#1758)

`src/lib/data/marketplace/checklists/` は **持ち物純化** された:

- 旧 `morning-* / evening-* / weekend-*` × 4 年齢 = 12 件削除
- 残るのは `event-field-trip` / `event-pool` / `event-school-start` の **3 件のみ**
- routine 系の役割は `activity-pack mustDefault` → `activities.priority='must'` に移管

**同期するファイル**:
- `src/lib/data/marketplace/index.ts` の import 文 / `allItems` 配列
- `docs/design/marketplace-preset-checklist-audit.md` (3 件のみに整理済)
- E2E spec: `tests/e2e/setup-marketplace-must.spec.ts` で 3 件のみ確認

#### 7d. marketplace reward-set 一括追加 (#2136 MP-1 / #2366 ADR-0052 Strategy 移行)

`src/lib/data/marketplace/reward-sets/*.json` の reward-set 10 件は **マーケットプレイス詳細ページ + admin/rewards 画面 + setup wizard の 3 箇所**から一括取込でき、`special_rewards.sourcePresetId` (#1254 G1) で重複検知される。

**#2366 (ADR-0052)**: callsite 3 箇所は `$lib/marketplace/dispatchImport({ typeCode: 'reward-set', ... })` 経由に統一済 (Strangler Fig)。旧 `reward-set-import-service.ts` は @deprecated marker 経由で 1 release 並行稼働 (新 Strategy の内部 callee として参照)。`requiresChildId=true` が Registry に表明されており、#8 UnifiedImportHub の子供選択 UI 統合基盤。

**#2362 PR-4 (ADR-0055)**: per-child 取込 fan-out + 兄弟共通化 UX 整備 + marketplace 詳細から child 排除 (CWE-598)。`narrowChildContext` で discriminated union (`child-selection` / `legacy-single`) に narrow、`importRewardSetToChildren` で複数 child 同時 fan-out。admin 側 `ChildSelectionDialog` auto-open + 「他の子供から copy」(`copyChildRewardsToSibling` / `copyChildRewardsToSiblings`) で運用フロー完成。詳細動線は [marketplace-import-flow.md](marketplace-import-flow.md) §3.2 reward-set 節参照。

**並行実装ペア**:

| 場所 | 内容 | 技術 |
|------|------|------|
| `src/lib/data/marketplace/reward-sets/*.json` (10 件) | reward-set preset (title / points / icon / category / description) | JSON |
| `src/lib/domain/marketplace-item.ts` | `RewardSetPayload` 型 | TypeScript |
| `src/lib/marketplace/schemas/reward-set-schema.ts` (#2364) | Valibot `RewardSetPayloadSchema` (validation SSOT) | TypeScript |
| `src/lib/marketplace/strategies/reward-set-strategy.ts` (#2366) | `ImportStrategy<RewardSetPayload>` 実装 (parse / preview / apply、childId/presetId 必須) | TypeScript |
| `src/lib/marketplace/types/reward-set.ts` (#2366) | Registry 登録 (`requiresChildId: true`) | TypeScript |
| `src/lib/server/services/reward-set-import-service.ts` (@deprecated #2366) | `previewRewardSetImport` / `importRewardSet` (Strategy 内部 callee として並行稼働) | TypeScript |
| `src/routes/marketplace/[type]/[itemId]/+page.server.ts` | reward-set 詳細ページ CTA、`dispatchImport` 経由 | TypeScript |
| `src/routes/(parent)/admin/rewards/+page.server.ts` | 「マーケットプレイスから一括追加」、`dispatchImport` 経由 | TypeScript |
| `src/routes/setup/rewards/+page.server.ts` | setup wizard step 2、`dispatchImport` 経由 | TypeScript |
| `src/lib/domain/labels.ts` | `MARKETPLACE_LABELS.detailCtaImportReward*` / `REWARDS_LABELS.marketplace*` | TypeScript |
| `src/lib/server/db/schema.ts` | `special_rewards.sourcePresetId` (#1254 G1) | Drizzle |

**同期メカニズム**: `tests/unit/marketplace/strategies/reward-set-strategy.test.ts` (#2366、23 シナリオ + dispatcher integration) + `tests/unit/services/reward-set-import-service.test.ts` (15 シナリオ、Strangler Fig 並行) + E2E `tests/e2e/marketplace-reward-set-import.spec.ts` (5 シナリオ) + `tests/e2e/admin-rewards-import-marketplace.spec.ts` (#2366 admin 動線) で検証。

**修正時チェック**:
- 新しい reward-set を追加 → import-service テスト + E2E で itemId を網羅
- 重複検知ロジック (`sameSourceTitles`) 変更 → unit テスト 3 件 (「同一 preset 同一 title」/「別 preset 同名」/「sourcePresetId=null 手動 reward」) で誤検知ガード
- reward の即時付与（grant）と一括取込（import）の区別: 一括取込は **point 加算しない**（"候補登録"）。grant は `insertPointEntry` を呼ぶ

#### 7e. marketplace challenge-set 一括追加 (#2297, EPIC #2294 ③ — #2896 で marketplace 陳列廃止)

> **#2896 (2026-06-11 PO 判断)**: marketplace を活動 / ごほうび / チェックリストの 3 type に絞る方針に伴い、challenge-set は陳列対象外とし唯一の production preset (日本年間行事パック) を廃止した (JSON は `tests/fixtures/marketplace/challenge-sets/` へ移管し schema 互換検証を継続)。以下のペア表は型 / schema / Registry 登録の互換維持のため残置するが、marketplace 経由のチャレンジ取込動線は撤去済。チャレンジ機能本体 (自作 + auto-challenge) は `/admin/challenges` に保持。陳列方針・顧客価値は [44-チャレンジ設計書.md](44-チャレンジ設計書.md) を参照。

`src/lib/domain/marketplace-item.ts` の `ChallengeSetPayload` 等は **マーケットプレイス詳細ページ → /admin/challenges 画面**の動線（現在は廃止）で一括取込されていた。`MarketplaceItemType` を 4 → 5 type に拡張した実装。

**並行実装ペア (`MarketplaceItemType` 拡張時の同期対象)**:

| 場所 | 内容 | 技術 |
|------|------|------|
| `src/lib/domain/marketplace-item.ts` | `MarketplaceItemType` enum + `MarketplacePayloadMap` + `MARKETPLACE_TYPE_LABELS` + `MARKETPLACE_TYPE_ICONS` + 新規 `ChallengeSetPayload` interface | TypeScript |
| `src/lib/data/marketplace/challenge-sets/*.json` | challenge-set preset (15 件入りパック等) | JSON |
| `src/lib/data/marketplace/index.ts` | `allItems` 配列 + `getMarketplaceCounts` + `countPayloadItems` | TypeScript |
| `src/routes/marketplace/+page.svelte` | `typeKeys` 配列 (5 type) + grid-cols mobile 2 列 / SP 3 列 / desktop 5 列 | Svelte |
| `src/routes/marketplace/[type]/[itemId]/+page.server.ts` | `VALID_TYPES` 配列 | TypeScript |
| `src/routes/marketplace/[type]/[itemId]/+page.svelte` | challenge-set 詳細表示 + 「使ってみる」CTA → `/admin/challenges?marketplace-import=<id>` 遷移 | Svelte |
| `src/routes/(parent)/admin/challenges/+page.{svelte,server.ts}` | `marketplace-import` query 受取 → ChildSelectionDialog auto-open + `?/importMarketplaceChallengeSet` form action (per-child `createChildChallengesBulk` 配信、#2458-B で legacy `createSiblingChallenge` 撤去済) | Svelte / TS |
| `src/lib/domain/labels.ts` | `MARKETPLACE_LABELS.detailIncludedChallenges` / `detailCtaImportChallengeSet*` | TypeScript |

**同期メカニズム**: `tests/unit/domain/marketplace-items.test.ts` で type enum 完全性確認 + `tests/e2e/marketplace-challenge-set-import.spec.ts` で詳細 → admin 遷移 → 一括追加フロー検証。

**AN-5 補強 (#2180 観察 4 #2297 関連)**: `MarketplaceItemType` 拡張時は以下を全件触ること:
1. `marketplace-item.ts` enum + Payload interface + LABEL/ICON 4 箇所
2. `marketplace/index.ts` の `countPayloadItems` + `getMarketplaceCounts`
3. `routes/marketplace/+page.svelte` `typeKeys` + grid-cols
4. `routes/marketplace/[type]/[itemId]/+page.server.ts` `VALID_TYPES`
5. `routes/marketplace/[type]/[itemId]/+page.svelte` 表示 block + CTA block
6. import 先 admin 画面 (`/admin/<type-target>`) に query param 受取り + preview UI + form action

**修正時チェック**:
- 新しい challenge-set preset 追加 → `marketplaceImport` 先のチャレンジ展開ロジック (`_expandChallengeSetDates`、SvelteKit `+page.server.ts` の予約 export 制約により `_` 接頭辞) で当該 monthDay/durationDays が正しく実日付に展開されるか単体確認
- `MarketplaceItemType` enum 追加時は本表 6 項目全件のうち 1 つでも漏れると svelte-check or runtime で fail する設計

---

#### 7f. /admin/settings 6 グループ child routes (#2319 / #2320-2324)

旧 `/admin/settings/+page.svelte` (2059 行メガファイル、15 sections) を **SvelteKit child routes 6 グループに分割** (案 2 採用、Material Design / Apple HIG / NN/G Common Region 原則整合)。`accountDelete` (account 内) と `clear` (data 内) は **GitHub Danger Zone パターン** (赤枠 + ページ最下部 + 3-step 確認) を共通適用。

**並行実装ペア (settings UI 修正時の同期対象)**:

| 場所 | 内容 | 技術 |
|------|------|------|
| `src/routes/(parent)/admin/settings/+layout.svelte` | 6 グループへのサブナビ (mobile 横スクロール対応) | Svelte |
| `src/routes/(parent)/admin/settings/+page.svelte` | hub page (6 グループへのカード型ナビ + grace バナー) | Svelte |
| `src/routes/(parent)/admin/settings/+page.server.ts` | 空 load (各 child route が独自に load) | TypeScript |
| `src/routes/(parent)/admin/settings/account/+page.{svelte,server.ts}` | OYAKAGI / logout / accountDelete (Danger Zone) | Svelte / TS |
| `src/routes/(parent)/admin/settings/activities/+page.{svelte,server.ts}` | decay / point / defaultChild / sibling | Svelte / TS |
| `src/routes/(parent)/admin/settings/notifications/+page.{svelte,server.ts}` | notification (1 section、軽量) | Svelte / TS |
| `src/routes/(parent)/admin/settings/data/+page.{svelte,server.ts}` | data / cloud / clear (Danger Zone) | Svelte / TS |
| `src/routes/(parent)/admin/settings/support/+page.{svelte,server.ts}` | founderInquiry / feedback / appInfo | Svelte / TS |
| `src/lib/domain/labels.ts` | `SETTINGS_LABELS` (hub / Danger Zone) + `SETTINGS_NAV_LABELS` (新規、サブナビ専用) | TypeScript |
| `src/lib/data/setup-defaults-activities.ts` | activities グループ sensible defaults (setup hard-code 代替案 A、rule-preset 集約代替案) | TypeScript |
| `src/routes/setup/activities-defaults/+page.{svelte,server.ts}` | setup 任意 step (rules → activities-defaults → challenges 順、skip 可) | Svelte / TS |
| `src/lib/server/services/setup-funnel-service.ts` | `setup_activities_defaults_applied/skipped` イベント追加 | TypeScript |
| `src/lib/features/admin/push-subscription.ts` | `unsubscribeFromPush` を `_unsubscribeFromPush` から public export rename (notifications/+page.svelte の onMount 内動的 import 用) | TypeScript |

**同期メカニズム**:
- hub page から各 child route へのナビは hub の `groupCards` 配列 + `+layout.svelte` の `navItems` 配列の 2 箇所に書く (どちらか欠落時の早期検出)
- e2e `tests/e2e/admin-settings-export-gate.spec.ts` / `account-deletion.spec.ts` / `founder-inquiry.spec.ts` / `import-verify-dialog.spec.ts` / `plan-{free,standard,family}.spec.ts` は新 path (`/admin/settings/<group>`) でアクセス。レガシー URL マッピングは設けない (hub から個別ページへの link が機能するため)

**修正時チェック**:
- 新規 settings section 追加時はどの child route に属するか判断し、該当 child route の `+page.svelte` と `+page.server.ts` 双方を更新
- hub page のカードと `+layout.svelte` サブナビにも追加 (`SETTINGS_NAV_LABELS` と `SETTINGS_LABELS.group<Name>Title/Desc` を新設)
- Danger Zone セクションを追加する場合は account / data の既存実装 (`.danger-zone` CSS + 3-step) を 1:1 で踏襲

---

#### 8. 設計書 vs 実装

| 場所 | 内容 |
|------|------|
| `docs/design/07-API設計書.md` | API 仕様 |
| `docs/design/08-データベース設計書.md` | DB スキーマ |
| `docs/design/06-UI設計書.md` | UI 設計 |
| 実装コード | 実体 |

**同期メカニズム**:
- **現状（手動）**: チケット完了時に設計書更新チェック

---

#### 9. プラン機能リスト

| 場所 | 内容 |
|------|------|
| `src/lib/domain/plan-features.ts` | **SSOT**（#762 で新設）— 料金カード・管理画面ハイライト・Welcome解放機能 |
| `src/lib/server/services/plan-limit-service.ts` | 機能制限のブール値フラグ定義（`PLAN_LIMITS`） |
| `src/lib/domain/labels.ts` | `FEATURE_LABELS`（機能名の SSOT） |
| `src/routes/pricing/+page.svelte` | 料金プラン画面 |
| `src/routes/(parent)/admin/license/+page.svelte` | 管理画面プラン購入カード (デモ Lambda 環境では `DATA_SOURCE=demo` env でモック動作、ADR-0048) |
| `src/lib/features/admin/components/PremiumWelcome.svelte` | アップグレード完了ダイアログ |
| `site/index.html`, `site/pricing.html`, `site/pamphlet.html` | LP のプラン情報（手動同期） |

**同期メカニズム**:
- アプリ側 TS/Svelte コンポーネントは `plan-features.ts` を必ず import
- プラン機能追加時は `plan-limit-service.ts` の `PLAN_LIMITS` ブール値フラグと連動
- LP 側は `scripts/check-lp-plan-sync.mjs` で drift を自動検知（#764, `npm run lint:parallel` 経由）
  - `site/pricing.html`: 全 feature 完全一致（strict）
  - `site/index.html`, `site/pamphlet.html`: 少なくとも 1 feature 一致（loose, LP トップとパンフ簡略版のため）
  - 価格（`price` / `yearlyPrice` の数値部）は全ファイルでチェック（pamphlet は月額のみ）

**修正時チェック**:
- [ ] プラン機能追加 → `plan-features.ts` の該当プラン配列に追加
- [ ] 機能フラグ追加 → `plan-limit-service.ts` の `PLAN_LIMITS` にブール値を追加
- [ ] ラベル追加 → `labels.ts` の `FEATURE_LABELS` に追加
- [ ] ユニットテスト（`tests/unit/domain/plan-features.test.ts`）の期待値を更新
- [ ] LP 側（`site/*.html`）を更新 → `npm run lint:lp-plan-sync` で確認

---

#### 10. 年齢・誕生日 (age / birthDate / uiMode) (#1378)

| 場所 | 内容 |
|------|------|
| `child.birthDate` / `child.age` / `child.uiMode` / `child.uiModeManuallySet` | DB カラム（SSOT 優先度: birthDate > age > uiMode） |
| `src/lib/domain/validation/age-tier.ts` | `getDefaultUiMode(age)` / `recalcUiMode()` — uiMode 導出ロジック |
| `src/lib/server/services/child-service.ts` | `editChild()` — `uiModeManuallySet` を考慮した `recalcUiMode()` 呼出し |
| `src/lib/server/services/birthday-bonus-service.ts` | `calculateAge()` / `claimBirthdayBonus()` — age 更新 + uiMode 再計算 |
| `src/routes/(parent)/admin/children/+page.server.ts` | 子供登録・更新フォームの age/birthDate バリデーション |
| `docs/design/26-ゲーミフィケーション設計書.md §13` | 仕様 SSOT |

**同期メカニズム**:
- `birthDate` が変化した場合は必ず `calculateAge(birthDate)` で age を再計算し、`recalcUiMode()` で uiMode も更新する
- `uiModeManuallySet = 1` (保護者が明示設定) の場合は age 変更時も uiMode を維持する。`recalcUiMode()` がこの判断を担う（#1382, PR #1463 実装済み）
- 誕生日ボーナス claim 時は `uiModeManuallySet` に関わらず uiMode を上書きする（設計ポリシー: 誕生日は成長の節目）

**修正時チェック**:
- [ ] birthDate / age バリデーション変更 → `children/+page.server.ts` と `birthday-bonus-service.ts` の両方を確認
- [ ] `getDefaultUiMode` の年齢境界変更 → `age-tier.ts` 1 箇所（副作用: 全 child の uiMode が次回更新時に変化する）
- [ ] `uiModeManuallySet` ロジック変更 → `age-tier.ts` の `recalcUiMode()` と `child-service.ts` の `editChild()` の両方を確認
- [ ] age 自動インクリメント変更 (#1381) → `age-recalc-service.ts` + `schedule-registry.ts` + `+server.ts` の 3 ファイルが協調。uiMode 更新ロジック変更時は `birthday-bonus-service.ts` の担当外ポリシー（§13.9）と照合すること

#### 11. 法的文書 (privacy / terms) — LP-truth 例外 (#1638 / #1590)

| 場所 | 内容 |
|------|------|
| `site/privacy.html` | プライバシーポリシー（外部送信規律 / 未成年者取扱い / 域外移転等を含む） |
| `site/terms.html` | 利用規約（卒業概念 / 未成年者の利用等を含む） |
| `src/lib/domain/labels.ts` `LEGAL_LABELS` | 法律用語のキー語彙（`scripts/check-lp-ssot.mjs` で privacy / terms との一致を CI 検証） |
| `src/lib/server/services/consent-service.ts` `CURRENT_TERMS_VERSION` / `CURRENT_PRIVACY_VERSION` | 規約改訂日。本ファイルで上書きすると次回ログイン時に再同意フローへ自動誘導 |
| `src/routes/auth/signup/+page.svelte` | 同意チェックボックス（agreedTerms / agreedPrivacy / agreedCrossBorder の 3 つすべて必須） |
| `src/routes/legal/privacy/+page.server.ts` | 既存の `301` redirect 維持（LP-truth ADR-0013 整合 — アプリ側プラポリは LP の真実を SSOT として参照する） |
| `docs/design/14-セキュリティ設計書.md §8.5 / §8.6 / §8.7` | 設計書側の根拠 |

**例外的扱いの理由**: ADR-0013（LP-truth）で「LP は実装を SSOT として参照する」とした原則の例外として、法的文書は性質上 SSOT 化が不要で `site/privacy.html` / `site/terms.html` を直接編集する。`scripts/check-lp-ssot.mjs` の `EXCLUDED_LEGAL_FILES` で日本語ハードコード違反検出から除外している。代わりに `LEGAL_LABELS` のキー用語が両文書に出現することで文言ドリフトを CI 検出する。

**修正時チェック**:
- [ ] privacy.html / terms.html を変更 → `CURRENT_TERMS_VERSION` / `CURRENT_PRIVACY_VERSION` を改訂日付に更新（同意済みユーザーへの再同意フロー誘導）
- [ ] 法律用語を新規追加 → `LEGAL_LABELS` に追加し、`scripts/check-lp-ssot.mjs` の coverage 検証を通すこと
- [ ] 同意チェックボックス追加 → `signup/+page.svelte` の `canSubmit` / `submitBlockReason` に反映 + E2E テスト追加
- [ ] 設計書 14 の §8.5 / §8.6 / §8.7 と整合維持（電気通信事業法 §27の12 / 個情法 §28 / 未成年者取扱い）

#### 12. メール通知系 (trial / lifecycle / weekly-report) (#1601)

| 場所 | 内容 | 規律 |
|------|------|------|
| `src/lib/server/services/trial-notification-service.ts` | トライアル終了 3 日前 / 1 日前 / 当日通知 | システム通知扱い（年 6 回マーケ枠の対象外） |
| `src/lib/server/services/lifecycle-email-service.ts` (#1601) | 期限切れ前リマインド (30/7/1日前) + 休眠復帰 (90日) | マーケ扱い（年 6 回上限内、List-Unsubscribe必須、親宛のみ） |
| `src/lib/server/services/report-service.ts` | 週次活動レポート | 親宛のみ。opt-in (#1601 では枠外) |
| `src/lib/server/services/email-service.ts` | SES 送信コア + テンプレート | `sendEmail({ listUnsubscribeUrl })` 指定で SendRawEmailCommand を使い List-Unsubscribe ヘッダを付与 (RFC 8058) |
| `src/lib/server/services/marketing-email-counter.ts` (#1601) | 年間 6 回上限カウンタ (settings KV) | ADR-0023 §3.3 準拠 |
| `src/lib/server/services/unsubscribe-token.ts` (#1601) | HMAC ベース配信停止トークン | OPS_SECRET_KEY 流用 (Pre-PMF シンプル化、ADR-0010) |
| `src/routes/unsubscribe/[token]/` (#1601) | 配信停止確認画面 + one-click 解除 | RFC 8058 List-Unsubscribe-Post 対応 |

**規律 (ADR-0023 + ADR-0012 整合)**:
- 親オーナー (role='owner') の email 以外には絶対に送らない（子供への送信禁止）
- 「マーケ扱い」のメールを追加するときは必ず `marketing-email-counter` を経由して年 6 回上限を遵守
- 「マーケ扱い」のメールには必ず `listUnsubscribeUrl` を渡す（List-Unsubscribe ヘッダ + body 末尾の解除リンク）
- Anti-engagement (ADR-0012) 整合: 「今すぐアップグレード」「失効します」等の煽り NG。中立トーンを貫く

**修正時チェック**:
- [ ] 新メール種別の追加時は `LIFECYCLE_EMAIL_LABELS` (labels.ts) に文言を追加し、SSOT を保つ
- [ ] cron job 追加時は `schedule-registry.ts` + `infra/lambda/cron-dispatcher/index.ts` (KNOWN_ENDPOINTS) + `infra/lib/compute-stack.ts` (CRON_JOBS) の 3 箇所同期
- [ ] `Tenant.lastActiveAt` 関連の変更時は `entities.ts` + `auth-repo.interface.ts` + DynamoDB / SQLite 両 repo + `last-active-touch.ts` を同期

---

## 修正時チェックリスト

**すべての修正前に、以下のどれに該当するか確認し、対応するペアを触ること**:

- [ ] **UI ラベル・用語** → `src/lib/domain/labels.ts` + `site/index.html` + `site/pamphlet.html` + `site/shared-labels.js` + `tutorial-chapters.ts`
- [ ] **年齢モード** → `src/routes/(child)/{baby,preschool,elementary,junior,senior}/` の 5 ディレクトリ全て
- [ ] **本番画面** → **#2097 PR-B3 #2188 完了で `src/routes/demo/` 並行実装は 0 file**。本番 routes のみが SSOT (demo Lambda は env 駆動で本番 routes を直接 host、ADR-0048)。新規 `src/routes/demo/` の追加は禁止
- [ ] **アプリ機能** → LP (`site/`) で紹介している場合は文言同期
- [ ] **ナビゲーション** → 管理画面は `AdminLayout.svelte` 単一ファイルに Desktop dropdown + Mobile submenu が同居（`AdminMobileNav` は存在しない / 2026-04-19 実態確認）。子供画面の `BottomNav.svelte` は独立しており、親向け機能（マケプレ等）は対象外
- [ ] **DB スキーマ** → `tests/e2e/global-setup.ts` + `tests/unit/helpers/test-db.ts` + `src/lib/server/demo/demo-data.ts`
- [ ] **チュートリアル** → 本番 (`tutorial-chapters.ts`) + デモ (`demo-guide-state.svelte.ts`)
- [ ] **設計書** → 影響する `docs/design/*.md` を更新
- [ ] **法的文書 (privacy / terms)** (#1638 / #1590) → `site/privacy.html` / `site/terms.html` を変更したら `consent-service.ts` の `CURRENT_TERMS_VERSION` / `CURRENT_PRIVACY_VERSION` を改訂日付に更新し、`LEGAL_LABELS` (`labels.ts`) のキー用語が両文書に存在することを `node scripts/check-lp-ssot.mjs` で確認
- [ ] **認証が絡む画面** (#1026) → `npm run dev:cognito` で **自分の目で** ログイン/サインアップ/ops 経路を通り、`docs/DESIGN.md` §9 禁忌事項 (色直書き / プリミティブ再実装 / 内部コード露出 / 用語ハードコード / インラインスタイル / プリミティブ再実装) に違反がないか確認。`npm run dev` の自動認証モードだけで済ませない (ログインフォームが描画されないため UI 検証が抜ける)
- [ ] **年齢帯 variant ラベル** (ADR-0015) → `labels.ts` の tier-aware key（例: `encourage.complete`）を更新した場合、`child-home/variants/index.ts` + `tutorial-chapters.ts` + tips / dialog コンポーネント側の独自分岐が残っていないか grep。`if (uiMode === 'baby')` 散在（A1 アンチパターン）を検出したら `getLabel(key, ctx)` 経由に寄せる
- [ ] **日本語折り返し** (ADR-0016) → 見出し / Dialog タイトル / チュートリアルステップ追加時は、`app.css` の `text-wrap: balance; word-break: auto-phrase;` が効くセレクタ配下か確認。長文段落 / 古いブラウザ対応が必要な箇所は `use:budoux` action を個別適用。LP 側 (`site/*.html`) は `<budoux-ja>` CDN Web Component で wrap
- [ ] **route 分割 / rename / `data-testid` 移動** (#2410) → `scripts/capture-hp-screenshots.mjs` の `HERO_CAROUSEL_SCREENSHOTS` / `FEATURE_SCREENSHOTS` / `GROWTH_STAGE_SCREENSHOTS` / `AGE_SCREENSHOTS` 全 4 配列の `url:` と `scrollTo:` selector を grep し、移動先 URL に同期する。`docs/design/asset-catalog.md` §「LP スクショ」表 + `tests/e2e/lp-screenshot-baseline/README.md` の撮影元 URL 列も同期。同期漏れ実例: #2319 で `/admin/settings` 分割した際 capture script の URL 未更新で 19 連続 deploy fail (`feature-auto-sleep` の `[data-testid="settings-decay-section"]` が空 wrapper 経由で 10s timeout)

---

## 解消計画

| Tier | Issue | 内容 | ステータス |
|------|-------|------|-----------|
| Tier 1 | [#564](https://github.com/Takenori-Kusaka/ganbari-quest/issues/564) | 本マップ作成 + CLAUDE.md/PR/Issue テンプレ更新 | ✅ 完了 (2026-04-07) |
| Tier 2 | [#565](https://github.com/Takenori-Kusaka/ganbari-quest/issues/565) | CI 自動チェック + LP ラベル自動生成 + デモシード同期 | ✅ 完了 (2026-04-07) |
| Tier 3-K | [#566](https://github.com/Takenori-Kusaka/ganbari-quest/issues/566) | LP ビルドタイム同期 | ✅ #565 で吸収済み |
| Tier 3-I | [#567](https://github.com/Takenori-Kusaka/ganbari-quest/issues/567) | 年齢モード 5 種類を `[uiMode]` パラメータルートに集約 | 🔴 未着手（4434 行の重複解消） |
| Tier 3-J | [#568](https://github.com/Takenori-Kusaka/ganbari-quest/issues/568) | デモルートをアダプタパターンで本番ルートに統合 | 🔴 未着手（#567 完了後に実施推奨） |
