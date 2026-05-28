# プラン命名 + 課金期間 + 金額説得力訴求軸 要件 (Epic #2525 Phase 1 補強 2、2026-05-28)

| 項目 | 内容 |
|------|------|
| 親 issue | #2526 (Phase 1 要件、3 度目再オープン) |
| Epic | #2525 |
| 起点 | Phase 3 #2567 UI 設計案下書き中に PO レビューで 2 つの構造的問題発覚 (プラン名と実態の乖離 + ROI framing 訴求軸不明) |
| 原則 | #2559 (前工程不備は元フェーズ再オープン)、本セッション 3 度目の Phase 1 再オープン |
| ステータス | Phase 1 補強 2 として要件追加 (本 PR でマージ予定) |
| Phase 2 連動 | #2527 再々オープン済 (7 ジャーニー一括補強、本 PR マージ後着手) |
| deep-research | 家庭向け / 子供向け SaaS 15+ プロダクト + 業界 monthly-only 27% + F1-F11 顧客不安 (primary source 検証済) |

## 背景: 見落とした要件 (PO 指摘 2 点)

### 問題 1: プラン名と実態の乖離

現プラン名「family」は **B2C で「家族構成軸」と心理的に解釈される業界規範**が確立 (Apple One Family / Spotify Family / Microsoft 365 Family / Headspace Family / NYT Family が member-focused)。

PO 整理の実態は **「3 段階の運用本格度」**:
- 無料 = ちょっと活動を記録して評価したい
- standard = 家庭運用、本格度中
- family = **子供の人生における履歴・証跡として扱うレベル** (本格度高)

→ 「family」命名は訴求軸 (本格度) と乖離、誤読リスク (兄弟複数家庭向け、と解釈される)。

### 問題 2: ROI framing 訴求軸不明

谷②金額説得力 (4 谷の 1 つ) に対する解として、私が出した表示パターン (per-seat / cost-per-day / 比較 anchor) は:
- どの顧客不安に訴えるか不明 (PO「ピンとこない」)
- flat-rate モデルに per-seat は構造的矛盾 (家族メンバー数定額)

→ 顧客不安 → 判断軸 → 課金モデル整合 framing の順で再設計必要。

## 機能要件 (FR)

### FR-1: プラン名 = 無料 / スタンダード / **プレミアム** (PO 確定 2026-05-28)

`PLAN_TERMS.family` を `PLAN_TERMS.premium` に rename。

| 旧 | 新 | 理由 |
|---|---|---|
| `無料` | 維持 | 機能制限自然な命名 |
| `スタンダード` | 維持 | 中間 tier、業界汎用 |
| **`ファミリー`** | **`プレミアム`** | 業界汎用 (Notion Plus 等)、家族構成軸からの解放、安全策 |

訴求軸 (実態の「人生記録・証跡レベル」) は**プラン名でなく機能訴求・LP コピーで担保**する戦略 (PO 確定)。

**棄却案** (deep-research 推奨だが不採用):
- 「ジャーナル」: 「人生記録」直接表現だが独自性高すぎ
- 「おもいで」: ブランド温かみ整合だが独自性高すぎ
- 「シルバー / ゴールド」: 金属表現が日本でやや欧米的

### FR-2: 課金期間 = **月額のみ** (年額プラン廃止)

`STRIPE_PRICE_STANDARD_YEARLY` / `_FAMILY_YEARLY` / `interval: 'year'` / `YEARLY_PLANS` 等の年額関連実装を全廃止。

| 根拠 | 内容 |
|---|---|
| 業界転換 | **Spotify Family 2026 年に年額廃止**、Netflix も月額のみ、SaaS の 27% が monthly-only |
| ADR-0012 整合 | 年額 sunk cost lock-in = engagement 罠 (「使わなくなったら即解約」を透明に提供できない) |
| ADR-0010 Pre-PMF | proration / 返金規定 / dunning 年額 retry / 月年切替 UI / choice paralysis を一気に回避 |
| 顧客不安解消 | F5 (縛り) / F6 (auto-renewal 忘却) / F8 (子供成長ミスマッチ) / F10 (月/年迷い) / F11 (cancel friction) 5 件を一気に解消 |

**反対意見の処理**:
- 事業者目線 retention 30-50% 改善メリット → Pre-PMF cohort 小、PMF 後再評価 (Phase 2 ADR で)
- annual 割引で訴求 → V1 月額本体シンプル + V2 機能 anchor で十分

### FR-3: trial = プレミアム固定 7 日 (旧「family 固定」rename のみ)

