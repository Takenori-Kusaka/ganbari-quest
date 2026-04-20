# Architecture Decision Records (ADR)

本ディレクトリは、がんばりクエストの重要な技術決定・設計判断を記録する。

## ADR テンプレート

```markdown
# NNNN. タイトル

| 項目 | 内容 |
|------|------|
| ステータス | proposed / accepted / deprecated / superseded |
| 日付 | YYYY-MM-DD |
| 起票者 | 名前 |
| 関連 Issue | #番号 |

## コンテキスト

なぜこの決定が必要だったのか。

## 検討した選択肢

### 選択肢 A: ...
- メリット: ...
- デメリット: ...

### 選択肢 B: ...
- メリット: ...
- デメリット: ...

## 決定

何を選び、なぜ選んだか。

## 結果

この決定により何が変わるか。トレードオフは何か。
```

## ボリューム上限ルール

ADR を現場の常時参照ルールとして機能させるため、以下の上限を設ける。

| 項目 | 上限 | 根拠 |
|------|------|------|
| `docs/decisions/` 直下 active ADR 総数 | **≤ 10 件** | Miller's Law (7±2) の認知限界。毎週以上参照するルールとして記憶し得る現実的上限 |
| per-ADR 本文 | ≤ 150 行 | 5 分以内に通読可能な分量 |
| per-ADR 章立て | ≤ 7 セクション | コンテキスト / 選択肢 / 決定 / 結果 + 固有セクション ≤ 3 |

超過時の運用:

- per-ADR が 150 行を超える場合、補助ドキュメント（`docs/design/*.md`）に詳細を分離
- 章立てが 7 を超える場合、統合またはサブセクション化

上限数値は暫定値。6 ヶ月ごとの棚卸で見直し可能。

## 新規 ADR 追加 gate

以下のいずれかを満たさない限り、新規 ADR を起票しない。

1. **機械強制できない判断原則** — 定性的方針で CI / lint / テンプレで表現できないもの
2. **後から改訂時に背景理解が必須な決定** — 技術選定根拠・トレードオフ記録等
3. **既存 ADR と矛盾する新判断** — supersede 必須

上記いずれでもなければ、以下に配置する:

- CI / lint / workflow（`.github/workflows/*`, `scripts/*`）
- Issue / PR テンプレート（`.github/ISSUE_TEMPLATE/*`, `PULL_REQUEST_TEMPLATE.md`）
- CLAUDE.md（ルート / `docs/` / `src/` / `tests/` / `.github/` / `infra/`）

## 10 枠超過時の義務（1-in-1-out）

- 10 枠が埋まっている状態で新規追加する場合、既存 1 件以上を archive 送りまたは supersede することを同 PR 内で必須とする
- 同梱なしの PR は CI で自動 fail させる（CI 実装は follow-up で別 Issue 化）
- 該当する既存 ADR が見つからない場合、新規 ADR 起票自体を取り下げる

## archive 運用ルール

`docs/decisions/archive/` は歴史的価値はあるが現場の常時参照ルールではない ADR の退避先。

- **退避時**: `git mv docs/decisions/XXXX-*.md docs/decisions/archive/` で元番号のまま移動、git rename 履歴を継承
- **ヘッダ追記**: `archived (YYYY-MM-DD): reason` を必ず明記
- **再活性化**: archive から直下に戻す際は、同 PR 内で active 10 件のうち 1 件を archive 送りにする（1-in-1-out）
- **完全削除判断**: archive 内でも以下に該当すれば削除可（定期棚卸で判断）
  - 既に別 ADR で内容が完全カバーされている
  - 対象コード / プロセスが廃止済みで再活性化の可能性ゼロ

## renumber 規約

原則: **ADR 番号は不変ではない**。Pre-PMF 個人開発段階では renumber コスト < 認知負荷コスト であり、統合・整理のたびに番号を振り直して構わない。ただし混乱を避けるため以下手順を守る。

