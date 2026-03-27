import * as cdk from 'aws-cdk-lib';
import * as backup from 'aws-cdk-lib/aws-backup';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as events from 'aws-cdk-lib/aws-events';
import * as s3 from 'aws-cdk-lib/aws-s3';
import type { Construct } from 'constructs';

export class StorageStack extends cdk.Stack {
	public readonly table: dynamodb.TableV2;
	public readonly assetsBucket: s3.Bucket;
	public readonly repository: ecr.Repository;

	constructor(scope: Construct, id: string, props?: cdk.StackProps) {
		super(scope, id, props);

		// --- DynamoDB: Single-table design ---
		this.table = new dynamodb.TableV2(this, 'MainTable', {
			tableName: 'ganbari-quest',
			partitionKey: { name: 'PK', type: dynamodb.AttributeType.STRING },
			sortKey: { name: 'SK', type: dynamodb.AttributeType.STRING },
			billing: dynamodb.Billing.onDemand(),
			removalPolicy: cdk.RemovalPolicy.RETAIN,
			pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: false },
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

		// --- AWS Backup: Daily backup with 3-day retention (cheaper than PITR) ---
		const vault = new backup.BackupVault(this, 'BackupVault', {
			backupVaultName: 'ganbari-quest-vault',
			removalPolicy: cdk.RemovalPolicy.DESTROY,
		});

		const plan = new backup.BackupPlan(this, 'BackupPlan', {
			backupPlanName: 'ganbari-quest-daily',
			backupPlanRules: [
				new backup.BackupPlanRule({
					ruleName: 'daily-3day-retention',
					scheduleExpression: events.Schedule.cron({ hour: '18', minute: '0' }),
					deleteAfter: cdk.Duration.days(3),
					backupVault: vault,
				}),
			],
		});

		plan.addSelection('DynamoDB', {
			resources: [backup.BackupResource.fromDynamoDbTable(this.table)],
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
				{
					id: 'archive-logs-to-glacier',
					prefix: 'logs/',
					transitions: [
						{
							storageClass: s3.StorageClass.GLACIER,
							transitionAfter: cdk.Duration.days(1),
						},
					],
				},
			],
		});

		// --- ECR Repository for Lambda container image ---
		this.repository = new ecr.Repository(this, 'AppRepo', {
			repositoryName: 'ganbari-quest',
			removalPolicy: cdk.RemovalPolicy.RETAIN,
			lifecycleRules: [
				{
					maxImageCount: 10,
					description: 'Keep 10 most recent images for rollback (~2 weeks)',
				},
				{
					tagStatus: ecr.TagStatus.UNTAGGED,
					maxImageAge: cdk.Duration.days(1),
					description: 'Delete untagged images after 1 day',
				},
			],
		});

		// --- Outputs ---
		new cdk.CfnOutput(this, 'TableName', { value: this.table.tableName! });
		new cdk.CfnOutput(this, 'AssetsBucketName', { value: this.assetsBucket.bucketName });
		new cdk.CfnOutput(this, 'EcrRepositoryUri', { value: this.repository.repositoryUri });
	}
}
