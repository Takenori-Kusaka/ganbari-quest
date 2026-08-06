import * as path from 'node:path';
import * as cdk from 'aws-cdk-lib';
import type * as ecr from 'aws-cdk-lib/aws-ecr';
import * as events from 'aws-cdk-lib/aws-events';
import * as eventsTargets from 'aws-cdk-lib/aws-events-targets';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as firehose from 'aws-cdk-lib/aws-kinesisfirehose';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambdaNode from 'aws-cdk-lib/aws-lambda-nodejs';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as logsDestinations from 'aws-cdk-lib/aws-logs-destinations';
import type * as s3 from 'aws-cdk-lib/aws-s3';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import type { Construct } from 'constructs';
import { type GqEnvConfig, PROD_ENV_CONFIG } from './env-config';

// SSOT: src/lib/server/cron/schedule-registry.ts
// CDK tsconfig rootDir は infra/ 固定のため、utcCronExpression + name のみインライン定義する。
// Lambda (cron-dispatcher/index.ts) は esbuild バンドル経由で schedule-registry.ts を直接 import する。
const CRON_JOBS = [
	// Epic #2525 Phase 7 PR-L3 (#2818): license key 全廃に伴い `license-expire` EventBridge Rule を撤去
	// (CronRuleLicenseExpire)。期限管理は customer.subscription.deleted webhook に代替。
	{ name: 'retention-cleanup', utcCronExpression: 'cron(0 16 * * ? *)' },
	{ name: 'trial-notifications', utcCronExpression: 'cron(0 0 * * ? *)' },
	// #1601 (ADR-0023 §5 I11): 期限切れ前リマインド + 休眠復帰メール
	{ name: 'lifecycle-emails', utcCronExpression: 'cron(30 0 * * ? *)' },
	// #1598 (ADR-0023 §5 I7): PMF 判定アンケート (Sean Ellis Test) 年 2 回配信
	{ name: 'pmf-survey', utcCronExpression: 'cron(0 0 1 6,12 ? *)' },
	// #3504: クラウドエクスポート非同期 build バッチ (5 分毎)
	{ name: 'export-build', utcCronExpression: 'cron(0/5 * * * ? *)' },
	// #3959: Stripe webhook 未達 (沈黙) の検知バッチ (毎時)
	{ name: 'stripe-webhook-delivery-check', utcCronExpression: 'cron(5 * * * ? *)' },
] as const;

export interface ComputeStackProps extends cdk.StackProps {
	assetsBucket: s3.Bucket;
	repository: ecr.Repository;
	/**
	 * 環境設定 (#2873)。未指定時は PROD_ENV_CONFIG (現行 prod 値) — prod template 不変条件。
	 * staging は prefix 分離 + demo Lambda / cron-dispatcher / log archiving 省略 +
	 * 外部サービス env (Stripe / Discord / Gemini / SES) 非注入で構築する。
	 */
	envConfig?: GqEnvConfig;
}

export class ComputeStack extends cdk.Stack {
	public readonly fn: lambda.Function;
	public readonly functionUrl: lambda.FunctionUrl;
	/**
	 * アプリ Lambda の CloudWatch LogGroup (#3998)。
	 *
	 * OpsStack が log 由来 MetricFilter (例外にならず 503 応答として表面化する fail-closed 等、
	 * Lambda / CloudFront の既定 metric に乗らない事象) を張るために公開する。
	 * `fn.logGroup` の暗黙解決に頼ると「名前が一致しているつもりの別 LogGroup」に filter を
	 * 張っても誰も気付けないため、実体を明示的に受け渡す。
	 */
	public readonly appLogGroup: logs.LogGroup;
	/** cron-dispatcher (#1376)。enableCronDispatcher=false (staging) では未構築 */
	public readonly cronDispatcherFn?: lambda.Function;

	// --- ADR-0048 Multi-Lambda Demo (#2097 week 4) ---
	// demo Fn / FunctionUrl / IAM role を本番と完全分離する。
	// (Provisioned Concurrency は AWS アカウントの Lambda concurrent execution quota
	//  不足で割り当て不可、かつ予算制約のため本構成では未採用。cold start ~1-2s で運用)
	// IAM role には CloudWatch Logs write (`AWSLambdaBasicExecutionRole`) のみを付与し、
	// DynamoDB / Cognito / Secrets Manager / SES / S3 へのアクセスは付与しない。
	// 検証: tests/unit/infra/multi-lambda-cdk.test.ts (C-1 IAM isolation regression test)
	// enableDemoLambda=false (staging) では未構築 (#2873)。
	// buildDemoLambda() (constructor 外) で代入するため readonly を外している。
	public demoFn?: lambda.Function;
	public demoFunctionUrl?: lambda.FunctionUrl;
	public demoLambdaRole?: iam.Role;

