import * as cdk from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as firehose from 'aws-cdk-lib/aws-kinesisfirehose';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import type { Construct } from 'constructs';

export interface ComputeStackProps extends cdk.StackProps {
	table: dynamodb.TableV2;
	assetsBucket: s3.Bucket;
	repository: ecr.Repository;
}

export class ComputeStack extends cdk.Stack {
	public readonly fn: lambda.Function;
	public readonly functionUrl: lambda.FunctionUrl;

	constructor(scope: Construct, id: string, props: ComputeStackProps) {
		super(scope, id, props);

		// --- CloudWatch Log Group (3-day retention) ---
		const logGroup = new logs.LogGroup(this, 'AppLogGroup', {
			logGroupName: '/aws/lambda/ganbari-quest-app',
			retention: logs.RetentionDays.THREE_DAYS,
			removalPolicy: cdk.RemovalPolicy.DESTROY,
		});

		// --- Cognito 設定を SSM から取得（cross-stack export を回避） ---
		const cognitoUserPoolId = ssm.StringParameter.valueForStringParameter(
			this,
			'/ganbari-quest/cognito/user-pool-id',
		);
		const cognitoClientId = ssm.StringParameter.valueForStringParameter(
			this,
			'/ganbari-quest/cognito/client-id',
		);
		// Cognito Hosted UI ドメイン（Google OAuth 有効時に auth-stack が SSM に書き込む）
		const cognitoDomain = ssm.StringParameter.valueForStringParameter(
			this,
			'/ganbari-quest/cognito/domain',
		);
		const contextTokenSecret = ssm.StringParameter.valueForStringParameter(
			this,
			'/ganbari-quest/context-token-secret',
		);

		// --- Gemini API Key（SSM から取得、未設定時はフォールバック動作） ---
		const geminiApiKey = this.node.tryGetContext('geminiApiKey') ?? '';

		// --- Stripe 設定（CDK context 経由で GitHub Actions Secrets から取得） ---
		const stripeSecretKey = this.node.tryGetContext('stripeSecretKey') ?? '';
		const stripeWebhookSecret = this.node.tryGetContext('stripeWebhookSecret') ?? '';
		const stripePriceMonthly = this.node.tryGetContext('stripePriceMonthly') ?? '';
		const stripePriceYearly = this.node.tryGetContext('stripePriceYearly') ?? '';
		const stripePriceFamilyMonthly = this.node.tryGetContext('stripePriceFamilyMonthly') ?? '';
		const stripePriceFamilyYearly = this.node.tryGetContext('stripePriceFamilyYearly') ?? '';

		// --- Cron Endpoint Bearer Secret (#820 PR-D / ADR-0033) ---
		// /api/cron/retention-cleanup の Bearer 認証に使用。
		// /ops ダッシュボードは Cognito ops group 認可に移行したため、この鍵は共有しない。
		// 後方互換: 既存 GitHub Secret `OPS_SECRET_KEY` を cronSecret context として渡す運用が続く間は、
		// CDK でも OPS_SECRET_KEY / CRON_SECRET の両方の env を Lambda に注入し、
		// アプリ側 (checkAuth) がどちらでも通るようにする。
		const cronSecret = this.node.tryGetContext('cronSecret') ?? '';
		const legacyOpsSecretKey = this.node.tryGetContext('opsSecretKey') ?? '';

		// --- License Key HMAC Secret (#806, #911) ---
		// production で未設定だと hooks.server.ts の assertLicenseKeyConfigured() が
		// 起動時に throw するため、Lambda 環境変数として必ず注入する。
		// ADR-0026 §G2 の grace period 実装までは process.env 直読み方式を維持する。
		// 恒久的には AWS Secrets Manager 経由の読み込み (#810) に移行予定。
		const awsLicenseSecret = this.node.tryGetContext('awsLicenseSecret') ?? '';
		if (!awsLicenseSecret) {
			// 必須 Secret が未設定のまま誤デプロイされると、Lambda cold start 時に
			// assertLicenseKeyConfigured() が throw して本番障害になるため、
			// CDK 側で明示的に失敗させる（addError は deploy を阻止する）。
			cdk.Annotations.of(this).addError(
				'[ComputeStack] awsLicenseSecret context is empty. ' +
					'Pass -c awsLicenseSecret=${{ secrets.AWS_LICENSE_SECRET }} in the deploy workflow. ' +
					'See docs/decisions/0026-license-key-architecture.md and infra/CLAUDE.md.',
			);
		}

		// --- Discord Webhook URLs（CDK context 経由で GitHub Actions Secrets から取得） ---
		const feedbackDiscordWebhookUrl = this.node.tryGetContext('feedbackDiscordWebhookUrl') ?? '';
		const discordWebhookSignup = this.node.tryGetContext('discordWebhookSignup') ?? '';
		const discordWebhookBilling = this.node.tryGetContext('discordWebhookBilling') ?? '';
		const discordWebhookChurn = this.node.tryGetContext('discordWebhookChurn') ?? '';
		const discordWebhookIncident = this.node.tryGetContext('discordWebhookIncident') ?? '';

		// --- Lambda: SvelteKit via Lambda Web Adapter ---
		this.fn = new lambda.DockerImageFunction(this, 'SvelteKitFn', {
			functionName: 'ganbari-quest-app',
			code: lambda.DockerImageCode.fromEcr(props.repository, {
				tagOrDigest: 'latest',
			}),
			memorySize: 512,
			timeout: cdk.Duration.seconds(30),
			architecture: lambda.Architecture.ARM_64,
			environment: {
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
				...(discordWebhookIncident
					? { DISCORD_WEBHOOK_INCIDENT: discordWebhookIncident }
					: {}),
				...(cronSecret ? { CRON_SECRET: cronSecret } : {}),
				...(legacyOpsSecretKey ? { OPS_SECRET_KEY: legacyOpsSecretKey } : {}),
				// #911 / #806: assertLicenseKeyConfigured() が必須要求する。
				// 未設定だと Lambda cold start 時に throw して 500 連発するため、
				// GitHub Actions Secrets 経由で必ず注入する。
				...(awsLicenseSecret ? { AWS_LICENSE_SECRET: awsLicenseSecret } : {}),
				...(geminiApiKey ? { GEMINI_API_KEY: geminiApiKey } : {}),
				...(stripeSecretKey ? { STRIPE_SECRET_KEY: stripeSecretKey } : {}),
				...(stripeWebhookSecret ? { STRIPE_WEBHOOK_SECRET: stripeWebhookSecret } : {}),
				...(stripePriceMonthly ? { STRIPE_PRICE_MONTHLY: stripePriceMonthly } : {}),
				...(stripePriceYearly ? { STRIPE_PRICE_YEARLY: stripePriceYearly } : {}),
				...(stripePriceFamilyMonthly ? { STRIPE_PRICE_FAMILY_MONTHLY: stripePriceFamilyMonthly } : {}),
				...(stripePriceFamilyYearly ? { STRIPE_PRICE_FAMILY_YEARLY: stripePriceFamilyYearly } : {}),
				COGNITO_LOGOUT_URL: 'https://ganbari-quest.com/auth/login',
				SES_SENDER_EMAIL: 'noreply@ganbari-quest.com',
				SES_CONFIG_SET_NAME: 'ganbari-quest-config',
			},
		});
		this.fn.node.addDependency(logGroup);

		// Grant Lambda access to DynamoDB and S3
		props.table.grantReadWriteData(this.fn);
		props.assetsBucket.grantReadWrite(this.fn);

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

		// Lambda Function URL (public, CloudFront will be in front)
		this.functionUrl = this.fn.addFunctionUrl({
			authType: lambda.FunctionUrlAuthType.NONE,
			invokeMode: lambda.InvokeMode.BUFFERED,
		});

		// --- Log archiving: CloudWatch Logs → Firehose → S3 (Glacier) ---
		this.setupLogArchiving(logGroup, props.assetsBucket);

		// --- Outputs ---
		new cdk.CfnOutput(this, 'FunctionUrl', { value: this.functionUrl.url });
		new cdk.CfnOutput(this, 'FunctionName', { value: this.fn.functionName });
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
