# biome-ignore 複雑性 リファクタ umbrella (Issue #2397)

| 項目 | 内容 |
|------|------|
| 親 Issue | [#2397](https://github.com/Takenori-Kusaka/ganbari-quest/issues/2397) |
| ステータス | active (sub-Issue 起票フェーズ) |
| 起票日 | 2026-05-22 |
| 関連 ADR | [ADR-0007](../decisions/0007-static-analysis-tier-policy.md) / [ADR-0010](../decisions/0010-pre-pmf-scope-judgment.md) |

## 1. 背景

biome の complexity rule (`noExcessiveCognitiveComplexity` / `useMaxParams`) を **44 箇所 / 39 ファイル** で `biome-ignore` 指定で suppress しており、コメントの 8 割が「複雑なビジネスロジックのため、別 Issue でリファクタ予定」のままになっている。コードレビュー時の毎回の説明コスト・新規開発者の理解障害・テスト困難化が累積している。

Pre-PMF Bucket B (技術負債整理、ADR-0010 §3)。放置すると開発速度低下 30-50% 想定。

## 2. 設計原則

- **Strangler Fig pattern**: umbrella 配下で段階リファクタ、Big Bang 禁止 (Pre-PMF リスク回避)
- **Extract Method / Extract Class**: 各 sub-Issue で `Refactoring` 教科書の Extract pattern を適用
- **assertion 弱体化禁止 (ADR-0006)**: リファクタ時に既存テスト assertion を弱めない
- **biome rule 自体は変更しない**: complexity threshold を緩めるのではなく ignore 撤去で対応
- **テスト先行**: 各 sub-Issue で対象関数の単体テスト充足を確認してから refactor 着手

## 3. 仕様

### 3.1 全件 grep 結果 (2026-05-22 時点)

`grep -rn "biome-ignore.*complexity" src/` で **44 箇所**ヒット。ユニークファイル数 **39 件**。

```bash
$ grep -rn "biome-ignore.*complexity" src/ | wc -l
44

$ grep -rln "biome-ignore.*complexity" src/ | sort -u | wc -l
39
```

内訳 (rule 別):

| Rule | 件数 |
|------|------|
| `lint/complexity/noExcessiveCognitiveComplexity` | 30 |
| `lint/complexity/useMaxParams` | 14 |

### 3.2 優先度判定表 (39 ファイル)

判定基準:

- **影響範囲**: core path (auth/hooks/services 中心系) = HIGH / 周辺 service = MID / repo/edit form = LOW
- **難易度**: 分岐数・依存数・テスト充足度
- **優先度**: HIGH = 半年以内 / MID = 1 年以内 / LOW = nice-to-have

| # | ファイル | rule 種別 | 件数 | 影響範囲 | 難易度 | 優先度 | sub-Issue |
|---|---------|----------|------|---------|-------|-------|----------|
| 1 | `src/hooks.server.ts` | cognitive | 1 | HIGH (全 request) | 高 | **HIGH** | TBD |
| 2 | `src/lib/server/auth/providers/cognito.ts` | cognitive | 1 | HIGH (auth) | 高 | **HIGH** | TBD |
| 3 | `src/lib/domain/battle-engine.ts` | cognitive | 1 | HIGH (子供 UI core) | 中 | **HIGH** | TBD |
| 4 | `src/routes/auth/signup/+page.server.ts` | cognitive | 1 | HIGH (登録 funnel) | 中 | **HIGH** | TBD |
| 5 | `src/lib/server/demo/demo-service.ts` | cognitive | 1 | HIGH (LP demo) | 中 | **HIGH** | TBD |
| 6 | `src/lib/server/security/magic-bytes.ts` | cognitive | 1 | HIGH (セキュリティ) | 中 | **HIGH** | TBD |
| 7 | `src/lib/server/services/activity-log-service.ts` | cognitive | 1 | HIGH (記録 core) | 中 | **HIGH** | TBD |
| 8 | `src/lib/server/services/daily-mission-service.ts` | cognitive | 1 | HIGH (ミッション) | 中 | **HIGH** | TBD |
| 9 | `src/routes/(parent)/admin/+layout.server.ts` | cognitive | 1 | HIGH (admin core) | 中 | **HIGH** | TBD |
| 10 | `src/lib/server/services/recommendation-service.ts` | cognitive | 1 | MID | 中 | MID | TBD |
| 11 | `src/lib/server/services/sibling-ranking-service.ts` | cognitive | 1 | MID | 中 | MID | TBD |
| 12 | `src/lib/server/services/ops-analytics-service.ts` | cognitive | 1 | MID (ops) | 中 | MID | TBD |
| 13 | `src/lib/server/services/export-service.ts` | cognitive | 1 | MID | 中 | MID | TBD |
| 14 | `src/lib/server/services/retention-cleanup-service.ts` | cognitive | 1 | MID (cron) | 中 | MID | TBD |
| 15 | `src/lib/server/services/tenant-cleanup-service.ts` | cognitive | 1 | MID (cron) | 中 | MID | TBD |
| 16 | `src/lib/server/services/pmf-survey-service.ts` | cognitive | 1 | MID (cron) | 低 | MID | TBD |
| 17 | `src/lib/server/services/bonus-hook-service.ts` | cognitive | 1 | MID (6 rule 集約) | 低 | MID | TBD |
| 18 | `src/lib/server/discord-alert.ts` | cognitive | 1 | MID (通知) | 低 | MID | TBD |
| 19 | `src/lib/server/db/seed.ts` | cognitive | 1 | MID (dev seed) | 中 | MID | TBD |
| 20 | `src/lib/server/db/schema-validator.ts` | cognitive | 1 | MID | 中 | MID | TBD |
| 21 | `src/routes/(parent)/admin/activities/+page.server.ts` | cognitive | 2 | MID (admin) | 中 | MID | TBD |
| 22 | `src/routes/(parent)/admin/children/+page.server.ts` | cognitive | 1 | MID (admin) | 中 | MID | TBD |
| 23 | `src/routes/(parent)/admin/challenges/+page.server.ts` | cognitive | 1 | MID (admin) | 中 | MID | TBD |
| 24 | `src/routes/(parent)/admin/billing/+page.svelte` | cognitive | 1 | MID (billing) | 中 | MID | TBD |
| 25 | `src/routes/api/v1/admin/account/delete/+server.ts` | cognitive | 1 | MID (削除 flow) | 中 | MID | TBD |
| 26 | `src/routes/api/v1/admin/cleanup-orphans/+server.ts` | cognitive | 1 | LOW (admin ops) | 低 | LOW | TBD |
| 27 | `src/routes/api/v1/children/[id]/avatar/+server.ts` | cognitive | 1 | LOW (画像) | 低 | LOW | TBD |
| 28 | `src/routes/ops/license/issue/+page.server.ts` | cognitive | 1 | LOW (ops only) | 低 | LOW | TBD |
| 29 | `src/routes/(parent)/admin/activities/[id]/edit/+page.server.ts` | cognitive | 1 | LOW (form 分解、ignore 妥当) | 低 | **KEEP** | N/A |
| 30 | `src/lib/features/admin/components/SaasLicensePanel.svelte` | cognitive | 1 | MID (PIN gate、ignore 妥当) | 低 | **KEEP** | N/A |
| 31 | `src/lib/server/services/certificate-service.ts` | useMaxParams | 1 | MID | 低 | MID | TBD |
| 32 | `src/lib/server/services/checklist-service.ts` | useMaxParams | 1 | MID | 低 | MID | TBD |
| 33 | `src/lib/server/services/discord-notify-service.ts` | useMaxParams | 1 | MID (通知) | 低 | MID | TBD |
| 34 | `src/lib/server/services/voice-service.ts` | useMaxParams | 1 | LOW | 低 | LOW | TBD |
| 35 | `src/lib/server/services/rule-preset-import-service.ts` | useMaxParams | 2 | LOW (旧 API 互換) | 低 | **KEEP** | N/A |
| 36 | `src/lib/server/db/status-repo.ts` | useMaxParams | 2 | LOW (型安全) | 低 | LOW | TBD |
| 37 | `src/lib/server/db/sqlite/status-repo.ts` | useMaxParams | 2 | LOW (型安全) | 低 | LOW | TBD |
| 38 | `src/lib/server/db/dynamodb/status-repo.ts` | useMaxParams | 2 | LOW (型安全) | 低 | LOW | TBD |
| 39 | `src/lib/server/db/demo/status-repo.ts` | useMaxParams | 2 | LOW (型安全) | 低 | LOW | TBD |

**サマリ**:

- **HIGH 優先 (9 件)**: 半年以内に sub-Issue 起票 + refactor PR
- **MID 優先 (18 件)**: 1 年以内に対応、必要に応じてさらに分解
- **LOW 優先 (9 件)**: nice-to-have、status-repo 系 4 件はオブジェクト引数化で 1 PR にまとめる可能性
- **KEEP (3 件)**: ignore コメントが明示的に妥当性を述べているため refactor 対象外。コメント文言を「別 Issue でリファクタ予定」から実際の理由に書き換える sub-task のみ別途検討

### 3.3 sub-Issue 起票方針

- **HIGH 優先 9 件**: 個別 sub-Issue 起票 (umbrella #2397 で `blocks` リンク)
- **MID 優先 18 件**: 個別 sub-Issue 起票 (低頻度更新のため細粒度を維持)
- **LOW 優先 9 件**: status-repo 系 4 件を **1 sub-Issue に集約** (`useMaxParams` 共通のオブジェクト引数化)、残り 5 件は個別起票
- **KEEP 3 件**: 起票しない (umbrella docs にコメント書き換え提案のみ記載)

合計起票予定: **HIGH 9 + MID 18 + LOW 6 = 33 sub-Issue** (LOW は status-repo を集約)

### 3.4 sub-Issue テンプレ

```markdown
## 種別
refactor

## 優先度
{HIGH|MID|LOW}

## 概要
`<path>` の `biome-ignore lint/complexity/<rule>` を撤去する。

## ゴール
- [ ] 対象関数を Extract Method / Extract Class で分解
- [ ] biome-ignore コメントを撤去
- [ ] 既存 vitest 全 PASS (assertion 弱体化禁止)
- [ ] 新規 helper 関数に単体テスト追加
- [ ] `npm run pre-ready` 全 Step PASS

## 制約
- ADR-0006 (assertion 弱体化禁止) 遵守
- biome rule threshold は変更しない

## Blocked by
#2397
```

## 4. 進捗追跡

| Phase | 件数 | 状態 |
|-------|------|------|
| Phase 1 (umbrella docs) | 1 | active (本 PR で完了) |
| Phase 2 (HIGH sub-Issue 起票) | 9 | TBD |
| Phase 3 (MID sub-Issue 起票) | 18 | TBD |
| Phase 4 (LOW sub-Issue 起票) | 6 | TBD |
| Phase 5 (refactor PR 順次 merge) | 33 | TBD |
| Phase 6 (umbrella close) | 1 | 全 sub-Issue close 後 |

6 ヶ月後の棚卸で sub-Issue クローズ率を追跡し、進捗が停滞した場合は MID 以下を archive 化する判断を行う。

## 5. 関連

- ADR-0007: 静的解析 tier ポリシー (T1/T2/T3/T4)
- ADR-0010: Pre-PMF scope 判断 (Bucket B 技術負債)
- ADR-0006: assertion 弱体化禁止
- Prior art: EPIC #2362 (MarketplaceTypeRegistry) で同様の umbrella + sub-Issue パターン成功