	constructor(scope: Construct, id: string, props: ComputeStackProps) {
		super(scope, id, props);

		const cfg = props.envConfig ?? PROD_ENV_CONFIG;
		const prefix = cfg.resourcePrefix;
		const isProd = cfg.envName === 'prod';

		// --- CloudWatch Log Group ---
		// retention 30 日 SSOT (Issue #2735 / QA Adversarial security 軸 follow-up、Phase 7 PR-3b prerequisite):
		//   本 AppLogGroup は Stripe webhook handler / checkout / getPriceId fallback 経路の
		//   structured log を受ける課金 path 系統。post-mortem (`docs/operations/stripe-post-mortem-runbook.md`)
		//   で CloudWatch Logs Insights query `filter service = "stripe" and context.kind = "stripe-lookup-failed"`
		//   を 30 日以内に実行可能とする必要がある (Pre-PMF Bucket A、ADR-0010 整合、compliance + post-mortem)。
		//   その他の非課金 LogGroup (cron-dispatcher / demo / health-check) は 3-day retention を維持。
		const logGroup = new logs.LogGroup(this, 'AppLogGroup', {
			logGroupName: `/aws/lambda/${prefix}-app`,
			retention: logs.RetentionDays.ONE_MONTH, // 30 日、課金 path post-mortem SSOT
			removalPolicy: cdk.RemovalPolicy.DESTROY,
		});
		this.appLogGroup = logGroup;

		// --- Cognito 設定を SSM から取得（cross-stack export を回避） ---
		// staging (#2873) は ssmPrefix='/ganbari-quest-staging' の staging 専用 param を参照する。
		const cognitoUserPoolId = ssm.StringParameter.valueForStringParameter(
			this,
			`${cfg.ssmPrefix}/cognito/user-pool-id`,
		);
		const cognitoClientId = ssm.StringParameter.valueForStringParameter(
			this,
			`${cfg.ssmPrefix}/cognito/client-id`,
		);
		// Cognito Hosted UI ドメイン（prod: Google OAuth 有効時に auth-stack が SSM に書き込む /
		// staging: auth-stack が default domain 値を必ず書き込む — #2873）
		const cognitoDomain = ssm.StringParameter.valueForStringParameter(
			this,
			`${cfg.ssmPrefix}/cognito/domain`,
		);
		// staging の context-token-secret は deploy-aws-staging.yml が冪等 put する (PO 手作業なし)
		const contextTokenSecret = ssm.StringParameter.valueForStringParameter(
			this,
			`${cfg.ssmPrefix}/context-token-secret`,
		);

		// --- Gemini API Key（SSM から取得、未設定時はフォールバック動作） ---
		const geminiApiKey = this.node.tryGetContext('geminiApiKey') ?? '';

		// --- Stripe 設定（CDK context 経由で GitHub Actions Secrets から取得） ---
		const stripeSecretKey = this.node.tryGetContext('stripeSecretKey') ?? '';
		const stripeWebhookSecret = this.node.tryGetContext('stripeWebhookSecret') ?? '';

		// 逆方向 (本番に test key が入る) の allowlist (#4104 PO 指摘 2026-07-31)。
		// staging に live が入る事故は「live webhook secret を入れる」+「Stripe を live mode に切り替えて
		// staging の endpoint を登録する」の二重の誤操作を要し、単体では副作用が起きない。
		// これに対し **本番に test key が入る事故は単体で成立し、しかも無通知**である —
		// 顧客の決済がすべて test mode に流れ、顧客は払ったつもりで実際には 1 円も入らない
		// (2026-07-26 の webhook 未達と同じ「誰も気づかないまま課金が成立しない」型)。
		// 実害が大きいのはこちらのため、prod 側も同じ allowlist 形で止める。
		// denylist (`sk_test_` を弾く) にしないのは staging 側と同じ理由で、将来 Stripe が prefix を
		// 増やしたときに黙って通るため。既知の live prefix 以外を落とす。
		if (stripeSecretKey && !/^(sk|rk)_live_/.test(stripeSecretKey)) {
			cdk.Annotations.of(this).addError(
				'[ComputeStack] stripeSecretKey が live mode の key ではありません (#4104)。' +
					'本番には `sk_live_` / `rk_live_` で始まる key のみ配備できます。' +
					'test key を本番に配備すると顧客の決済が test mode に流れ、' +
					'決済成功に見えたまま入金されない状態が無通知で成立するため synth を停止します。',
			);
		}
		// #2719 (Phase 7 PR-3b prerequisite): yearly 4 種 + legacy `stripePriceMonthly` /
		// `stripePriceYearly` は物理削除済。monthly 2 種のみ Lambda env に inject する。
		// 過去 yearly 契約者の MRR 表示は `stripe-metrics-service.ts` の `HISTORICAL_YEARLY_AMOUNTS`
		// fallback で継続計算 (SSOT: docs/design/billing-redesign/phase7-staging-validation-protocol.md)。
		const stripePriceStandardMonthly = this.node.tryGetContext('stripePriceStandardMonthly') ?? '';
		const stripePriceFamilyMonthly = this.node.tryGetContext('stripePriceFamilyMonthly') ?? '';

		// --- lookup_key 関連 env (#2721 / #2716) ---
		// 参照 SSOT:
		//   - docs/design/billing-redesign/phase6-context-decisions-6.md §4 lookup_key 段階移行
		//
		// useLookupKey: default 'true' で Production cutover を反映する。
		//   - lookup_key (`standard_monthly` / `premium_monthly`) 経由 Price ID 解決
		//   - Stripe API 障害時は env var `STRIPE_PRICE_*` fallback (kill switch、isLookupKeyEnabled())
		//
		// webhook shadow mode 関連の 2 env は #4128 で撤去した。受信口を 1 本
		// (`/api/stripe/webhook`) に確定し、「署名検証だけして 200 を返す」経路を無くしたため。
		const useLookupKey = this.node.tryGetContext('useLookupKey') ?? 'true';

		// --- Cron Endpoint Bearer Secret (#820 PR-D / ADR-0033) ---
		// /api/cron/retention-cleanup の Bearer 認証に使用。
		// /ops ダッシュボードは Cognito ops group 認可に移行したため、この鍵は共有しない。
		// 後方互換: 既存 GitHub Secret `OPS_SECRET_KEY` を cronSecret context として渡す運用が続く間は、
		// CDK でも OPS_SECRET_KEY / CRON_SECRET の両方の env を Lambda に注入し、
		// アプリ側 (checkAuth) がどちらでも通るようにする。
		const cronSecret = this.node.tryGetContext('cronSecret') ?? '';
		const legacyOpsSecretKey = this.node.tryGetContext('opsSecretKey') ?? '';

		// Epic #2525 Phase 7 PR-L5 (#2860): license key 全廃 contract に伴い AWS_LICENSE_SECRET の
		// CDK context 取得 + 必須検証 (addError) + Lambda env 注入を撤去。assertLicenseKeyConfigured()
		// は PR-L0 (#2806) で no-op 化済のため起動失敗リスクなし。entitlement は Stripe Subscription
		// (tenant.status) が唯一 SSOT。GitHub Secrets 実体 + deploy workflow の -c 引数撤去は PO 手動。

		// --- Parent-Gate Cookie Secret (#2310 / #2337 / ADR-0050) ---
		// /admin/* PIN gate の cookie-signature HMAC-SHA256 署名キー。
		// production cognito mode で必須。未設定だと src/lib/server/services/parent-gate-session.ts
		// の getSecret() が cold start 時に throw して /admin/* 全 500 化する (PR #2325 で実害発生)。
		// 配布証跡: GitHub Actions Secrets → CDK context → Lambda env (本ファイル) → 本番 Lambda
		// 緊急復旧 (2026-05-20): user が aws lambda update-function-configuration で直接配備済。
		// 本 PR で CDK SSOT 化し次回 stack deploy 時に env が消失しないようにする (out-of-sync 解消)。
		const parentGateCookieSecret = this.node.tryGetContext('parentGateCookieSecret') ?? '';
		if (!parentGateCookieSecret) {
			// 未注入のまま誤デプロイされると Lambda cold start 時に parent-gate-session.ts が
			// throw して /admin/* が 500 連発するため、CDK synth 段階で明示的に失敗させる
			// (ADR-0006 / addError は deploy を阻止する、AWS_LICENSE_SECRET と同じ運用)。
			cdk.Annotations.of(this).addError(
				'[ComputeStack] parentGateCookieSecret context is empty. ' +
					// biome-ignore lint/suspicious/noTemplateCurlyInString: GitHub Actions template syntax, not JS template literal
					'Pass -c parentGateCookieSecret=${{ secrets.PARENT_GATE_COOKIE_SECRET }} in the deploy workflow. ' +
					'See docs/decisions/0050-parent-gate-session-cookie-signature.md and infra/CLAUDE.md.',
			);
		}

		// --- DSQL backend 配線 (EPIC #3424 / #3438 Phase 2A で無条件既定化) ---
		// DSQL は本番の唯一の DB backend。DATA_SOURCE=dsql + DSQL_ENDPOINT + dsql:DbConnect を
		// **無条件**で配線する。旧 `dsqlEnabled` flag と「flag なしは DATA_SOURCE=dynamodb fallback」
		// (#2873 prod template 不変条件) は #3438 Phase 2A で撤去した: prod は既に DSQL 稼働のため
		// CDK 既定を実態に一致させ、fallback (dead な dynamodb backend への silent 巻戻し) を排除する。
		// endpoint / cluster ARN は DsqlStack deploy 後の実値を context で受ける (deploy workflow が
		// describe-stacks で resolve)。未注入なら synth を失敗させる (endpoint 無しで dsql Lambda を
		// 上げると cold start で全リクエスト 500 化、ADR-0006 silent fail 防止)。
		// #3438 (本 PR): DynamoDB table + ANALYTICS_TABLE_NAME env + grantReadWriteData を撤去。
		// analytics は on-demand 化済で DynamoDB を参照しない (`ANALYTICS_TABLE_NAME` の app 側読取 0)。
		const dsqlEndpoint = this.node.tryGetContext('dsqlEndpoint') ?? '';
		const dsqlClusterArn = this.node.tryGetContext('dsqlClusterArn') ?? '';
		// **prod / staging とも DSQL 必須** (endpoint / clusterArn 未注入なら synth を失敗させる、ADR-0006)。
		// #3438 Phase 2B: DynamoDB backend 撤去に伴い staging の dual-mode (未注入時 dynamodb fallback) を
		// 廃止し prod と同型に統一 (staging=prod 構成一致)。deploy-aws-staging.yml は #3685 で PR trigger でも
		// DSQL lane を常時実行し endpoint を注入するため fallback は不要 (dead な dynamodb への silent 巻戻し排除)。
		if (!dsqlEndpoint) {
			cdk.Annotations.of(this).addError(
				'[ComputeStack] dsqlEndpoint context が空です。DSQL は唯一の DB backend (#3438) のため必須です。' +
					'DsqlStack deploy 後の ClusterEndpoint 出力を -c dsqlEndpoint=<id>.dsql.<region>.on.aws で渡してください。',
			);
		}
		if (!dsqlClusterArn) {
			cdk.Annotations.of(this).addError(
				'[ComputeStack] dsqlClusterArn context が空です。dsql:DbConnect の resource 限定 (最小権限) に' +
					'必須です。-c dsqlClusterArn=arn:aws:dsql:... で渡してください。',
			);
		}

		// --- Discord Webhook URLs（CDK context 経由で GitHub Actions Secrets から取得） ---
		const feedbackDiscordWebhookUrl = this.node.tryGetContext('feedbackDiscordWebhookUrl') ?? '';
		// #4192 (#4174 Q2 の PO 決裁): `discordWebhookSignup` / `Billing` / `Churn` は
		// **持たないと決めた**ので読む口ごと撤去した。「secret を登録すれば動く」形を残さない。
		// 復活させたい場合は決裁をやり直すこと (再配線は
		// tests/unit/architecture/notification-channels-not-owned.test.ts が CI で落とす)。
		const discordWebhookIncident = this.node.tryGetContext('discordWebhookIncident') ?? '';

		// --- staging Stripe test mode (#4104) ---
		// staging に **test mode の** Stripe 資格情報だけを配備する。test mode は本番顧客・本番決済に
		// 一切影響しないため「外部サービス副作用ゼロ」の意図 (本番への副作用を作らない) は保たれる。
		//
		// live 混入の機械強制は **allowlist** で行う (denylist ではない):
		//   - secret key は `sk_test_` / `rk_test_` 以外を synth error にする。denylist (`sk_live_` を弾く)
		//     だと将来 Stripe が prefix を増やしたときに素通りするため、既知の test prefix 以外を落とす。
		//   - webhook signing secret は **test / live とも `whsec_` で prefix が同一**であり、文字列からは
		//     判別できない。ここは守れない範囲として明示する。live webhook secret 単体では本番への副作用を
		//     起こせず (署名検証にしか使われない)、live 側の実行権限は secret key が握るため、
		//     secret key の allowlist が実効的な防御線になる。
		//   - price id も test / live とも `price_` で判別不能。ただし staging は `USE_LOOKUP_KEY=true` で
		//     Stripe API の lookup_key から解決するため price env 自体を注入しない (#4104、secret 新規登録ゼロ)。
		//     lookup_key 解決に失敗したら fallback せず落ちる = silent degradation を作らない。
		const stagingStripeSecretKey = this.node.tryGetContext('stagingStripeSecretKey') ?? '';
		const stagingStripeWebhookSecret = this.node.tryGetContext('stagingStripeWebhookSecret') ?? '';

		if (stagingStripeSecretKey && !/^(sk|rk)_test_/.test(stagingStripeSecretKey)) {
			cdk.Annotations.of(this).addError(
				'[ComputeStack] stagingStripeSecretKey が test mode の key ではありません (#4104)。' +
					'staging には `sk_test_` / `rk_test_` で始まる key のみ配備できます。' +
					'live key の配備は本番顧客への副作用を生むため synth を停止します。',
			);
		}
		if (stagingStripeWebhookSecret && !/^whsec_/.test(stagingStripeWebhookSecret)) {
			cdk.Annotations.of(this).addError(
				'[ComputeStack] stagingStripeWebhookSecret の形式が不正です (#4104)。' +
					'Stripe webhook signing secret は `whsec_` で始まります' +
					' (test / live は prefix が同一のため、live 判別は secret key 側の allowlist が担う)。',
			);
		}

		// --- staging 用 Lambda env (#2873) ---
		// prod との差分 (handoff spec):
		//   - Discord / Gemini / SES 系 env は注入しない (本番外部サービスへの副作用ゼロ)
		//   - Stripe は **test mode に限り** 注入する (#4104。live は上の allowlist が synth で止める)
		//   - CRON_SECRET / OPS_SECRET_KEY 不要 (cron-dispatcher 省略)
		//   - ORIGIN / COGNITO_CALLBACK_URL / COGNITO_LOGOUT_URL: Function URL は synth 時未確定
		//     (自己参照) のため placeholder。deploy-aws-staging.yml の ORIGIN resolve step が
		//     get-function-url-config で解決し read-modify-write で更新する (health/smoke は
		//     GET のみで ORIGIN 非依存のため縮退可)。
		const stagingOriginPlaceholder = 'https://staging-origin-placeholder.invalid';
		const stagingEnvironment: Record<string, string> = {
			// #3438 Phase 2B: staging も prod と同型で無条件 DSQL (旧 dual-mode の dynamodb fallback 廃止)。
			// endpoint は上の fail-close で必須化済。#3438 (本 PR): DynamoDB table 撤去に伴い
			// DYNAMODB_TABLE / TABLE_NAME / ANALYTICS_TABLE_NAME env を撤去 (analytics on-demand 化済)。
			DATA_SOURCE: 'dsql',
			DSQL_ENDPOINT: dsqlEndpoint,
			DSQL_USER: 'app_user',
			ASSETS_BUCKET: props.assetsBucket.bucketName,
			DATABASE_URL: '/tmp/ganbari-quest.db',
			AWS_LWA_PORT: '3000',
			PORT: '3000',
			HOST: '0.0.0.0',
			NODE_ENV: 'production',
			ORIGIN: stagingOriginPlaceholder,
			BODY_SIZE_LIMIT: '10485760',
			AUTH_MODE: 'cognito',
			ANALYTICS_ENABLED: 'true',
			COGNITO_USER_POOL_ID: cognitoUserPoolId,
			COGNITO_CLIENT_ID: cognitoClientId,
			COGNITO_DOMAIN: cognitoDomain,
			COGNITO_CALLBACK_URL: `${stagingOriginPlaceholder}/auth/callback`,
			COGNITO_LOGOUT_URL: `${stagingOriginPlaceholder}/auth/login`,
			CONTEXT_TOKEN_SECRET: contextTokenSecret,
			MAINTENANCE_MODE: 'false',
			// #4104: Stripe test mode。未注入なら isStripeEnabled()=false のまま (従来挙動)。
			// price id は注入せず lookup_key 経路で解決する (USE_LOOKUP_KEY=true)。
			...(stagingStripeSecretKey ? { STRIPE_SECRET_KEY: stagingStripeSecretKey } : {}),
			...(stagingStripeWebhookSecret ? { STRIPE_WEBHOOK_SECRET: stagingStripeWebhookSecret } : {}),
			...(stagingStripeSecretKey ? { USE_LOOKUP_KEY: 'true' } : {}),
		};

		// --- Lambda: SvelteKit via Lambda Web Adapter ---
		this.fn = new lambda.DockerImageFunction(this, 'SvelteKitFn', {
			functionName: `${prefix}-app`,
			code: lambda.DockerImageCode.fromEcr(props.repository, {
				tagOrDigest: 'latest',
			}),
			memorySize: 512,
			timeout: cdk.Duration.seconds(30),
			architecture: lambda.Architecture.ARM_64,
			// prod は従来の inline env を一切変えない (prod template 不変条件 #2873 / ADR-0019)。
			// PARENT_GATE_COOKIE_SECRET は staging でも必須 (cognito mode の parent-gate-session.ts
			// が cold start 時に要求する。既存 GitHub Secret を再利用、新規 secret ゼロ)。
			environment: isProd
				? {
						// #3438 Phase 2A: DSQL が唯一の DB backend (無条件)。DSQL_USER=app_user (#3646):
						// dsql:DbConnect は custom db role 専用 (admin は DbConnectAdmin。role 実体は
						// deploy workflow の dsql:grant が provisioning)。#3438 (本 PR): DynamoDB table 撤去に
						// 伴い DYNAMODB_TABLE / TABLE_NAME / ANALYTICS_TABLE_NAME env を撤去。
						DATA_SOURCE: 'dsql',
						DSQL_ENDPOINT: dsqlEndpoint,
						DSQL_USER: 'app_user',
						ASSETS_BUCKET: props.assetsBucket.bucketName,
						DATABASE_URL: '/tmp/ganbari-quest.db',
						AWS_LWA_PORT: '3000',
						PORT: '3000',
						HOST: '0.0.0.0',
						NODE_ENV: 'production',
						ORIGIN: 'https://ganbari-quest.com',
						BODY_SIZE_LIMIT: '10485760',
						AUTH_MODE: 'cognito',
						// analytics は on-demand 化済 (`analytics-ondemand-service.ts`) で DynamoDB を
						// 参照しない (`ANALYTICS_TABLE_NAME` の app 側読取 0)。ANALYTICS_ENABLED のみ維持。
						ANALYTICS_ENABLED: 'true',
						COGNITO_USER_POOL_ID: cognitoUserPoolId,
						COGNITO_CLIENT_ID: cognitoClientId,
						COGNITO_DOMAIN: cognitoDomain,
						COGNITO_CALLBACK_URL: 'https://ganbari-quest.com/auth/callback',
						CONTEXT_TOKEN_SECRET: contextTokenSecret,
						MAINTENANCE_MODE: 'false',
						...(feedbackDiscordWebhookUrl
							? { FEEDBACK_DISCORD_WEBHOOK_URL: feedbackDiscordWebhookUrl }
							: {}),
						...(feedbackDiscordWebhookUrl
							? { DISCORD_WEBHOOK_INQUIRY: feedbackDiscordWebhookUrl }
							: {}),
						...(discordWebhookIncident ? { DISCORD_WEBHOOK_INCIDENT: discordWebhookIncident } : {}),
						...(cronSecret ? { CRON_SECRET: cronSecret } : {}),
						...(legacyOpsSecretKey ? { OPS_SECRET_KEY: legacyOpsSecretKey } : {}),
						// Epic #2525 Phase 7 PR-L5 (#2860): AWS_LICENSE_SECRET 注入を撤去 (license key 全廃)。
						// #2310 / #2337 / ADR-0050: parent-gate-session.ts の getSecret() が production
						// cognito mode で必須要求する。未注入だと /admin/* cold start 時に throw して
						// 500 連発 (2026-05-20 実害発生)。AWS_LICENSE_SECRET と同じ運用。
						// demo Lambda (SvelteKitDemoFn) は AUTH_MODE=anonymous で PIN gate 無効
						// (ADR-0048 整合) のため注入しない。
						...(parentGateCookieSecret
							? { PARENT_GATE_COOKIE_SECRET: parentGateCookieSecret }
							: {}),
						...(geminiApiKey ? { GEMINI_API_KEY: geminiApiKey } : {}),
						...(stripeSecretKey ? { STRIPE_SECRET_KEY: stripeSecretKey } : {}),
						...(stripeWebhookSecret ? { STRIPE_WEBHOOK_SECRET: stripeWebhookSecret } : {}),
						...(stripePriceStandardMonthly
							? { STRIPE_PRICE_STANDARD_MONTHLY: stripePriceStandardMonthly }
							: {}),
						...(stripePriceFamilyMonthly
							? { STRIPE_PRICE_FAMILY_MONTHLY: stripePriceFamilyMonthly }
							: {}),
						// Phase 7 PR-3b cutover (#2721): default 'true' で lookup_key 経路有効化。
						// Stripe API 障害時は env var fallback (config.ts isLookupKeyEnabled() / getPriceId())。
						// kill switch: Lambda env を 'false' に変更すると約 30 秒で env var 直読経路に巻き戻し。
						USE_LOOKUP_KEY: useLookupKey,
						COGNITO_LOGOUT_URL: 'https://ganbari-quest.com/auth/login',
						SES_SENDER_EMAIL: 'noreply@ganbari-quest.com',
						SES_CONFIG_SET_NAME: 'ganbari-quest-config',
						// #3438 Phase 2A: DATA_SOURCE=dsql は base env に無条件で含む (旧 dsqlEnabled 上書き撤去)。
					}
				: {
						// #3438 Phase 2A: staging も本番同型で DSQL backend (stagingEnvironment に DSQL 一式を
						// 含む)。本番構成 = staging 構成の一致 (旧 dsqlEnabled 上書き撤去、#2873 fallback 排除)。
						...stagingEnvironment,
						...(parentGateCookieSecret
							? { PARENT_GATE_COOKIE_SECRET: parentGateCookieSecret }
							: {}),
					},
		});
		this.fn.node.addDependency(logGroup);

		// Grant Lambda access to S3 (DynamoDB grant は #3438 で撤去、DB backend は DSQL)
		props.assetsBucket.grantReadWrite(this.fn);

		// EPIC #3424 / #3438 Phase 2A: DSQL 接続権限 (無条件)。dsql:DbConnect は実行時アプリ用の
		// 最小権限で、DDL/GRANT 用の dsql:DbConnectAdmin は付与しない (migration runner が
		// 別クレデンシャル経路で使う、M3 §3.4 B6 実行時接続ロールモデル)。resource は cluster
		// ARN に限定する (ワイルドカード禁止)。clusterArn は上の fail-close で必須化済。
		if (dsqlClusterArn) {
			this.fn.addToRolePolicy(
				new iam.PolicyStatement({
					actions: ['dsql:DbConnect'],
					resources: [dsqlClusterArn],
				}),
			);
		}

		// staging (#2873): SES / Cost Explorer grant は付与しない (本番外部サービスへの
		// 副作用ゼロ + blast radius 最小化。SES env も非注入のためアプリは送信経路を持たない)。
		if (isProd) {
			// Grant Lambda SES SendEmail permission
			this.fn.addToRolePolicy(
				new iam.PolicyStatement({
					actions: ['ses:SendEmail', 'ses:SendRawEmail'],
					resources: ['*'],
				}),
			);

			// Grant Lambda Cost Explorer read access (OPS dashboard)
			this.fn.addToRolePolicy(
				new iam.PolicyStatement({
					actions: ['ce:GetCostAndUsage'],
					resources: ['*'],
				}),
			);
		}

		// Lambda Function URL (public, CloudFront will be in front)
		this.functionUrl = this.fn.addFunctionUrl({
			authType: lambda.FunctionUrlAuthType.NONE,
			invokeMode: lambda.InvokeMode.BUFFERED,
		});

		// --- Log archiving: CloudWatch Logs → Firehose → S3 (Glacier) ---
		// staging (#2873): log archiving は省略 (idle≈¥0、CW Logs free tier で十分)。
		if (cfg.enableLogArchiving) {
			this.setupLogArchiving(logGroup, props.assetsBucket);
		}

		// --- Cron Dispatcher Lambda + EventBridge Rules (#1376) ---
		// LWA は HTTP イベントのみ処理できるため、EventBridge を直接 SvelteKit Lambda に
		// 接続することはできない。このディスパッチャーが EventBridge ペイロードを
		// HTTP POST に変換して SvelteKit の /api/cron/:job を呼び出す。
		// staging (#2873): cron-dispatcher は省略する (定期ジョブの検証責務は本番系統が担い、
		// staging は deploy 経路貫通 + post-deploy health が責務)。cronSecret throw guard も
		// 本分岐内に移動 — staging synth では CRON_SECRET / OPS_SECRET_KEY を要求しない。
		if (cfg.enableCronDispatcher) {
			const cronDispatcherLogGroup = new logs.LogGroup(this, 'CronDispatcherLogGroup', {
				logGroupName: `/aws/lambda/${prefix}-cron-dispatcher`,
				retention: logs.RetentionDays.THREE_DAYS,
				removalPolicy: cdk.RemovalPolicy.DESTROY,
			});

			// #1586: cron-dispatcher は CRON_SECRET / OPS_SECRET_KEY のいずれか最低 1 本が
			// 注入されていないと、Lambda 起動時に「FUNCTION_URL or CRON_SECRET not set」で throw し
			// 全ジョブ (license-expire / retention-cleanup / trial-notifications) が fail する。
			// silent skip ではなく CDK synth 時点で deploy をブロックする (ADR-0006 Safety Assertion Erosion Ban)。
			// 修復経緯: PR#1509 で dispatcher を新設した際、メイン Lambda (L148-149) と異なり
			// OPS_SECRET_KEY fallback の注入が抜け落ち、かつ CRON_SECRET が GitHub Secret 未登録だったため
			// 2 日間 silent fail し続けた (#1586)。
			if (!cronSecret && !legacyOpsSecretKey) {
				throw new Error(
					'[ComputeStack] cron-dispatcher requires cronSecret or opsSecretKey CDK context. ' +
						// biome-ignore lint/suspicious/noTemplateCurlyInString: GitHub Actions template syntax
						'Pass `-c cronSecret=${{ secrets.CRON_SECRET }}` or `-c opsSecretKey=${{ secrets.OPS_SECRET_KEY }}` ' +
						'in deploy.yml. Confirm `OPS_SECRET_KEY` (or `CRON_SECRET`) is registered via `gh secret list` (#1586).',
				);
			}

			// #1828: AWS Lambda Node.js 20.x EOL (2026-04-30) 対応で 22.x へ migration
			this.cronDispatcherFn = new lambdaNode.NodejsFunction(this, 'CronDispatcherFn', {
				functionName: `${prefix}-cron-dispatcher`,
				entry: path.join(__dirname, '..', 'lambda', 'cron-dispatcher', 'index.ts'),
				handler: 'handler',
				runtime: lambda.Runtime.NODEJS_22_X,
				architecture: lambda.Architecture.ARM_64,
				memorySize: 128,
				timeout: cdk.Duration.minutes(5),
				logGroup: cronDispatcherLogGroup,
				environment: {
					FUNCTION_URL: this.functionUrl.url,
					// #1586: メイン Lambda (L148-149) と整合させ CRON_SECRET と OPS_SECRET_KEY の両方を注入。
					// dispatcher 側 (cron-dispatcher/index.ts) は `CRON_SECRET ?? OPS_SECRET_KEY` の順で
					// fallback 参照する。L79-81 の後方互換設計に従う。
					...(cronSecret ? { CRON_SECRET: cronSecret } : {}),
					...(legacyOpsSecretKey ? { OPS_SECRET_KEY: legacyOpsSecretKey } : {}),
				},
				bundling: {
					minify: true,
					sourceMap: false,
				},
			});
			this.cronDispatcherFn.node.addDependency(cronDispatcherLogGroup);

			// EventBridge Rules: CRON_JOBS (SSOT: src/lib/server/cron/schedule-registry.ts)
			for (const job of CRON_JOBS) {
				// camelCase ID: license-expire → CronRuleLicenseExpire
				const ruleId = `CronRule${job.name
					.split('-')
					.map((s) => s.charAt(0).toUpperCase() + s.slice(1))
					.join('')}`;
				const rule = new events.Rule(this, ruleId, {
					ruleName: `${prefix}-cron-${job.name}`,
					description: `Cron job dispatcher for ${job.name} (#1376)`,
					schedule: events.Schedule.expression(job.utcCronExpression),
				});
				rule.addTarget(
					new eventsTargets.LambdaFunction(this.cronDispatcherFn, {
						event: events.RuleTargetInput.fromObject({ cronJob: job.name }),
					}),
				);
			}
		}

		// --- ADR-0048 Multi-Lambda Demo Fn (#2097 week 4) ---
		// 本番 Fn と同じ Docker image を共有しつつ、IAM role + 環境変数で完全分離する。
		// load-bearing 制約 (1 人運用、セキュリティインシデント対応不可) のため、
		// demo Fn は CloudWatch Logs write 以外の AWS リソースに一切アクセスできない。
		//
		// 設計判断:
		//   - 同じ ECR image を共有: tag 同期 + 別 image 維持の運用負荷を回避
		//   - 同 region (us-east-1): ACM 証明書 / Cognito region (#1606) と整合
		//   - 同 memory/timeout/arch: 想定外の冷却差分を作らない
		//   - IAM role 完全分離: granular blast radius 制御 (本番 DynamoDB / Cognito 漏洩防止)
		//   - 環境変数 DATA_SOURCE=demo + AUTH_MODE=anonymous: PR #2120 の demo Repository + AnonymousAuthProvider を起動
		//   - 本番 secret (Stripe / Gemini / Cognito / License / Discord) 注入禁止
		//   - Provisioned Concurrency 1 unit (cost ~$2.74/mo): 初回 cold start 体験劣化を避ける
		//
		// 検証: tests/unit/infra/multi-lambda-cdk.test.ts
		//   - C-1 IAM isolation: DynamoDB / Cognito / Secrets Manager / SES へのアクセスなし
		//   - C-2 CloudFront distribution count: prod + demo = 2 本
		//   - C-3 demo Fn env: DATA_SOURCE='demo' + AUTH_MODE='anonymous'
		//
		// staging (#2873): demo Lambda は省略 (enableDemoLambda=false)。staging の責務は
		// 本番 deploy 経路の貫通 + post-deploy health であり、demo 配信は本番系統のみ。
		if (cfg.enableDemoLambda) {
			this.buildDemoLambda(props);
		}

		// --- Outputs ---
		new cdk.CfnOutput(this, 'FunctionUrl', { value: this.functionUrl.url });
		new cdk.CfnOutput(this, 'FunctionName', { value: this.fn.functionName });
		if (this.cronDispatcherFn) {
			new cdk.CfnOutput(this, 'CronDispatcherFunctionName', {
				value: this.cronDispatcherFn.functionName,
			});
		}
		if (this.demoFunctionUrl && this.demoFn && this.demoLambdaRole) {
			new cdk.CfnOutput(this, 'DemoFunctionUrl', { value: this.demoFunctionUrl.url });
			new cdk.CfnOutput(this, 'DemoFunctionName', { value: this.demoFn.functionName });
			new cdk.CfnOutput(this, 'DemoLambdaRoleArn', { value: this.demoLambdaRole.roleArn });
		}
	}

