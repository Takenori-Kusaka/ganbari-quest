# Runbook: front door secret (`ORIGIN_VERIFY_SECRET`) のローテーション

CloudFront → origin の共有シークレット (`x-origin-verify`) を **顧客を落とさずに** 差し替える手順。

| 項目 | 値 |
|---|---|
| 対象 | AWS 本番 (`ganbari-quest.com`) / AWS staging。**NUC には配布しないため対象外** |
| 影響しうる画面 | `/admin` ・ `/api/v1/admin` ・ `/ops` (front door 保護対象。仕様は [14-セキュリティ設計書 §11.5.1](../design/14-セキュリティ設計書.md)) |
| 所要 | 3 段 × deploy 完了待ち (CloudFront distribution の Deployed まで数分) |
| 実行者 | オーナー (`gh secret set` と本番 deploy を伴う) |

---

## 1. なぜ 1 回の差し替えでは駄目か

secret は **2 つの stack** に配られる。

| 配布先 | stack | 実体 |
|---|---|---|
| CloudFront が送出する header 値 | `NetworkStack` | `infra/lib/network-stack.ts` の `OriginCustomHeader` |
| origin (Lambda) が期待する値 | `ComputeStack` | Lambda env `ORIGIN_VERIFY_SECRET` |

`NetworkStack` は `ComputeStack` の Function URL に依存するため、`cdk deploy --all` は **Compute → Network の順** に走る。値を 1 本だけ差し替えると:

1. ComputeStack が更新される → Lambda は **新値** を期待する
2. CloudFront はまだ **旧値** を送っている (distribution が Deployed になるまで数分)
3. その間、保護対象 3 prefix は **全顧客で 404**

順序を入れ替えても対称に窓が開く (CloudFront が新値を送り始めた時点で Lambda はまだ旧値を期待する)。**どちらの順序でも 1 値受理では窓は閉じない。**

