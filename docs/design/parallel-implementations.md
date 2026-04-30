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
| `src/routes/(child)/`, `src/routes/(parent)/` | 本番コード |
| `src/routes/demo/(child)/[mode]/` | デモの子供画面 |
| `src/routes/demo/(parent)/admin/` | デモの親画面 |
| `src/lib/server/demo/demo-data.ts` | デモ用シードデータ（静的） |

**同期メカニズム**:
- **現状（手動）**: 本番コード変更 → デモ画面を手動で追従
- **Tier 3（#566 で予定）**: デモアダプタパターンで本番コードを流用

**修正時チェック**:
- 新しいページを追加したら `src/routes/demo/(child)/[mode]/<新ページ>` も作ること
- デモシードのデータ構造がスキーマと整合しているか `tests/unit/demo/demo-data-integrity.test.ts` で検証

**本番 admin ⇔ デモ admin の既知の並行ペア**:

| 本番 | デモ | 備考 |
|------|------|------|
| `src/routes/(parent)/admin/+page.svelte` | `src/routes/demo/(parent)/admin/+page.svelte` | ホーム |
| `src/routes/(parent)/admin/activities/` | `src/routes/demo/(parent)/admin/activities/` | 活動管理 |
| `src/routes/(parent)/admin/children/` | `src/routes/demo/(parent)/admin/children/` | 子供管理 |
| `src/routes/(parent)/admin/license/` | `src/routes/demo/(parent)/admin/license/` | プラン・お支払い（#790 でデモ追加）。デモは Stripe/ライセンスキー適用を全てモック化 |
| `src/routes/(parent)/admin/rewards/` | `src/routes/demo/(parent)/admin/rewards/` | 報酬管理 |
| `src/routes/(parent)/admin/settings/` | `src/routes/demo/(parent)/admin/settings/` | 設定 |

> ⚠️ `AdminLayout.svelte` の `navCategories` はナビ項目を `${basePath}/<slug>` で生成するため、
> 本番に admin ページを追加したら必ず同じスラッグでデモ側にも実装を追加すること。
> さもなければ `/demo/admin/<slug>` が 404 を返し、デモ上の導線が破壊される。

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
| デモ admin | `src/routes/demo/(parent)/admin/` |

**同期メカニズム**:
- **現状（手動）**
- **Tier 3（#566 で予定）**: デモアダプタで統合

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
| `checklist_templates.kind` 削除 (#1755) | 同上（列削除済） | 同上（DROP COLUMN + DELETE WHERE kind='routine'） | 同上（列なし） | 同上（kind プロパティ削除済 + routine テンプレート削除） | #1755 (#1709-A) |

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
| `src/routes/(parent)/admin/license/+page.svelte` | 管理画面プラン購入カード |
| `src/routes/demo/(parent)/admin/license/+page.svelte` | デモ版プラン購入カード |
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
- [ ] **本番画面** → 同等機能が `src/routes/demo/` にも存在しないか確認
- [ ] **アプリ機能** → LP (`site/`) で紹介している場合は文言同期
- [ ] **ナビゲーション** → 管理画面は `AdminLayout.svelte` 単一ファイルに Desktop dropdown + Mobile submenu が同居（`AdminMobileNav` は存在しない / 2026-04-19 実態確認）。子供画面の `BottomNav.svelte` は独立しており、親向け機能（マケプレ等）は対象外
- [ ] **DB スキーマ** → `tests/e2e/global-setup.ts` + `tests/unit/helpers/test-db.ts` + `src/lib/server/demo/demo-data.ts`
- [ ] **チュートリアル** → 本番 (`tutorial-chapters.ts`) + デモ (`demo-guide-state.svelte.ts`)
- [ ] **設計書** → 影響する `docs/design/*.md` を更新
- [ ] **法的文書 (privacy / terms)** (#1638 / #1590) → `site/privacy.html` / `site/terms.html` を変更したら `consent-service.ts` の `CURRENT_TERMS_VERSION` / `CURRENT_PRIVACY_VERSION` を改訂日付に更新し、`LEGAL_LABELS` (`labels.ts`) のキー用語が両文書に存在することを `node scripts/check-lp-ssot.mjs` で確認
- [ ] **認証が絡む画面** (#1026) → `npm run dev:cognito` で **自分の目で** ログイン/サインアップ/ops 経路を通り、`docs/DESIGN.md` §9 禁忌事項 (色直書き / プリミティブ再実装 / 内部コード露出 / 用語ハードコード / インラインスタイル / プリミティブ再実装) に違反がないか確認。`npm run dev` の自動認証モードだけで済ませない (ログインフォームが描画されないため UI 検証が抜ける)
- [ ] **年齢帯 variant ラベル** (ADR-0015) → `labels.ts` の tier-aware key（例: `encourage.complete`）を更新した場合、`child-home/variants/index.ts` + `tutorial-chapters.ts` + tips / dialog コンポーネント側の独自分岐が残っていないか grep。`if (uiMode === 'baby')` 散在（A1 アンチパターン）を検出したら `getLabel(key, ctx)` 経由に寄せる
- [ ] **日本語折り返し** (ADR-0016) → 見出し / Dialog タイトル / チュートリアルステップ追加時は、`app.css` の `text-wrap: balance; word-break: auto-phrase;` が効くセレクタ配下か確認。長文段落 / 古いブラウザ対応が必要な箇所は `use:budoux` action を個別適用。LP 側 (`site/*.html`) は `<budoux-ja>` CDN Web Component で wrap

---

## 解消計画

| Tier | Issue | 内容 | ステータス |
|------|-------|------|-----------|
| Tier 1 | [#564](https://github.com/Takenori-Kusaka/ganbari-quest/issues/564) | 本マップ作成 + CLAUDE.md/PR/Issue テンプレ更新 | ✅ 完了 (2026-04-07) |
| Tier 2 | [#565](https://github.com/Takenori-Kusaka/ganbari-quest/issues/565) | CI 自動チェック + LP ラベル自動生成 + デモシード同期 | ✅ 完了 (2026-04-07) |
| Tier 3-K | [#566](https://github.com/Takenori-Kusaka/ganbari-quest/issues/566) | LP ビルドタイム同期 | ✅ #565 で吸収済み |
| Tier 3-I | [#567](https://github.com/Takenori-Kusaka/ganbari-quest/issues/567) | 年齢モード 5 種類を `[uiMode]` パラメータルートに集約 | 🔴 未着手（4434 行の重複解消） |
| Tier 3-J | [#568](https://github.com/Takenori-Kusaka/ganbari-quest/issues/568) | デモルートをアダプタパターンで本番ルートに統合 | 🔴 未着手（#567 完了後に実施推奨） |
