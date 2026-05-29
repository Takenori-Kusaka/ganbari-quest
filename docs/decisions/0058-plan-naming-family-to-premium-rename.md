# 0058. プラン命名 family → premium rename (上位 SSOT 改訂、PO 判断適用)

| 項目 | 内容 |
|------|------|
| ステータス | accepted |
| 日付 | 2026-05-29 |
| 起票者 | PO (Takenori-Kusaka) |
| 関連 Issue | #2609 (本 ADR 提出 PR で解消)、#2588 (Phase 1 補強 2、family → premium rename 確定 origin) |

## コンテキスト

`docs/design/21-プラン用語統一規約.md` §4 旧禁止語規約 (「プレミアム」プラン名禁止 / ブランドコピー用に温存) と、`docs/design/billing-redesign/phase1-plan-naming-pricing-axis-requirements.md` (#2588 MERGED) FR-1 (family → premium rename 確定) が **SSOT 衝突**状態のまま放置されており、Phase 3 sibling PR (#2605 / #2606) で 2 PR 連続検出、Phase 4-7 実装担当が判断停止していた。

旧版「ファミリープラン」採用根拠 (子育て・家族向け製品として自然) は、Phase 1 補強 2 (#2588) の deep-research で以下が判明し再評価が必要になった:

1. **業界規範ミスマッチ**: B2C「Family」プランは **家族構成軸 = メンバー追加・席数増加** を表す確立規範 (Apple One Family / Spotify Family / Microsoft 365 Family / Headspace Family / NYT Family は全 member-focused)。本プロダクトの flat-rate 家族メンバー数固定モデルに対し、メンバー追加機能の誤期待を生む
2. **訴求軸乖離**: 本プロダクトの 3 段階は **運用本格度** (無料 = 試用 / スタンダード = 家庭運用 / 上位 = 人生記録レベル本格運用) を表す。「ファミリー」は本格度を伝えない
3. **業界汎用性の活用**: 「プレミアム」は Notion Plus / Spotify Premium / Slack Premium 等で「上位 tier の一般名」として確立、choice paralysis 最小化

## 検討した選択肢

### 選択肢 A: family 命名維持 + ブランドコピー「プレミアム」温存 (旧版方針)

- 概要: 現状の `PLAN_TERMS.family` を維持、「プレミアム」はブランドコピー (「プレミアムな子育て体験」) としてのみ使用
- メリット: rename コスト 0、過去 docs / コード変更なし
- デメリット: 上記 (1)-(3) の業界規範 / 訴求軸乖離は解消されない。#2588 deep-research の知見を捨てる
- Pre-PMF コスト: 短期コスト 0 だが、LP コンバージョン低下 / cohort 規範ミスマッチを Pre-PMF 段階で抱える

### 選択肢 B: family → premium rename (PO 採用)

- 概要: 旧 `family` → 新 `premium` に rename。旧「ファミリープラン」名称廃止、「プレミアムプラン」を正式プラン名 + ブランドコピー兼用
- メリット: 業界規範整合 (上位 tier = Premium)、訴求軸 (運用本格度) と命名整合、choice paralysis 最小化
- デメリット: 95 件 atom 経由箇所の rename 必要 (Phase 7 #2656 系で担当)、移行期両用許可運用が必要
- Pre-PMF コスト: 短期コスト中 (Phase 7 実装) だが、PMF 後の rename はさらに高コスト (LP/メール/アプリ全面修正 + ユーザー認知断絶) のため Pre-PMF 中の rename が合理的 (ADR-0010 Pre-PMF 優先度判断)

### 選択肢 C: 独自命名 (「ジャーナル」「おもいで」「シルバー / ゴールド」等)

- 概要: deep-research で挙がった代替案 (人生記録直接表現 or 金属表現)
- メリット: 本プロダクト訴求軸 (人生記録) を直接表現
- デメリット: 独自性高すぎで業界規範外、choice paralysis 増加、新規ユーザーの直感的理解阻害
- Pre-PMF コスト: 認知コスト高、ブランド構築コスト過剰 (ADR-0010 §3 過剰防衛該当)

## 決定

**選択肢 B (family → premium rename)** を採用。

PO 判断 (2026-05-29):
- **Q1**: family → premium rename を採用
- **Q2**: 「ファミリー」プラン名 → 「プレミアム」プラン名に置換 (家族プラン名が実態と乖離との指摘対応)
- **Q3**: 旧版「プレミアムをブランドコピー用に温存」方針を撤回、プラン名 + ブランドコピー兼用 (Spotify Premium パターン整合)

## 結果

### 短期 (本 ADR 提出 PR scope)

- `docs/design/21-プラン用語統一規約.md` 全面改訂 (上位 SSOT 更新、§7 命名根拠 rewrite、§9 SSOT 順序ルール明文化、§10 改訂履歴追記)
- `scripts/check-forbidden-terms.mjs` から「プレミアムプラン」削除 (allowlist 化)
- 本 ADR-0058 起票 (PO 判断経緯の SSOT 記録)

### 中期 (Phase 7 #2656 系担当)

- `src/lib/domain/terms.ts` の `PLAN_TERMS.family` / `PLAN_FULL_TERMS.family` → `*.premium` 実 rename (atom 1 行修正で labels.ts compound 経由 95 件箇所に自動伝播、ADR-0045)
- `src/lib/server/auth/providers/cognito-dev.ts` DEV_USERS の `family` user → `premium` user 同期
- Stripe 環境変数 (`STRIPE_PRICE_FAMILY_MONTHLY` 等) rename + Stripe 商品 ID 切替
- `site/shared-labels.js` LP fallback 再生成 (`scripts/generate-lp-labels.mjs --check`)
- LP / pricing.html / faq.html / pamphlet.html の data-label / コピー文同期差し替え (ADR-0013 LP truth 順序: atom rename 完遂後に配信)
- 並行実装 (tests/e2e/global-setup.ts / tests/unit/helpers/test-db.ts / demo-data.ts) 同期

### 移行期運用 (Phase 7 完遂まで)

- 「ファミリープラン」「プレミアムプラン」両用許可 (Phase 7 atom rename 進行中の段階的伝播を許容)
- Phase 7 完遂後、`scripts/check-forbidden-terms.mjs` に「ファミリープラン」を新規禁止語追加判断 (#2656 系完遂時の別 follow-up Issue で実施)

### SSOT 順序ルール (#2609 解消で明文化)

`docs/design/21` (上位 SSOT) → `terms.ts` (atom SSOT) → `labels.ts` (compound SSOT) → 配信物 (LP / メール / アプリ UI) の改訂順序を §9 で明文化。本 ADR + 規約改訂 (上位 SSOT) を **先行 merge**、派生 SSOT (atom / 配信物) は Phase 7 で順次実施。

### Pre-PMF 整合性 (ADR-0010)

本決定は ADR-0010 Bucket A (Pre-PMF で着手すべき): 命名 SSOT 衝突は CI gate (`check-forbidden-terms.mjs`) と検証文書 (#2588) の連鎖を破壊し、Phase 4-7 実装担当の判断停止 = 開発速度低下を引き起こすため、SSOT 整合化は Pre-PMF 段階で必須。PMF 後の命名変更は LP / メール / アプリ全面修正 + ユーザー認知断絶コストが過大なため、Pre-PMF 中の rename が合理的。