そこで origin 側が **新旧 2 値を並行受理** する (`ORIGIN_VERIFY_SECRET_PREVIOUS`、#4364)。旧値を受理している間に header を差し替え、伝播が終わってから旧値を落とす。

---

## 2. 手順 (3 段。どの段でも窓が開かない)

### 前提確認

```bash
# 2 値受理が deploy 済みであること (未 deploy ならローテーション禁止)
gh api repos/Takenori-Kusaka/ganbari-quest/contents/src/lib/server/security/origin-verify.ts \
  --jq '.content' | base64 -d | grep -c countMatchingSecrets    # 1 以上なら OK
```

`0` なら **ローテーションしてはならない**。origin が単一値受理のままであり、値を変えた瞬間に `/admin` が落ちる。

### 段 1 — 旧値を「並行受理」に載せる（header はまだ変えない）

現行値を `ORIGIN_VERIFY_SECRET_PREVIOUS` に **コピー** する。この段では `ORIGIN_VERIFY_SECRET` を触らない。

**秘密値を端末に残さない**: `gh secret set` に `--body` を使うと値がシェル履歴・スクロールバック・画面共有に残る。`--body` を付けずに実行すると gh が非表示プロンプトで受け取る。現行値の取得も、標準出力に出さずファイル経由でつなぐ。

```bash
# 現行値は GitHub Secrets からは読み出せない。Lambda の環境変数から取り出す。
# 画面に出さないよう 0600 の一時ファイルに落とし、使い終わったら必ず消す。
umask 077
aws lambda get-function-configuration --function-name ganbari-quest-app --region us-east-1 \
  --query 'Environment.Variables.ORIGIN_VERIFY_SECRET' --output text > /tmp/ov-current

gh secret set ORIGIN_VERIFY_SECRET_PREVIOUS --repo Takenori-Kusaka/ganbari-quest < /tmp/ov-current
shred -u /tmp/ov-current 2>/dev/null || rm -f /tmp/ov-current
```

生成時に手元に控えた値があるなら、`gh secret set ORIGIN_VERIFY_SECRET_PREVIOUS --repo …` を `--body` 無しで実行してプロンプトに貼るだけでよい。

deploy する (`deploy.yml` を main push または `gh workflow run deploy.yml`)。

- **この段の状態**: CloudFront は旧値を送出 / Lambda は「新値 = 旧値」「旧値 = 旧値」の 2 値を受理。実質何も変わらない
- **窓が開かない理由**: 送出値も期待値も変わっていない

### 段 2 — 新値に切り替える（2 値受理が窓を吸収する）

```bash
umask 077
node -e 'console.log(require("crypto").randomBytes(32).toString("hex"))' > /tmp/ov-new
gh secret set ORIGIN_VERIFY_SECRET --repo Takenori-Kusaka/ganbari-quest < /tmp/ov-new
shred -u /tmp/ov-new 2>/dev/null || rm -f /tmp/ov-new
# ORIGIN_VERIFY_SECRET_PREVIOUS は段 1 のまま (触らない)
```

deploy する。

- **ComputeStack 更新後 / NetworkStack 更新前**: CloudFront は**旧値**を送出 → Lambda は `PREVIOUS` として**受理** ✅
- **NetworkStack 更新後**: CloudFront は**新値**を送出 → Lambda は `SECRET` として**受理** ✅
- **窓が開かない理由**: 遷移のどの瞬間も、送出されている値は 2 候補のいずれかに必ず含まれる

**deploy 完了後、次段に進む前に伝播を確認する**:

```bash
# (a) CloudFront 経由で /admin が front door を通ること。
#     **-L を付けない**: redirect を追うと login ページの 200 を拾ってしまい、front door を
#     通過していなくても成功に見える。404 でないこと (302 or 200) を直接見る。
curl -s -o /dev/null -w 'admin=%{http_code}\n' https://ganbari-quest.com/admin

# (b) Function URL 直叩きは 404 のままであること (front door が効いている証跡)
curl -s -o /dev/null -w 'direct=%{http_code}\n' "$(aws lambda get-function-url-config \
  --function-name ganbari-quest-app --region us-east-1 --query FunctionUrl --output text)admin"
```

(a) が 404、または (b) が 404 以外なら **段 3 に進まず段 2 を再 deploy する** (旧値がまだ配られている / 新値が届いていない)。

**単発 curl は「自分の POP」しか見ていない**: CloudFront の設定伝播は POP 単位で進むため、実行者の 1 拠点で (a) が通っても別地域の顧客にはまだ旧値が送られていることがある。2 値受理中はどちらでも通るので実害は出ないが、**段 3 に進む判断はこの curl だけを根拠にしない**。CloudFormation で NetworkStack の update が `UPDATE_COMPLETE` になっている (= distribution が Deployed) ことを併せて確認する:

```bash
aws cloudformation describe-stacks --stack-name GanbariQuestNetwork --region us-east-1 \
  --query 'Stacks[0].StackStatus' --output text   # UPDATE_COMPLETE を確認
```

### 段 3 — 旧値を落とす（受理を新値 1 本に戻す）

```bash
gh secret set ORIGIN_VERIFY_SECRET_PREVIOUS --body "" --repo Takenori-Kusaka/ganbari-quest
```

deploy する。

- **この段の状態**: CloudFront は新値を送出 / Lambda は新値のみ受理
- **窓が開かない理由**: 送出値は新値のまま変わらず、落とすのは「もう誰も送っていない旧値」だけ
- 空文字を渡すと Lambda env `ORIGIN_VERIFY_SECRET_PREVIOUS` 自体が作られない (CDK が条件付き注入する)

段 3 まで完了して**初めてローテーションが終わる**。旧値には TTL も有効期限も無いため、**残したまま放置すると漏れた旧値が無期限に有効なまま** = ローテーションの目的が達成されない。

**残置の検知**: 旧値が配られている間、アプリは起動後 1 回だけ以下の warn を出す。CloudWatch Logs でこれが出続けている = 段 3 が未実施である。

```
[front-door] ORIGIN_VERIFY_SECRET_PREVIOUS が設定されています = 旧 secret を並行受理中 …
```

```bash
aws logs filter-log-events --log-group-name /aws/lambda/ganbari-quest-app --region us-east-1 \
  --start-time $(( ($(date +%s) - 86400) * 1000 )) \
  --filter-pattern 'ORIGIN_VERIFY_SECRET_PREVIOUS' --query 'events[].message' --output text
```

段 3 の deploy 後にこの log が出なくなることを確認して完了とする。

---

## 3. 失敗時

| 症状 | 原因 | 対処 |
|---|---|---|
| deploy 中に `originVerifySecretPrevious` が短すぎる旨の synth エラー | 旧値を加工して渡した / 部分コピー | 旧値を**そのまま**設定し直す。32 文字未満は黙って捨てず throw する仕様 (silent skip 禁止) |
| 段 2 後に `/admin` が 404 | 段 1 を飛ばした / 段 1 の deploy が未完了のまま段 2 に進んだ | `ORIGIN_VERIFY_SECRET_PREVIOUS` に**旧値**を入れて即 deploy する (段 1 に戻す)。復旧は deploy 完了で自動 |
| 段 2 後も Function URL 直叩きが 200 | Lambda env に secret が届いていない | `deploy.yml` の `Validate required secrets` と post-deploy の front door smoke を確認する。secret 未登録なら fail-open している |
| どの値が現役か分からなくなった | 手元に控えがない | Lambda の環境変数を読む (上記 §段 1 のコマンド)。GitHub Secrets からは読めない |

**緊急時の最終手段**: `ORIGIN_VERIFY_SECRET_PREVIOUS` に「CloudFront がいま送っている値」を入れて deploy すれば、必ず受理される状態に戻せる。CloudFront が送っている値は `NetworkStack` の直近 deploy 時の `ORIGIN_VERIFY_SECRET` であり、CloudFormation の distribution 設定で確認できる。

---

## 4. 未了 (この runbook の範囲外)

- **Secrets Manager への移設 / 自動生成**: AWS 公式は本方式の header 値をランダム自動生成し定期ローテーションすることを推奨する。現状は人が `gh secret set` する運用
- **自動ローテーション**: 上記 3 段を rotation Lambda で無人化する。移設だけでは無人化しない (CFN の dynamic reference は stack update 無しでは新値を取りに行かない)
- **ローテーション頻度の決定**: AWS 参照実装の既定は 1 日。本アプリでは未決定
- **旧値の TTL / 残置の自動失効**: `ORIGIN_VERIFY_SECRET_PREVIOUS` に期限は無く、段 3 を忘れれば無期限に有効。検知は上記の CloudWatch log 1 本のみで、**alarm も自動失効も無い**。自動ローテーション実装時に「pending は N 時間で失効」を同時に入れる
- **front door 無効化の常時監視**: secret 誤設定で検査が fail-open に落ちても、気付けるのはプロセス 1 回の log だけ。Function URL 直叩きが 404 のままであることを継続監視する仕組みは無い (deploy 直後の smoke のみ)
