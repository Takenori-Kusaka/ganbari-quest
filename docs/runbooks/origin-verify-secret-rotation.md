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

```bash
# 現行値は GitHub Secrets からは読み出せないため、生成時に手元に控えた値、または
# Lambda コンソールの環境変数 ORIGIN_VERIFY_SECRET から取得する
aws lambda get-function-configuration --function-name ganbari-quest-app --region us-east-1 \
  --query 'Environment.Variables.ORIGIN_VERIFY_SECRET' --output text

gh secret set ORIGIN_VERIFY_SECRET_PREVIOUS --body "<いま動いている値>" \
  --repo Takenori-Kusaka/ganbari-quest
```

deploy する (`deploy.yml` を main push または `gh workflow run deploy.yml`)。

- **この段の状態**: CloudFront は旧値を送出 / Lambda は「新値 = 旧値」「旧値 = 旧値」の 2 値を受理。実質何も変わらない
- **窓が開かない理由**: 送出値も期待値も変わっていない

### 段 2 — 新値に切り替える（2 値受理が窓を吸収する）

```bash
NEW=$(node -e 'console.log(require("crypto").randomBytes(32).toString("hex"))')
gh secret set ORIGIN_VERIFY_SECRET --body "$NEW" --repo Takenori-Kusaka/ganbari-quest
# ORIGIN_VERIFY_SECRET_PREVIOUS は段 1 のまま (触らない)
```

deploy する。

- **ComputeStack 更新後 / NetworkStack 更新前**: CloudFront は**旧値**を送出 → Lambda は `PREVIOUS` として**受理** ✅
- **NetworkStack 更新後**: CloudFront は**新値**を送出 → Lambda は `SECRET` として**受理** ✅
- **窓が開かない理由**: 遷移のどの瞬間も、送出されている値は 2 候補のいずれかに必ず含まれる

**deploy 完了後、次段に進む前に伝播を確認する**:

```bash
# CloudFront 経由で /admin が 404 でないこと (未ログインなら login への redirect が正常)
curl -s -o /dev/null -w '%{http_code}\n' -L https://ganbari-quest.com/admin
# Function URL 直叩きは 404 のままであること (front door が効いている証跡)
curl -s -o /dev/null -w '%{http_code}\n' "$(aws lambda get-function-url-config \
  --function-name ganbari-quest-app --region us-east-1 --query FunctionUrl --output text)admin"
```

前者が 404、または後者が 404 以外なら **段 3 に進まず段 2 を再 deploy する** (旧値がまだ配られている / 新値が届いていない)。

### 段 3 — 旧値を落とす（受理を新値 1 本に戻す）

```bash
gh secret set ORIGIN_VERIFY_SECRET_PREVIOUS --body "" --repo Takenori-Kusaka/ganbari-quest
```

deploy する。

- **この段の状態**: CloudFront は新値を送出 / Lambda は新値のみ受理
- **窓が開かない理由**: 送出値は新値のまま変わらず、落とすのは「もう誰も送っていない旧値」だけ
- 空文字を渡すと Lambda env `ORIGIN_VERIFY_SECRET_PREVIOUS` 自体が作られない (CDK が条件付き注入する)

段 3 まで完了して**初めてローテーションが終わる**。旧値を残したまま放置すると、漏れた旧値が無効化されない = ローテーションの目的が達成されない。

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
