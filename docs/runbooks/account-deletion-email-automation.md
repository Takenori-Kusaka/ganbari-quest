# アカウント削除予告メール自動化 (EventBridge + Lambda + SES) — Plan & Design (#2399)

> **目的**: `docs/design/account-deletion-flow.md` で schema 設計済の「アカウント削除 14 日前通知」を、既存 cron 基盤 (EventBridge schedule + cron-dispatcher Lambda + SES Configuration Set) に乗せて自動化する。
>
> **本 PR の scope**: 計画 + 設計 docs + sub-Issue 起票のみ。Lambda code / SES template / EventBridge schedule rule の実装は別 PR (sub-Issue Phase 1 / Phase 2)。

---

## §1. 設計背景

### 1.1 現状ギャップ

| 状態 | 実装 | docs SSOT |
|------|------|----------|
| アカウント削除予約 (`softDeleteTenant`) | 実装済 (`src/lib/server/services/grace-period-service.ts`) | `account-deletion-flow.md §4` |
| グレースピリオド物理削除 cron (`grace-period-deletion`) | 実装済 (#1648, EventBridge `cron(0 17 * * ? *)` 02:00 JST 毎日) | 同上 / `schedule-registry.ts` |
| 削除完了メール (`sendDeletionCompleteEmail`) | 実装済 (`email-service.ts` L323) | 同上 |
| グレース開始通知 (`sendCancellationEmail`) | 実装済 (`email-service.ts` L304) | 同上 |
| **14 日前予告メール** | **未実装** ← 本 Issue でカバー | (本 runbook で SSOT 化) |

ユーザーが standard プラン (7 日) / family プラン (30 日) のグレースピリオド中に居る間、自動で「あと N 日で削除されます」というリマインダーを送る機構が無いため、復元 UI を見ずに沈黙で削除されるリスクがある。

### 1.2 なぜ自動化が必要か

| 観点 | 影響 |
|------|------|
| UX (誤操作防止) | 親が誤って削除予約を実行した場合、復元期限内に気づける |
| 法務 (GDPR Article 17 推奨ベストプラクティス) | 削除前の事前通知は EU 規制で明文要件ではないが推奨。日本の個人情報保護法でも消去前確認の機会提供は ADR-0010 Bucket C (運用安定) として有用 |
| **SLA 整合 (`docs/operations/sla.md` §3.5 障害通知 / §3.8 免責事項 / §2 設計原則 (7)「改定は 14 日前事前通知」 — SSOT。`site/sla.html` は LP 公開コピー)** | **SLA は「サービス重要変更の 14 日前通知」を約束済 (`docs/runbooks/account-deletion-email-automation.md` の family プラン 14 日前と整合)。本機構は、テナント個別の「データ消失」という重要変更に対し SLA §3.5 / §3.8 / §2(7) と同じ「14 日前予告」原則を実装する** |
| Pre-PMF コスト | EventBridge rule 1 本追加 + Lambda 起動 1 回/日 + SES 1 通/送信。月額数十円レベル (ADR-0010 Bucket A: ローンチ後の運用安定 / Pre-PMF 段階では low priority だが工数 < 10h) |

### 1.3 採用しない代替案

| 案 | 棄却理由 |
|----|---------|
| 新規 EventBridge schedule rule + 新規専用 Lambda function | dispatcher 基盤 (#1376) と二重管理。schedule-registry.ts SSOT 違反 |
| GitHub Actions schedule で本番 endpoint を叩く | schedule 精度 5-15 分ズレ + Actions の secret 直書きリスク |
| 即時送信 (削除予約と同時送信) | 「14 日前」というタイミング訴求が失われる |
| 別 Lambda function 新設 (Issue 2399 本文の初稿) | **採用しない**。`cron-dispatcher` Lambda が既に存在し、新規 endpoint `/api/cron/deletion-warning-emails` を追加するだけで dispatcher が自動的に HTTP POST してくれる。Lambda function 新規追加コストは不要 |

---

## §2. 設計原則

| 原則 | 理由 |
|------|------|
| **既存 cron 基盤を再利用** (新規 Lambda function 追加禁止) | dispatcher Lambda + schedule-registry.ts + EventBridge rule の 3 点セットで完結。lifecycle-emails / pmf-survey と同型 |
| **idempotent 保証** | 1 ユーザーにつき 1 回しか送らない (settings KV `deletion_warning_sent_at` で dedupe) |
| **schedule SSOT 必須** | `src/lib/server/cron/schedule-registry.ts` に登録 → `tests/unit/cron/schedule-consistency.test.ts` で CDK / dispatcher の三者整合性を CI で検証 |
| **silent fail 検出** | CloudWatch Alarm `CronDispatcherErrors` (既存) で自動検知 + post-deploy smoke test (deploy.yml で実行済) で env 注入確認 |
| **DLQ 不要** (Pre-PMF Bucket A 過剰防衛回避、ADR-0010) | dispatcher Lambda は既に retry 内蔵。失敗時は CloudWatch Logs + Alarm 通知で十分。SQS DLQ は ARR ≥ ¥100万/月 で再評価 |
| **メール文言は子供を出さない** | 「保護者アカウントの削除予約について」の中立トーン。Anti-engagement (ADR-0012) + Marketing Policy (ADR-0031) 整合 |
| **List-Unsubscribe ヘッダ必須** | RFC 8058 準拠 + Gmail / Yahoo の 2024 要件 (lifecycle-emails と同設定を流用) |

---

## §3. アーキテクチャ概要

### 3.1 構成図 (文章記述、ASCII 図禁止 / drawio は別 PR で追加)

主要コンポーネント:

1. **EventBridge Rule** (新規追加): `ganbari-quest-cron-deletion-warning-emails`
   - cron 式: `cron(0 0 * * ? *)` (UTC) = JST 毎日 09:00
   - target: `ganbari-quest-cron-dispatcher` Lambda (既存)
   - payload: `{ cronJob: "deletion-warning-emails" }`

2. **cron-dispatcher Lambda** (既存、変更なし):
   - payload を `Authorization: Bearer <CRON_SECRET>` 付きで `https://<function-url>/api/cron/deletion-warning-emails` に HTTP POST 変換
   - timeout 5min / memory 128MB / ARM64

3. **SvelteKit cron endpoint** (Phase 1 で新規作成予定):

   ```text
   src/routes/api/cron/deletion-warning-emails/+server.ts
   ```

   - `verifyCronAuth` で 401 ガード (既存パターン)
   - `findTenantsForDeletionWarning` を呼んで対象テナント抽出
   - 各 owner に対し `sendDeletionWarningEmail` を呼び出す
   - 結果を JSON で返却 (送信成功数 / 失敗数 / skipped 数)

4. **新規 service** (Phase 1 で新規作成予定):

   ```text
   src/lib/server/services/deletion-warning-service.ts
   ```

   - `findTenantsForDeletionWarning(now)`: settings KV から `physical_deletion_date` が `now + 1 day .. now + 1 day + 24h` のテナントを抽出
   - `sendDeletionWarningEmail` を email-service.ts に追加
   - 送信成功時に `deletion_warning_sent_at` を settings に書く (idempotency)

5. **SES** (既存、設定変更なし):
   - 送信元: `noreply@ganbari-quest.com`
   - Configuration Set: `ganbari-quest-config` (bounce / complaint 監視済)
   - template: HTML + text 2-variant 直書き (lifecycle-emails と同パターン、別 SES template リソース不要)

### 3.2 トリガータイミングの計算

グレース期間によって「削除 14 日前」の意味が異なる:

| プラン | グレース期間 | 通知タイミング | 計算式 |
|--------|-------------|---------------|--------|
| free | 0 日 | (送信なし) | 即時削除のため対象外 |
| standard | 7 日 | 削除 1 日前 (グレース 6 日目) | `physical_deletion_date - now == 1 day` |
| family | 30 日 | 削除 14 日前 (グレース 16 日目) | `physical_deletion_date - now == 14 days` |

> **判定**: Issue 本文の「14 日前固定」は family プラン基準。standard はグレース 7 日しかないため「14 日前」は到達不能 → 「削除 1 日前」に縮退する。
>
> **仕様確定タイミング (#2429 QM Re-Review で明示)**: 上記の standard プラン「削除 1 日前」縮退は **本 PR (#2429) で SSOT 確定**とする。Phase 1 sub-Issue (#2426) は本 runbook §3.2 の表をそのまま実装する責務を持ち、仕様再議論は行わない（再議論が必要な場合は本 runbook を別 PR で更新してから Phase 1 着手）。

### 3.3 DB 影響

- 既存 `settings` テーブルに 1 キー追加: `deletion_warning_sent_at` (ISO 8601 string)
- スキーマ migration 不要 (KV テーブルへの新規 key 追加のみ、ADR-0031 互換)

---

## §4. 観測性 (Observability)

### 4.1 Logger

Phase 1 で新規追加する deletion-warning-service.ts (Phase 1 #2426) で以下を出力:

```ts
logger.info('[deletion-warning] sent', { tenantId, daysRemaining, emailHash });
logger.warn('[deletion-warning] skipped (already sent)', { tenantId });
logger.error('[deletion-warning] send failed', { tenantId, error });
```

### 4.2 CloudWatch Alarm

| Alarm 名 | メトリクス | 閾値 | 既存 / 新規 |
|---------|----------|------|-----------|
| `CronDispatcherErrors` (既存) | `cron-dispatcher` Lambda Errors | ≥ 1回/5分 | 既存 (#1376 で導入済) |
| `DeletionWarningEmailFailures` (Phase 2 で検討) | CloudWatch metric filter on `[deletion-warning] send failed` log | ≥ 3回/24h | **新規追加は Phase 2 で判断**。Pre-PMF ARR < ¥100万/月では既存 Alarm で十分の可能性 |

### 4.3 DLQ 方針

- **Phase 1 (#2399 child): DLQ なし**。dispatcher Lambda 内 retry + CloudWatch Alarm で代替 (ADR-0010 Pre-PMF 過剰防衛回避)
- **Phase 2 (#2399 child): DLQ 検討対象**。ARR ≥ ¥100万/月 or 送信失敗 30 日連続発生時に SQS DLQ 追加を再評価

---

## §5. デプロイ手順

Phase 1 (sub-Issue) PR がマージされたとき:

1. `schedule-registry.ts` への `deletion-warning-emails` 追加
2. `infra/lib/compute-stack.ts` CRON_JOBS 配列への追加 (EventBridge rule 自動生成)
3. Phase 1 で新規追加する path:

   ```text
   src/routes/api/cron/deletion-warning-emails/+server.ts
   src/lib/server/services/deletion-warning-service.ts
   ```

   加えて `email-service.ts` に新 function を追加 (Phase 1)
4. CDK deploy (GitHub Actions deploy.yml で自動)
5. post-deploy smoke test (deploy.yml の dryRun invoke で env 注入確認)

### 5.1 PO 責務 (AWS CLI 検証)

Dev session に AWS CLI 権限がないため、以下は PR comment に PO が貼付:

```bash
# 1. EventBridge rule 登録確認
aws events list-rules --name-prefix ganbari-quest-cron-deletion-warning --region us-east-1

# 2. dryRun smoke test
aws lambda invoke \
  --function-name ganbari-quest-cron-dispatcher \
  --payload '{"cronJob":"deletion-warning-emails","dryRun":true}' \
  --cli-binary-format raw-in-base64-out \
  --region us-east-1 \
  /tmp/deletion-warning-dryrun.json
cat /tmp/deletion-warning-dryrun.json
# 期待: {"statusCode":200,"jobName":"deletion-warning-emails","dryRun":true}

# 3. CloudWatch Logs 確認 (実 schedule 起動後)
aws logs tail /aws/lambda/ganbari-quest-cron-dispatcher --region us-east-1 \
  --since 24h | grep deletion-warning-emails
```

---

## §6. テスト戦略

### 6.1 unit (Phase 1)

Phase 1 で新規作成する unit test:

```text
tests/unit/services/deletion-warning-service.test.ts
```

検証内容:

- `findTenantsForDeletionWarning` の境界条件 (14 日前ピッタリ / 13 日前 / 15 日前)
- idempotency: `deletion_warning_sent_at` 既存のテナントを skip
- family / standard プランの giorni 計算分岐

加えて既存 `tests/unit/cron/schedule-consistency.test.ts` で registry / CDK / dispatcher の三者整合性を自動 assert。

### 6.2 E2E (Phase 2)

Phase 2 で新規作成する E2E test:

```text
tests/e2e/account-deletion-warning-email.spec.ts
```

検証内容:

- mock SES で送信メール内容を assert
- 削除予約 → cron 起動 → メール送信 → restore で sent 状態リセット
- List-Unsubscribe ヘッダ存在検証 (RFC 8058)

### 6.3 idempotency 検証 (deploy 後手動)

```bash
# 同じ日に dispatcher を 2 回 invoke しても 2 通目は送らないことを CloudWatch Logs で確認
aws lambda invoke --function-name ganbari-quest-cron-dispatcher \
  --payload '{"cronJob":"deletion-warning-emails"}' ...
# 5 分後再 invoke、`skipped (already sent)` ログが増えることを確認
```

---

## §7. リスク / 残課題

| リスク | 対応 |
|--------|------|
| standard プラン (7 日グレース) で「14 日前」が論理的に存在しない | Phase 1 sub-Issue で仕様確定。「削除 1 日前」に縮退する案を有力に推奨 |
| family プランで `physical_deletion_date - 14 days` が時刻ズレ (TZ / UTC vs JST) | utils関数 `daysUntil` (lifecycle-email-service.ts と同型) を流用し、JST 基準で計算 |
| SES bounce 急増 (削除予約ユーザーがメール無効化済の場合) | 既存 SES Configuration Set のバウンス監視で吸収 (`ses-bounce-notifications` SNS) |
| ユーザーが「14 日前メール」を spam 報告 | List-Unsubscribe 即時反映 + 年 6 回上限カウンタ (`marketing-email-counter.ts`) **には乗せない** (これは法務通知扱い、ADR-0023 §5 I11 整合) |

---

## §8. 関連

### 8.1 既存 docs

- `docs/design/account-deletion-flow.md` (グレースピリオド + 削除パターン SSOT)
- `docs/design/13-AWSサーバレスアーキテクチャ設計書.md` §3.3 (cron-dispatcher + EventBridge)
- `docs/runbooks/cron-3-endpoints-verification.md` (#1377 cron 検証フロー、本 runbook の親型)
- [`docs/operations/sla.md`](../operations/sla.md) §3.5 障害通知 / §3.8 免責事項 / §2 設計原則 (7) 「改定は 14 日前事前通知」 — **SLA SSOT (PR #2428 で策定)**。SLA の「重要な変更は 14 日前までに通知」原則と本機構の family プラン 14 日前予告が整合。SLA がサービス全体の重要変更を扱うのに対し、本機構はテナント個別のデータ消失予告を扱う (補完関係)
- [`site/sla.html`](../../site/sla.html) §5 障害通知 / §8 免責事項末尾 — 上記 SSOT の LP 公開コピー (保護者ユーザ向け表記、参照のみ)

### 8.2 関連 Issue / ADR

- #2399 (本 Issue): EventBridge + Lambda + SES 自動化 (本 runbook)
- #2426 (Phase 1): Lambda code + SES template 実装
- #2427 (Phase 2): E2E + 観測性 (Alarm / DLQ 判断)
- #1376 (closed): AWS EventBridge cron 基盤導入
- #1601 (closed): lifecycle-emails (本 Issue と同型実装、参考)
- #1648 (closed): grace-period-deletion cron (#742 復元期限切れ物理削除)
- #1781 (closed): softDeleteTenant 配線完了
- ADR-0010 Pre-PMF スコープ判断 (Bucket A 過剰防衛回避)
- ADR-0012 Anti-engagement 原則 (メール文言の中立トーン)
- ADR-0023 §5 I11 (archive、年 6 回マーケティング上限 — 本機能は **法務通知扱いで対象外**)
- ADR-0024 (archive、インフラ PR 必須要件 — 本 runbook はその発展系)
- **[ADR-0049](../decisions/0049-retention-physical-delete-extended.md)** (active、un-archived 2026-05-19) — プラン別履歴保持期間ポリシー（物理削除対象テーブル拡張）。本 ADR §4 ポイント残高の非削除設計 / §7 downgrade 時の UX で「削除前の予告メール通知は別 Issue (#729 AC)」と明示されており、本 runbook (#2399) はその follow-up 実装に該当。フォローアップ欄「削除予告メール（14 日前）の実装」をカバー
- (旧 ADR-0028 (削除済、git 履歴で追跡)) — 上記 ADR-0049 が un-archived + 拡張で継承済。historical record として git 履歴のみ
- ADR-0031 (Marketing policy Pre-PMF)

---

## 更新履歴

| 日付 | 版数 | 内容 |
|------|------|------|
| 2026-05-22 | 1.0 | #2399 初版作成 (計画 + 設計のみ、実装は sub-Issue) |
| 2026-05-23 | 1.1 | #2429 QM Re-Review 対応: §1.2 / §8.1 に SLA cross-ref 追加 / §3.2 で standard プラン「1 日前」縮退の確定タイミングを本 PR で SSOT 化と明示 / §8.2 に ADR-0049 (active) cross-ref 追加 (旧 ADR-0028 は historical record として archive 参照のみ) |
| 2026-05-23 | 1.2 | #2429 QM Re-Review #2 対応 (M-2-RE): §1.2 / §8.1 の SLA 参照を `docs/operations/sla.md` (PR #2428 で策定された SSOT) 主参照に修正し、`site/sla.html` は LP 公開コピー (補助) として明示。§8.2 nit: 旧 ADR-0028 archive 表記を「削除済、git 履歴で追跡」に修正 (実体は archive/ ではなく削除済) |
