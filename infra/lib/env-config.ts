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
	/** AWS Backup (daily plan) を構築するか。staging は空 table のため不要 */
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

/** AWS staging (#2873)。idle≈¥0 (Lambda リクエスト課金 / DynamoDB on-demand / 固定費 = ECR repo のみ) */
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
