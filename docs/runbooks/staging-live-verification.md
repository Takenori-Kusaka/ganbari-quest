# Runbook: staging 実機検証（cognito + DSQL 経路）

> **対象**: ローカルのどの backend でも実行されない `AUTH_MODE=cognito` + DSQL 経路（課金状態の解決 / entitlement / parent-gate / 招待・メンバー）を、AWS staging（`ganbari-quest-staging-app`）で 1 回通して観測するための手順。
> **実行主体**: リリース発火 = GQ-Audit / 検証実行と証跡提出 = GQ-Dev / 秘匿値・権限の配置 = オーナー。

## 🚨 staging は全世界公開。実在のメールアドレスを登録しない

**staging の CloudFront には地域制限がない（#4204）。** post-deploy smoke を回す GitHub Actions runner が日本国外にあるため JP allowlist を外してある。したがって **Cognito に実在のメールアドレスを登録した時点で「PII を持つ全世界公開環境」が成立する。**

**sign-up には使い捨てメールだけを使う。** 許可ドメインの SSOT は `.github/workflows/deploy-aws-staging.yml` の `STAGING_ALLOWED_EMAIL_DOMAINS`（本 runbook にリストを複製しない — 複製すると必ずズレる）。

allowlist 外のドメインが登録されると、staging deploy の `Staging PII guard` が Discord の incident チャネルに通知する。**deploy は止まらない**（既に登録されたものは手遅れで、止めても意味がないため）。**気づけることが目的。**

## ⚠️ ステータス: 未実証（2026-07 時点）

