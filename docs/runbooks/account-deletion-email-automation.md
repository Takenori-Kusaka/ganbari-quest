# アカウント削除予告メール自動化 (EventBridge + cron-dispatcher + SES) — 設計 SSOT (#2399)

> **目的**: 猶予期間中のテナントに「このまま何もしなければデータが消える」ことと復元導線を 1 通だけ届ける。既存 cron 基盤 (EventBridge schedule + cron-dispatcher Lambda + SES) に endpoint 1 本を足して実現する。
>
> **本 runbook がしきい値 / idempotency / 送信経路の設計 SSOT**。

---

## §1. 設計背景

### 1.1 現状ギャップ

| 状態 | 実装 | docs SSOT |
|------|------|----------|
| アカウント削除予約 (`softDeleteTenant`) | 実装済 (`src/lib/server/services/grace-period-service.ts`) | `account-deletion-flow.md §4` |
| グレースピリオド物理削除 cron (`grace-period-deletion`) | 実装済 (#1648, registry `cron(0 17 * * ? *)` 02:00 JST 毎日)。**AWS EventBridge Rule 未作成のため AWS 本番では未駆動、現状は NUC scheduler のみで起動** (dispatcher `KNOWN_ENDPOINTS` には登録済、`13-AWSサーバレスアーキテクチャ設計書.md` cron 表参照) | 同上 / `schedule-registry.ts` |
| 削除完了メール (`sendDeletionCompleteEmail`) | 実装済 (`email-service.ts` L323) | 同上 |
| グレース開始通知 (`sendCancellationEmail`) | 実装済 (`email-service.ts` L304) | 同上 |
| **削除予告メール** | 実装済 (`/api/cron/deletion-warning-emails` → `deletion-warning-service.ts` → `email-service.sendDeletionWarningEmail`) | 本 runbook + `account-deletion-flow.md` §4.7 |

猶予期間中 (standard 7 日 / family 30 日) に顧客へ届くイベントは、予約直後 (`sendCancellationEmail`) と削除完了後 (`sendDeletionCompleteEmail`) の両端しかない。その間「復元できる」ことを思い出す契機が無いと、復元 UI を見ないまま沈黙で削除される。

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
| **List-Unsubscribe ヘッダを付けない** | 購読解除リンクは marketing 配信 (lifecycle-emails) を止めるものであり、お手続きの連絡に添えると「解除すれば止まる」と誤解させる。本メールは配信設定にかかわらず届く必要があるため、marketing 経路 (`wrapLifecycleTemplate` + List-Unsubscribe) ではなく汎用トランザクション template で送る。RFC 8058 / Gmail の bulk sender 要件は bulk・promotional mail が対象であり本通知は該当しない |
| **年 6 回上限を消費しない** | `marketing-email-counter` に乗せると、上限に達した年にデータ消失の予告が握り潰される |

---

## §3. アーキテクチャ概要

### 3.1 構成図 (文章記述、ASCII 図禁止 / drawio は別 PR で追加)

主要コンポーネント:

1. **EventBridge Rule**: `ganbari-quest-cron-deletion-warning-emails`
   - cron 式: `cron(0 1 * * ? *)` (UTC) = JST 毎日 10:00 (他の日次 cron が 09:00 / 09:30 に寄るため 30 秒予算の食い合いを避けてずらす)
   - target: `ganbari-quest-cron-dispatcher` Lambda (既存)
   - payload: `{ cronJob: "deletion-warning-emails" }`

2. **cron-dispatcher Lambda** (既存、変更なし):
   - payload を `Authorization: Bearer <CRON_SECRET>` 付きで `https://<function-url>/api/cron/deletion-warning-emails` に HTTP POST 変換
   - timeout 5min / memory 128MB / ARM64

3. **SvelteKit cron endpoint**:

   ```text
   src/routes/api/cron/deletion-warning-emails/+server.ts
   ```

   - `verifyCronAuth` で認証 (POST = 実行 / GET = dryRun ヘルスチェック)
   - `runDeletionWarningEmails({ dryRun })` を呼び、集計を JSON で返す

4. **service**:

   ```text
   src/lib/server/services/deletion-warning-service.ts
   ```

   - 全テナントを走査し `getGracePeriodStatus()` で soft delete 状態 / プラン / 物理削除予定日を取得
   - `shouldWarn(planTier, daysRemaining)` で送信判定 (§3.2)
   - **保護者ロール (owner/parent) 全員**の email 宛に `sendDeletionWarningEmail` を個別に呼ぶ (#4325 follow-up、オーナー決裁 2026-08-06)。owner 1 名固定だと owner 不在 / アドレス失効で予告が単一障害点になるため。`child` ロールは対象外、同一メールアドレスが複数ロールに登録されていれば 1 通にまとめる。1 通以上の送信に成功したときのみ `deletion_warning_sent_at` を書く (idempotency)。対象保護者が 1 件も見つからない場合は `skippedNoRecipients` として集計し、削除自体は止めない
   - 件数上限 (`DEFAULT_DELETION_WARNING_LIMIT`) + `createTimeBudget` で 30 秒制約に収め、残件を `tenantsRemaining` で報告する (silent 持ち越し禁止、#3695)

5. **SES** (既存、設定変更なし):
   - 送信元: `noreply@ganbari-quest.com`
   - Configuration Set: `ganbari-quest-config` (bounce / complaint 監視済)
   - template: HTML + text 2-variant 直書き (lifecycle-emails と同パターン、別 SES template リソース不要)

### 3.2 送信しきい値 (`DELETION_WARNING_DAYS_BEFORE`)

猶予日数 (`DELETION_GRACE_PERIOD_DAYS`) がプランごとに異なるため、「削除 14 日前」は全プランでは成立しない。

| プラン | 猶予 | しきい値 | 根拠 |
|--------|------|---------|------|
| free | 0 日 | **なし (送信しない)** | 即時物理削除のため予告を送る時間が存在しない。削除確認は `account-deletion-flow.md` §5.1 の入力確認 UX が担う |
| standard | 7 日 | 残り 1 日 | 猶予 7 日に 14 日前は収まらない |
| family | 30 日 | 残り 14 日 | `docs/operations/sla.md` §2 設計原則 (7) の「重要な変更は 14 日前に事前通知」と同じ原則 |

判定は `shouldWarn(planTier, daysRemaining)`:

- `daysRemaining` は **JST 暦日差**で数える (時刻差ではなく暦日差にすることで、予約した時刻によって「あと N 日」の表示と判定がズレない)
- `daysRemaining >= 1 かつ daysRemaining <= しきい値 かつ 未送信` で送る
- **「一致」ではなく「以下」で判定する**: cron が 1 日欠測しただけで予告なしに削除される (= 本機構が塞ごうとしている無音の失敗そのもの) のを避けるため。二重送信は §3.3 の idempotency が防ぐ
- しきい値が猶予日数より小さいことは `tests/unit/services/deletion-warning-service.test.ts` [W2] が機械強制する (猶予日数を変えたときに到達不能なしきい値が silent に残らない)

### 3.3 idempotency と再送

- 送信済フラグ: `settings.deletion_warning_sent_at` (ISO 8601 string)。定義は `grace-period-service.ts` の `DELETION_WARNING_SENT_KEY` (soft delete 状態の KV 群と同じライフサイクルのため)
- **予約時 (`softDeleteTenant`) と復元時 (`restoreSoftDeletedTenant`) にクリアする**。クリアを落とすと、復元して再度削除予約した顧客に対し「2 回目は予告なしで消える」silent regression になる (回帰 test: 同 test file [W5])
- 送信失敗時はフラグを書かない (次回実行で再試行される)。宛先が複数いる場合は **1 通でも成功すればフラグを書く** (一部の保護者アドレスが恒久的に失敗し続けても無限リトライにしない。成功した宛先には翌日以降二重に届かない)。全宛先が失敗したときのみ再試行対象になる
- スキーマ migration 不要 (KV テーブルへの新規 key 追加のみ)

---

## §4. 観測性 (Observability)

### 4.1 Logger

`deletion-warning-service.ts` が以下を出力する:

```ts
logger.info('[deletion-warning] sent', { tenantId, planTier, daysRemaining });
logger.warn('[deletion-warning] no guardian email found; deletion proceeds unwarned', { tenantId, daysRemaining });
logger.error('[deletion-warning] send failed', { tenantId, daysRemaining });
logger.warn('[deletion-warning] carried over remaining tenants to next run', { remaining });
```

### 4.2 CloudWatch Alarm

| Alarm 名 | メトリクス | 閾値 | 既存 / 新規 |
|---------|----------|------|-----------|
| `CronDispatcherErrors` (既存) | `cron-dispatcher` Lambda Errors | ≥ 1回/5分 | 既存 (#1376 で導入済) |
| `DeletionWarningEmailFailures` | CloudWatch metric filter on `[deletion-warning] send failed` log | ≥ 3回/24h | **設けない**。送信失敗はフラグを書かないため翌日の実行で自動再試行され、恒常的な失敗は `CronDispatcherErrors` と SES bounce 監視で表面化する。ARR ≥ ¥100万/月 到達時に再評価する |

### 4.3 DLQ 方針

- **DLQ は設けない**。dispatcher Lambda 内 retry + 翌日実行での自動再試行 + CloudWatch Alarm で代替する (ADR-0010 Pre-PMF 過剰防衛回避)
- 再評価トリガ: ARR ≥ ¥100万/月 到達、または送信失敗が 30 日連続で発生した場合に SQS DLQ 追加を評価する

---

## §5. デプロイ手順

登録先 3 点 (`tests/unit/cron/schedule-consistency.test.ts` が整合を CI 検証する):

1. `src/lib/server/cron/schedule-registry.ts` の `deletion-warning-emails`
2. `infra/lib/compute-stack.ts` の `CRON_JOBS` (EventBridge Rule 自動生成)
3. `infra/lambda/cron-dispatcher/index.ts` の `KNOWN_ENDPOINTS`

deploy は GitHub Actions `deploy.yml` (CDK deploy → post-deploy smoke test で env 注入確認)。

### 5.1 オーナー責務 (AWS CLI 検証 / 実受信確認)

Dev session に AWS CLI 権限が無いため、以下はオーナーが実行して PR comment に貼付する。**SES の実送信は実資格情報を要するため、自動 test は mock 送信までで固定されている**。実際にメールが届くかの確認は本手順が唯一の担保である:

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

### 6.1 unit

| test | 検証内容 |
|------|---------|
| `tests/unit/services/deletion-warning-service.test.ts` | free 無送信 / プラン別しきい値 / 境界 (15・14・13 日) / idempotency / 復元→再予約で再送 / cron 欠測の救済 / opt-out でも届く / 時間予算の持ち越し報告 |
| `tests/unit/services/deletion-warning-email.test.ts` | 本文に復元 URL + 削除予定日 + 残日数がある / 子供の情報を含まない / List-Unsubscribe を付けない (SendRawEmailCommand を使わない) / 煽り表現なし |
| `tests/unit/routes/cron-deletion-warning-emails.test.ts` | `CRON_SECRET` 設定あり (Bearer / x-cron-secret) / 未設定 × `AUTH_MODE` の 3 パターン / 例外時に内部情報を出さない |
| `tests/unit/services/grace-period-service.test.ts` | 復元時に `deletion_warning_sent_at` をクリアする |
| `tests/unit/cron/schedule-consistency.test.ts` (既存) | registry / CDK / dispatcher / 設計書 cron 表の整合 |

### 6.2 E2E

```text
tests/e2e/cron-deletion-warning-emails.spec.ts
```

- 認証ガード 3 パターン (`tests/CLAUDE.md` §cron E2E テスト整合)
- dryRun POST / GET ヘルスチェックで全集計 (`tenantsRemaining` 含む) が返る

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
| standard プラン (7 日グレース) で「14 日前」が論理的に存在しない | §3.2 の通りプラン別しきい値 (standard = 残り 1 日) とし、しきい値 < 猶予日数 を test で機械強制する |
| free プランには予告が一切届かない | 猶予 0 日 = 即時物理削除のため原理的に送れない。削除予約時の入力確認 UX (`account-deletion-flow.md` §5.1) が唯一の確認機会である |
| 残日数の時刻ズレ (TZ / UTC vs JST) | `daysUntilJST` が JST 暦日を UTC 深夜として解釈し UTC 算術で引く (プロセス TZ 非依存、#4015 / #4127 JST SSOT 整合) |
| SES bounce 急増 (削除予約ユーザーがメール無効化済の場合) | 既存 SES Configuration Set のバウンス監視で吸収 (`ses-bounce-notifications` SNS) |
| ユーザーが予告メールを spam 報告 | 年 1 予約あたり 1 通のみ。年 6 回上限カウンタ (`marketing-email-counter.ts`) には乗せず、購読解除でも止めない (法務通知扱い、§2) |

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
- #4119 / #4311: `grace-period-deletion` の EventBridge Rule 配線 (物理削除が本番で駆動する前提)
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