	/**
	 * ADR-0048 Multi-Lambda Demo Fn (#2097 week 4)。prod のみ構築 (enableDemoLambda)。
	 * 中身は従来 constructor inline だったものを無変更で移設 (#2873 — prod template 不変条件、
	 * construct ID / 物理名 / env / IAM は一切変えない)。
	 */
	private buildDemoLambda(props: ComputeStackProps): void {
		// 1. 独立 LogGroup (3-day retention、prod と同じ運用)
		const demoLogGroup = new logs.LogGroup(this, 'DemoAppLogGroup', {
			logGroupName: '/aws/lambda/ganbari-quest-app-demo',
			retention: logs.RetentionDays.THREE_DAYS,
			removalPolicy: cdk.RemovalPolicy.DESTROY,
		});

		// 2. 独立 IAM role: AWSLambdaBasicExecutionRole (CloudWatch Logs write) のみ
		//    NO grants for: DynamoDB tables / Cognito User Pool / Secrets Manager / SES / S3 (logs 以外)
		//    本番 Fn と共有しない (cross-tenancy 防止 + blast radius 最小化)。
		this.demoLambdaRole = new iam.Role(this, 'DemoLambdaRole', {
			roleName: 'ganbari-quest-app-demo-role',
			assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
			managedPolicies: [
				iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
			],
			description:
				'Demo Lambda execution role (ADR-0048). CloudWatch Logs only. No DynamoDB/Cognito/Secrets/SES grants.',
		});

		// 3. demo Fn: prod と同じ Docker image を共有しつつ env / role で隔離
		this.demoFn = new lambda.DockerImageFunction(this, 'SvelteKitDemoFn', {
			functionName: 'ganbari-quest-app-demo',
			code: lambda.DockerImageCode.fromEcr(props.repository, {
				tagOrDigest: 'latest',
			}),
			memorySize: 512, // 本番と同値 (256MB だと SvelteKit + Node 22 cold start で OOM 起き 502、PR #2129 deploy 後に発覚)
			timeout: cdk.Duration.seconds(30),
			architecture: lambda.Architecture.ARM_64,
			role: this.demoLambdaRole,
			environment: {
				// ADR-0048 + PR #2120: demo Repository + AnonymousAuthProvider が起動する trigger
				DATA_SOURCE: 'demo',
				AUTH_MODE: 'anonymous',
				// 本番と一致させる起動環境変数 (NODE_ENV / PORT / HOST / LWA)
				NODE_ENV: 'production',
				AWS_LWA_PORT: '3000',
				PORT: '3000',
				HOST: '0.0.0.0',
				BODY_SIZE_LIMIT: '10485760',
				ORIGIN: 'https://demo.ganbari-quest.com',
				MAINTENANCE_MODE: 'false',
				// hotfix #5 (2026-05-16): src/lib/server/db/client.ts L12 が `new Database(DATABASE_URL)` を
				// 無条件にモジュールロード時に呼ぶ。DATA_SOURCE=demo でも実行され、defaults `./data/ganbari-quest.db`
				// は Lambda の cwd `/var/task` (read-only) で失敗 → Lambda 起動 502。本番と同じ `/tmp` 配置で
				// 空 SQLite ファイル作成、demo Repository は factory.ts で別途選択されるためアプリ層では使わない。
				DATABASE_URL: '/tmp/ganbari-quest.db',
				// 本番 secret は意図的に NO INJECT:
				//   - ASSETS_BUCKET (S3) / DSQL_ENDPOINT (DSQL backend)
				//   - COGNITO_* / CONTEXT_TOKEN_SECRET (Cognito)
				//   - STRIPE_* (Stripe)
				//   - GEMINI_API_KEY (Gemini)
				//   - CRON_SECRET / OPS_SECRET_KEY (cron / ops)
				//   - DISCORD_WEBHOOK_* (Discord)
				//   - SES_SENDER_EMAIL / SES_CONFIG_SET_NAME (SES)
				// PR #2120 で demo Repository が DATA_SOURCE='demo' を見て in-memory fixture で完結する設計のため、
				// これらの secret は demo Fn のランタイム動作に一切不要。
			},
		});
		this.demoFn.node.addDependency(demoLogGroup);

		// 4. Function URL (auth=NONE、本番と同じ。前段 CloudFront で配信する)
		this.demoFunctionUrl = this.demoFn.addFunctionUrl({
			authType: lambda.FunctionUrlAuthType.NONE,
			invokeMode: lambda.InvokeMode.BUFFERED,
		});

		// 5. Provisioned Concurrency は AWS アカウント Lambda concurrent execution quota
		//    不足で割り当て不可 (1 unit でも UnreservedConcurrentExecution が最低 10 を下回る)。
		//    かつ予算制約のため未採用 (PO 判断 2026-05-15)。cold start ~1-2s で運用。
		//    必要になったら AWS Service Quotas で増額申請後に lambda.Alias + provisionedConcurrentExecutions=1
		//    を追加する (cost ~$2.74/月)。
	}

