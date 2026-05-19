# 0010. Pre-PMF スコープ判断（3 バケット + セキュリティ最小化 + 優先度）

- **Status**: Accepted
- **Date**: 2026-04-20
- **Related Issue**: #1262 / #1265
- **統合元**: 旧 ADR-0023 + ADR-0034（本 PR で削除） + 2026-04-20 HP 再レビュー議論（新規）

## コンテキスト

> 旧 ADR-0023（Pre-PMF Issue 優先度判断基準）と ADR-0034（Pre-PMF セキュリティ最小化）を統合し、2026-04-20 HP 再レビュー議論で確定した **3 バケット判断基準**（バケット A: 実装 + 訴求 / B: LP 訴求のみ / C: 沈黙）を新規追加。ADR 10 枠再構成（#1262）の一環。

本プロジェクトは Pre-PMF（V2MOM Q2: サインアップ 20 名/月、Year 1: MAU 500 / MRR ¥12,000）。PO 1 人 + AI エージェント体制では以下の構造的バイアスが発生する:

1. **エンジニア偏重** — 2026-04-11 時点 open issue 集計で `area:billing=61`, `area:admin=25`、**growth / marketing / activation = 0**
2. **過剰防衛設計** — `license_event` / `ops_audit_log` / ブルート検知 / WAF / S3+Athena 等、PMF 後なら妥当だが Pre-PMF では ROI が見合わない設計が連鎖提案
3. **LP コンテンツの不均衡** — 親の懸念項目を「書けば安心」と追加すると、かえって新規不安を誘発する懸念が判明（2026-04-20 HP 再レビュー）

「起票されなかった issue」「書かないことの価値」が可視化されないため、PR テンプレ・レビュー・CI では検出不可能。**起票時点・設計時点での機械的チェック**が必要。

## 決定

### 1. 3 バケット判断基準（Issue / LP コンテンツ / 機能実装すべてに適用）

| バケット | 内容 | 例 |
|---------|------|-----|
| **A: 実装 + 訴求** | 顧客獲得インパクトが明確で、LP 訴求も有効 | 自動スリープ、使用時間可視化、年齢移行対応 |
| **B: LP 訴求のみ（既存発掘） / 実装は既存機能で代替** | 実装せずに LP で安心感を提供できる | 撤退コスト説明、サービス終了時データ扱い説明 |
| **C: 沈黙** | LP 掲載で新規不安誘発リスクが便益を上回る / YAGNI 該当 | 虚偽申告検知アルゴリズム、汎用監査ログ基盤、ML 検出 |

判断軸は 3 軸: **被害額 × 実装保守コスト × LP 掲載による新規不安誘発リスク**。デフォルトは **沈黙（C）**。A / B に上げるには明確な顧客獲得インパクトの根拠を要する。

### 2. Pre-PMF セキュリティ採用マトリクス（バケット判断の具体化）

| レイヤ | 採用（Pre-PMF） | 採用しない | PMF 後再評価トリガ |
|-------|---------------|-----------|-----------------|
| 鍵強度 | HMAC-SHA256（2^160 鍵空間） | — | — |
| レート制限 | API Gateway 標準スロットリング | AWS WAF / カスタム MW | throttling 既定値を恒常超過 |
| コスト監視 | AWS Budgets アラート（無料） | Cost Explorer API 定期ポーリング | Budgets で検知しきれない sudden burst |
| 顧客向け監査 | 既存 `licenses.status` + Stripe webhook 履歴 | 汎用監査ログ DynamoDB / S3+Athena | 法的・規約的な監査要請 |
| ランタイムログ | CloudWatch Logs 3 日 retention | 長期保管 / Athena | インシデント頻度 / コンプラ要件 |
| ブルート検知 | HMAC 鍵強度のみ（アルゴリズム防御） | IP カウンタ / Discord アラート | 量子計算等の現実化 |
| コスト上限停止 | なし | Budgets Action 自動停止 | 月額コストが想定 5 倍 × 3 回 |

### 3. Issue 起票時の Pre-PMF チェックリスト（`type:feat` 必須）

1. どのペルソナ（P1 / P2）のどの課題を解決するか明記
2. V2MOM の Method（M1〜M4）に紐づけ
3. **この機能がなくても Pre-PMF サインアップ 20 名/月に到達できるか**を自問
   - できる → `priority:medium` 以下（どれほど欲しくても high 以上を付けない）
   - できない → `priority:high` 以上 + 本文に「なぜ到達できないか」の根拠
4. 直近に Growth / Marketing / Onboarding 系 Issue を 1 本以上起票した（連続する新機能 Issue はバイアスの兆候）
5. 工数と Year 1 KPI（MAU 500 / MRR ¥12,000）への寄与が釣り合っている

