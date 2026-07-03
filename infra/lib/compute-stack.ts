import * as path from 'node:path';
import * as cdk from 'aws-cdk-lib';
import type * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import type * as ecr from 'aws-cdk-lib/aws-ecr';
import * as events from 'aws-cdk-lib/aws-events';
import * as eventsTargets from 'aws-cdk-lib/aws-events-targets';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as firehose from 'aws-cdk-lib/aws-kinesisfirehose';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambdaNode from 'aws-cdk-lib/aws-lambda-nodejs';
import * as logs from 'aws-cdk-lib/aws-logs';
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
	// #1693 (#1639 follow-up): analytics 事前集計バッチ (前日分 funnel + cancellation を集計)
	{ name: 'analytics-aggregator-daily', utcCronExpression: 'cron(0 18 * * ? *)' },
	// #1742: challenge (preset distribution) 事前集計バッチ (#1602 N+1 GetItem 移行)
	{ name: 'challenge-aggregator-daily', utcCronExpression: 'cron(30 18 * * ? *)' },
	// #3504: クラウドエクスポート非同期 build バッチ (5 分毎)
	{ name: 'export-build', utcCronExpression: 'cron(0/5 * * * ? *)' },
] as const;

export interface ComputeStackProps extends cdk.StackProps {
	table: dynamodb.TableV2;
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
		// #2719 (Phase 7 PR-3b prerequisite): yearly 4 種 + legacy `stripePriceMonthly` /
		// `stripePriceYearly` は物理削除済。monthly 2 種のみ Lambda env に inject する。
		// 過去 yearly 契約者の MRR 表示は `stripe-metrics-service.ts` の `HISTORICAL_YEARLY_AMOUNTS`
		// fallback で継続計算 (SSOT: docs/design/billing-redesign/phase7-staging-validation-protocol.md)。
		const stripePriceStandardMonthly = this.node.tryGetContext('stripePriceStandardMonthly') ?? '';
		const stripePriceFamilyMonthly = this.node.tryGetContext('stripePriceFamilyMonthly') ?? '';

		// --- Phase 7 PR-3b / PR-4a 配備済 Stripe Webhook + lookup_key 関連 env (#2721 / #2713 / #2716) ---
		// 参照 SSOT:
		//   - docs/decisions/0059-phase7-cutover-sequence.md
		//   - docs/design/billing-redesign/phase6-phase7-execution-ssot.md §3 Step 3 / Step 4
		//   - docs/design/billing-redesign/phase6-context-decisions-6.md §4 lookup_key 段階移行
		//
		// useLookupKey (PR-3b cutover): default 'true' で Production cutover を反映する。
		//   - lookup_key (`standard_monthly` / `premium_monthly`) 経由 Price ID 解決
		//   - Stripe API 障害時は env var `STRIPE_PRICE_*` fallback (kill switch、isLookupKeyEnabled())
		//   - 旧 env var 4 件は PR-5 cleanup (1 週間 smoke test 完了後) で削除
		// stripeWebhookShadowMode (PR-4a 配備、cutover は PR-4b): default 'false'。
		//   - PR-4a で env 配備のみ実施済 (#2714)、CDK context 配布が本 PR で完了
		//   - PR-4b cutover 時に 'true' に切替て shadow mode 検証 (24-48h)
		// stripeWebhookSecretTest (PR-4a 配備): Test mode webhook signing secret (#2627 §C)。
		//   - shadow mode + cutover で `STRIPE_WEBHOOK_SHADOW_MODE=true` 時に getWebhookSecretForShadow()
		//     経由で参照される (config.ts:120)
		const useLookupKey = this.node.tryGetContext('useLookupKey') ?? 'true';
		const stripeWebhookShadowMode = this.node.tryGetContext('stripeWebhookShadowMode') ?? 'false';
		const stripeWebhookSecretTest = this.node.tryGetContext('stripeWebhookSecretTest') ?? '';

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