	private setupLogArchiving(logGroup: logs.LogGroup, bucket: s3.Bucket): void {
		// #3939: aws-cdk-lib GA L2 (firehose.DeliveryStream + logsDestinations.FirehoseDestination)。
		// delivery role / subscription role は L2 が最小権限で自動生成する (旧 L1 + 手動 IAM 2 本は撤去)。
		// 物理名は固定しない (CFN 自動命名): 旧 stream `ganbari-quest-log-archive` からの置換を
		// 同名衝突なしの 1 deploy (create 新 → delete 旧) で成立させるため。stream は stateless
		// (バッファ中データのみ) で S3 の既 archive は無傷。切替瞬断 (数秒) は Glacier archive 用途で許容。
		const stream = new firehose.DeliveryStream(this, 'LogArchiveDelivery', {
			destination: new firehose.S3Bucket(bucket, {
				dataOutputPrefix: 'logs/year=!{timestamp:yyyy}/month=!{timestamp:MM}/day=!{timestamp:dd}/',
				errorOutputPrefix: 'logs-error/',
				bufferingSize: cdk.Size.mebibytes(5),
				bufferingInterval: cdk.Duration.seconds(900),
				compression: firehose.Compression.GZIP,
			}),
		});

		// Subscription filter: all log events → Firehose (role は FirehoseDestination が自動生成)。
		new logs.SubscriptionFilter(this, 'LogArchiveSubscriptionFilter', {
			logGroup,
			destination: new logsDestinations.FirehoseDestination(stream),
			filterPattern: logs.FilterPattern.allEvents(),
		});
	}
}
