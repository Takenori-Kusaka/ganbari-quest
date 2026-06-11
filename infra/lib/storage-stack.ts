import * as cdk from 'aws-cdk-lib';
import * as backup from 'aws-cdk-lib/aws-backup';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as events from 'aws-cdk-lib/aws-events';
import * as s3 from 'aws-cdk-lib/aws-s3';
import type { Construct } from 'constructs';
import { type GqEnvConfig, PROD_ENV_CONFIG } from './env-config';

export interface StorageStackProps extends cdk.StackProps {
	/**
	 * 環境設定 (#2873)。未指定時は PROD_ENV_CONFIG (現行 prod 値) — prod template 不変条件。
	 * staging は STAGING_ENV_CONFIG を渡し、prefix 分離 + Backup 省略 + DESTROY +
	 * ECR maxImageCount:3 で構築する。
	 */
	envConfig?: GqEnvConfig;
}

export class StorageStack extends cdk.Stack {
	public readonly table: dynamodb.TableV2;
	public readonly assetsBucket: s3.Bucket;
	public readonly repository: ecr.Repository;

	constructor(scope: Construct, id: string, props?: StorageStackProps) {
		super(scope, id, props);

		const cfg = props?.envConfig ?? PROD_ENV_CONFIG;
		const prefix = cfg.resourcePrefix;
		const isProd = cfg.envName === 'prod';

		// --- DynamoDB: Single-table design ---
		// timeToLiveAttribute='ttl': analytics event log (90 日 / DynamoAnalyticsProvider) と
		// analytics 事前集計レコード (#1693, 365 日) の自動失効に使用。レコード側で `ttl` 属性に
		// epoch seconds (UTC) を入れた行が DynamoDB バックグラウンドプロセスで自動削除される。
		// TTL を持たないアプリケーションレコード (CHILD#... 等) は `ttl` 属性を持たないため影響なし。
		this.table = new dynamodb.TableV2(this, 'MainTable', {
			tableName: prefix,
			partitionKey: { name: 'PK', type: dynamodb.AttributeType.STRING },
			sortKey: { name: 'SK', type: dynamodb.AttributeType.STRING },
			billing: dynamodb.Billing.onDemand(),
			removalPolicy: cfg.removalPolicy,
			pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: false },
			timeToLiveAttribute: 'ttl',
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
		// staging (#2873): 空 table 起点 + 使い捨て可能なため Backup 構成自体を省略する (idle≈¥0)。
		if (cfg.enableBackup) {
			const vault = new backup.BackupVault(this, 'BackupVault', {
				backupVaultName: `${prefix}-vault`,
				removalPolicy: cdk.RemovalPolicy.DESTROY,
			});

			const plan = new backup.BackupPlan(this, 'BackupPlan', {
				backupPlanName: `${prefix}-daily`,
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
		}

		// --- S3: Avatar images & backups ---
		this.assetsBucket = new s3.Bucket(this, 'AssetsBucket', {
			bucketName: `${prefix}-assets-${this.account}`,
			removalPolicy: cfg.removalPolicy,
			blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
			encryption: s3.BucketEncryption.S3_MANAGED,
			// staging (#2873): DESTROY 時に bucket を空にしてから削除できるようにする
			autoDeleteObjects: cfg.removalPolicy === cdk.RemovalPolicy.DESTROY,
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
		// staging (#2873): prod repo 共有は不採用 (prod rollback の `[-2]` digest 選択 +
		// lifecycle maxImageCount:10 を staging push が侵食するため)。staging 専用 repo を
		// maxImageCount:3 で新設する (固定費 ≈$0.05〜0.15/月、idle≈¥0 承認範囲内)。
		this.repository = new ecr.Repository(this, 'AppRepo', {
			repositoryName: prefix,
			removalPolicy: cfg.removalPolicy,
			imageScanOnPush: true,
			lifecycleRules: [
				{
					maxImageCount: isProd ? 10 : 3,
					description: isProd
						? 'Keep 10 most recent images for rollback (~2 weeks)'
						: 'Keep 3 most recent images for staging rollback (#2873)',
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