Phase 1 trial 要件 (#2533) の「family 固定 7 日」は本 FR-1 連動で「**プレミアム固定 7 日**」に rename。trial 構造 (カード登録なし / 自動無料復帰 / 1 回制限 family-tenant) は維持。

### FR-4: 谷②金額説得力 = 顧客不安 F1-F11 + framing 軸 V1-V5

#### 顧客不安リスト (11 種、本プロダクト固有)

| # | 不安 | 根拠 |
|---|---|---|
| F1 | 「¥500/¥780 は高い? 妥当?」 | 絶対値判断 (anchor 不在) |
| F2 | 「standard と premium、どっち?」 | choice paralysis |
| F3 | 「本格度に見合う価値?」 | 機能 vs 価格 |
| F4 | 「無料で十分なのに有料の理由?」 | Reverse Trial 終了時 |
| F5 | 「縛り? 損する?」 | commitment 不安 (年額廃止で消失) |
| F6 | 「auto-renewal 忘却で課金継続?」 | subscription fatigue (42% unused 課金、年額廃止で軽減) |
| F7 | 「家計に subscription 1 件追加?」 | US 家庭 subscription $2,600/年 平均 |
| F8 | 「子供成長で 1 年後分からない」 | 子供成長と時間軸ミスマッチ |
| F9 | 「兄弟複数 vs 1 人っ子で価値?」 | family 命名解釈 (FR-1 で消失) |
| F10 | 「月 vs 年で迷う」 | FR-2 年額廃止で消失 |
| F11 | 「cancel friction」 | FTC Click-to-Cancel 2025 規制 |

#### framing 軸 (flat-rate 整合、5 種)

| # | パターン | 解く不安 |
|---|---|---|
| V1 | 月額本体シンプル表示 | F1, F10 |
| V2 | 機能 anchor (what you get) | F1, F3 |
| V3 | 時間 anchor (累積記録の価値) | F3, F8 |
| V4 | anchor middle tier (decoy: premium 最右 + standard 推奨) | F2 |
| V5 | commitment 安全装置 framing (「いつでも解約」「カード登録不要」) | F5, F6, F11 |

#### 不安→解マッピング (ピンとこない羅列を回避)

| 不安 | 推奨 framing | LP 文言 (案) |
|---|---|---|
| F1+F3 | V1 + V2 | 月額単価大きく + 「これだけで全部」機能列挙 |
| F2 | V4 | premium 最右、standard を「✓ 推奨」 |
| F3+F8 | V2 + V3 | 「6 ヶ月で 180 件の成長記録」累積価値 |
| F4 | V2 | Reverse Trial 終了時「30 日試した家族の○○%が継続中の機能」(LP truth 整合) |
| F5+F6+F11 | V5 | 「縛りなし・いつでも解約・カード登録不要で開始」(既存 atom) |
| F7 | V1 + V3 | 「コーヒー 2 杯」型 anchor 不採用 (ADR-0012 違反)、V3 「累積記録価値」で正面突破 |

### FR-5: ADR 起票推奨

本要件の判断 (業界調査 + 哲学整合 + Pre-PMF 影響) は ADR 級:
- **ADR 候補名**: 「プラン命名と課金期間方針 (本格度軸 + 月額のみ)」
- context: Spotify Family 2026 廃止 + 27% monthly-only + family 命名業界規範
- 選択肢比較: Day One Silver/Gold + Cozi Gold + Notion Plus の 3 OSS/事例 (ADR-0014 OSS 先調査ルール整合)
- 整合: ADR-0010 (Pre-PMF) / ADR-0012 (Anti-engagement) / ADR-0013 (LP truth) / ADR-0045 (atom)
- TOP 10 active 39 件超過中、月 1 棚卸 (2026-06) で 1-in-1-out トリガー判断

## 非機能要件 (NFR)

- **NFR-1**: プラン名 rename は `PLAN_TERMS.family` atom 1 行修正で 95 件伝播 (Explore 確認済、ADR-0045 効果)
- **NFR-2**: 年額廃止の機械置換 9 件 + テストケース文脈判断 (Explore 確認済)
- **NFR-3**: LP HTML 35 件は data-lp-key i18n 経由で `generate-lp-labels.mjs` 再生成で対応
- **NFR-4**: 法務文書 5 件 (terms.html / tokushoho.html「ファミリープラン: 30日」grace-period 文脈) は手動更新 + 法務確認
- **NFR-5**: DB schema enum (`'family'` → `'premium'`) は migration 必須 (Phase 7 実装、ADR-0031 db-migration skill)
- **NFR-6**: Stripe Product / Price 物体の plan label 同期 + 年額 Price 削除 (Phase 7、Dashboard + secrets)

## ユーザーストーリー

- US-1: 保護者として、プラン名「プレミアム」が本格度上位を示すと直感的に分かる
- US-2: 1 人っ子家庭でも「プレミアム = 本格運用」と理解でき、family 解釈で除外感を持たない
- US-3: 月額のみで「年/月どっち?」の迷いがなく、即決判断できる
- US-4: 「縛りなし・いつでも解約」の明示で安心して試せる

## 各 Phase の責務

| Phase | 本要件に関する責務 |
|---|---|
| **Phase 1 (要件)** | 本書: プラン名 / 課金期間 / ROI framing 訴求軸を明文化 ✅ |
| **Phase 2 (UX)** | 7 ジャーニー再々補強 (#2527 再々オープン済、本 PR マージ後着手) |
| **Phase 3 (UI)** | プレミアム + 月額のみ前提で UI 設計 (子 issue #2567-2575、中断中) |
| **Phase 4 (動線)** | LEGACY_URL_MAP / IA は Phase 1 補強 1 (#2583) と連動 |
| **Phase 5 (アーキ)** | labels.ts / atom rename + 年額削除実装計画 |
| **Phase 6 (実装詳細)** | 機械置換 95 (プラン名) + 9 (年額) + 法務 5 件の手順 |
| **Phase 7 (実装)** | 一括 rename PR + DB migration + Stripe Dashboard 同期 + tests |

## 影響範囲サマリ (Explore 照合 2026-05-28)

| カテゴリ | 件数 | 内訳 |
|---|---|---|
| プラン名 atom 経由 | **95 件** | terms.ts atom 1 行修正で伝播 |
| 年額関連実装 | **9 件 + テスト文脈** | config.ts / license-plan.ts / labels.ts |
| LP HTML 表記 | 35 件 | data-lp-key i18n 経由 |
| 法務文書直書き | 5 件 | terms.html / tokushoho.html / privacy.html |

## Open question (PO 判断、Phase 5/7 で確定)

| # | 論点 | 状態 |
|---|---|---|
| 1 | DB schema `'family'` enum 値 migration 戦略 | Phase 7 (db-migration skill 経由、ADR-0031) |
| 2 | Stripe Dashboard Product/Price 同期手順 | Phase 7 |
| 3 | 法務文書 5 件の改訂タイミング | Phase 7 (法務確認後、別 PR で段階化可) |
| 4 | 既存 family-tier 加入ユーザーの移行通知 | **不要** (現在利用ユーザーゼロ、PO 確定 2026-05-28) |
| 5 | ADR 起票タイミング | 月 1 棚卸 2026-06 で 1-in-1-out トリガー |

## 根拠 (primary source)

- **deep-research (2026-05-28、本セッション)**: 家庭向け / 子供向け SaaS 15+ プロダクト + Spotify Family 2026 年額廃止 + 27% SaaS monthly-only + F1-F11 顧客不安 + V1-V5 framing 軸
  - [Spotify Community: Family Annual Discontinued](https://community.spotify.com/t5/Premium-Family/How-to-subscribe-family-plan-and-pay-yearly/td-p/5388449)
  - [Day One Silver/Gold (9to5Mac 2026-04)](https://9to5mac.com/2026/04/08/day-one-journaling-app-introduces-gold-plan-with-ai-summaries-and-daily-chat/)
  - [Membership.io: Naming Membership Tiers 2026](https://blog.membership.io/naming-your-membership-tiers-a-2025-guide)
  - [Recurly: SaaS Benchmarks 27% monthly-only](https://recurly.com/research/saas-benchmarks-for-subscription-plans/)
  - [User Intuition: Annual vs Monthly Trade-offs](https://www.userintuition.ai/reference-guides/annual-vs-monthly-plans-commitment-cash-and-churn-trade-offs)
  - [Crowell: FTC Click-to-Cancel 2025](https://www.crowell.com/en/insights/client-alerts/ftcs-new-click-to-cancel-and-what-it-means-for-businesses-with-any-form-of-subscription-membership-or-auto-renew-or-recurring-payment-program)
  - [Prosperity Issue: Subscription Overload Families](https://prosperityissue.com/subscription-overload-how-recurring-costs-are-quietly-impacting-families)
- **Explore (2026-05-28)**: `src/lib/server/stripe/config.ts` (4 Price) / `src/lib/domain/constants/license-plan.ts` (MONTHLY/YEARLY_PLANS) / `src/lib/domain/terms.ts` (PLAN_TERMS / PRICE_TERMS) / `src/lib/domain/labels.ts` (95 件 atom 経由参照) / `site/*.html` (35 件) / 法務文書 (5 件)
- 関連 ADR: ADR-0010 (Pre-PMF) / ADR-0012 (Anti-engagement) / ADR-0013 (LP truth) / ADR-0014 (OSS 先調査) / ADR-0028 (引き止めない) / ADR-0045 (atom/compound 2 階層) / ADR-0049 (retention)
- 関連 memory: [[plan-name-implementation-gap]] / [[roi-framing-customer-anxiety-axis]] / [[replan-on-unforeseen-blocker]] (本セッション教訓)
- 関連 Phase 1 補強 1: [phase1-naming-url-integrity-requirements.md](phase1-naming-url-integrity-requirements.md) (PR #2583 マージ済)
