import * as cdk from 'aws-cdk-lib';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as s3 from 'aws-cdk-lib/aws-s3';
import type { Construct } from 'constructs';
import { type GqEnvConfig, PROD_ENV_CONFIG } from './env-config';

export interface StorageStackProps extends cdk.StackProps {
	/**
	 * 環境設定 (#2873)。未指定時は PROD_ENV_CONFIG (現行 prod 値) — prod template 不変条件。
	 * staging は STAGING_ENV_CONFIG を渡し、prefix 分離 + DESTROY + ECR maxImageCount:3 で構築する。
	 */
	envConfig?: GqEnvConfig;
}

/**
 * S3 (assets) + ECR (Lambda container image) を提供する Storage stack。
 *
 * DynamoDB single-table (`MainTable` / GSI1 / GSI2) + その AWS Backup (daily plan) は
 * EPIC #3424 (DynamoDB → Aurora DSQL 移管) の capstone で撤去した。DB backend は DSQL
 * (`DsqlStack`) が唯一の SSOT であり、本 stack は DB リソースを持たない。
 *
 * 撤去は cross-stack export の in-use 削除制約により 2-deploy に分割した (#3438 → #3850 → #3854):
 *   - Deploy-1 (#3850): consumer(ComputeStack) は MainTable への参照を全撤去したが (#3438)、
 *     producer(本 stack) は table + `exportValue(tableName)` (Ref) + `exportValue(tableArn)` (Arn)
 *     の 2 本を保持した (CFN は import 中の未反映 consumer がいる export の削除を拒否するため)。
 *   - Deploy-2 (#3854、本 stack の現状): consumer の import 消失が本番反映された後、table + AWS Backup
 *     + 両 export を撤去した (この時点で両 export とも in-use ではないため削除成功)。
 *
 * prod は removalPolicy=RETAIN だったため、CloudFormation は既存 MainTable を「管理から外す
 * (orphan)」だけで物理 table + データは AWS 上に保全される (物理削除は別 ops 手順 / PO 承認)。
 */
export class StorageStack extends cdk.Stack {
	public readonly assetsBucket: s3.Bucket;
	public readonly repository: ecr.Repository;

	constructor(scope: Construct, id: string, props?: StorageStackProps) {
		super(scope, id, props);

		const cfg = props?.envConfig ?? PROD_ENV_CONFIG;
		const prefix = cfg.resourcePrefix;
		const isProd = cfg.envName === 'prod';

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
		new cdk.CfnOutput(this, 'AssetsBucketName', { value: this.assetsBucket.bucketName });
		new cdk.CfnOutput(this, 'EcrRepositoryUri', { value: this.repository.repositoryUri });
	}
}
