import * as cdk from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as s3 from 'aws-cdk-lib/aws-s3';
import type { Construct } from 'constructs';

export class StorageStack extends cdk.Stack {
	public readonly table: dynamodb.TableV2;
	public readonly assetsBucket: s3.Bucket;

	constructor(scope: Construct, id: string, props?: cdk.StackProps) {
		super(scope, id, props);

		// --- DynamoDB: Single-table design ---
		this.table = new dynamodb.TableV2(this, 'MainTable', {
			tableName: 'ganbari-quest',
			partitionKey: { name: 'PK', type: dynamodb.AttributeType.STRING },
			sortKey: { name: 'SK', type: dynamodb.AttributeType.STRING },
			billing: dynamodb.Billing.onDemand(),
			removalPolicy: cdk.RemovalPolicy.RETAIN,
			pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
			globalSecondaryIndexes: [
				{
					indexName: 'GSI1',
					partitionKey: { name: 'SK', type: dynamodb.AttributeType.STRING },
					sortKey: { name: 'PK', type: dynamodb.AttributeType.STRING },
				},
				{
					indexName: 'GSI2',
					partitionKey: { name: 'GSI2PK', type: dynamodb.AttributeType.STRING },
					sortKey: { name: 'GSI2SK', type: dynamodb.AttributeType.STRING },
				},
			],
		});

		// --- S3: Avatar images & backups ---
		this.assetsBucket = new s3.Bucket(this, 'AssetsBucket', {
			bucketName: `ganbari-quest-assets-${this.account}`,
			removalPolicy: cdk.RemovalPolicy.RETAIN,
			blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
			encryption: s3.BucketEncryption.S3_MANAGED,
			lifecycleRules: [
				{
					id: 'delete-old-backups',
					prefix: 'backups/',
					expiration: cdk.Duration.days(30),
				},
			],
		});

		// --- Outputs ---
		new cdk.CfnOutput(this, 'TableName', { value: this.table.tableName! });
		new cdk.CfnOutput(this, 'AssetsBucketName', { value: this.assetsBucket.bucketName });
	}
}
