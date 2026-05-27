# NUC セルフホスト版 要件定義 (#2539 / Epic #2525 Phase 1)

| 項目 | 内容 |
|------|------|
| 孫 issue | #2539 (NUC セルフホストの要件) — 前セッションで PO が「Epic 内で設計」と決めた正規購入者判定 |
| 親 | #2526 (Phase 1) / 上位 #2525 |
| ステータス | deep-research 完了 (ADR-0051 + セルフホスト OSS 5 件公式 + 実コード照合) → PO 事業判断 2 論点 + レビュー待ち |

## 核心: 現状 NUC は license key に強結合 (撤廃は破壊的)

- `capabilities.ts:77` — `nuc-prod && !licenseKey.valid` なら DB 書き込み **deny** (license key 無効だと NUC で記録すらできない)
- `capabilities.ts:127` — `redeem.license_key` capability (nuc-prod のみ)
- `evaluation-context.ts:42` — `EvaluationLicenseKey` (NUC モードのみ)
- → **license key 撤廃は NUC 正規性判定の根幹を外す**。代替を Phase 1 で設計する PO 判断は妥当

## 業界標準 (公式確認): セルフホスト OSS は信頼ベースが主流

| OSS | 正規性検証 | 方式 |
|-----|----------|------|
| GitLab CE / Ghost / Plausible CE / Vaultwarden | **検証なし** (信頼ベース、機能差別化のみ) | (a) 信頼ベース |
| GitLab 有料 (Premium/Ultimate) | オフライン署名 license file (日次オンライン同期前提) | (b) 署名 token (enterprise 限定) |

**5 件中 4 件が信頼ベース。署名 token は有料 enterprise のみ、それも日次オンライン同期前提**で純粋 offline DRM ではない。

## 正規購入者判定方式 推奨

**第一推奨: (a) 信頼ベース (判定なし・family 固定)**

根拠: ① 業界 4/5 が信頼ベース ② ADR-0010 (Pre-PMF 過剰防衛禁止) — offline DRM は典型的過剰防衛、NUC は家庭内 offline 機器で攻撃面極小 ③ ADR-0051 (NUC=Edition 配布形態、買い切り SKU でない=ライセンス検証対象でない、配布物自体が正規の証跡) ④ 既存 `SelfHostedPlanProvider` family 固定設計が妥当

退ける: (b) 署名 token=将来買い切り販売時のみ / (c) オンラインチェック=offline 矛盾・却下 / (d) HW 紐づけ=DRM 過剰・却下

## 機能要件 (FR)

| ID | 要件 | 設計意図 + 根拠 |
|----|------|----------------|
| FR-1 | NUC は plan tier を **family 固定で解決**、Stripe/license key 非依存 | 既存 SelfHostedPlanProvider 妥当性確認。ADR-0051「NUC=全機能」 |
| FR-2 | `capabilities.ts` `canWriteDb()` から **`nuc-prod && !licenseKey.valid` deny 分岐を撤廃** | license key 撤廃の直接帰結。撤廃しないと NUC が記録不能に (現状 :77)。信頼ベース移行の核 |
| FR-3 | `redeem.license_key` capability + `EvaluationLicenseKey` 型を NUC から除去 | license key 撤廃の lateral spread |
| FR-4 | `/admin/license` は ADR-0051 の NucLicensePanel (Edition badge + 利用状況 + サポート link) を維持、key 入力欄なし | ADR-0051 で既に決定済 |
| FR-5 | SaaS 版は Stripe Subscription を plan SSOT、NUC とは plan 解決経路を完全分離 | ADR-0051 bifurcation |

## 非機能要件 (NFR)

- NFR-1: NUC は**完全オフライン動作** (外部到達ゼロで全機能) | NUC 存在意義 (ADR-0051 家庭にデータを閉じる)
- NFR-2: 正規性判定機構を**新規に作らない** (DRM 不採用) | ADR-0010、業界 4/5 信頼ベース
- NFR-3: NUC/SaaS 分岐は `locals.runtimeMode` SSOT 経由・page 層 1 箇所集約 | ADR-0051 §2.2

## ユーザーストーリー

- US-N1: NUC 利用者として、ネット未接続でも全機能を使いたい (家庭にデータを閉じる NUC を選んだ)
- US-N2: NUC 利用者として、license key を入力させられたくない (配布物自体が正規の証跡)
- US-N3: 開発者として、license key 撤廃で NUC が記録不能にならないことを E2E で保証したい (capabilities.ts:77 回帰防止)

## Open question (PO 事業判断)

| # | 論点 | 状態 |
|---|------|------|
| 1 | NUC の収益モデル | ✅ PO 確定 2026-05-27: **完全無料 OSS 配布** (GitLab CE/Ghost 型、収益は SaaS 側) |
| 2 | 正規購入者判定方式 | ✅ PO 確定 2026-05-27: **信頼ベース** (判定なし・family 固定、DRM 作らない、ADR-0010/0051 整合) |
| 3 | NUC の機能差別化 (全機能 family vs 一部 SaaS 限定) | 全機能 family が ADR-0051 整合、収益モデル次第 |
| 4 | 既存 NUC dogfood 機 (192.168.68.79) の license key 撤廃移行手順 | Phase 7 実装で扱う |
| 5 | AWS_LICENSE_SECRET / ALLOW_LEGACY_LICENSE_KEYS env の SaaS 側残存範囲 | Phase 6 (#2514 実装詳細) lateral spread で扱う |

## 根拠 (primary source)

- ADR-0051 (NUC-SaaS Bifurcation、Edition 配布形態) / nuc-saas-runtime-bifurcation.md
- 実コード: capabilities.ts (:77 deny, :127 redeem) / evaluation-context.ts (:42) / runtime-mode.ts (nuc-prod profile)
- セルフホスト OSS 公式: GitLab CE / Ghost (MIT) / Plausible CE (AGPLv3) / Vaultwarden (信頼ベース確認)
- ADR-0010 (Pre-PMF 過剰防衛禁止) / ADR-0012
