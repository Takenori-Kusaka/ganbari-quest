---
name: PR Review
description: Use when reviewing a pull request. Enforces Step 0 PO-decision triage (po-decision:required label for high-risk irreversible paths, #3862) plus the mandatory 9-point checklist (file existence, dependencies, AC verification, E2E, lateral spread, CSS, design docs, documentation, recent-deploy deletion guard).
---

# PR レビューチェックリスト

## Step 0: PO 決裁 triage（#3862、高リスク・不可逆変更の機械判定）

A〜I のレビューに入る前に、本 PR が **PO 決裁対象か** を判定する。AI は triage + ブリーフ生成のみを担い、**判断と実態把握は PO が握る**（automation complacency / rubber-stamping への構造的対処）。

### 0-1. パス判定マップ（機械層）

**SSOT = `.github/labeler.yml` の `po-decision:required` エントリ**。`actions/labeler@v6`（`.github/workflows/labeler.yml`）が PR opened / synchronize で自動付与する。領域一覧（glob 実体は labeler.yml 参照）:

| 領域 | 代表パス |
|---|---|
| DB スキーマ / migration | `src/lib/server/db/schema.ts` / `src/lib/server/db/dsql/schema.ts` / `drizzle/**` |
| Stripe・billing | `src/lib/server/stripe/**` / `src/routes/api/stripe/**` |
| auth・認可境界 | `src/hooks.server.ts` / `src/lib/policy/**` / `src/lib/server/auth/**` |
| infra・deploy | `infra/**` / `.github/workflows/deploy*.yml` |
| DSQL テナント分離（ADR-0063） | `src/lib/server/db/dsql/connection.ts` + tenant-predicate fitness test |
| retention・PII（ADR-0049） | retention-cleanup / account-deletion / deletion-export service |
| env（ADR-0006） | `.env.example` / `src/lib/runtime/env.ts` |
| 価格・プラン文字列（ADR-0045） | `src/lib/domain/terms.ts` / `src/lib/domain/plan-features.ts` |
| 法務・LP truth（ADR-0013） | `site/{terms,privacy,tokushoho,sla,pricing}.html` / プライシング戦略書 |

回帰固定: `tests/unit/github/po-decision-labeler.test.ts`（高リスク代表パス → label 期待、false negative 0）。glob 追加・変更時は同テストの代表パスも同 PR で更新する。

### 0-2. glob で表現できない triage シグナル（判断層 checklist、PO 決裁 2026-07-19 追加軸込み）

パス非該当でも、以下に 1 つでも該当すれば `gh pr edit <N> --add-label "po-decision:required"` で手動付与する:

- [ ] **運用コスト / 保守コストが増える変更**（定常運用手順の追加・監視対象の増加・手動運転の恒常化）
- [ ] **新規デザインアーキテクチャパターンの採用**（既存 registry / Strategy / 3 層トークン等に無い新パターン導入）
- [ ] **技術負債としての積み残しが発生する変更**（暫定実装のまま完了扱い・migration 半端・fallback の恒久化）
- [ ] 変更ファイル数が大きい（50 file 超、レビュー shallow 化の実証リスク）
- [ ] 5 年齢モード横断波及（`regression-check` / `impact-analysis` skill 該当）
- [ ] `priority:critical`（ADR-0002）
- [ ] ロールバック不能なデータ破壊 / 不可逆 migration を含む

### 0-3. label 付与時の義務

`po-decision:required` の PR は、PR body に **「## PO 決裁ブリーフ」条件付きセクション**（`dev-open-pr` skill の `templates/po-decision-brief.md`、**mermaid 一枚絵** = リスク・可逆性 / trade-off / 反対理由 3 軸 / 顧客面の変化 / 判断依頼を 1 図に圧縮、#3918 PO 恒久要件）を必須添付し、**PO の Yes/No 判断を得てから merge する**（QM / audit-manager 単独で merge しない）。ブリーフ生成手順は [dev-open-pr SKILL.md](../dev-open-pr/SKILL.md) §「PO 決裁ブリーフ」を参照。非該当 PR は通常フロー（A〜I → QM 判定）で進み、抜き取り監査（`docs/sessions/audit-team.md` §3.9）の対象になる。

## 必須 9 項目（A〜I 全項目）

### A. ファイル存在・依存関係
- [ ] import 先のファイルが全て実在するか
- [ ] 新規 import の依存パッケージが package.json に存在するか
- [ ] 削除されたファイルを参照している箇所がないか

### B. Issue AC 突合
- [ ] Issue の Acceptance Criteria を 1 行ずつ検証
- [ ] 部分実装で `closes` していないか（AC 全項目必須）
- [ ] Issue で提案された対策が全て実装されているか

### C. テスト品質（ADR-0005 / ADR-0061）
- [ ] 新規コードにユニットテストが同梱されているか
- [ ] 境界値・異常系・競合のテストケースがあるか
- [ ] アサーション弱体化（toBeTruthy/toBeDefined への置換）がないか
- [ ] E2E テストが必要な場合は同梱されているか
- [ ] **failing-test-first（ADR-0061）**: バグ修正 PR は「再現テスト → 修正」順か。修正前に失敗し修正後に green になるテストで原因が pin されているか（修正だけで再現テストなしは差し戻し）
- [ ] **push-down-the-pyramid（ADR-0061 / ADR-0007）**: 重量レーン（e2e / 統合監査）で露見した不具合は、同条件を unit / lint / fitness function で捕捉できないか検討し、可能なら下位層に降ろしてあるか
- [ ] **same-class-N→guard（ADR-0061）**: 同一バグ class が 2 回以上再発している領域は、別 instance パッチでなく CI gate / lint / property test / fitness function で class 全体を lock しているか（instance パッチのみは Done にしない）
- [ ] **Svelte Runes semantic（ADR-0007 §6 / #3878、lint 対象外の領域）**: `.svelte` 変更は `eslint-plugin-svelte` recommended（`lint:svelte`）が syntactic footgun を潰すが、**「この `$effect` は `$derived` にすべき」の意図判断は lint では原理的に不可能**（`prefer-writable-derived` は単一代入 trivial shape のみ検出）。effect で state を derive/同期していないか、新規 `eslint-suppressions.json` エントリ増（baseline 悪化）がないかを目視で確認する

### D. 横展開（parallel-implementations.md）
- [ ] labels.ts の変更 → site/ + `**/_guide.ts` (❓ ページガイド) / `tutorial-chapters-child.ts` (子供チュートリアル) も同期
- [ ] 本番画面の変更 → デモ画面も同等変更
- [ ] ナビゲーション変更 → Desktop + Mobile + BottomNav
- [ ] DB スキーマ変更 → global-setup.ts + test-db.ts + demo-data.ts

### E. CSS/デザイン（docs/DESIGN.md §9）
- [ ] hex 直書き禁止（routes/features 内）
- [ ] プリミティブ再実装禁止
- [ ] 内部コード UI 露出禁止
- [ ] 用語ハードコード禁止（labels.ts 経由）
- [ ] インラインスタイル禁止（動的値以外）

### F. 設計書同期
- [ ] docs/CLAUDE.md の更新ルール表に該当する変更がある場合、設計書が更新済み
- [ ] 設計書更新なき PR はマージ不可

### G. セキュリティ
- [ ] ユーザー入力の検証（XSS、SQLi）
- [ ] 認証・認可チェック
- [ ] 機密情報のログ出力禁止

### H. 文書化
- [ ] レビュー指摘を全て文書化（ADR-0006: 指摘ゼロでマージは禁止）
- [ ] 発見事項は PR コメントまたは Issue で記録

### I. 直近 deploy file 削除なし（#2603、rebase drift 5 連続再発教訓）
- [ ] `node scripts/check-recent-deploy-deletion.mjs --pr <N>` が exit 0
- [ ] 直近 7 日に main merge された file を本 PR が削除していない（rebase drift の典型 symptom）
- [ ] archive 移動 (ADR 1-in-1-out 等) の legitimate な delete なら `--ignore-pattern` で除外
- [ ] exit 2 検出時は **Fix Agent dispatch → `git rebase origin/main` 強制** + screenshots branch 再 push (#2063)

## 判定

- 全項目 OK → Approve
- Copilot の COMMENTED は承認扱いにしない

### BLOCK は 3 類型のみ (2026-07-30、SSOT: `docs/sessions/qm-session.md` §BLOCK 基準)

A〜I で NG が出ても、**自動的に Request Changes にはしない**。BLOCK してよいのは次の 3 類型だけで、該当しないものは **Approve + follow-up（PR コメント止まり）** に降格する。

| # | 類型 | 例 |
|---|---|---|
| ① | **顧客に実害がある** | データ不整合 / 課金の誤り / 認可の穴 / 日付境界のずれ / 画面が使えない |
| ② | **証跡の真正性を弱める** | PR body の主張が HEAD に存在しない / SS の Before-After 偽装 / 実行していない検証を実行したと書く |
| ③ | **不可逆** | 本番データ・課金・削除・DB スキーマに触れ、戻せない |

- **gate の削除・warn 降格は BLOCK 事由にしない**。gate を減らす PR は **PO 承認があるかだけ**を確認し、承認があれば内容の是非で BLOCK しない（gate の増減は PO 承認事項であり QA の判断領域ではない）
- **記録の不整合（body の書式 / チェックボックス / 表の体裁）は BLOCK しない**。降格の条件は **「独立に実 diff を確認し、実害がないと確認できた場合のみ」** — 確認せずに降格しない
- follow-up は **PR コメント止まり**。Issue 化は「E1〜E5 のいずれかに属し、かつ顧客の金・データ・法務に接続する」場合のみ（装置起因は Issue にしない、`docs/sessions/po-session.md` §「Issue を起票する基準」）