		// --- Discord Webhook URLs（CDK context 経由で GitHub Actions Secrets から取得） ---
		const feedbackDiscordWebhookUrl = this.node.tryGetContext('feedbackDiscordWebhookUrl') ?? '';
		const discordWebhookSignup = this.node.tryGetContext('discordWebhookSignup') ?? '';
		const discordWebhookBilling = this.node.tryGetContext('discordWebhookBilling') ?? '';
		const discordWebhookChurn = this.node.tryGetContext('discordWebhookChurn') ?? '';
		const discordWebhookIncident = this.node.tryGetContext('discordWebhookIncident') ?? '';

		// --- staging 用 Lambda env (#2873) ---
		// prod との差分 (handoff spec):
		//   - Stripe / Discord / Gemini / SES 系 env は注入しない (本番外部サービスへの副作用ゼロ)
		//   - CRON_SECRET / OPS_SECRET_KEY 不要 (cron-dispatcher 省略)
		//   - ORIGIN / COGNITO_CALLBACK_URL / COGNITO_LOGOUT_URL: Function URL は synth 時未確定
		//     (自己参照) のため placeholder。deploy-aws-staging.yml の ORIGIN resolve step が
		//     get-function-url-config で解決し read-modify-write で更新する (health/smoke は
		//     GET のみで ORIGIN 非依存のため縮退可)。
		const stagingOriginPlaceholder = 'https://staging-origin-placeholder.invalid';
		const stagingEnvironment: Record<string, string> = {
			DATA_SOURCE: 'dynamodb',
			DYNAMODB_TABLE: props.table.tableName!,
			TABLE_NAME: props.table.tableName!,
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
			ANALYTICS_TABLE_NAME: props.table.tableName!,
			COGNITO_USER_POOL_ID: cognitoUserPoolId,
			COGNITO_CLIENT_ID: cognitoClientId,
			COGNITO_DOMAIN: cognitoDomain,
			COGNITO_CALLBACK_URL: `${stagingOriginPlaceholder}/auth/callback`,
			COGNITO_LOGOUT_URL: `${stagingOriginPlaceholder}/auth/login`,
			CONTEXT_TOKEN_SECRET: contextTokenSecret,
			MAINTENANCE_MODE: 'false',
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
						DATA_SOURCE: 'dynamodb',
						DYNAMODB_TABLE: props.table.tableName!,
						TABLE_NAME: props.table.tableName!,
						ASSETS_BUCKET: props.assetsBucket.bucketName,
						DATABASE_URL: '/tmp/ganbari-quest.db',
						AWS_LWA_PORT: '3000',
						PORT: '3000',
						HOST: '0.0.0.0',
						NODE_ENV: 'production',
						ORIGIN: 'https://ganbari-quest.com',
						BODY_SIZE_LIMIT: '10485760',
						AUTH_MODE: 'cognito',
						// #1591 (ADR-0023 I2): DynamoDB analytics provider を本番有効化。
						// メインテーブルに ANALYTICS#<date> パーティションを同居させる
						// (single-table design)。TTL 90 日でレコードは自動削除される (provider 側)。
						// umami / Sentry は #1591 で削除済み。analytics 系の env はこれだけで完結。
						ANALYTICS_ENABLED: 'true',
						ANALYTICS_TABLE_NAME: props.table.tableName!,
						COGNITO_USER_POOL_ID: cognitoUserPoolId,
						COGNITO_CLIENT_ID: cognitoClientId,
						COGNITO_DOMAIN: cognitoDomain,
						COGNITO_CALLBACK_URL: 'https://ganbari-quest.com/auth/callback',
						CONTEXT_TOKEN_SECRET: contextTokenSecret,
						MAINTENANCE_MODE: 'false',
						...(feedbackDiscordWebhookUrl
							? { FEEDBACK_DISCORD_WEBHOOK_URL: feedbackDiscordWebhookUrl }
							: {}),
						...(discordWebhookSignup ? { DISCORD_WEBHOOK_SIGNUP: discordWebhookSignup } : {}),
						...(discordWebhookBilling ? { DISCORD_WEBHOOK_BILLING: discordWebhookBilling } : {}),
						...(discordWebhookChurn ? { DISCORD_WEBHOOK_CHURN: discordWebhookChurn } : {}),
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
						// Phase 7 PR-4a 配備 (#2713): default 'false'。PR-4b cutover で 'true' 切替。
						// shadow mode = log only handler (`/api/stripe/webhook-v2`)、本番動作不変。
						STRIPE_WEBHOOK_SHADOW_MODE: stripeWebhookShadowMode,
						// Phase 7 PR-4a 配備 (#2713 / #2627 §C): Test mode webhook signing secret。
						// shadow / cutover で getWebhookSecretForShadow() (config.ts:120) 経由参照。
						// 空文字 fallback で本番 STRIPE_WEBHOOK_SECRET に flow。Production cutover 後に
						// 本番 secret に置換 (PR-4b マージ時、#2627 §F)。
						...(stripeWebhookSecretTest
							? { STRIPE_WEBHOOK_SECRET_TEST: stripeWebhookSecretTest }
							: {}),
						COGNITO_LOGOUT_URL: 'https://ganbari-quest.com/auth/login',
						SES_SENDER_EMAIL: 'noreply@ganbari-quest.com',
						SES_CONFIG_SET_NAME: 'ganbari-quest-config',
					}
				: {
						...stagingEnvironment,
						...(parentGateCookieSecret
							? { PARENT_GATE_COOKIE_SECRET: parentGateCookieSecret }
							: {}),
					},
		});
		this.fn.node.addDependency(logGroup);

		// Grant Lambda access to DynamoDB and S3
		props.table.grantReadWriteData(this.fn);
		props.assetsBucket.grantReadWrite(this.fn);

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
				//   - DYNAMODB_TABLE / TABLE_NAME / ASSETS_BUCKET (DynamoDB / S3)
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
		// Firehose delivery role
		const firehoseRole = new iam.Role(this, 'LogArchiveFirehoseRole', {
			assumedBy: new iam.ServicePrincipal('firehose.amazonaws.com'),
		});
		firehoseRole.addToPolicy(
			new iam.PolicyStatement({
				actions: [
					's3:AbortMultipartUpload',
					's3:GetBucketLocation',
					's3:GetObject',
					's3:ListBucket',
					's3:ListBucketMultipartUploads',
					's3:PutObject',
				],
				resources: [bucket.bucketArn, `${bucket.bucketArn}/logs/*`],
			}),
		);

		// Firehose delivery stream → S3
		const stream = new firehose.CfnDeliveryStream(this, 'LogArchiveStream', {
			deliveryStreamName: 'ganbari-quest-log-archive',
			s3DestinationConfiguration: {
				bucketArn: bucket.bucketArn,
				prefix: 'logs/year=!{timestamp:yyyy}/month=!{timestamp:MM}/day=!{timestamp:dd}/',
				errorOutputPrefix: 'logs-error/',
				roleArn: firehoseRole.roleArn,
				bufferingHints: {
					sizeInMBs: 5,
					intervalInSeconds: 900,
				},
				compressionFormat: 'GZIP',
			},
		});

		// CloudWatch Logs → Firehose subscription role (inline policy to avoid race condition)
		const subscriptionRole = new iam.Role(this, 'CWLogsToFirehoseRole', {
			assumedBy: new iam.ServicePrincipal(`logs.${this.region}.amazonaws.com`),
			inlinePolicies: {
				FirehoseAccess: new iam.PolicyDocument({
					statements: [
						new iam.PolicyStatement({
							actions: ['firehose:PutRecord', 'firehose:PutRecordBatch'],
							resources: [stream.attrArn],
						}),
					],
				}),
			},
		});

		// Subscription filter: all log events → Firehose
		const subscription = new logs.CfnSubscriptionFilter(this, 'LogArchiveSubscription', {
			logGroupName: logGroup.logGroupName,
			filterPattern: '',
			destinationArn: stream.attrArn,
			roleArn: subscriptionRole.roleArn,
		});
		// Ensure IAM role + Firehose are fully created before subscription
		subscription.node.addDependency(subscriptionRole);
		subscription.node.addDependency(stream);
	}
}