**本 runbook は通しで実行されていない。** 初回実行は Issue [#4099](https://github.com/Takenori-Kusaka/ganbari-quest/issues/4099) で行う（検証主体 = オーナー（AWS SSO 対話ログインが必須）+ GQ-Audit（staging リリース発火））。

未実証の 4 項目は [§8 本 runbook が保証できない点](#8-本-runbook-が保証できない点) を参照 — psql 接続と UPDATE / staging sign-up の確認コード到達性 / staging DSQL の初期データ / Stripe 経路の不在。

初回実行で手順との齟齬が出た場合は、**本 runbook を是正してから**証跡とする。是正の結果として本ステータス見出しを撤去できることが #4099 の close 判定。

## 1. 適用範囲

**入口は CloudFront（`GanbariQuestNetworkStaging` の `DistributionDomainName`）。Function URL 直ではない。** SvelteKit の名前付き form action（`?/action`）は Lambda Function URL がクエリ文字列のスラッシュを拒否するため、CloudFront Function `ganbari-quest-staging-query-slash-encode` を通さないとログインもサインアップもできない（#4204）。

### 本 runbook で検証する

| 対象 | ローカルで実行されない理由 | staging で通る経路 |
|---|---|---|
| cognito provider（`src/lib/server/auth/providers/cognito.ts`） | `npm run dev` は `local.ts` / `dev:cognito` は `cognito-dev.ts` / demo は `anonymous.ts` を使い、`cognito.ts` を通らない | staging Lambda env `AUTH_MODE=cognito`（`infra/lib/compute-stack.ts` の `stagingEnvironment`） |
| DSQL `families` 行を読む課金・権限解決 | ローカルは sqlite / PGlite / demo stub で `families` の DSQL 行を読まない | staging Lambda env `DATA_SOURCE=dsql` + `DSQL_USER=app_user` |
| 招待 / メンバー（invites / memberships） | sqlite / demo / PGlite の 3 backend すべてで検証不可（`docs/CLAUDE.md` §「local 検証不可: invite / members (auth repo) 系 (#3732)」） | 同上 |

### 本 runbook で検証しない（staging に存在しない）

| 対象 | 根拠 |
|---|---|
| Stripe webhook / checkout の実イベント | `.github/workflows/deploy-aws-staging.yml` 冒頭「外部サービス副作用ゼロ: Stripe / Discord / Gemini / SES 系 secret は一切渡さない」。`compute-stack.ts` の `stagingEnvironment` にも Stripe 系 env は無い |
| cron / 定期ジョブ | staging は cron-dispatcher を構築しない（`compute-stack.ts`、`enableCronDispatcher=false`） |
| demo Lambda / log archiving | staging は構築しない（`infra/lib/env-config.ts` の staging 設定） |
| SES 経由のメール送信 | `infra/lib/auth-stack.ts` は非 prod で SES を構成せず Cognito default email に fallback する |

Stripe 実イベントが必要な検証は staging では原理的に再現できない。その場合は本 runbook を使わず、本番反映後の実測を証跡とする判断をオーナーに仰ぐ。

## 2. 役割分担

| 工程 | 担当 | 実行内容 | 前提 |
|---|---|---|---|
| リリース発火 | GQ-Audit | `deploy-aws-staging.yml` を `workflow_dispatch` で起動（backend の選択肢は無い、#4224） | 検証対象コミットが `develop` に入っていること（§3） |
| 検証実行・証跡提出 | GQ-Dev | DSQL 対象行の書き換え → 観測 → 原状復帰 → PR body へ貼付 | AWS credential（§6 の gap 参照） |
| 秘匿値・権限の配置 | オーナー | 検証用 Cognito アカウント / AWS 権限の可否判断 | — |

## 3. Step 1 — リリース発火（GQ-Audit）

`workflow_dispatch` の checkout ref は `develop` 固定（`deploy-aws-staging.yml` Step 1）。**検証したい修正が `develop` に merge されていなければ、staging には反映されない**。未 merge の修正を検証したい場合は、統合 PR（develop → main）を立てれば `pull_request` trigger 側で当該 PR HEAD が deploy される（この経路では DSQL lane が常時 ON）。

```bash
gh workflow run deploy-aws-staging.yml
gh run list --workflow=deploy-aws-staging.yml --limit 1
gh run watch <run-id>
```

- **actor guard**: job は `Takenori-Kusaka` / `ganbariquestsupport-lab` の 2 アカウントでのみ実行される。他アカウントで dispatch すると job 自体が skip される。
- **concurrency**: group `deploy-aws-staging` / `cancel-in-progress: true`。同時に走らせると前の run が cancel されるため、検証中は他の統合 PR と重ならない時間帯を選ぶ。
- DSQL lane では cluster deploy → `npm run dsql:migrate`（schema provisioning）→ staging 3 stack deploy → `npm run dsql:grant`（Lambda 実行 role への app_user 付与）→ health / smoke → 実 DSQL 並行検証 test の順に実行される。

## 4. Step 2 — deploy 完了確認

workflow run が緑であれば health（`/api/health`、5 回 retry）と smoke（`/` と `/switch` が 200 か 302）は既に PASS している。手元で再確認する場合:

```bash
BASE=$(aws lambda get-function-url-config --function-name ganbari-quest-staging-app \
  --region us-east-1 --query 'FunctionUrl' --output text)
BASE="${BASE%/}"
curl -s -o /dev/null -w "%{http_code}\n" "$BASE/api/health"   # 200
```

Lambda のログは `/aws/lambda/ganbari-quest-staging-app`（`compute-stack.ts` の `AppLogGroup`）:

```bash
aws logs tail /aws/lambda/ganbari-quest-staging-app --region us-east-1 --since 10m --follow
```

## 5. Step 3 — 検証用アカウント

- staging の Cognito user pool は `ganbari-quest-staging-users-v2`（`infra/lib/auth-stack.ts` の `UserPoolV2` + `env-config.ts` の `resourcePrefix`）。`selfSignUpEnabled: true` / email 検証あり / パスワードは 8 文字以上・大小英字・数字を含むこと。
- **`DEV_USERS`（`src/lib/server/auth/providers/cognito-dev.ts`）は staging に存在しない**。あれは `COGNITO_DEV_MODE` 前提のローカル専用定義で、staging Lambda env に `COGNITO_DEV_MODE` は入っていない。
- **staging DSQL には seed 配線が無い**（`docs/design/staging-synthetic-seed.md` §5「AWS staging: 構造準備済 / 配線は #2873」）。検証対象の家族データは、sign-up して自分で作ったものになる。
- サインアップ確認メールは Cognito default email 送信（SES 非構成）。届かない場合は §6 の gap に従いオーナーに依頼する。
- **検証が終わったら作成した Cognito ユーザーを削除する**（`aws cognito-idp admin-delete-user --user-pool-id <staging pool id> --username <検証用ユーザー>`）。放置すると staging に検証者の実メールアドレスが残り続ける。削除権限が無い場合はオーナーに依頼する。

## 6. Step 4 — DSQL の対象行を書き換える / 戻す

`families` 行（`src/lib/server/db/dsql/schema.ts` の `families`）を検証用の状態に変え、アプリがそれを読むかを観測する。

### 6.1 接続情報

```bash
DSQL_ENDPOINT=$(aws cloudformation describe-stacks --stack-name GanbariQuestDsqlStaging \
  --region us-east-1 --query "Stacks[0].Outputs[?OutputKey=='ClusterEndpoint'].OutputValue" --output text)
```

接続パラメータはリポジトリ内の DSQL CLI（`scripts/dsql-migrate.ts` / `scripts/dsql-grant.ts`）と同一: user = `admin`（`DbConnectAdmin` 経路、アプリ実行時の `app_user` とは分離）/ database = `postgres` / TLS 必須。パスワードには IAM 認証トークンを投入する:

```bash
aws dsql generate-db-connect-admin-auth-token --hostname "$DSQL_ENDPOINT" \
  --region us-east-1 --expires-in 3600
```

> **トークンの取扱い**: 有効期限は 3600 秒（`--expires-in` の値）。**PR body / Issue / チャットに貼らない**、シェル履歴に残さない（変数へ代入するか `HISTCONTROL=ignorespace` 下で先頭スペース付き実行）、検証完了後は変数を破棄（`unset`）してターミナルを閉じる。`aws dsql` は AWS CLI v2 の新しめのバージョンでのみ提供されるサブコマンド。`aws dsql help` が引けない場合は CLI を最新に更新してから再実行する（リポジトリ内の DSQL 経路は SDK 実装で CLI の前例が無いため、初回実行者は先に疎通を確認すること）。

> **リポジトリに任意 SQL を流す汎用 CLI は無い**（`dsql:migrate` は migration 適用、`dsql:grant` は role 付与の専用ツール）。上記トークンを外部 PostgreSQL クライアント（psql 等）のパスワードとして渡して接続する。この接続方式は `docs/research/dsql-poc-phase1-results-2026-07-05.md` の実クラスタ PoC で確認されているが、**staging cluster で本 runbook 作成時に再実行はしていない**（§8 参照）。

### 6.2 書き換え手順（必ず 5 段で行う）

`families.plan` の値は `src/lib/domain/constants/subscription-plan.ts`（`monthly` / `yearly` / `family-monthly` / `family-yearly` / `lifetime`）、`families.status` は `src/lib/domain/constants/subscription-status.ts`（`active` / `grace_period` / `suspended` / `terminated`）が SSOT。**DB が拒否するのは `status` だけ**（`families_status_ck`）で、**`plan` には CHECK が無い**（`src/lib/server/db/dsql/schema.ts` の `families` 定義コメント: plans lookup 表参照のため CHECK を張らない）。SSOT 外の plan を書いても DB は黙って受理するので、投入前に値を目視確認すること（typo を「拒否されなかった = 正しい値」と誤認すると §7 の観測結果がバグか typo か切り分けられなくなる）。

```sql
-- (1) 変更前の値を控える（この出力を PR body に貼る）
SELECT family_id, plan, status, plan_expires_at, updated_at
FROM families WHERE family_id = '<検証対象の family uuid>';

-- (2) 検証したい状態に書き換える
UPDATE families
SET plan = 'family-monthly', status = 'active', updated_at = now()
WHERE family_id = '<検証対象の family uuid>';

-- (3) → §7 の観測を実施

-- (4) 控えた値へ戻す（NULL だった列は NULL に戻す）
UPDATE families
SET plan = <控えた plan>, status = '<控えた status>', updated_at = now()
WHERE family_id = '<検証対象の family uuid>';

-- (5) 復旧確認（(1) と plan / status / plan_expires_at が一致すること）
SELECT family_id, plan, status, plan_expires_at FROM families
WHERE family_id = '<検証対象の family uuid>';
```

- 書き換えるのは**自分が sign-up して作った family の行だけ**。他の行に触らない。
- `updated_at` は復旧後も (1) とは異なる値になる。差分ゼロを確認するのは `plan` / `status` / `plan_expires_at`。
- (4) を実行せずに終わらない。次の検証者が汚れた行を掴む。

## 7. Step 5 — 観測

| 観測点 | 手順 | AC 充足と言える状態 |
|---|---|---|
| プラン表示 | staging の CloudFront URL でログイン → `/admin/subscription`（parent-gate PIN を通す） | 表示プラン / 上限が §6.2 (2) で書き込んだ値と一致する |
| 権限（entitlement） | 当該プランでのみ使える機能を 1 つ操作する | プランに応じて許可 / 拒否が切り替わる |
| サーバ側の解決 | `aws logs tail /aws/lambda/ganbari-quest-staging-app --since 10m` | 例外・fail-closed による 5xx が出ていない |

再ログインせずに反映されるかを見る検証では、**書き換え後にログアウトしない**こと（Cookie を作り直すと「毎リクエスト DB から解決しているか」を確認できなくなる）。

証跡は「(1) の SELECT 出力 → (2) の UPDATE → 観測結果（スクリーンショット / ログ）→ (5) の SELECT 出力」の順に PR body へ貼る。**本リポジトリは OSS 公開前提のため、貼付時に `family_id`（UUID）とメールアドレスをマスクする**（`family_id=<masked>` に置換するか、出力を貼らず「(1) と (5) の plan / status / plan_expires_at が一致することを確認した」と記す）。スクリーンショットに課金状態以外の識別情報が写り込んでいないかも貼る前に確認する。

## 8. 本 runbook が保証できない点

| 項目 | 状態 | 対処 |
|---|---|---|
| §6 の psql 接続と UPDATE の実行 | AWS credential（`DbConnectAdmin` 相当）が必要で、リポジトリ内からは検証できない | 実行者が初回実行時に結果を PR に記録し、齟齬があれば本 runbook を修正する |
| staging Cognito でのサインアップ完了 | SES 非構成のため確認コードの到達性が未確認 | 届かない場合はオーナーに Cognito 側でのユーザー作成を依頼する（admin 権限が必要） |
| staging DSQL の初期データ | seed 配線が未実施（`docs/design/staging-synthetic-seed.md` §5） | 検証者が sign-up してデータを作る |
| Stripe 経路 | **配線済（#4104）**。ただし webhook endpoint 登録と `STRIPE_WEBHOOK_SECRET_TEST` の登録が未完のため、実往復は未実証 | §10 の手順で endpoint を登録し、S-0〜S-5 を実施する |

## 9. Stripe test mode（#4104）

staging には **test mode の Stripe 資格情報だけ**を配備する。test mode は本番顧客・本番決済・本番 Dashboard に一切影響しない。

### 9.1 secret（GitHub Actions Secrets のみ）

| secret | 状態 | 用途 |
|---|---|---|
| `STRIPE_SECRET_KEY_TEST` | 登録済 | staging Lambda の `STRIPE_SECRET_KEY` |
| `STRIPE_WEBHOOK_SECRET_TEST` | **未登録**（§9.2 で登録） | staging webhook の署名検証 |
| `STRIPE_PRICE_*` | **不要** | `USE_LOOKUP_KEY=true` で Stripe API の lookup_key から解決するため |

### 9.2 staging webhook endpoint の登録手順（PO 作業、AC4）

**staging の URL は初回 deploy まで確定しない**ため、本手順は staging deploy 後に実施する。

> **webhook の登録先は Lambda Function URL 直。CloudFront ではない。**
>
> 画面操作の入口は CloudFront（§1）だが、**Stripe webhook だけは例外**である。Stripe の送信元は米国にあり、CloudFront の地域制限（JP）を通れないため経路を CloudFront に寄せられない。`/api/stripe/webhook` は front door header（`x-origin-verify`、#4280）の**対象外**として設計されており、保護は Stripe 署名検証（`STRIPE_WEBHOOK_SECRET`）が担う。SSOT は `docs/design/14-セキュリティ設計書.md` §11.5.1 の保護対象表。
>
> **CloudFront の URL を登録すると課金 webhook が全滅する。** 到達しないか 403 が続き、Stripe は連続失敗した endpoint を無効化する。本番・staging とも Function URL 直で登録すること。

1. staging deploy 完了後、Lambda Function URL を取得する:

```bash
aws lambda get-function-url-config --function-name ganbari-quest-staging-app   --region us-east-1 --query FunctionUrl --output text
```

2. Stripe Dashboard を **test mode** に切り替え、Developers → Webhooks → 「Add endpoint」
3. Endpoint URL に `<FunctionUrl>api/stripe/webhook` を入力（`FunctionUrl` は末尾スラッシュ付きで返る）
4. 購読 event は `docs/design/billing-redesign/` の購読 event 一覧（#3990 で整合済）に合わせる
5. 発行された signing secret を登録し、staging を再 deploy する:

```bash
gh secret set STRIPE_WEBHOOK_SECRET_TEST --body "whsec_xxxxxxxx" --repo Takenori-Kusaka/ganbari-quest
```

### 9.3 live 混入の機械強制（2 段）

| 段 | 実体 | 停止タイミング |
|---|---|---|
| 1 | `deploy-aws-staging.yml` の `Validate required secrets` | synth 前 |
| 2 | `infra/lib/compute-stack.ts` の allowlist（`sk_test_` / `rk_test_` 以外を `Annotations.addError`） | synth 時（deploy に進まない） |

**検証には実 live key を使わない。** `sk_live_` + `0` を 28 個並べた、**prefix だけが本物のダミー文字列**で確認する。判定は prefix の形にのみ依存させてあるため、ダミーで落ちる。**ダミーで落ちなければ実装の欠陥**である。

実 live key を staging env に投入する操作は行わない。万一 hard-fail が効かなかった場合、本番課金鍵が staging に配備された状態が成立し、これは不可逆である。

**守れない範囲（明示）**: webhook signing secret は test / live とも `whsec_` で prefix が同一のため、文字列から判別できない。形式検査のみで、live 判別は secret key 側の allowlist が担う。

### 9.4 検証項目 S-0〜S-5（#4104 の close 条件）

| # | 項目 | 合格条件 |
|---|---|---|
| **S-0** | test card で checkout を完了し、**webhook が実際に届き**、**DB の plan が変わり**、**`/admin/subscription` の実画面に反映が出る** | **3 つ全部**。1 つでも欠けたら不合格 |
| S-1 | Lambda env に Stripe test key が入る | `isStripeEnabled()=true` |
| S-2 | **ダミー** live prefix で deploy を試み hard-fail する | synth が error で停止（実 live key は使わない） |
| S-3 | staging webhook endpoint 登録 + 本節の手順が読める | endpoint が test mode に存在する |
| S-4 | #4081 AC6（webhook 未達時の `success_url` 救済経路） | reconciliation が `applied` を返す |
| S-5 | #4096 Q2（解約 → 期末まで利用可 → 取り消し） | 各段で契約状態が期待どおり |

**S-0 が通って初めて #4104 を close する。** S-4（救済経路）が通ることは S-0（本線）が通ることの代わりにならない。救済経路は本線が落ちたときのためのものであり、2026-07-26 に落ちたのは本線（webhook 到達）である。

## 9.5 staging Lambda の env を手で足さない（#4352）

検証のために `aws lambda update-function-configuration` で env を足すことは**しない**。足したものは deploy が success を返しても消えず（CloudFormation は out-of-band drift を戻さない）、**IaC に無い設定が効いたまま検証を通してしまう**。実際 #4286（price env が無い配備で購入が必ず 400）の検証中に手で入れた `STRIPE_PRICE_*_MONTHLY` が残存し、checkout が通っても「lookup_key 経路が直った」証拠にならない状態が続いた。

現在の staging deploy は:

- env を **CDK synth 出力から組み立てた完全な集合で全上書き**する（IaC に無いキーは書き戻されず消える。除去したキー名は run の warning に出る）
- deploy 末尾に **env キー差分検査**があり、synth 出力と live のキー集合が食い違えば **fail** する（キー名のみ出力、値は出さない）

検証に env が要るなら **`infra/lib/compute-stack.ts` に足して deploy する**。仕様 SSOT は [13-AWSサーバレスアーキテクチャ設計書 §4.3](../design/13-AWSサーバレスアーキテクチャ設計書.md)。

この検査が**見ていない**もの:

- **既知キーの値の drift**。検査対象はキー集合のみ。値まで見ないため、`USE_LOOKUP_KEY` を手で `false` に倒した等は検出しない（次の deploy の全上書きで IaC 値には戻る）
- **CFN intrinsic 由来キーの値**（`ASSETS_BUCKET` / `COGNITO_*` / `CONTEXT_TOKEN_SECRET` など）。これらはローカルで解決できないため live の値をそのまま引き継ぐ

**staging で env を倒す kill switch 運用は取れない**（`USE_LOOKUP_KEY` / `MAINTENANCE_MODE` を手で倒しても次の deploy で戻り、それまでの間は差分検査も通る）。staging で挙動を切り替えたいときは `compute-stack.ts` を変えて deploy する。本番 Lambda は本 workflow の対象外なので、本番の env kill switch は従来どおり使える。

**「次の deploy で消えるから残してよい」は残置の根拠にしない。** 消えるまでの間は効き続け、その間の検証結果が信用できなくなる（#4117 の 2026-08-05 残置決裁はこの前提に立っており、無効）。

## 10. 関連

- [docs/runbooks/staging-gate-required-checks.md](staging-gate-required-checks.md) — staging deploy gate の required 化手順
- [docs/design/staging-synthetic-seed.md](../design/staging-synthetic-seed.md) — PII-free 合成 seed の設計と配線状況
- [docs/runbooks/dsql-restore.md](dsql-restore.md) — DSQL の backup / 復元
- `.github/workflows/deploy-aws-staging.yml` / `infra/lib/compute-stack.ts` / `infra/lib/auth-stack.ts` / `infra/lib/env-config.ts`
- Issue #2873（AWS staging stack）/ #3732（invite / members の local 検証不可）/ #4099（本 runbook の初回実行と gap 4 項目の確定）/ #4104（staging Stripe test mode）/ #4117（EPIC E1）
