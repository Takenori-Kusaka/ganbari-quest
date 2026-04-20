# ADR 棚卸レポート (2026-04-20)

#1262（ADR 全体リファクタリング — active-primary ≤ 10 達成とボリューム上限ルール確立）完了時点の最終棚卸。

sub-A（新 0001-0010 起案）/ sub-B（25 archive + 5 delete）/ sub-C（CLAUDE.md / 設計書 6 ファイルの参照 archive 化）完了を総括する。

## サマリ

| 区分 | 件数 | 備考 |
|------|------|------|
| **active ADR（TOP 10）** | **10** | `docs/decisions/` 直下。全て毎週以上現場参照される |
| archive ADR | 25 | `docs/decisions/archive/` に退避。歴史的参照可 |
| 削除済み（git 履歴で追跡） | 19 | TOP10 吸収 14 件 + supersede 終結 5 件 |
| 棚卸レポート（履歴） | 2 | 2026-04-19, 2026-04-20（本書） |

ボリューム上限ルール（Miller's Law 7±2）に基づく `active ≤ 10` を達成。

## active ADR 一覧（TOP 10）

| # | タイトル | 起票由来 | 主要利用箇所 |
|---|---------|---------|--------------|
| 0001 | 設計書 Single Source of Truth | 旧 0003 | `docs/CLAUDE.md` 設計書更新表 |
| 0002 | Critical 修正の品質ゲート | 旧 0005 | `.github/CLAUDE.md` Critical PR 必須 5 条件 |
| 0003 | Issue 起票・クローズ品質（根本原因 + 構造的解決） | 旧 0010 + 0018 統合 | Issue テンプレート・PO セッション |
| 0004 | レビュー & AC 検証品質 | 旧 0006 + 0038 統合 | PR レビュー必須チェックリスト |
| 0005 | テスト品質 ratchet | 旧 0017 + 0020 統合 | `tests/CLAUDE.md` テスト要件 |
| 0006 | Safety Assertion Erosion Ban | 旧 0029 | `scripts/check-no-assertion-weakening.mjs` |
| 0007 | 静的解析 tier ポリシー (T1/T2/T3/T4) | 旧 0032 | CI `.github/workflows/ci.yml` 階層 |
| 0008 | 設計ポリシー先行確認フロー | 旧 0035 | 実装越境禁止ルール |
| 0009 | labels.ts SSOT 化原則 | 旧 0037 | `check-no-plan-literals.mjs` ほか |
| 0010 | Pre-PMF スコープ判断 | 旧 0034 を拡張 | 過剰防衛設計拒否判断 |

## archive ADR 25 件

`docs/decisions/archive/` に退避。能動参照は不要だが、歴史的背景・運用詳細として残存。

### 技術選定の背景（7 件）

| # | タイトル | 備考 |
|---|---------|------|
| 0011 | SvelteKit 2 + Svelte 5 (Runes) 採用 | スタック選定時の判断記録 |
| 0012 | DynamoDB シングルテーブル設計 | 旧 AWS 時代のデータ設計 |
| 0013 | Cognito + Google OAuth 認証 | 認証方式の決定 |
| 0014 | 3 層 CSS トークンアーキテクチャ | `DESIGN.md` §2 の原典 |
| 0015 | Repository パターンによる DB 抽象化 | サーバ層設計方針 |
| 0040 | 実行モード × ライセンス統括アーキテクチャ | 2026-04 起票、P5 完了後 archive |
| 0043 | NativeSelect primitive 導入 | Ark UI `<Select>` から移行記録 |

### 現行ルールに昇格して TOP10 を支えている旧 ADR（11 件）