根拠なしの `priority:high` は、レビュワーが `medium` 以下に降格する。

### 4. 破棄する過剰設計（Pre-PMF 段階では不採用）

`license_event` 追記ログテーブル / `ops_audit_log` 汎用監査 / ブルート検知 / 監査ログ専用 DynamoDB / S3+Athena / AWS WAF 導入。新規採用したい場合は本 ADR を supersede する新 ADR を先に起票。

**事例追記 (2026-05-19、EPIC #2283 由来)**:
- [Phase Analytics-Removal EPIC #2283](https://github.com/Takenori-Kusaka/ganbari-quest/issues/2283) (`tmp/research/analytics-removal-result.md`): 親管理画面 `/admin/analytics` への運営 KPI 露出 (Activation Funnel / Retention Cohort / 解約理由分布) を全面撤去。**Pre-PMF 段階の典型的な「親画面での運営者向け機能露出」事例** (内部用語 UI 露出 + 全テナント集計の親画面露出 + on-demand DynamoDB query 実行コスト + GDPR Art.5(1)(b) 目的限定違反)。家族向け B2C 業界 (ClassDojo Family / Cozi / Habitica / GoHenry / BusyKid) で同パターン先行事例 0 件。運用者向け機能は `/ops/analytics` に集約 (`ops_users` group 認証)、admin / ops 境界 SSOT は `06-UI設計書.md §11 画面所属判断` 参照。

### 5. PMF 後の再評価トリガ

- **規模**: 月商 ¥10,000 超 または 有料顧客 100 人超
- **インシデント**: セキュリティインシデント（不正アクセス・情報漏洩・サービス停止 30 分超）が 1 件
- **外部要件**: B2B エンタープライズ契約、GDPR 対応要請、PCI DSS 等

### 6. 免除

- `priority:critical` の bug fix（緊急対応）
- 法務・セキュリティ・コンプライアンス対応（選択の余地なし）
- `type:fix` の既存機能保守

### 7. OSS / UX prior art 先調査 + 機能完成度 9 層 17 項目判定 (#1350 / #2117 / #2139 / #2159 / #2171 / #2180)

#### 7.1 OSS 先調査と Pre-PMF 導入コスト判断 (#1350)

独自実装を含む Issue では、起票前に **OSS / 確立パターンを最低 2 件**調査する義務がある（ADR README + Issue テンプレで強制）。
Pre-PMF 段階での OSS 採用判断は、本 ADR の 3 バケット判断に準じる:

| OSS 導入タイプ | Pre-PMF 判断 | 例 |
|---------------|------------|-----|
| **軽量・単一責務** (zod / valibot / Toast 系) | 採用推奨 (A / B) | バリデーション・日時フォーマット・i18n runtime |
| **広範 framework 導入** (CMS / 大規模 BaaS) | 沈黙 (C) — ADR 先行必須 | Contentful / Sanity / Strapi |
| **OSS が存在しない領域** | 「探した範囲」を本文に明記 → 独自実装許容 | プロダクト固有ドメインロジック |

「OSS を見もしないまま独自実装」は構造的に禁止。bundle size / 学習コスト / 長期保守性を 3 点セットで評価し、
Pre-PMF で過剰な OSS (例: 大規模 BaaS) は採用せず、軽量 OSS > 独自実装の順に優先する。

#### 7.2 補助機能 (permission 系) の UX prior art 先調査 (#2117)

Web Platform API (permission 系: Notification API / Geolocation API / Camera/Microphone API / Clipboard API / Bluetooth API / NFC API 等) を扱う Issue は、OSS 先調査に加えて **UX prior art 先調査** (業界 3-5 件の許可フロー UX) を deep research 必須化する。

**permission 系の判定基準**:
- 非同期 permission リクエスト (`navigator.permissions.request()` 系)
- ブラウザ UI 介在
- async / await の複数 failure point
- 成功時 / 失敗時 / pending 中の UI 状態管理

該当 Issue は Issue Template の `auxiliary-feature-ux-checklist` 5 項目 (loading / failure / informed consent / state feedback / settings fallback) を AC に複製必須。

#### 7.3 補助機能 (marketplace 系) の 4 層完成度判定 (#2139)

**marketplace 系機能の 4 層完成度判定基準**: マーケットプレイス + 取込 + アプリ反映を伴う機能は、以下 4 層全てが揃って初めて「機能完成」とする:

| 層 | 内容 | 確認手段 |
|---|------|---------|
| **表示層** | マーケットプレイス一覧 + 詳細ページで preview 可能 | UI から item 詳細を開ける |
| **import 層** | import service / DB 反映機構 / 重複検出 | 「一括追加」/「取込」ボタンで DB に row が増える |
| **アプリ反映層** | 取込後に既存機能 (`special_rewards` / `checklist_templates` / `settings` 等) と整合動作 | 取込後に該当機能画面で表示される |
| **setup 連携層** | 新規ユーザー setup フローで一括追加経路あり | setup wizard で type 別 preset 選択可能 |

**「JSON データ + UI 表示のみ + import 未実装」状態の起票禁止**: marketplace 一覧に表示するだけで取込手段が無い (JSON データを LP/UI から見せるだけの) 機能は **見かけだけ機能** として ADR-0013 (LP truth) 違反となる。新規 type 追加 / 既存 type 修正 Issue は 4 層全てを AC に列挙すること。

該当 Issue は Issue Template の `auxiliary-feature-ux-checklist` 4 層 (表示 / import / アプリ反映 / setup 連携) を AC に複製必須。

#### 7.4 子供向け機能の 3 必須項目 (#2159 RS-5 由来)

子供向け機能 (子供画面で表示 / 操作 / 通知される機能) を扱う Issue は以下 **3 必須項目** を AC に複製必須。Phase Reward-Shop-UX で発覚した「中途半端実装」(#1335 SHOP-UI で UX 完成度 AC 外) の構造的再発防止:

| 項目 | 内容 | 確認手段 |
|---|------|---------|
| **業界 prior art 比較 (3 件以上、子供向け対象に限定)** | Khan Academy Kids / Duolingo ABC / Lingokids / PBS Kids 等の同等機能を最低 3 件比較し、UX チープさを起票時点で検出 | Issue 本文に prior art 3 件の screenshot or URL 添付 |
| **レスポンシブ完成度 (PC/Mobile 5 breakpoint)** | 375 / 768 / 1024 / 1280 / 1440 の 5 breakpoint で表示確認、PC 1 列中央寄せ等の崩れなし | E2E or 手動 SS 5 枚添付 |
| **感情演出完成度 (祝福 / 達成感 / フィードバック 3 層)** | 子供 UX コア体験の Dialog プレーン問題回避、3 層演出が揃って初めて「機能完成」 | 実装画面で達成時 / 完了時 / 操作時の 3 演出を SS 添付 |

#### 7.5 子供向け機能 / 補助機能の 3 追加必須項目 (#2171 MN-4 由来)

子供向け機能 / 補助機能を扱う Issue は §7.4 に加えて以下 **3 追加必須項目** を AC に複製必須。Phase Milestone-Notification-UX で発覚した「実装対象と AC のペルソナ不整合 / 類似 component 重複疑い / 業界 prior art 未参照」の構造的再発防止:

| 項目 | 内容 | 確認手段 |
|---|------|---------|
| **対象ペルソナと表示画面の整合性** | 起票時点で「誰 (P1 親 / P2 子供 / ops) がどこ (子供画面 / 親画面 / ops 画面) で使うか」明示、実装後に再確認 | Issue 本文に ペルソナ × 画面 mapping 表記載 |
| **類似 component grep (SSOT 確認)** | 新規 component 実装前に `grep -rE "<.*Banner\|<.*Overlay" src/lib/ui/components/` 等で重複検出、既存統合 or 新規分離の判断 | PR 本文に grep 結果 + 判断ロジック記載 |
| **語彙統一の年齢整合 (ADR-0015)** | ひらがな / 漢字混在は ADR-0015 `getLabel(key, ctx)` 整合確認、年齢別 variant 化 | labels.ts diff + 全年齢モード 5 種 SS 添付 |

#### 7.6 ナビ / 情報アーキテクチャ系の 2 必須項目 (#2180 AN-5 由来)

ナビ / 情報アーキテクチャ系 (NAV_CATEGORIES / admin-ia.md / 親管理画面ナビ / 子供画面ナビ 等の階層変更) を扱う Issue は以下 **2 必須項目** を AC に複製必須。Phase Admin-Nav-Restructure (#2176 EPIC) で発覚した「過去設計 SSOT 確認漏れ / ナビ 3 種同期変更漏れ」の構造的再発防止:

| 項目 | 内容 | 確認手段 |
|---|------|---------|
| **過去設計整合性確認 (closed Issue / 設計書 / ADR の SSOT 突合)** | 起票時点で関連する過去 closed Issue / ADR / `docs/design/admin-ia.md` 等の設計書を grep で全件確認、「現状 SSOT」と「本 Issue 提案」の差分を明示。subject-first 等の業界 prior art 整合根拠も併記 | Issue 本文に過去 SSOT 差分表 + prior art 引用 (Family Link / iOS HIG / Material 3 等) |
| **ナビ 3 種 (デスクトップ + モバイル + ボトムナビ) 統合変更時の SSOT 確認** | `AdminLayout.svelte` + `AdminMobileNav.svelte` + `BottomNav.svelte` の 3 種を grep で網羅、1-2 種だけ変更する漏れがないか確認。labels.ts SSOT 経由で 3 種同期反映を担保 | PR 本文に grep 結果 + 3 種への反映確認 |

Phase Admin-Nav-Restructure 由来の累積観察 6 件目 (Push-3 #2117 / MP-4 #2139 / Phase Category-Collapsible #2148 / Phase Reward-Shop-UX #2154 / Phase Milestone-Notification-UX #2167 / Phase Admin-Nav-Restructure #2176) と同型の「設計優先度変更」パターン。本項目で「subject-first 等の業界 prior art を見もしないまま頻度ベース分類で確定」の再発を防ぐ。

#### 7.7 機能完成度の定義 (permission 系 / marketplace 系 / 子供向け機能 / ナビ系の境界)

| カテゴリ | 該当例 | 判定基準 | 必須項目数 |
|---------|--------|---------|---------|
| **permission 系** | Web Push / Notification / Geolocation / Camera / Microphone / Clipboard / Bluetooth | Web Platform API + ブラウザ permission ダイアログ介在 | 5 項目 (§7.2) |
| **marketplace 系** | activity-pack / reward-set / event-checklist / rule-preset | 取込 → アプリ機能反映 の 2 hop 構造 | 4 項目 (§7.3) |
| **子供向け機能** | 子供画面で表示 / 操作 / 通知される機能 (ごほうび / バッジ / ミルストン / 通知 等) | 子供画面 (`/(child)/[uiMode=uiMode]/*`) で UI 露出 | 3+3 = 6 項目 (§7.4 + §7.5) |
| **ナビ / 情報アーキテクチャ系** | NAV_CATEGORIES 改訂 / admin-ia.md / 親管理画面ナビ階層 / 子供画面ナビ階層 | ナビカテゴリ追加・削除・上位下位移動 | 2 項目 (§7.6) |
| **対象外** | 単一画面の CRUD / 内部設定変更 / refactor | 上記 4 カテゴリのいずれにも該当しない | 0 項目 |

複数カテゴリ該当時は全該当層を AC に列挙 (例: 子供向け + permission 系 + ナビ系 = 5+3+3+2 = 13 項目、最大 9 層 17 項目)。

#### 7.8 retroactive 検証 (#2180 AC4)

Phase Admin-Nav-Restructure 完了時の retroactive 検証で「過去 closed Issue (#337 / #1396 / #1395) で本 §7.6 の 2 項目があれば、補佐の前回『過去設計乖離』誤判定 (実は admin-ia.md v1.0 と整合) が回避できたか」を確認する。

- **#337 (2026-04-04)**: 4 カテゴリ設計時、subject-first 等の業界 prior art 引用なし → §7.6 ①「過去設計整合性確認」+ Family Link 等 prior art 引用が AC にあれば、起票時に subject-first 採否を議論できた
- **#1395 / #1396 (2026-04-26-27)**: admin-ia.md v1.0 + 5 tab 実装、ナビ 3 種同期は実施済だが「将来 family グループ拡張視点」未言及 → §7.6 ② 自体は実施済だが、subject-first 観点での将来設計余白が AC 不在
- **結論**: 本 §7.6 の 2 項目があれば、本 Phase Admin-Nav-Restructure で発生した「補佐誤判定」+「PO 違和感の構造的素早検出」が起票時点で達成可能。今後 retroactive 適用は新規 Issue のみ対象 (closed Issue は git 履歴で保全、修正なし)。

判定不明な場合は補佐の deep research (`.claude/skills/issue-triage/SKILL.md` 手順 C) で業界 prior art を 3-5 件調査して判定する。

## 結果

- Pre-PMF の優先順位が「機能の完成度」から「ユーザー獲得への寄与」にシフト
- `priority:high` のインフレが抑制される（根拠必須化の副作用）
- AI エージェントが自律的に大量の feat issue / 過剰防衛を生成する事故を防ぐ
- 「書かない」「実装しない」判断が構造化され、レビュー時間が短縮

### トレードオフ

- 起票に追加検討コスト（5〜10 分）
- 監査ログが存在しない期間のインシデント調査は限定的（state + Stripe webhook + CloudWatch 3 日のみ）

## 関連

- ADR-0003（Issue 起票品質）— 本 ADR を補完（起票の構造化）
- ADR-0008（設計ポリシー先行確認）— 本 ADR の判断を実装着手前に強制
- ADR-0006（Safety Assertion Erosion Ban）— 既存セーフティは守る（本 ADR は新規採用の抑制）
