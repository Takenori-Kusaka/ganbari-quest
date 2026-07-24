import * as cdk from 'aws-cdk-lib';
import * as backup from 'aws-cdk-lib/aws-backup';
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
 * S3 (assets) + ECR (Lambda container image) + AWS Backup vault (RETAIN-orphan) を提供する Storage stack。
 *
 * DynamoDB single-table (`MainTable` / GSI1 / GSI2) + その AWS Backup **plan / selection / role** は
 * EPIC #3424 (DynamoDB → Aurora DSQL 移管) の capstone で撤去した。DB backend は DSQL
 * (`DsqlStack`) が唯一の SSOT であり、本 stack は DB table リソースを持たず新規 backup も取らない。
 *
 * 撤去は cross-stack export の in-use 削除制約により 2-deploy に分割した (#3438 → #3850 → #3854):
 *   - Deploy-1 (#3850): consumer(ComputeStack) は MainTable への参照を全撤去したが (#3438)、
 *     producer(本 stack) は table + `exportValue(tableName)` (Ref) + `exportValue(tableArn)` (Arn)
 *     の 2 本を保持した (CFN は import 中の未反映 consumer がいる export の削除を拒否するため)。
 *   - Deploy-2 (#3854): consumer の import 消失が本番反映された後、table + BackupPlan/Selection/Role
 *     + 両 export を撤去した (この時点で両 export とも in-use ではないため削除成功)。
 *
 * prod は removalPolicy=RETAIN だったため、CloudFormation は既存 MainTable を「管理から外す
 * (orphan)」だけで物理 table + データは AWS 上に保全される (物理削除は別 ops 手順 / PO 承認)。
 *
 * **BackupVault だけは RETAIN で残す (#3881 class 回避、本 stack の現状)**: #3854 が旧 MainTable の
 * 日次 backup 用 `BackupVault` (`ganbari-quest-vault`) も撤去しようとしたが、この vault は旧 daily plan
 * が生成した recovery point 2 件を保持しており、**AWS Backup は「recovery point を持つ vault の削除」を
 * API レベルで拒否する** (CloudFormation も同じ)。よって vault 撤去は deploy 失敗 → StorageStack
 * rollback → 本番 deploy 停止 (#3881 と同一クラス) を招く。canonical 解は、移行中の backup データ削除
 * (破壊的・不可逆) を避けて **vault を残しつつ `removalPolicy: RETAIN` に是正**することであり、これは
 * 旧 table を RETAIN-orphan で残した判断と一貫する (recovery point 2 件は移行安定までの安全網)。
 * plan / selection / role は table を参照する stateless リソースのため撤去済 = 新規 backup は取らない。
 * 旧 vault は `removalPolicy: DESTROY` (= DeletionPolicy: Delete) だったが、これは AWS Backup の CDK 既定
 * RETAIN に反しており、まさに削除を試みさせていた元凶。RETAIN に是正することで将来 vault を template
 * から外す時も orphan 化で安全に外せる。vault の物理 empty→delete (recovery point ×2 削除 → vault 削除)
 * は移行安定後の gated out-of-band ops (PO 承認必須。infra/CLAUDE.md / 設計書 §3.1 に手順)。
 */
export class StorageStack extends cdk.Stack {
	public readonly assetsBucket: s3.Bucket;
	public readonly repository: ecr.Repository;

	constructor(scope: Construct, id: string, props?: StorageStackProps) {
		super(scope, id, props);

		const cfg = props?.envConfig ?? PROD_ENV_CONFIG;
		const prefix = cfg.resourcePrefix;
		const isProd = cfg.envName === 'prod';

		// --- AWS Backup vault: RETAIN-orphan (#3881 class 回避) ---
		// 旧 MainTable の日次 backup 用 vault。plan / selection / role は #3854 で撤去済 (= 新規 backup
		// は取らない) だが、vault 自体は recovery point 2 件を保持しており AWS Backup が「recovery point
		// 有り vault の削除」を拒否するため、撤去すると deploy 失敗 → rollback → orphan (#3881) になる。
		// canonical 解 = 破壊的な backup データ削除を避け vault を RETAIN で残す (旧 table RETAIN-orphan と
		// 一貫、recovery point 2 件は移行安定までの安全網)。removalPolicy は必ず RETAIN — CDK の BackupVault
		// 既定は RETAIN だが、旧実装は DESTROY (= DeletionPolicy: Delete) を明示して既定に反し削除を試みて
		// いた。ここで RETAIN に是正することで、将来 vault を template から外す時も orphan 化で安全に外せる。
		// vault の物理 empty→delete は移行安定後の gated out-of-band ops (PO 承認必須、設計書 §3.1)。
		// staging (#2873) は空 table 起点 + 使い捨て可能で backup 対象が無いため vault 自体を構築しない。
		if (cfg.enableBackup) {
			const vault = new backup.BackupVault(this, 'BackupVault', {
				backupVaultName: `${prefix}-vault`,
				removalPolicy: cdk.RemovalPolicy.RETAIN,
			});
			// DeletionPolicy 変更 (Delete→Retain) は CFN 上 metadata であり property 差分が無いと
			// resource update が skip され得るため、benign な tag を 1 つ付けて確実に resource を
			// 再処理させる (in-place update、replacement ではない)。tag 値自体が「なぜこの vault が
			// template に残っているか」を AWS console 上でも自己説明する。
			cdk.Tags.of(vault).add('gq-lifecycle', 'retained-pending-ops-cleanup');
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
		new cdk.CfnOutput(this, 'AssetsBucketName', { value: this.assetsBucket.bucketName });
		new cdk.CfnOutput(this, 'EcrRepositoryUri', { value: this.repository.repositoryUri });
	}
}
