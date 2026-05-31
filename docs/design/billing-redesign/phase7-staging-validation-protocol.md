# Phase 7 PR-3b staging 検証期間 SSOT (cutover lookup_key Production 切替)

| 項目 | 内容 |
|---|---|
| 起票 Issue | #2718 (QM Tier 2 Adversarial business 軸 follow-up) |
| 起票日 | 2026-06-01 |
| 関連 PR | #2722 (Phase 7 PR-3b lookup_key Production cutover) / #2717 (PR-3a lookup_key caching) |
| 関連 ADR | [ADR-0059](../../decisions/0059-phase7-cutover-sequence.md) §3 rollback 3 期間別マトリクス + §2 kill switch 機構 |
| 上流 SSOT | [phase6-context-decisions-6.md §8 OQ-3](phase6-context-decisions-6.md) (「1 週間 staging 検証推奨」を Phase 7 Step 3 Pre-Ready 設計時に確定する旨の Open question) / [phase6-rollback-and-kill-switches.md §8 ロールバック判断基準 3 指標](phase6-rollback-and-kill-switches.md) / [phase6-phase7-execution-ssot.md §3 Step 3](phase6-phase7-execution-ssot.md) |
| 上位原則 | [ADR-0010](../../decisions/0010-pre-pmf-scope-judgment.md) (Pre-PMF Bucket A 課金別格 vs 過剰追加 YAGNI) / [[adr0010-interpretation]] / [[billing-critical-extra-caution]] |

## 1. 設計背景

### 1.1 課題 (QM Tier 2 BLOCK の Phase A SSOT 不在)

PR #2722 (Phase 7 PR-3b lookup_key Production cutover) を Ready 化する前提となる **staging 検証期間 SLA SSOT が未確定**。QM Tier 2 Adversarial business 軸所見:

