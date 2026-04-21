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

> **注**: #1307 (B9) / #1298 (B3) 派生で ADR-0011 / ADR-0012 / ADR-0013 が同時期に提案されており、10 枠上限ルールの 1-in-1-out は 3 本が揃って merge されるタイミングでまとめて棚卸する（PO 判断）。本表は一時的に 11+ 行に膨らむ可能性がある。

| # | タイトル | ステータス | 日付 |
|---|--------|----------|------|
| 0001 | [設計書は Single Source of Truth](0001-design-doc-as-source-of-truth.md) | accepted | 2026-04-20 |
| 0002 | [Critical 修正の品質ゲート](0002-critical-fix-quality-gate.md) | accepted | 2026-04-20 |
| 0003 | [Issue 起票・クローズ品質（根本原因 + 構造的解決）](0003-issue-quality-standard.md) | accepted | 2026-04-20 |
| 0004 | [レビュー & AC 検証品質](0004-review-and-ac-verification.md) | accepted | 2026-04-20 |
| 0005 | [テスト品質 ratchet](0005-test-quality-ratchet.md) | accepted | 2026-04-20 |
| 0006 | [Safety Assertion Erosion Ban](0006-safety-assertion-erosion-ban.md) | accepted | 2026-04-20 |
| 0007 | [静的解析 tier ポリシー (T1/T2/T3/T4)](0007-static-analysis-tier-policy.md) | accepted | 2026-04-20 |
| 0008 | [設計ポリシー先行確認フロー](0008-design-policy-pre-approval.md) | accepted | 2026-04-20 |
| 0009 | [labels.ts SSOT 化原則](0009-labels-ssot-principle.md) | accepted | 2026-04-20 |
| 0010 | [Pre-PMF スコープ判断（3 バケット + セキュリティ最小化 + 優先度）](0010-pre-pmf-scope-judgment.md) | accepted | 2026-04-20 |
| 0012 | [Anti-engagement 原則（滞在時間 = 価値毀損）](0012-anti-engagement-principle.md) | accepted | 2026-04-21 |
| 0013 | [LP 文言は実装の事実を SSOT とする](0013-lp-truth-from-implementation.md) | accepted | 2026-04-21 |

## archive 一覧（25 件）

`docs/decisions/archive/` 配下。現場の常時参照ルールではないが歴史的価値で保全。再活性化時は本 README の「archive 運用ルール」を参照。

### 技術選定の背景（7 件）

| # | タイトル |
|---|--------|
| 0011 | [SvelteKit 2 + Svelte 5 採用](archive/0011-sveltekit-svelte5.md) |
| 0012 | [DynamoDB シングルテーブル設計](archive/0012-dynamodb-single-table.md) |
| 0013 | [Cognito + Google OAuth](archive/0013-cognito-google-oauth.md) |
| 0014 | [3 層 CSS トークンアーキテクチャ](archive/0014-css-token-architecture.md) |
| 0015 | [Repository パターン](archive/0015-repository-pattern.md) |
| 0040 | [実行モード × ライセンス統括](archive/0040-runtime-mode-license-unified-architecture.md) |
| 0043 | [NativeSelect primitive](archive/0043-native-select-primitive.md) |

### 現行ルール（TOP10 落ち）（11 件）

| # | タイトル |
|---|--------|
| 0001 | [リネーム時の後方互換必須](archive/0001-rename-backward-compat.md) |
| 0004 | [スタンプカード正仕様](archive/0004-stamp-card-spec.md) |
| 0007 | [画像アセット保護](archive/0007-image-asset-protection.md) |
| 0019 | [ダイアログ FSM](archive/0019-dialog-fsm-scrap-and-rebuild.md) |
| 0021 | [デプロイ検証ゲート](archive/0021-deploy-verification-gate.md) |
| 0022 | [課金 × データライフサイクル整合](archive/0022-billing-data-lifecycle-consistency.md) |
| 0024 | [resolvePlanTier 責務分離](archive/0024-plan-tier-resolution-pattern.md) |
| 0025 | [License × Stripe 因果関係](archive/0025-license-subscription-causality.md) |
| 0026 | [ライセンスキーアーキテクチャ](archive/0026-license-key-architecture.md) |
| 0028 | [retention 物理削除ポリシー](archive/0028-retention-physical-delete.md) |
| 0031 | [スキーマ互換テスト義務化](archive/0031-schema-change-compat-testing.md) |

### 実装ポリシー（5 件）

| # | タイトル |
|---|--------|
| 0030 | [Cognito E2E user lifecycle](archive/0030-cognito-e2e-user-lifecycle.md) |
| 0033 | [/ops Cognito ops group 認可](archive/0033-ops-dashboard-cognito-authz.md) |
| 0036 | [マーケット公開アクセス設計](archive/0036-marketplace-public-access.md) |
| 0039 | [デモモード統合](archive/0039-demo-mode-app-execution-mode.md) |
| 0044 | [admin bypass 証跡運用](archive/0044-admin-bypass-evidence.md) |

### 小規模方針（2 件）

| # | タイトル |
|---|--------|
| 0041 | [マーケット命名テンプレート](archive/0041-marketplace-naming-template.md) |
| 0042 | [マーケット性別バリアント方針](archive/0042-marketplace-gender-variant-policy.md) |

## 削除済み（git 履歴で追跡）

以下は #1262 sub-A / sub-B で削除。内容は TOP 10 に吸収済み、または supersede チェーン終結。

- **TOP 10 吸収**: 旧 0003 / 0005 / 0006 / 0010 / 0017 / 0018 / 0020 / 0023 / 0029 / 0032 / 0034 / 0035 / 0037 / 0038（14 件、sub-A）
- **supersede チェーン終結**: 旧 0002 / 0008 / 0009 / 0016 / 0027（5 件、sub-B）

## 棚卸レポート

- [adr-inventory-2026-04-19.md](adr-inventory-2026-04-19.md) — 旧 0001〜0039 の棚卸（0008 / 0009 / 0016 を supersede）
- `adr-inventory-2026-04-20.md`（予定）— #1262 sub-7 完了時に刷新
