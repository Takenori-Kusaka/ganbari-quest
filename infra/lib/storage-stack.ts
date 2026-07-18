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

/**
 * S3 (assets) + ECR (Lambda container image) + DynamoDB `MainTable` を提供する Storage stack。
 *
 * DynamoDB single-table (`MainTable` / GSI1 / GSI2) は EPIC #3424 (DynamoDB → Aurora DSQL 移管)
 * の capstone #3438 で撤去予定だが、**cross-stack export の in-use 削除制約により 2-deploy に分割**
 * する (#3850)。CloudFormation は「利用中の export は削除も値変更も不可」であり、producer(本 stack)
 * が export を消す前に consumer(ComputeStack) が import を落とし終えている必要がある。1 回の synth で
 * Storage template は固定 (Storage → Auth → Compute の producer-first 固定順) のため、同一リリース内で
 * consumer を先に更新することはできない。よって CFN 標準の 2-deploy パターンを採る:
 *   - Deploy-1 (本 stack の現状 / #3850): consumer は import を落とす (#3438 で `grantReadWriteData` +
 *     `DYNAMODB_TABLE` env を撤去済) が、producer は table + export を保持する。
 *   - Deploy-2 (次リリース / follow-up): consumer の import が本番反映され消失した後、producer が
 *     table + `exportValue` を撤去する (この時点で export は in-use ではないため削除成功)。
 *
 * prod は removalPolicy=RETAIN のため、Deploy-2 での table 撤去時も CloudFormation は table を
 * orphan 化するのみ (物理 table + データは AWS 上に保全、物理削除は別 ops 手順 / PO 承認)。
 * DB backend の SSOT は既に DSQL (`DsqlStack`) 一本であり、本 table は runtime で参照されない
 * (health は probePg、analytics は on-demand 化済)。本 stack が table を保持するのは Deploy-1 の
 * export 保持のためだけであり、アプリケーションは DynamoDB を読み書きしない。
 */
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

		// --- #3850: cross-stack export を明示保持 (2-deploy migration の肝) ---
		// #3438 で ComputeStack は MainTable への参照を全撤去したため、Storage → Compute の
		// cross-stack export を生成していた consumer 参照が消えた。CDK は参照ゼロの export を
		// synth 時に自動削除するが、CloudFormation は「未だ本番反映されていない (= import 中の)
		// consumer」があると in-use 判定で export 削除を拒否し、StorageStack rollback → 本番
		// deploy.yml 停止に至る (#3850)。`exportValue` は正にこの removal migration 用途の CDK
		// 公式 API であり、consumer 参照が消えた後も同一名の export を保持させる。
		//
		// **旧 (デプロイ済) ComputeStack が import する MainTable export は 2 種類ある** — Arn だけ
		// 保持した #3855 が deploy-aws-staging 貫通で再 rollback した真因は、この Ref を保持し忘れた
		// ことにある。旧 compute-stack.ts (撤去コミット 9ebd59e1 の親版) の `props.table.*` 全参照を
		// 実測すると、consumer が import する export の完全集合は以下 2 つ (第 3 の export はない):
		//   1. Ref export  `${stackName}:ExportsOutputRefMainTable<hash>`
		//      ← `props.table.tableName!` (= CFN `Ref MainTable`) を参照する
		//        `TABLE_NAME` / `DYNAMODB_TABLE` / `ANALYTICS_TABLE_NAME` env 6 箇所。全て同一
		//        `Ref MainTable` に解決されるため export は 1 本 (使用箇所数に依らない)。
		//   2. Arn export  `${stackName}:ExportsOutputFnGetAttMainTable<hash>Arn`
		//      ← `props.table.grantReadWriteData(this.fn)` の IAM policy が参照する
		//        `Fn::GetAtt MainTable Arn`。export は 1 本。
		// どちらか一方でも消すと、その export を import 中の未反映 consumer が in-use 削除拒否を
		// 引き起こす。よって Deploy-1 では **両方**を保持する。明示 name は渡さない — CDK が
		// prod / staging 各 stack 名 (`GanbariQuest{,Staging}Storage`) で auto-export と同一名を
		// 自動再生成するため、staging との名前衝突を避けられる。Deploy-2 (#3854) で consumer の
		// import 消失が本番反映された後、この 2 行と table 構築を撤去すれば両 export とも in-use で
		// なくなり安全に削除できる (regression guard: tests/unit/infra/staging-cdk.test.ts B-3850)。
		this.exportValue(this.table.tableName); // Ref export (TABLE_NAME 等 env、#3855 で欠落 → #3850 再発)
		this.exportValue(this.table.tableArn); // Arn export (grantReadWriteData IAM policy)

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