- PR-3a (#2717、`USE_LOOKUP_KEY=false` caching layer 配備、本番影響ゼロ) は merge 済
- PR-3b は `USE_LOOKUP_KEY=true` で Production cutover、本番経路を lookup_key 解決に切替える critical PR
- PR-3a merge → PR-3b merge の間に **どれだけ staging 検証するか**の SLA が未確定
- 検証不十分のまま PR-3b マージ → Stripe API 障害時の影響範囲 / 顧客 inquiry リスク / DB inconsistency リスクが Pre-PMF 課金別格 ([[billing-critical-extra-caution]]) で許容不能

### 1.2 上流 SSOT との関係

`phase6-context-decisions-6.md` §8 OQ-3 で「1 週間 staging 検証推奨」が **Phase 7 Step 3 Pre-Ready 設計時に確定** とされていた。本 docs はその確定を担う SSOT。

ただし上流 OQ-3 は Phase 6 検討時点の推奨案であり、現時点 (2026-06-01) で再評価する。本 docs は以下 2 案を併記し **QM 再協議用 SSOT** として明示する:

- **2-3 日案 (本 docs 推奨、本 SSOT 採用)**: Pre-PMF 顧客ゼロ前提 + ADR-0010 「過剰追加 YAGNI」整合
- **1 営業週間案 (QM 当初指摘、上流 OQ-3 推奨案)**: Production 顧客発生後の通常 cutover 想定、Pre-PMF では過剰の可能性

### 1.3 設計がなかった場合に何が困るか

1. **PR-3b の Ready 化判断基準が散在** — Dev / PO / QM の判断が個別感覚に依存、再現性ゼロ
2. **staging 検証項目が散在** — smoke test 観点が PR body / コメント / 各 reviewer 頭の中に分散、検証品質ばらつき
3. **ロールバック判断基準と staging 判断基準が分離** — staging で何を観測して PASS とするか、ロールバック指標 (`phase6-rollback-and-kill-switches.md` §8) との整合が取れない
4. **QM 再協議の根拠不在** — 「期間短縮交渉したい」と思っても、何を担保するから短縮できるかの SSOT がない

## 2. 設計原則

1. **検証 3 段階を SSOT 化**: code merge → cdk deploy → smoke 観測 の 3 段階の AC を本 docs で固定
2. **2 期間案を併記**: PR-3b の Pre-PMF Bucket A 性質と「過剰追加 YAGNI」原則の両立のため、2-3 日案 (推奨) + 1 営業週間案 (fallback) を併記して QM 再協議の選択肢を確保
3. **ロールバック判断基準 SSOT 委任**: `phase6-rollback-and-kill-switches.md` §8 の 3 指標 (Stripe webhook 失敗率 / 顧客 inquiry / DB inconsistency) を staging 観測の合否判定にもそのまま適用 — 二重定義しない
4. **kill switch SSOT 委任**: ADR-0059 §2 の `USE_LOOKUP_KEY` env var (Lambda 30 秒反映) を staging → production の即時切戻し経路として唯一の SSOT とする — staging 期間中も同じ機構を保持

## 3. 検証 3 段階 SSOT

PR-3b Ready 化 → staging 検証完了 → Production cutover の 3 段階 AC。

### 3.1 段階 1: code merge (PR-3b Ready 化前)

| AC | 検証項目 | 検証手段 |
|---|---|---|
| 1.1 | `npm run pre-ready -- --pr 2722` 全 10 step PASS | CI |
| 1.2 | PR-3b の prerequisite (#2718 本 docs / #2719 yearly plan / #2720 Sentry alert) 全 close 確認 | gh issue view |
| 1.3 | `USE_LOOKUP_KEY=true` Test mode unit test PASS (`tests/unit/server/stripe/lookup-key-config.test.ts` 12 ケース + `price-cache.test.ts` 6 ケース) | vitest |
| 1.4 | `apiVersion = '2026-04-22.dahlia'` 物理 bump 確認 (`src/lib/server/stripe/client.ts:28`) | grep |

### 3.2 段階 2: cdk deploy (staging 環境)

| AC | 検証項目 | 検証手段 |
|---|---|---|
| 2.1 | staging 環境 Lambda env に `USE_LOOKUP_KEY=true` + `STRIPE_WEBHOOK_SHADOW_MODE=false` + `STRIPE_WEBHOOK_SECRET_TEST` 配備確認 | aws lambda get-function-configuration |
| 2.2 | staging cold start `getPlanConfigs()` で lookup_key 解決成功 (CloudWatch log 確認) | CloudWatch Logs Insights |
| 2.3 | staging で `prices.list({ lookup_keys })` Stripe API 呼出成功 (status 200) | CloudWatch Metrics |
| 2.4 | Sentry / Discord alert 経路設定確認 (#2720 で配備した alert ハンドラが staging で動作) | Sentry Project 設定確認 |

### 3.3 段階 3: smoke 観測 (staging 検証期間)

| AC | 観測指標 | 閾値 (PASS 条件) | 閾値 (ロールバック条件) | 委任先 SSOT |
|---|---|---|---|---|
| 3.1 | Stripe API lookup_key 解決成功率 | ≥ 99.5% (= 失敗率 ≤ 0.5%) | > 1% (1 hour 集計) | [phase6-rollback-and-kill-switches.md §8 指標 1](phase6-rollback-and-kill-switches.md) |
| 3.2 | 顧客 inquiry 件数 (staging では bot / Dev 検証のみ、本番顧客なし) | 0 件 | ≥ 1 件 (= staging で異常検知) | [phase6-rollback-and-kill-switches.md §8 指標 2](phase6-rollback-and-kill-switches.md) |
| 3.3 | DB inconsistency (`stripe_webhook_events` dedup miss) | 0 件 | ≥ 1 件 | [phase6-rollback-and-kill-switches.md §8 指標 3](phase6-rollback-and-kill-switches.md) |
| 3.4 | kill switch dry-run (`USE_LOOKUP_KEY=true` → `false` 30 秒以内に env var 経路復帰) | 1 度実演 PASS | 反映失敗 | [phase6-rollback-and-kill-switches.md §5.5](phase6-rollback-and-kill-switches.md) |
| 3.5 | Stripe API 障害 fallback test (artificial network error 注入で `USE_LOOKUP_KEY=false` 即時切戻し成功) | PASS | FAIL | [ADR-0059 §2 kill switch 機構](../../decisions/0059-phase7-cutover-sequence.md) |

## 4. staging 検証期間 2 案併記 (QM 再協議用 SSOT)

| 期間案 | 期間 | 検証カバレッジ | 根拠 | 適用条件 |
|---|---|---|---|---|
| **2-3 日案 (本 docs 推奨)** | 48-72h | 段階 1+2 完遂 + 段階 3 の 3.1/3.2/3.3 を 48h 連続観測 + 3.4 kill switch dry-run 1 回 + 3.5 fallback test 1 回 | (a) Pre-PMF 顧客ゼロ、本番 inquiry リスク 0 (b) ADR-0010 「過剰追加 YAGNI」整合 — 顧客発生前段階で 1 営業週間は過剰防衛 (c) kill switch (30 秒反映) と Sentry alert (即時) で MTTR 5 分以内、staging 延長による追加担保は限界効用低い (d) [[adr0010-interpretation]] 「あるべき機能の品質を削る口実ではない」が、「過剰追加機能の YAGNI」は適用 | Pre-PMF 期、本番顧客 0 件 (= 現状) |
| **1 営業週間案 (上流 OQ-3 推奨 / QM 当初指摘 / fallback)** | 5 営業日 (7 暦日) | 段階 1+2+3 全件 + cron 跨ぎ (24h tick × 5 回) + 週末跨ぎ (土日連続稼働) + 月初 invoice 生成跨ぎ (該当時) | (a) Stripe Test Clock 6 シナリオ全件 (子 2 #2674) + Webhook 5 event 全種 1 週間連続観測 (b) Production 顧客発生後の通常 cutover では業界標準 (Stripe 公式 webhook migration 5 phase で shadow 期間 1 週間推奨例あり) | Production 顧客発生後 (本 PR では非適用、将来の re-cutover 想定) |

### 4.1 PO 判断結果 (2026-06-01 時点)

**2-3 日案を採用** (Pre-PMF 顧客 0 件、PR-3a で本番影響ゼロ caching layer 検証済、kill switch 整備済の前提)。

QM 再協議で本案を提示し、**QM Approve なら PR-3b #2722 Phase A 解消** とする。QM が不採用とした場合は 1 営業週間案に切替。

### 4.2 2-3 日案で削れない 5 項目

QM 再協議で「短すぎる」と指摘される懸念に備え、**2-3 日案でも下記 5 項目は削れない**:

1. **段階 1+2 全 AC PASS 必須** (本 docs §3.1 / §3.2)
2. **kill switch dry-run 1 回実演 (本 docs §3.3 AC 3.4)** — staging で `USE_LOOKUP_KEY=true → false` 切替を必ず 1 度実演し、Lambda 反映 30 秒以内を物理確認
3. **Stripe API 障害 fallback test 1 回 (本 docs §3.3 AC 3.5)** — staging で artificial error 注入し、env var 経路に切戻し成功を物理確認
4. **Sentry / Discord alert 設定確認 (#2720 配備の alert ハンドラ動作確認、本 docs §3.2 AC 2.4)**
5. **ロールバック判断基準 3 指標 SSOT 適用 (本 docs §3.3 = `phase6-rollback-and-kill-switches.md §8` 委任)** — staging 観測中も指標閾値抵触で即時ロールバック判断

## 5. ロールバック判断基準 (SSOT 委任)

本 docs は staging 検証中のロールバック判断基準を **新規定義しない**。`phase6-rollback-and-kill-switches.md` §8 の 3 指標 + §4 期間別マトリクスに委任する (二重定義回避):

| 期間 | 該当 staging 段階 | ロールバック手順 SSOT |
|---|---|---|
| **期間 A** (PR-3b マージ前) | 本 docs §3.1 / §3.2 / §3.3 全て | [phase6-rollback-and-kill-switches.md §4.2](phase6-rollback-and-kill-switches.md) (revert 可、全戻し) |
| **期間 B** (PR-3b マージ後 24h 以内) | 本 docs scope 外 (Production cutover 後) | [phase6-rollback-and-kill-switches.md §4.3](phase6-rollback-and-kill-switches.md) (kill switch revert、`USE_LOOKUP_KEY=false`) |
| **期間 C** (PR-3b マージ後 1 週間) | 本 docs scope 外 | [phase6-rollback-and-kill-switches.md §4.4](phase6-rollback-and-kill-switches.md) (forward-fix) |

## 6. 完了判定基準 SSOT

PR-3b Production cutover の完了判定基準 (= staging 検証 PASS + Production deploy 後 24h 観測 PASS の AND):

| 観測指標 | 完了判定閾値 | 失敗時の対応 |
|---|---|---|
| Stripe API lookup_key 解決失敗率 | < 0.1% (24h 集計) | `phase6-rollback-and-kill-switches.md §8 指標 1` |
| 顧客 inquiry 件数 | 0 件 (24h) | `phase6-rollback-and-kill-switches.md §8 指標 2` |
| DB inconsistency (dedup miss 等) | 0 件 (24h) | `phase6-rollback-and-kill-switches.md §8 指標 3` |
| Sentry alert 検出 | 0 件 (24h) | 都度精査、新規 alert なら別 Issue 起票 |

## 7. 関連

### Phase 6 (上流 SSOT)

- [phase6-context-decisions-6.md §8 OQ-3](phase6-context-decisions-6.md) — 「1 週間 staging 検証推奨」の Open question (本 docs で確定)
- [phase6-rollback-and-kill-switches.md §8](phase6-rollback-and-kill-switches.md) — 3 指標 SSOT (本 docs §3.3 / §5 / §6 が委任)
- [phase6-phase7-execution-ssot.md §3 Step 3](phase6-phase7-execution-ssot.md) — Phase 7 lookup_key 移行 step 全体

### Phase 7 (本 docs の落とし先)

- PR #2722 (PR-3b lookup_key Production cutover) — 本 docs の prerequisite SSOT
- PR #2717 (PR-3a caching layer、merge 済) — 本番影響ゼロの shadow 配備
- #2719 (yearly plan lookup_key 追加実装、PR-3b prerequisite)
- #2720 (Sentry / Discord alert 強化、PR-3b prerequisite)

### ADR

- [ADR-0010](../../decisions/0010-pre-pmf-scope-judgment.md) — Pre-PMF Bucket A + 「過剰追加 YAGNI」整合
- [ADR-0059](../../decisions/0059-phase7-cutover-sequence.md) — Phase 7 cutover sequence + kill switch SSOT (本 docs が補強)

### memory

- [[billing-critical-extra-caution]] — 課金は Pre-PMF Bucket A でも別格
- [[adr0010-interpretation]] — 「あるべき機能の品質を削る口実ではない」が、「過剰追加機能の YAGNI」は適用

## 8. 影響範囲事後検証

本 docs は **設計 SSOT のみ** で実コード変更なし。L1-L4 影響範囲:

- L1 構文: docs/decisions/0059 への 1 セクション追加 (本 docs 参照)、grep 影響なし
- L2 意味: 用語 (staging / 2-3 日 / 1 営業週間) は本 docs で初定義、上流 OQ-3 用語と整合
- L3 構造: `phase6-rollback-and-kill-switches.md §8` (3 指標) を再利用、二重定義回避
- L4 派生 artifact: PR-3b #2722 PR body の prerequisite 表に本 docs link 追加 (#2718 close の comment で対応)
