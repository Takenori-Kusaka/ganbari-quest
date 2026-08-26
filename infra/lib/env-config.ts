import * as cdk from 'aws-cdk-lib';

/**
 * 環境別 CDK 設定 SSOT (#2873 / EPIC #2861 D 系)
 *
 * 本番 6 stack と AWS staging 3 stack (Storage / Auth / Compute) を同一 stack class で
 * 構築するための環境設定。staging 専用 class の複製 (二重管理) は不採用。
 *
 * 不変条件 (#2873 AC4 / ADR-0019):
 *   - PROD_ENV_CONFIG は現行 prod の物理名・挙動と完全一致させる。各 stack の
 *     optional `envConfig` prop の default はこの PROD_ENV_CONFIG であり、
 *     `-c stagingEnabled=true` 無しの synth で prod template は従来と同一になる。
 *   - 検証: tests/unit/infra/staging-cdk.test.ts (prod 不変 guard)。
 */
export interface GqEnvConfig {
	/** 環境名 ('prod' | 'staging')。stack 内の環境分岐に使う */
	readonly envName: 'prod' | 'staging';
	/** 物理リソース名 prefix (table / Lambda / log group / pool / bucket / ECR repo) */
	readonly resourcePrefix: string;
	/** SSM パラメータ prefix (例: '/ganbari-quest' / '/ganbari-quest-staging') */
	readonly ssmPrefix: string;
	/**
	 * AWS Backup vault (RETAIN-orphan) を構築するか。prod のみ true。
	 * #3854 で DynamoDB MainTable + BackupPlan/Selection/Role を撤去した際、vault も撤去すると
	 * recovery point 2 件を持つ `ganbari-quest-vault` が「recovery point 有り vault は削除不可」
	 * の AWS Backup API 制約で deploy 失敗 → rollback → orphan (#3881 class) になる。よって vault
	 * は `removalPolicy: RETAIN` で保持し (旧 MainTable RETAIN-orphan と一貫)、backup データ
	 * (recovery point) は移行安定までの安全網として非削除で残す。物理 empty→delete は移行安定後の
	 * gated out-of-band ops (PO 承認必須)。詳細は infra/CLAUDE.md / 設計書 §3.1。
	 */
	readonly enableBackup: boolean;
	/** demo Lambda (ADR-0048) を構築するか。staging は不要 */
	readonly enableDemoLambda: boolean;
	/** cron-dispatcher + EventBridge Rules (#1376) を構築するか。staging は不要 */
	readonly enableCronDispatcher: boolean;
	/** CloudWatch Logs → Firehose → S3 の log archiving を構築するか。staging は不要 */
	readonly enableLogArchiving: boolean;
	/** stateful リソース (table / bucket / ECR / pool) の RemovalPolicy */
	readonly removalPolicy: cdk.RemovalPolicy;
}

/**
 * assets バケットの物理名 (SSOT、#4724)。
 *
 * StorageStack が bucket を作るときと、DsqlStack が AWS Backup の selection に載せるときの
 * 2 箇所で使う。**片方だけ変えると「バックアップしているつもりで別のバケットを見ている」**
 * になり、しかも成功扱いで気付けないため 1 関数に閉じる。cross-stack export を作らない
 * ために ARN を GetAtt で渡さず、両 stack がそれぞれ自分の account でこの関数を呼ぶ
 * (`tests/unit/infra/assets-backup.test.ts` が両者の一致を機械検証する)。
 */
export function assetsBucketName(resourcePrefix: string, account: string): string {
	return `${resourcePrefix}-assets-${account}`;
}

/** 上記バケットの ARN。AWS Backup の BackupResource.fromArn() に渡す。 */
export function assetsBucketArn(resourcePrefix: string, account: string): string {
	return `arn:aws:s3:::${assetsBucketName(resourcePrefix, account)}`;
}

/** 現行 prod 値 (default)。値を変えると prod template が変わるため変更禁止 (ADR-0019) */
export const PROD_ENV_CONFIG: GqEnvConfig = {
	envName: 'prod',
	resourcePrefix: 'ganbari-quest',
	ssmPrefix: '/ganbari-quest',
	enableBackup: true,
	enableDemoLambda: true,
	enableCronDispatcher: true,
	enableLogArchiving: true,
	removalPolicy: cdk.RemovalPolicy.RETAIN,
};

/** AWS staging (#2873)。idle≈¥0 (Lambda リクエスト課金 / 固定費 = ECR repo のみ) */
export const STAGING_ENV_CONFIG: GqEnvConfig = {
	envName: 'staging',
	resourcePrefix: 'ganbari-quest-staging',
	ssmPrefix: '/ganbari-quest-staging',
	enableBackup: false,
	enableDemoLambda: false,
	enableCronDispatcher: false,
	enableLogArchiving: false,
	removalPolicy: cdk.RemovalPolicy.DESTROY,
};
