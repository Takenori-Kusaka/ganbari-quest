# プラン機能棚卸し（#792）

**最終更新**: 2026-04-11
**目的**: `/pricing` と LP (`site/pricing.html`) の features 欄が、実装済み機能の実態と一致しているかを棚卸しする。
**対象**: free / standard / family の 3 プラン

---

## 棚卸し方針

1. **実装で plan-gate されているか**を一次情報とする (`plan-limit-service.ts` の `PLAN_LIMITS` と各 route / service のガード)
2. 実装は存在するが plan-gate されていない機能は「全プラン共通機能」として扱い、プラン比較に載せない
3. デッドコンフィグ（`PLAN_LIMITS` に存在するが参照されないフラグ）は `/pricing` に載せない
4. LP と SSOT（`src/lib/domain/plan-features.ts`）の差分は最小化する

---

## 実装済み機能と plan-gate 状況

### ✅ plan-gate されている機能（プラン差別化の根拠となる）

| 機能 | 実装 | gate キー | 差分 |
|------|------|----------|------|
| 子供の登録数 | `checkChildLimit` | `maxChildren` | free: 2 / paid: 無制限 |
| オリジナル活動の作成数 | `checkActivityLimit` | `maxActivities` | free: 3 / paid: 無制限 |
| チェックリストテンプレート数 | `checkChecklistTemplateLimit` | `maxChecklistTemplates` | free: 3/子 / paid: 無制限 |
| 活動履歴の保持期間 | `applyRetentionFilter` / `hasArchivedData` | `historyRetentionDays` | free: 90日 / standard: 365日 / family: 無制限 |
| データエクスポート（JSON） | `/admin/export` の plan チェック | `canExport` | free: ❌ / paid: ✅ |
| 特別なごほうび設定（即時付与） | `admin/rewards/+page.server.ts:59 ensurePremium` | `canCustomReward` | free: ❌ / paid: ✅ |
| ひとことメッセージ（自由テキスト） | ParentMessage の gate | `canFreeTextMessage` | free/standard: ❌ / family: ✅ |
| きょうだいランキング | SiblingTrendChart の gate | `canSiblingRanking` | free/standard: ❌ / family: ✅ |
| クラウドエクスポート同時保管数 | Cloud exports | `maxCloudExports` | free: 0 / standard: 3 / family: 10 |

### ⚠️ plan-gate されていないが有料訴求リストにある機能（掲載は要再検討）

| 機能 | 実装場所 | 現状の gate | 判断 |
|------|---------|-----------|------|
| AI による活動提案 | `/api/v1/activities/suggest` | `tier !== 'family'` ガード有り | ✅ family 限定の訴求で正しい |
| 月次比較レポート | `getMonthlyComparison` → `/admin/status` | **gate なし**（全プラン参照可） | ❌ family only 表記は誤り — 掲載から削除 |
| 5つのチカラの成長グラフ | `status-service.ts` → `/admin/status` | **gate なし**（全プラン参照可） | ❌ standard only 表記は誤り — 掲載から削除 |
| 週次メールレポート | `api/v1/admin/weekly-report/+server.ts` | エンドポイントは存在、cron は未稼働 | ⚠️ 「準備中」or 掲載保留 |

### 🪦 デッドコンフィグ（削除済み）

| 機能 | PLAN_LIMITS | 実装 | 判断 |
|------|-----------|------|------|
| ~~アバター画像のカスタマイズ~~ | ~~`canCustomAvatar`~~ | #866 で削除。アバターアップロードは全プラン利用可 | `/pricing` に載せない。全プラン共通として扱う |

### 📘 全プラン共通機能（プラン差別化に使わない）

以下は実装済みだが plan-gate されていないため、プラン別 features 欄には掲載しない（「全プラン共通」の補足に含める）。

- デフォルトの子供設定 (#576, `default-child-service.ts`) — 設定画面から全プラン利用可
- 日次サマリー / 活動ログ閲覧 — 全プラン基本機能
- XP・レベルアップ・シールくじ・コンボ — 「冒険体験は全プラン共通」としてカード下に記載済み
- おうえんスタンプ — デザイン書 §23 ではプラン差別化候補だったが、現状実装は gate なし
- 活動アイコンの絵文字選択 — カスタム活動作成の一部であり「オリジナル活動の作成：無制限」に内包される
- 子供のアバター画像アップロード (#866 削除) — `/api/v1/children/[id]/avatar` は全プラン 5MB まで利用可

---

## ファミリー +¥280/月 の価値訴求

**現状の課題**: family プラン card のリストが短く、「スタンダードの全機能」とだけ書かれているため +¥280/月 の追加価値が曖昧。

**本棚卸しで定義するファミリー差別化機能（実装済み）**:
1. **きょうだいランキング**: SiblingTrendChart に `canSiblingRanking` ガード有り
2. **ひとことメッセージ（自由テキスト）**: ParentMessage に `canFreeTextMessage` ガード有り（standard は定型スタンプのみ）
3. **無制限の履歴保持**: `historyRetentionDays: null`（standard は 1 年）
4. **クラウドバックアップ 10 世代保管**: `maxCloudExports: 10`（standard は 3 個）
5. **メール優先サポート 24 時間以内応答**: サポート SLA（非技術的差別化）

---

## SSOT 更新方針（`src/lib/domain/plan-features.ts`）

### 更新ルール
- 実装で gate されている機能のみ掲載する
- family の features は「スタンダードの全機能」+ **ファミリー固有の 5 項目を明示**（曖昧さを排除）
- 「AI による活動提案」は family 限定で明記（#722 でプランゲートを family に変更）
- 「月次比較レポート」「5つのチカラの成長グラフ」は plan-gate なしのため features 欄から削除
- 「週次メールレポート」は cron が未稼働のため削除（復活は実稼働後）

### 対象ファイル
- `src/lib/domain/plan-features.ts`: SSOT
- `tests/unit/domain/plan-features.test.ts`: 期待値更新
- `src/routes/pricing/+page.svelte`: SSOT を import しているため自動反映
- `site/pricing.html` plan card 部分: 手動同期
- `site/index.html` / `site/pamphlet.html`: 該当箇所があれば手動同期

### LP 同期状況
- `site/pricing.html` plan card + 比較表: 本 PR で棚卸し結果に同期済み
- `site/index.html` ファミリーカード: 本 PR で同期済み（月次比較レポート → ひとことメッセージ）
- `site/pamphlet.html` プランカード: 本 PR で同期済み（旧スペック → 棚卸し結果）

---

## 関連 issue / ADR

- #792 本 PR
- #762 plan-features.ts SSOT 化（PR #870 でマージ済み）
- #733 AI 活動提案の features 欄追加
- #772 ひとことメッセージ（自由テキスト）の family 追加
- #782 きょうだいランキングを family プラン限定化
- #866 `canCustomAvatar` デッドコンフィグを削除（Option A: pricing に記載なしのため全プラン利用可で現状維持）
- ADR-0024 プラン解決 (`resolvePlanTier`) の責務分離パターン
