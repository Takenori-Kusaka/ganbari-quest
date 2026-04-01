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

		// --- OPS Dashboard（CDK context 経由で GitHub Actions Secrets から取得） ---
		const opsSecretKey = this.node.tryGetContext('opsSecretKey') ?? '';

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
				...(opsSecretKey ? { OPS_SECRET_KEY: opsSecretKey } : {}),
				...(geminiApiKey ? { GEMINI_API_KEY: geminiApiKey } : {}),
				...(stripeSecretKey ? { STRIPE_SECRET_KEY: stripeSecretKey } : {}),
				...(stripeWebhookSecret ? { STRIPE_WEBHOOK_SECRET: stripeWebhookSecret } : {}),
				...(stripePriceMonthly ? { STRIPE_PRICE_MONTHLY: stripePriceMonthly } : {}),
				...(stripePriceYearly ? { STRIPE_PRICE_YEARLY: stripePriceYearly } : {}),
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
