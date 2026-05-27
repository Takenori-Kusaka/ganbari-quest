# プラン変更 (アップ/ダウングレード) 要件定義 (#2535 / Epic #2525 Phase 1)

| 項目 | 内容 |
|------|------|
| 孫 issue | #2535 (アップ・ダウングレードの要件) |
| 親 | #2526 (Phase 1) / 上位 #2525 |
| ステータス | deep-research 完了 (Stripe 公式一次 + 既存 plan-change-flow.md 照合) → PO レビュー待ち |

## 最重要制約 (Stripe 公式)

**Customer Portal の「ダウングレード管理 (期末適用)」は同一 Product 内の Price 間のみ機能する。** family と standard が別 Stripe Product だと Portal 期末ダウングレードが効かず、ダウングレードが即時化して credit proration 事故を招く。→ **standard/family を同一 Product の別 Price に構成する (or Portal 切替 product を適切登録) 必要**。現行は別 product 示唆 (`STRIPE_PRICE_STANDARD_*` / `STRIPE_PRICE_FAMILY_*`) のため **Phase 5 (アーキ) で Dashboard 構成を確認・再設計** (Open question 1)。

## 機能要件 (FR)

| ID | 要件 | 設計意図 + 根拠 |
|----|------|----------------|
| FR-1 | **4 パターン対応**: ①standard→family ②family→standard ③月→年 ④年→月 | tier/interval 双方向は標準期待。Portal が 1 UI で吸収 |
| FR-2 | ダウングレード期末適用を成立させる **Product 構成** (同一 Product 別 Price) | 最重要制約。Phase 5 で Dashboard 確認 (Open question 1) |
| FR-3 | **アップグレード (standard→family / 月→年) は即時反映 + proration 即時請求** | 「払ったらすぐ使える」期待。capability 即時解放。Stripe charge proration |
| FR-4 | **ダウングレード (family→standard / 年→月) は期末適用** | 支払済期間のサービス提供義務 + Stripe 公式が期末遷移推奨 (proration 事故回避)。ADR-0012 (引き止めない) |
| FR-5 | **family→standard ダウン時、超過リソースの扱いを変更確定前に提示** (既存 DowngradeResourceSelector #738 踏襲) | データ喪失不安回避。期末猶予 + ユーザー選択 (残す/アーカイブ)。#2538 連動 |
| FR-6 | 変更は **webhook (`customer.subscription.updated`) を SSOT に DB 反映**、UI 楽観表示しない | Portal 中断時に副作用ゼロ。proration 最終値は Stripe が持つ |
| FR-7 | 変更前に **PIN/確認ゲート** (子供誤操作防止、既存 #771) | 家庭内共用端末 |

## 非機能要件 (NFR)

- NFR-1: proration 計算・請求は **Stripe に委譲、自前計算しない** (課金計算の自前は事故源)
- NFR-2: interval 変更時の **billing date リセットを事前明示** (月→年で billing date が変更日にリセット。特商法 最終確認画面整合)
- NFR-3: ダウングレード credit は **現金返金されず次回請求充当**である旨を明示
- NFR-4: Portal 設定 (プラン変更=オン / 比例配分 / ダウングレード管理=オン) を **Dashboard 構成として文書化** (デフォルト全オフ、構成漏れ=変更 UI 出ない事故)

## ユーザーストーリー

1. 子供が増え standard→family にその場で上げ、即無制限/きょうだいランキングを使う (FR-3)
2. family→standard に下げる。今期分は無駄にしたくない (期末から)。超過子供データは消したくない (FR-4/FR-5)
3. 月→年に切替え割引を受けたい。次の請求日を知りたい (FR-1③/NFR-2)
4. 年→月に戻したい。期末まで年額のまま無駄なく (FR-1④/FR-4)

## proration の確定ルール (業界標準 + Stripe 推奨)

| 方向 | ルール | 根拠 |
|------|--------|------|
| アップグレード (standard→family / 月→年) | **即時 + proration 即時請求** | charge proration。即時 capability 解放 |
| ダウングレード (family→standard / 年→月) | **期末適用** | credit proration の複雑さ回避。Stripe 公式推奨 + サービス提供義務 |

## family→standard ダウン時の超過リソース (#2538 連動、方向性のみ)

- **standard も子供無制限**なので子供数は超過しない。超過するのは **member (family ∞ → standard 4)** と **family 限定 capability (AI 提案/きょうだいランキング)** + **履歴保持期間**
- 方向性: **期末まで family capability 維持 → 期末に standard 制限適用。超過分は物理削除せず is_archived=true (アーカイブ)、再アップグレードで復元可。変更前に DowngradeResourceSelector で残す対象を選択** (既存 #738 整合)
- 詳細 (member 超過 / 保持期間短縮で閲覧不可になる履歴) は #2538 で精査

## Open question

| # | 論点 | 推奨/状態 |
|---|------|----------|
| 1 | **Stripe Product 構成** (同一 Product 別 Price か別 Product か) | **Phase 5 で Dashboard 確認**。同一 Product 別 Price が Portal 期末ダウン成立の唯一解 |
| 2 | interval 変更を Portal に出す選択肢数 | standard月/年・family月/年 = 4。Hick's Law 整理は Phase 3 UI |
| 3 | ~~ライセンスキー方式の二経路~~ | **本 Epic でライセンスキー撤廃のため無効化** (Portal 経由に一本化) |
| 4 | ダウングレード期末適用中の UI 表示 | 「○月○日に standard に変わります / member ○人アーカイブ」を PlanStatusCard に (Phase 3) |
| 5 | 年→月ダウン時の年額割引 credit | Stripe 既定 (次回充当) で十分。解約孫 #2536 と連動 |

## 根拠 (primary source)

- Stripe upgrade-downgrade / prorations / configure-portal / mixed-interval / subscription-schedules (proration 方向・Portal 期末ダウン制約・interval 変更)
- 既存 SSOT: docs/design/plan-change-flow.md (§3.2 Portal / §5 #738 超過リソース / §6 月↔年) — Stripe 公式と整合確認済
- ADR-0012 (引き止めない) / ADR-0010 (Pre-PMF、自前 proration 計算しない)
