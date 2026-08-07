# CloudWatch アラートの通知運用（Discord）

| 項目 | 内容 |
|---|---|
| SSOT 対象 | どの alarm を Discord に出すか / 昇格・降格の手順 |
| 方針表 | `infra/lib/ops-alert-policy.ts` |
| 転送実装 | `infra/lambda/ops-alert-forwarder/index.ts` |
| 関連 Issue | #4189（オーナー決裁 2026-08-03、案 B）/ #4174 / #4119 |

---

## 1. 設計背景

### 課題

本番の CloudWatch アラームは **宛先が 0 件**だった（SNS topic に subscription が無く、鳴っても誰にも届かない）。同型の欠陥が #4119（NUC バックアップが 18 晩失敗しても通知 0 通）/ #4174（Lambda incident 通知 0 通）でも起きている。

### この運用がないと何が困るか

宛先を繋ぐだけだと、今度は**逆の失敗**が起きる。閾値の妥当性を検証していない alarm を一斉に鳴らすと、平常時から通知が流れ続け、**本物の障害が同じ見た目で埋もれる**。「アラートが常態化していると見逃しかねない」（オーナー、2026-08-03）。

---

## 2. 設計原則

**通知は opt-in。既定は鳴らさない。**

| 状態 | CloudWatch | Discord |
|---|---|---|
| `notify: false`（既定） | alarm として存在し、コンソール / メトリクスで見える | **出さない**（転送 Lambda の log に「抑止した」と残る） |
| `notify: true` | 同上 | 出す |

**`notify: true` に上げてよいのは、その alarm が「実際に鳴って有効だった」実績が付いたときだけ。** 実績は `reason` に書く（いつ・何を検知したか）。

**staging には alarm を作らない。** stg のノイズが本番と同じ経路で流れると、本番の異常が埋もれる。staging に監視を入れる場合は **別 topic / 別 webhook** にする。

---

## 3. 昇格の手順（`notify: false` → `true`）

1. **平常時の発火回数を見る**
   ```bash
   aws cloudwatch describe-alarm-history \
     --alarm-name <alarm 名> --history-item-type StateUpdate \
     --start-date "$(date -u -d '30 days ago' +%Y-%m-%dT%H:%M:%SZ)" \
     --region us-east-1 --query 'AlarmHistoryItems[].Timestamp'
   ```
   **平常時に鳴っているなら昇格しない。** 先に閾値を直す（それが「効果的」ということ）。

2. **`infra/lib/ops-alert-policy.ts` を書き換える**
   ```ts
   'ganbari-quest-lambda-url-5xx': {
     notify: true,
     reason: '2026-09-12 の Lambda 障害で 1 回だけ発火し、平常 30 日間の発火 0 件を確認済み',
   },
   ```
   **`reason` に「いつ・何を検知したか」を書く。** 空 / 定型 stub / 極端な短文は CI が弾く。

3. **`tests/unit/infra/ops-alert-policy.test.ts` の allow-list assertion を更新する**

   `notify: true` の alarm 名の集合を完全一致で固定している。昇格したら期待値に alarm 名を足す。**assertion を消さない / 部分一致に緩めない**（どちらも次の昇格・降格が無検証で通る）。

4. **PR を出して deploy する。** 転送 Lambda に方針表が bundle されるため、**deploy しないと反映されない**。

## 4. 降格の手順（`notify: true` → `false`）

鳴りすぎて見なくなったら**降格させる**。放置して「見ない通知」を増やすより良い。手順は昇格と同じで、`reason` に「いつ・何回鳴って実用にならなかったか」を書く。

---

## 5. 宛先が壊れていないかの確認

deploy のたびに `.github/workflows/deploy.yml` の **"Ops alarm destination verification"** が実物を 2 点見る。

1. SNS topic `ganbari-quest-ops-alerts` に **lambda subscription が 1 件以上**
2. **転送 Lambda の実 env** に `DISCORD_WEBHOOK_INCIDENT`

どちらも欠けていれば deploy を止める。手で確認する場合:

```bash
TOPIC_ARN=$(aws sns list-topics --region us-east-1 \
  --query "Topics[?ends_with(TopicArn, ':ganbari-quest-ops-alerts')].TopicArn | [0]" --output text)
aws sns list-subscriptions-by-topic --topic-arn "$TOPIC_ARN" --region us-east-1 \
  --query 'Subscriptions[].{Protocol:Protocol,Endpoint:Endpoint}'

aws lambda get-function-configuration \
  --function-name ganbari-quest-ops-alert-forwarder --region us-east-1 \
  --query 'keys(Environment.Variables)'
```

## 6. 通知が来ないときの切り分け

| 症状 | 見る場所 |
|---|---|
| alarm は ALARM だが Discord に出ない | 転送 Lambda の log。`suppressed alarm=...` があれば **仕様どおり抑止**（方針表が `notify: false`） |
| log に `DISCORD_WEBHOOK_INCIDENT が未設定` | secret が未登録。deploy gate をすり抜けている（gate 自体を疑う） |
| log が 1 行も無い | SNS subscription が無い。上記 §5 を確認 |

**「通知が来ない」と「抑止した」は log で区別できる。** 転送 Lambda は抑止したことも必ず残す。

---

## 7. 環境変数

| env | 用途 |
|---|---|
| `DISCORD_WEBHOOK_INCIDENT` | **本 runbook の対象**。CloudWatch アラーム + アプリ Lambda の incident |
| `DISCORD_WEBHOOK_HEALTH` | ヘルスチェック Lambda（1 時間毎の外形監視） |
| `DISCORD_WEBHOOK_SUPPORT` | 問い合わせ受信 |
| `DISCORD_ALERT_WEBHOOK_URL` | NUC セルフホスト側（バックアップ失敗等）。`.env` に置く |

`opsEmail` は **本 topic では使わない**。AWS Budgets が EMAIL 固定の仕様のため、DsqlStack のコスト通知にのみ残る。
