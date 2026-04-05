# SES サンドボックス脱出手順書 — がんばりクエスト

## 概要

Amazon SES は新規アカウントでは**サンドボックスモード**で起動します。
サンドボックスでは検証済みメールアドレスにしか送信できないため、本番運用（ユーザー登録時のメール確認、パスワードリセット等）にはプロダクションアクセスの申請が必要です。

### サンドボックス vs プロダクションモード

| 項目 | サンドボックス | プロダクション |
|------|-------------|-------------|
| 送信先 | **検証済みアドレスのみ** | 任意のアドレス |
| 送信数上限 | 200通/24時間 | 50,000通/24時間（初期値、引き上げ可能） |
| 送信レート | 1通/秒 | 14通/秒（初期値、引き上げ可能） |
| 用途 | 開発・テスト | 本番運用 |

### 本プロジェクトでの SES 利用箇所

- **Cognito ユーザー認証メール**: `noreply@ganbari-quest.com` からメール確認コード・パスワードリセットを送信（`infra/lib/auth-stack.ts`）
- **サポートメール受信**: `support@ganbari-quest.com` への問い合わせ → S3 保存 → Discord 通知 + 自動応答（`infra/lib/ses-stack.ts`）
- **自動応答メール**: サポート問い合わせに対する自動返信（SES 受信 Lambda）

---

## 前提条件

- AWS CLI がインストール・設定済み（`aws configure` でリージョン `us-east-1` を設定）
- SES ドメイン検証が完了済み（CDK で `ganbari-quest.com` のドメイン Identity + DKIM が設定済み）
- Configuration Set `ganbari-quest-config` がデプロイ済み

## Step 0: 現在のステータス確認

まず、現在のアカウントがサンドボックスかプロダクションかを確認します。

```bash
aws ses get-account --region us-east-1
```

出力例（サンドボックスの場合）:

```json
{
    "SendQuota": {
        "Max24HourSend": 200.0,
        "MaxSendRate": 1.0,
        "SentLast24Hours": 0.0
    },
    "EnforcementStatus": "HEALTHY",
    "ProductionAccessEnabled": false
}
```

`"ProductionAccessEnabled": false` → サンドボックスモード（本番申請が必要）

> **注意**: `aws ses get-account` は SES v2 API です。旧 v1 API を使っている場合は `aws sesv2 get-account` を試してください。

---

## Step 1: AWS Console からプロダクションアクセスを申請

### 1-1: SES コンソールにアクセス

