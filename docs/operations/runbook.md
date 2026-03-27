# がんばりクエスト 障害対応ランブック

## Level 1: アラート受信（自動）

1. メール確認（CloudWatch Alarms / AWS Health / Cost Anomaly）
2. UptimeRobot のダウン通知を確認

## Level 2: 状況判断（5分以内）

1. CloudWatch Dashboard で状況確認
   - URL: `https://us-east-1.console.aws.amazon.com/cloudwatch/home?region=us-east-1#dashboards:name=ganbari-quest-ops`
2. 障害の種別を判断:
   - A: Lambda エラー → Level 3A
   - B: AWS 障害 → Level 3B
   - C: DDoS/異常トラフィック → Level 3C

## Level 3A: Lambda エラー対応

1. CloudWatch Logs でエラー内容確認
   ```bash
   aws logs tail /aws/lambda/ganbari-quest-app --since 30m --format short
   ```
2. 直近デプロイが原因か判断（`gh run list` で確認）
3. Yes → ロールバック
   ```bash
   # 直前のイメージに戻す
   aws lambda update-function-code \
     --function-name ganbari-quest-app \
     --image-uri <前バージョンのECR URI>
   ```
4. No → コード修正 → main push → 自動デプロイ

## Level 3B: AWS 障害対応

1. AWS Health Dashboard で影響範囲確認
   - https://health.aws.amazon.com/health/status
2. メンテナンスモード ON
   ```bash
   aws lambda update-function-configuration \
     --function-name ganbari-quest-app \
     --environment "Variables={MAINTENANCE_MODE=true,...既存の環境変数}"
   ```
   ※ CloudFront が 503 → S3 のメンテナンスページに差し替え
3. AWS の復旧を待つ
4. 復旧後、メンテナンスモード OFF
   ```bash
   aws lambda update-function-configuration \
     --function-name ganbari-quest-app \
     --environment "Variables={MAINTENANCE_MODE=false,...既存の環境変数}"
   ```
5. ヘルスチェック確認
   ```bash
   curl -s https://ganbari-quest.com/api/health | jq .
   ```

## Level 3C: DDoS/異常トラフィック対応

1. CloudFront メトリクスでリクエスト数を確認
2. Lambda 同時実行数アラーム (>50) の確認
3. 必要に応じ Lambda の予約済み同時実行数を制限
   ```bash
   aws lambda put-function-concurrency \
     --function-name ganbari-quest-app \
     --reserved-concurrent-executions 10
   ```
4. Budget アラートで課金状況確認
5. 原因特定後、制限を解除

## メンテナンスモード操作

### 開始

```bash
# Lambda 環境変数で MAINTENANCE_MODE=true に設定
# → 全リクエスト（/api/health 除く）が 503 を返す
# → CloudFront が 503 を検知し S3 のメンテページ（/error/503.html）を表示
aws lambda update-function-configuration \
  --function-name ganbari-quest-app \
  --environment "Variables={MAINTENANCE_MODE=true,...}"
```

### 終了

```bash
aws lambda update-function-configuration \
  --function-name ganbari-quest-app \
  --environment "Variables={MAINTENANCE_MODE=false,...}"

# 確認
curl -s https://ganbari-quest.com/api/health | jq .
```

## 連絡先・リソース

| リソース | URL/情報 |
|----------|----------|
| CloudWatch Dashboard | `ganbari-quest-ops` |
| AWS Health | https://health.aws.amazon.com/health/status |
| GitHub Actions | `gh run list` |
| Lambda Function | `ganbari-quest-app` (us-east-1) |
| DynamoDB Table | `ganbari-quest` (us-east-1) |
| CloudFront | Distribution ID は `aws cloudfront list-distributions` で確認 |