| # | タイトル | TOP10 対応 |
|---|---------|-----------|
| 0001-rename-backward-compat | 名称リネーム後方互換 | 0001 |
| 0004-stamp-card-spec | スタンプカード仕様 | 0001（設計書 SSOT） |
| 0007-image-asset-protection | 画像アセット禁忌 | 0001（`DESIGN.md` §9） |
| 0019 | ダイアログ管理 FSM スクラップ＆ビルド | 独立ルール（詳細参照先） |
| 0021 | デプロイ検証ゲート | 0002（Critical 修正） |
| 0022 | 課金サイクル×データライフサイクル整合 | 0001（`account-deletion-flow.md`） |
| 0024 | プラン解決パターン | 0009（labels SSOT） |
| 0025 | License ↔ Stripe 因果関係 | 0001（`license-subscription-causality.md`） |
| 0026 | ライセンスキーアーキテクチャ | 0001（`license-key-requirements.md`） |
| 0028 | retention 物理削除ポリシー | 0001（`08-データベース設計書.md` §retention） |
| 0031 | スキーマ変更互換性テスト | 0005（テスト ratchet） |

### 実装ポリシー系（5 件）

| # | タイトル | 備考 |
|---|---------|------|
| 0030 | Cognito E2E ユーザーのライフサイクル基盤 | テスト基盤 |
| 0033 | /ops ダッシュボード Cognito authz | OPS_SECRET_KEY → CRON_SECRET 分離 |
| 0036 | Marketplace 公開アクセス制御 | アクセス境界 |
| 0039 | demo-mode × app 実行モード | ADR-0040 で統合 |
| 0044 | admin bypass merge 証跡 | 0004（レビュー品質） |

### 小規模方針（2 件）

| # | タイトル | 備考 |
|---|---------|------|
| 0041 | Marketplace naming template | プリセット命名規則 |
| 0042 | Marketplace gender variant policy | #1212 で「維持」改訂 |

## 削除された ADR（19 件）

git 履歴で追跡可能。TOP10 に吸収 or supersede 終結。

### TOP10 吸収で冗長化（14 件）

旧 0002 (critical-fix), 0005 (critical-fix-quality-gate-old), 0006 (pr-review-docs), 0010 (issue-ticket-quality), 0017 (test-quality-ratchet-old), 0018 (issue-root-cause), 0020 (test-ratchet-enforce), 0027 (retention-policy-old), 0029 (safety-assertion-erosion-ban-old), 0032 (static-analysis-tier-old), 0034 (pre-pmf-security-min), 0035 (design-policy-preapproval-old), 0037 (labels-ssot-old), 0038 (ac-verification-evidence)

### supersede 終結（5 件）

旧 0008 (age-mode-5-duplication), 0009 (server-client-type-contract), 0016 (dialog-overlay-state), 0023 (ー), 0003 (design-doc-ssot 旧番号)

## active-primary 参照頻度ログ

10 件すべて **毎週 1 回以上** は PR/CI/セッションエージェントから機械参照されている（サンプル）:

- 0001 → `docs/CLAUDE.md` 設計書更新表から毎 PR で参照
- 0002 → `priority:critical` issue テンプレートから毎 Critical PR で参照
- 0003 → Issue 新規起票時 / QA セッション Issue 突合時に毎回参照
- 0004 → PR レビュー必須チェックリストから毎 PR で参照
- 0005 → `tests/CLAUDE.md` スキーマ変更 PR テスト要件から参照
- 0006 → `scripts/check-no-assertion-weakening.mjs` が全 PR で自動実行
- 0007 → CI ワークフローの tier 運用で毎 PR 実行
- 0008 → 実装越境禁止ルール（Reviewer/PO セッション）で毎回参照
- 0009 → `scripts/check-no-plan-literals.mjs` が全 PR で自動実行
- 0010 → スコープ判断 (新機能 ADR 起票前) で毎度参照

## 今後の運用

- 次回棚卸は ADR 番号が 0020 に達した時点（概ね 6-9 ヶ月後）
- archive ADR の本文は現状維持（削除しない）。復活が必要な場合は TOP10 のいずれかと入れ替える
- 新 ADR 追加は `README.md` §「新規 ADR 追加 gate」に従うこと
- TOP10 新規追加時は既存 1 件を archive 化して **常に 10 件以下を維持**

## 関連 Issue / PR

- #1262 — ADR 全体リファクタリング（本棚卸対象）
- #1270 — sub-B 25 archive + 5 delete + 参照更新 + sub-C CLAUDE.md 追従
- #1267 — sub-B の重複 Draft（#1270 と統合につき close）
- [2026-04-19 棚卸](adr-inventory-2026-04-19.md) — 前回棚卸（旧体系ベース）