- **1:1 renumber**: `git mv OLD-*.md NEW-*.md` で履歴継承、フロントマター内の番号更新
- **N:1 統合**: 新番号で新規作成、旧ファイルは `git rm`（内容は新 ADR の「コンテキスト」セクションに統合元として記載）
- **renumber PR** は 1 つに集約（分割厳禁）、参照更新（CLAUDE.md / copilot-instructions / docs/design 等）を同時または直後の別 PR で行う
- **過去 PR / コミット本文** の ADR 番号参照は更新しない（git 履歴として保全）

## 命名規則

- ファイル名: `NNNN-kebab-case-title.md`
- 番号は 0001 から連番（欠番は renumber 時に詰める）
- active は `docs/decisions/` 直下、archive は `docs/decisions/archive/` に配置
- ステータスが `superseded` / `archived` になったファイルも、明示的削除判断がない限り git 履歴として残す

## 一覧（TOP 10 active）

> 本セクションは #1262 の sub-A / sub-7 完了時点で新 0001-0010 に更新される。現時点では過渡期として旧採番を掲載。

| # | タイトル | ステータス | 日付 |
|---|--------|----------|------|
| 0001 | [リネーム時の後方互換必須](0001-rename-backward-compat.md) | accepted | 2026-03-28 |
| 0002 | [ダイアログキュー必須](0002-dialog-queue-required.md) | accepted | 2026-03-28 |
| 0003 | [設計書は Single Source of Truth](0003-design-doc-as-source-of-truth.md) | accepted | 2026-04-06 |
| 0004 | [スタンプカード正仕様](0004-stamp-card-spec.md) | accepted | 2026-04-06 |
| 0005 | [Critical 修正の品質ゲート](0005-critical-fix-quality-gate.md) | accepted | 2026-04-06 |
| 0006 | [PR レビューは文書化された指摘を必ず出力する](0006-pr-review-must-document-findings.md) | accepted | 2026-04-07 |
| 0007 | [画像アセットが存在する機能を絵文字に戻すことは明示的デグレ](0007-image-asset-protection.md) | accepted | 2026-04-07 |
| 0008 | ~~[年齢モード5重複の変更リスク管理](0008-age-mode-duplication-risk.md)~~ | superseded (2026-04-19) | 2026-04-07 |
| 0009 | ~~[server→client 型契約の安全性確保](0009-server-client-type-contract.md)~~ | superseded (2026-04-19) | 2026-04-07 |
| 0010 | [Issue 起票・クローズの品質基準](0010-issue-close-quality.md) | accepted | 2026-04-10 |
| 0011 | [SvelteKit + Svelte 5 採用](0011-sveltekit-svelte5.md) | accepted | 2026-01-15 |
| 0012 | [DynamoDB シングルテーブル設計](0012-dynamodb-single-table.md) | accepted | 2026-02-20 |
| 0013 | [Cognito + Google OAuth 認証](0013-cognito-google-oauth.md) | accepted | 2026-02-25 |
| 0014 | [3層CSSトークンアーキテクチャ](0014-css-token-architecture.md) | accepted | 2026-03-15 |
| 0015 | [Repository パターンによる DB 抽象化](0015-repository-pattern.md) | accepted | 2026-02-15 |
| 0016 | ~~[ダイアログ/オーバーレイの状態管理方針](0016-dialog-overlay-management.md)~~ | superseded by 0019 (2026-04-19) | 2026-04-10 |
| 0017 | [テスト品質の劣化を許容しない開発プロセス](0017-test-quality-ratchet.md) | accepted | 2026-04-10 |
| 0018 | [Issue起票は根本原因特定と構造的解決策を必須とする](0018-issue-quality-standard.md) | accepted | 2026-04-10 |
| 0019 | [ダイアログ管理はFSMでスクラップ＆ビルド](0019-dialog-fsm-scrap-and-rebuild.md) | accepted | 2026-04-10 |
| 0020 | [テスト品質の劣化を許容しない（強制プロセス）](0020-test-quality-ratchet-enforcement.md) | accepted | 2026-04-10 |
| 0021 | [デプロイ検証ゲート](0021-deploy-verification-gate.md) | accepted | 2026-04-11 |
| 0022 | [課金サイクルとデータライフサイクルの整合性](0022-billing-data-lifecycle-consistency.md) | accepted | 2026-04-11 |
| 0023 | [Pre-PMF Issue 優先度判断基準](0023-pre-pmf-issue-priority-guidelines.md) | accepted | 2026-04-11 |
| 0024 | [プラン解決 (resolvePlanTier) の責務分離パターン](0024-plan-tier-resolution-pattern.md) | accepted | 2026-04-11 |
| 0025 | [License ↔ Stripe Subscription 因果関係](0025-license-subscription-causality.md) | accepted | 2026-04-11 |
| 0026 | [ライセンスキーアーキテクチャ](0026-license-key-architecture.md) | accepted | 2026-04-11 |
| 0027 | [プラン別履歴保持期間ポリシー（retention = 表示フィルタ）](0027-retention-policy.md) | accepted | 2026-04-12 |
| 0028 | [プラン別履歴保持期間ポリシー（retention = 表示フィルタ + 物理削除 cron）](0028-retention-physical-delete.md) | accepted | 2026-04-12 |
| 0029 | [Safety Assertion Erosion Ban](0029-safety-assertion-erosion-ban.md) | accepted | 2026-04-12 |
| 0030 | [Cognito E2E テストユーザーのライフサイクル基盤](0030-cognito-e2e-user-lifecycle.md) | accepted | 2026-04-16 |
| 0031 | [スキーマ変更時の既存データ互換性テスト義務化](0031-schema-change-compat-testing.md) | accepted | 2026-04-16 |
| 0032 | [静的解析ツール実行頻度ポリシー (T1/T2/T3/T4)](0032-static-analysis-tier-policy.md) | accepted | 2026-04-16 |
| 0033 | [/ops ダッシュボード認可を Cognito ops group ベースに刷新（OPS_SECRET_KEY 廃止）](0033-ops-dashboard-cognito-authz.md) | accepted | 2026-04-16 |
| 0034 | [Pre-PMF セキュリティ最小化方針（HMAC + API Gateway throttling + Budgets）](0034-pre-pmf-security-minimum.md) | accepted | 2026-04-16 |
| 0035 | [設計ポリシー先行確認フロー（新機能は実装前に PO 合意必須）](0035-design-policy-pre-approval.md) | accepted | 2026-04-17 |
| 0036 | [マーケットプレイス公開アクセス設計（閲覧パブリック / インポート認証必須）](0036-marketplace-public-access.md) | accepted | 2026-04-18 |
| 0037 | [全ユーザー向け文言の SSOT 化原則](0037-labels-ssot-principle.md) | accepted | 2026-04-18 |
| 0038 | [AC 検証エビデンス必須化 (Issue close gate + PR AC 検証マップ)](0038-ac-verification-evidence.md) | accepted | 2026-04-18 |
| 0039 | [デモモードをアプリ実行モードに統合](0039-demo-mode-app-execution-mode.md) | accepted | 2026-04-19 |
| 0040 | [実行モード × ライセンス統括アーキテクチャ (Typed env + EvaluationContext + Policy Gate)](0040-runtime-mode-license-unified-architecture.md) | accepted | 2026-04-19 |
| 0041 | [マーケットプレイス命名テンプレート](0041-marketplace-naming-template.md) | accepted | 2026-04-20 |
| 0042 | [マーケットプレイス 性別バリアント方針](0042-marketplace-gender-variant-policy.md) | accepted | 2026-04-20 |
| 0043 | [NativeSelect primitive を採用（raw select 全置換）](0043-native-select-primitive.md) | accepted | 2026-04-20 |
| 0044 | [admin bypass merge 証跡記録運用](0044-admin-bypass-evidence.md) | accepted | 2026-04-20 |

## archive 一覧

> `docs/decisions/archive/` 配下。#1262 の sub-B 完了時点で 23 件が移動される予定。現時点では空。

_（sub-B 完了後に一覧表が挿入される）_

## 棚卸レポート

- [adr-inventory-2026-04-19.md](adr-inventory-2026-04-19.md) — 0001〜0039 の棚卸（0008 / 0009 / 0016 を supersede）
- `adr-inventory-2026-04-20.md`（予定）— #1262 sub-7 完了時に刷新