1. [AWS SES コンソール（us-east-1）](https://us-east-1.console.aws.amazon.com/ses/home?region=us-east-1#/account) を開く
2. 左メニュー → **Account dashboard** をクリック
3. 「Request production access」ボタンをクリック

### 1-2: 申請フォームに入力

| 項目 | 入力内容 |
|------|---------|
| **Mail type** | `Transactional` |
| **Website URL** | `https://ganbari-quest.com` |
| **Use case description** | 下記参照 |
| **Additional contacts** | （空欄で可） |
| **Preferred contact language** | `English` or `Japanese` |

### 1-3: Use case description（英語テンプレート）

以下をコピー＆ペーストして必要に応じて編集してください:

```
We operate "Ganbari Quest" (https://ganbari-quest.com), a family-oriented web
application that gamifies children's daily activities to motivate good habits.

Email use cases (all transactional, no marketing):
1. Account verification: confirmation code when a parent signs up (via Amazon Cognito)
2. Password reset: reset code when a parent requests password recovery (via Amazon Cognito)
3. Support auto-reply: automatic acknowledgment when a user emails support@ganbari-quest.com

Expected volume:
- Initial phase: fewer than 100 emails/day
- Growth phase: up to 1,000 emails/day

Bounce/complaint handling:
- We have configured an SES Configuration Set ("ganbari-quest-config") with
  SNS event destinations for bounces and complaints.
- Bounce and complaint notifications are sent to dedicated SNS topics for monitoring.
- We do not send to purchased or third-party mailing lists.

Infrastructure:
- Domain: ganbari-quest.com (DKIM + SPF + MAIL FROM verified via CDK)
- Sender: noreply@ganbari-quest.com
- Region: us-east-1
```

### 1-4: 申請を送信

「Submit request」をクリックして申請を完了します。

---

## Step 2: 審査の待機

- **通常の審査期間**: 24〜48 時間（最大 5 営業日）
- **進捗確認**: AWS Support Center のケースとして表示されます
- **追加質問**: AWS から追加情報を求められる場合があります。Support Center のケースに返信してください

### 審査中にできること

- サンドボックスのまま、検証済みメールアドレスで動作テストを継続
- テスト用メールアドレスの検証:
  ```bash
  aws ses verify-email-identity --email-address your-test@example.com --region us-east-1
  ```

---

## Step 3: 承認後の確認

### 3-1: CLI で確認

```bash
aws ses get-account --region us-east-1
```

期待される出力:

```json
{
    "SendQuota": {
        "Max24HourSend": 50000.0,
        "MaxSendRate": 14.0,
        "SentLast24Hours": 0.0
    },
    "EnforcementStatus": "HEALTHY",
    "ProductionAccessEnabled": true
}
```

`"ProductionAccessEnabled": true` → プロダクションモード（任意のアドレスに送信可能）

### 3-2: テスト送信

承認後、未検証のメールアドレスに送信できることを確認:

```bash
aws ses send-email \
  --from "noreply@ganbari-quest.com" \
  --destination "ToAddresses=your-real-email@example.com" \
  --message "Subject={Data='SES Production Test'},Body={Text={Data='This is a test from Ganbari Quest SES production mode.'}}" \
  --configuration-set-name ganbari-quest-config \
  --region us-east-1
```

### 3-3: Cognito 経由でのテスト

実際にアプリでユーザー登録を行い、確認コードメールが届くことを検証:

1. `https://ganbari-quest.com/auth/signup` で新規登録
2. 入力したメールアドレスに確認コードが届くことを確認
3. パスワードリセットフローも同様にテスト

---

## CDK との関係

### CDK で既に設定済みの項目（変更不要）

本プロジェクトの SES インフラは `infra/lib/ses-stack.ts` と `infra/lib/auth-stack.ts` で CDK 管理されています。プロダクションアクセス申請に必要な基盤は既にデプロイ済みです。

| 設定 | CDK リソース | ファイル |
|------|-----------|---------|
| ドメイン検証 (DKIM + SPF) | `ses.EmailIdentity` | `ses-stack.ts` |
| MAIL FROM ドメイン | `mail.ganbari-quest.com` | `ses-stack.ts` |
| Configuration Set | `ganbari-quest-config` | `ses-stack.ts` |
| バウンス通知 (SNS) | `ses-bounce-notifications` | `ses-stack.ts` |
| 苦情通知 (SNS) | `ses-complaint-notifications` | `ses-stack.ts` |
| Cognito SES 統合 | `UserPoolEmail.withSES()` | `auth-stack.ts` |
| 受信ルール | `ReceiptRuleSet` | `ses-stack.ts` |

### CDK ではできないこと

- **プロダクションアクセスの申請自体**: AWS Console / Support 経由の手動操作が必要。CDK API では制御不可
- **送信クォータの引き上げ**: AWS Service Quotas コンソールから手動申請

### 将来的な CDK 追加設定（任意）

プロダクションアクセス承認後、必要に応じて以下を `ses-stack.ts` に追加できます:

```typescript
// 例: 専用 IP プール（大量送信時のみ必要、初期段階では不要）
// const pool = new ses.DedicatedIpPool(this, 'DedicatedPool', {
//   dedicatedIpPoolName: 'ganbari-quest-pool',
// });
```

現段階では追加の CDK 変更は不要です。

---

## トラブルシューティング

### 申請が却下された場合

1. AWS Support Center でケースの却下理由を確認
2. よくある却下理由:
   - Use case の説明が不十分 → より具体的に書き直して再申請
   - バウンス/苦情の処理方法が不明確 → Configuration Set + SNS の設定を明記
   - ウェブサイトが確認できない → `https://ganbari-quest.com` がアクセス可能であることを確認
3. 却下理由に対応した上で再申請（回数制限なし）

### メールが届かない場合（承認後）

```bash
# SES 送信統計を確認
aws ses get-send-statistics --region us-east-1

# CloudWatch で SES メトリクスを確認
aws cloudwatch get-metric-statistics \
  --namespace AWS/SES \
  --metric-name Bounce \
  --start-time $(date -u -d '1 hour ago' +%Y-%m-%dT%H:%M:%S) \
  --end-time $(date -u +%Y-%m-%dT%H:%M:%S) \
  --period 300 \
  --statistics Sum \
  --region us-east-1
```

### サンドボックスに戻された場合

大量のバウンスや苦情が発生すると、AWS がアカウントをサンドボックスに戻す場合があります:

- バウンス率を **5% 未満** に維持（目標: 2% 以下）
- 苦情率を **0.1% 未満** に維持（目標: 0.05% 以下）
- SNS 通知でバウンス/苦情をリアルタイム監視

---

## チェックリスト

- [ ] `aws ses get-account` で現在のステータス確認（サンドボックス）
- [ ] AWS Console から production access 申請
- [ ] Use case description に上記テンプレートを使用
- [ ] 審査完了の通知を待つ（24〜48 時間）
- [ ] `aws ses get-account` で `ProductionAccessEnabled: true` を確認
- [ ] 未検証アドレスへのテスト送信を確認
- [ ] Cognito 経由のメール確認コード送信を確認
- [ ] `support@ganbari-quest.com` への問い合わせ自動応答を確認
