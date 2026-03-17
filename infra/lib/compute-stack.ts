import * as cdk from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as s3 from 'aws-cdk-lib/aws-s3';
import type { Construct } from 'constructs';

export interface ComputeStackProps extends cdk.StackProps {
	table: dynamodb.TableV2;
	assetsBucket: s3.Bucket;
}

export class ComputeStack extends cdk.Stack {
	public readonly fn: lambda.Function;
	public readonly functionUrl: lambda.FunctionUrl;
	public readonly repository: ecr.Repository;

	constructor(scope: Construct, id: string, props: ComputeStackProps) {
		super(scope, id, props);

		// --- ECR Repository for Lambda container image ---
		this.repository = new ecr.Repository(this, 'AppRepo', {
			repositoryName: 'ganbari-quest',
			removalPolicy: cdk.RemovalPolicy.RETAIN,
			lifecycleRules: [
				{
					maxImageCount: 5,
					description: 'Keep only 5 most recent images',
				},
			],
		});

		// --- Lambda: SvelteKit via Lambda Web Adapter ---
		// First deploy: use placeholder image. GitHub Actions will push the real image.
		this.fn = new lambda.DockerImageFunction(this, 'SvelteKitFn', {
			functionName: 'ganbari-quest-app',
			code: lambda.DockerImageCode.fromEcr(this.repository, {
				tagOrDigest: 'latest',
			}),
			memorySize: 512,
			timeout: cdk.Duration.seconds(30),
			architecture: lambda.Architecture.ARM_64,
			environment: {
				TABLE_NAME: props.table.tableName!,
				ASSETS_BUCKET: props.assetsBucket.bucketName,
				AWS_LWA_PORT: '3000',
				PORT: '3000',
				HOST: '0.0.0.0',
				NODE_ENV: 'production',
			},
		});

		// Grant Lambda access to DynamoDB and S3
		props.table.grantReadWriteData(this.fn);
		props.assetsBucket.grantReadWrite(this.fn);

		// Lambda Function URL (public, CloudFront will be in front)
		this.functionUrl = this.fn.addFunctionUrl({
			authType: lambda.FunctionUrlAuthType.NONE,
			invokeMode: lambda.InvokeMode.RESPONSE_STREAM,
		});

		// --- Outputs ---
		new cdk.CfnOutput(this, 'FunctionUrl', { value: this.functionUrl.url });
		new cdk.CfnOutput(this, 'FunctionName', { value: this.fn.functionName });
		new cdk.CfnOutput(this, 'EcrRepositoryUri', { value: this.repository.repositoryUri });
	}
}
