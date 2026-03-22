import * as cdk from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as firehose from 'aws-cdk-lib/aws-kinesisfirehose';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as s3 from 'aws-cdk-lib/aws-s3';
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
				BODY_SIZE_LIMIT: '10485760',
			},
		});
		this.fn.node.addDependency(logGroup);

		// Grant Lambda access to DynamoDB and S3
		props.table.grantReadWriteData(this.fn);
		props.assetsBucket.grantReadWrite(this.fn);

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
