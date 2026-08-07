# CloudWatch アラートの通知運用（Discord）

| 項目 | 内容 |
|---|---|
| SSOT 対象 | どの alarm を Discord に出すか / 鳴りすぎたときの対処手順 |
| 方針表 | `infra/lib/ops-alert-policy.ts` |
| 転送実装 | `infra/lambda/ops-alert-forwarder/index.ts` |
| 関連 Issue | #4189（オーナー決裁 2026-08-03、案 B）/ #4174 / #4119 |

---

## 1. 設計背景

### 課題

本番の CloudWatch アラームは **宛先が 0 件**だった（SNS topic に subscription が無く、鳴っても誰にも届かない）。同型の欠陥が #4119（NUC バックアップが 18 晩失敗しても通知 0 通）/ #4174（Lambda incident 通知 0 通）でも起きている。

### この運用がないと何が困るか

宛先を繋ぐだけだと、今度は**逆の失敗**が起きる。平常時から鳴り続ける alarm を放置すると通知が捌けなくなり、**本物の障害が同じ見た目で埋もれる**。

一方で、鳴りすぎを「通知を止める」で処理すると**監視が消える**。守るべきは通知の総量が捌ける状態であって、通知そのものではない。鳴りすぎたら原因を直す。

---

## 2. 設計原則

**既定は「届ける」。alarm を足したら Discord に出る。**

| 状態 | CloudWatch | Discord |
|---|---|---|
| `notify: true`（既定） | alarm として存在し、コンソール / メトリクスで見える | 出す |
| `notify: false`（例外） | 同上 | **出さない**（転送 Lambda の log に「抑止した」と残る） |

**鳴りすぎたときの対処は、上から順に試す。**

1. **例外処理・早期回復を直す** — そもそも鳴らなくする
2. **閾値 / 評価期間を調整する** — 何を異常と呼ぶかの定義を直す（例: `evaluationPeriods` 2 + `datapointsToAlarm` 2 で単発スパイクを除く）
3. **1・2 の作業が進行中の間だけ `notify: false` にする** — §3

**未宣言の alarm は「出す」に倒れる。** 宣言漏れは CI（no-silent-gap test）が止める前提で、runtime まで漏れたものを黙って捨てない。

**staging には alarm を作らない。** stg のノイズが本番と同じ経路で流れると、本番の異常が埋もれる。staging に監視を入れる場合は **別 topic / 別 webhook** にする。

---

## 3. 暫定的に抑止する（`notify: true` → `false`）

**恒常発火していて、その原因を直す作業が進行中の場合に限る。**「ノイズが多そう」「実績が無い」は理由にならない。

1. **実際に何回鳴っているかを見る**
   ```bash
   aws cloudwatch describe-alarm-history \
     --alarm-name <alarm 名> --history-item-type StateUpdate \
     --start-date "$(date -u -d '30 days ago' +%Y-%m-%dT%H:%M:%SZ)" \
     --region us-east-1 --query 'AlarmHistoryItems[].Timestamp'
   ```

2. **是正作業を始める** — 早期回復 / 例外処理の是正、または閾値の調整。抑止はその作業が終わるまでの暫定措置であり、直す当てが無ければ抑止しない

   参照先は **Issue でも PR でも構わない**。GitHub の番号空間は Issue と PR で共通で、`#NNNN` で直している作業を辿れれば目的を満たす。**この gate を通すためだけに Issue を起票しない**（チーム憲章 §0 ルール 7: 装置の改善は Issue にしない）。閾値調整のようにその場の PR で直しきるなら、その PR 番号を書けばよい

3. **`infra/lib/ops-alert-policy.ts` を書き換える**
   ```ts
   'ganbari-quest-lambda-url-4xx-spike': {
     notify: false,
     reason: '2026-09 の 30 日間で 41 回発火（bot 由来）。閾値の見直しを #9999 で進めている',
   },
   ```
   **`reason` には (a) 何がどれくらいの頻度で鳴っているか (b) どこで直しているか を書く。** 是正作業の参照 (`#NNNN`、Issue / PR いずれでも可) が無い `notify: false` は CI が弾く。空 / 定型 stub / 極端な短文も同様

4. **PR を出して deploy する。** 転送 Lambda に方針表が bundle されるため、**deploy しないと反映されない**

## 4. 抑止を解く（`notify: false` → `true`）

**是正作業が終わったら戻す。** 抑止に出口がないと「暫定」が恒久化する。手順は §3 と同じで、`reason` を「その alarm が鳴いたとき人が何を知ることになるか」に書き換える。

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
