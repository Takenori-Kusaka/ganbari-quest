// tests/unit/infra/physical-name-ratchet.test.ts
// #3881 (ADR-0061 same-class→guard / fitness function): 明示物理名 (explicit physical name) の
// allowlist ratchet gate。
//
// ## なぜ必要か (root class = rollback-orphan → "already exists" deploy block)
// 第16回リリース (2026-07-18) で、DsqlBackupRole の IAM description 非 ASCII → CREATE_FAILED →
// stack rollback の際に、明示物理名を持つ DsqlBackupVault (`ganbari-quest-dsql-vault`) が中途作成の
// まま orphan 化し、次 deploy が `already exists` (名前衝突) で block された (#3870 / #3872 / #3881)。
// これは AWS CloudFormation の設計上の既知挙動で、**明示物理名を持つ限り、任意の create 失敗要因
// (quota / IAM 結果整合性 / service エラー / dependency 失敗) で同 class が再発する**:
//   - rollback は作成物を削除するが、削除できないリソースは orphan 化する (physical 残存)
//     https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/troubleshooting.html
//   - 物理名は "unique across all your active stacks" — 衝突すると deploy 失敗
//     https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-properties-name.html
//   - AWS 推奨回避 = 物理名を明示せず CloudFormation auto-naming に委ねる (同上)
// #3874 の層別防御 (infra/CLAUDE.md §CDK deploy 失敗の層別) では Layer 2 (project 固有 fitness)。
// Layer 1 (cfn-lint) は property 制約しか見ないため本 class を捕捉できない。
//
// ## 何をするか
// 1. bin/app.ts が instantiate し得る全 11 stack (prod 6 + Dsql prod/staging + AWS staging 3) を
//    synth し、CFN type ごとの物理名 property (RoleName / BucketName / FunctionName 等) を全抽出する。
// 2. allowlist (既存 baseline、justification 付き) と**集合として過不足なく一致**することを assert:
//    - allowlist 外の新規明示物理名 = fail (新規リソースは名前省略 = CFN auto-naming が既定)
//    - allowlist の stale entry = fail (撤去したら entry も削除 = ratchet は一方通行で減らす)
//
// ## ratchet 運用
// - **新規リソースに明示物理名を付けない** (CFN auto-naming はランダム suffix を生成するため
//   rollback-orphan が残っても次 deploy と名前衝突しない)。
// - どうしても明示名が必要な場合 (外部参照される固定名 / SSM path 契約等) のみ、stack 側に
//   justification コメントを書いたうえで本 allowlist に entry (reason 付き) を追加する。
// - 既存 RETAIN stateful named (vault / pool / bucket / ECR / backup-role) は **rename しない**
//   (rename = replacement = データ喪失)。orphan 化した場合の掃除手順は
//   docs/runbooks/rollback-orphan-cleanup.md を参照。
//
// ## 検出の注意 (required-name type)
// AWS::CloudFront::Function の Name は CFN 必須 prop のため CDK が常に literal を emit する
// (明示/自動を template から区別できない)。baseline に pin し、新規追加時は entry 追加を強制する
// (CDK 生成名も construct path に安定依存するため rollback-orphan 衝突 class は同じ)。

import * as cdk from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { describe, expect, it } from 'vitest';
import { AuthStack } from '../../../infra/lib/auth-stack';
import { ComputeStack } from '../../../infra/lib/compute-stack';
import { DsqlStack } from '../../../infra/lib/dsql-stack';
import { STAGING_ENV_CONFIG } from '../../../infra/lib/env-config';
import { NetworkStack } from '../../../infra/lib/network-stack';
import { OpsStack } from '../../../infra/lib/ops-stack';
import { SesStack } from '../../../infra/lib/ses-stack';
import { StorageStack } from '../../../infra/lib/storage-stack';

const env: cdk.Environment = { account: '000000000000', region: 'us-east-1' };

// cspell:ignore hostedzone TESTPOOL
function makeApp(): cdk.App {
	return new cdk.App({
		context: {
			'hosted-zone:account=000000000000:domainName=ganbari-quest.com:region=us-east-1': {
				Id: '/hostedzone/Z00000000000000000000',
				Name: 'ganbari-quest.com.',
			},
			'ssm:account=000000000000:parameterName=/ganbari-quest/cognito/user-pool-id:region=us-east-1':
				'us-east-1_TESTPOOL',
			'ssm:account=000000000000:parameterName=/ganbari-quest/cognito/client-id:region=us-east-1':
				'test-client-id',
			'ssm:account=000000000000:parameterName=/ganbari-quest/cognito/domain:region=us-east-1':
				'auth.ganbari-quest.com',
			'ssm:account=000000000000:parameterName=/ganbari-quest/context-token-secret:region=us-east-1':
				'test-context-token-secret',
			opsSecretKey: 'test-ops-secret-key',
			parentGateCookieSecret: 'test-parent-gate-secret-do-not-use-do-not-use',
			dsqlEndpoint: 'testcluster1234.dsql.us-east-1.on.aws',
			dsqlClusterArn: 'arn:aws:dsql:us-east-1:000000000000:cluster/testcluster1234',
		},
	});
}

/**
 * bin/app.ts が instantiate し得る全 stack (prod 6 + Dsql prod + Dsql staging + AWS staging 3)
 * の Template を返す (iam-role-description-ascii.test.ts と同一 wire = 網羅性 SSOT)。
 */
function buildAllTemplates(): Array<[string, Template]> {
	const templates: Array<[string, Template]> = [];

	// --- prod 6 stack ---
	const app = makeApp();
	const storage = new StorageStack(app, 'GanbariQuestStorage', { env });
	const auth = new AuthStack(app, 'GanbariQuestAuth', {
		env,
		appDomain: 'ganbari-quest.com',
		certificateArn: 'arn:aws:acm:us-east-1:000000000000:certificate/test',
	});
	const compute = new ComputeStack(app, 'GanbariQuestCompute', {
		env,
		assetsBucket: storage.assetsBucket,
		repository: storage.repository,
	});
	const network = new NetworkStack(app, 'GanbariQuestNetwork', {
		env,
		functionUrl: compute.functionUrl,
		// #4280: front door shared secret (NetworkStackProps 必須)。テスト用ダミー値。
		originVerifySecret: 'test-origin-verify-secret-0000000000000000',
		domainName: 'ganbari-quest.com',
		certificateArn: 'arn:aws:acm:us-east-1:000000000000:certificate/test',
		demoFunctionUrl: compute.demoFunctionUrl,
	});
	const ses = new SesStack(app, 'GanbariQuestSes', { env, domainName: 'ganbari-quest.com' });
	const ops = new OpsStack(app, 'GanbariQuestOps', {
		env,
		lambdaFn: compute.fn,
		distribution: network.distribution,
		functionUrl: compute.functionUrl,
		cronDispatcherFn: compute.cronDispatcherFn,
		staticAssetsBucket: network.staticAssetsBucket,
		// #3998: prod (infra/bin/app.ts) と同じ配線にする。渡さないと log 由来 alarm が
		// この ratchet の観測対象から外れ、明示物理名の増加を見逃す。
		appLogGroup: compute.appLogGroup,
		opsEmail: 'ops@example.com',
	});
	for (const [name, stack] of [
		['GanbariQuestStorage', storage],
		['GanbariQuestAuth', auth],
		['GanbariQuestCompute', compute],
		['GanbariQuestNetwork', network],
		['GanbariQuestSes', ses],
		['GanbariQuestOps', ops],
	] as const) {
		templates.push([name, Template.fromStack(stack)]);
	}

	// --- DSQL prod (backup vault / role / rule / budget を含む) + DSQL staging ---
	templates.push([
		'GanbariQuestDsql',
		Template.fromStack(
			new DsqlStack(makeApp(), 'GanbariQuestDsql', { env, opsEmail: 'ops@example.com' }),
		),
	]);
	templates.push([
		'GanbariQuestDsqlStaging',
		Template.fromStack(
			new DsqlStack(makeApp(), 'GanbariQuestDsqlStaging', { env, deletionProtection: false }),
		),
	]);

	// --- AWS staging 3 stack (#2873) ---
	const stagingApp = makeApp();
	const stStorage = new StorageStack(stagingApp, 'GanbariQuestStorageStaging', {
		env,
		envConfig: STAGING_ENV_CONFIG,
	});
	const stAuth = new AuthStack(stagingApp, 'GanbariQuestAuthStaging', {
		env,
		envConfig: STAGING_ENV_CONFIG,
	});
	const stCompute = new ComputeStack(stagingApp, 'GanbariQuestComputeStaging', {
		env,
		assetsBucket: stStorage.assetsBucket,
		repository: stStorage.repository,
		envConfig: STAGING_ENV_CONFIG,
	});
	for (const [name, stack] of [
		['GanbariQuestStorageStaging', stStorage],
		['GanbariQuestAuthStaging', stAuth],
		['GanbariQuestComputeStaging', stCompute],
	] as const) {
		templates.push([name, Template.fromStack(stack)]);
	}

	return templates;
}

/**
 * CFN resource type → 物理名 property の path。
 * この repo に現存する type + 今後追加されやすい named type を網羅する。
 * (AWS::Cognito::UserPoolDomain の Domain は DNS prefix で class が異なるため対象外)
 */
const PHYSICAL_NAME_PROPS: Record<string, readonly string[]> = {
	'AWS::IAM::Role': ['RoleName'],
	'AWS::IAM::ManagedPolicy': ['ManagedPolicyName'],
	'AWS::S3::Bucket': ['BucketName'],
	'AWS::ECR::Repository': ['RepositoryName'],
	'AWS::Lambda::Function': ['FunctionName'],
	'AWS::Backup::BackupVault': ['BackupVaultName'],
	'AWS::Backup::BackupPlan': ['BackupPlan', 'BackupPlanName'],
	'AWS::Budgets::Budget': ['Budget', 'BudgetName'],
	'AWS::SNS::Topic': ['TopicName'],
	'AWS::Logs::LogGroup': ['LogGroupName'],
	'AWS::Events::Rule': ['Name'],
	'AWS::CloudWatch::Alarm': ['AlarmName'],
	'AWS::SSM::Parameter': ['Name'],
	'AWS::Cognito::UserPool': ['UserPoolName'],
	'AWS::DynamoDB::Table': ['TableName'],
	'AWS::SQS::Queue': ['QueueName'],
	'AWS::CloudFront::Function': ['Name'],
	'AWS::Scheduler::Schedule': ['Name'],
	'AWS::StepFunctions::StateMachine': ['StateMachineName'],
};

/** Properties から path を辿って値を取り出す。 */
function dig(obj: unknown, path: readonly string[]): unknown {
	let cur = obj;
	for (const key of path) {
		if (!cur || typeof cur !== 'object') return undefined;
		cur = (cur as Record<string, unknown>)[key];
	}
	return cur;
}

/** 物理名値を安定 key 文字列化する (token 解決済 literal string が基本、object は JSON 化)。 */
function nameToKey(v: unknown): string {
	return typeof v === 'string' ? v : JSON.stringify(v);
}

/** 1 template から `${stack}/${type}/${name}` key の集合を抽出する。 */
function collectNamedResources(stackName: string, template: Template): Set<string> {
	const found = new Set<string>();
	const json = template.toJSON() as {
		Resources?: Record<string, { Type?: string; Properties?: unknown }>;
	};
	for (const res of Object.values(json.Resources ?? {})) {
		const type = res.Type;
		if (!type) continue;
		const path = PHYSICAL_NAME_PROPS[type];
		if (!path) continue;
		const name = dig(res.Properties, path);
		if (name === undefined) continue; // 名前省略 = CFN auto-naming (推奨既定)
		found.add(`${stackName}/${type}/${nameToKey(name)}`);
	}
	return found;
}

/**
 * allowlist entry。key = `${stack}/${CFN type}/${物理名}` (account は test env の 000000000000)。
 * reason = 明示物理名を保持する justification (新規追加時は必須。「なんとなく」は不可)。
 */
interface NamedResourceEntry {
	key: string;
	reason: string;
}

/** 同一 justification の key 群を entry 化する builder。 */
function group(reason: string, keys: readonly string[]): NamedResourceEntry[] {
	return keys.map((key) => ({ key, reason }));
}

// #3881 実測 baseline (2026-07-19、全 11 stack synth = 58 件 + #3907 保全 vault 1 件 = 59 件)。既存の明示物理名はここに pin し、
// **一方通行で減らす** (rename は replacement = データ喪失リスクのため既存は rename しない。
// リソース撤去時に entry を削除する)。新規追加は「auto-naming で代替できない」justification が
// ある場合のみ許容し、reason に根拠を書く。
const NAMED_RESOURCE_ALLOWLIST: readonly NamedResourceEntry[] = [
	...group(
		'RETAIN stateful。rename = replacement = 全 user / データ喪失 (auth-stack.ts / ADR-0017 系の orphan pool 実害履歴)。#3881 AC2 により rename せず pin',
		[
			'GanbariQuestAuth/AWS::Cognito::UserPool/ganbari-quest-users-v2',
			'GanbariQuestAuthStaging/AWS::Cognito::UserPool/ganbari-quest-staging-users-v2',
		],
	),
	...group(
		'RETAIN stateful + deploy.yml / workflows が固定名参照 (ECR push / assets bucket / support-mail cleanup)。rename = replacement のため pin',
		[
			'GanbariQuestStorage/AWS::ECR::Repository/ganbari-quest',
			'GanbariQuestStorage/AWS::S3::Bucket/ganbari-quest-assets-000000000000',
			'GanbariQuestStorageStaging/AWS::ECR::Repository/ganbari-quest-staging',
			'GanbariQuestStorageStaging/AWS::S3::Bucket/ganbari-quest-staging-assets-000000000000',
			'GanbariQuestSes/AWS::S3::Bucket/ganbari-quest-support-mail-000000000000',
			'GanbariQuestNetwork/AWS::S3::Bucket/ganbari-quest-error-pages-000000000000',
		],
	),
	...group(
		'SSM parameter path は app runtime / cross-stack 参照の固定契約 (path が API)。auto-naming 不可',
		[
			'GanbariQuestAuth/AWS::SSM::Parameter//ganbari-quest/cognito/client-id',
			'GanbariQuestAuth/AWS::SSM::Parameter//ganbari-quest/cognito/user-pool-id',
			'GanbariQuestAuthStaging/AWS::SSM::Parameter//ganbari-quest-staging/cognito/client-id',
			'GanbariQuestAuthStaging/AWS::SSM::Parameter//ganbari-quest-staging/cognito/domain',
			'GanbariQuestAuthStaging/AWS::SSM::Parameter//ganbari-quest-staging/cognito/user-pool-id',
			'GanbariQuestOps/AWS::SSM::Parameter//ganbari-quest/health-check/last-notified-status',
			'GanbariQuestOps/AWS::SSM::Parameter//ganbari-quest/health-check/weekly-stats',
			'GanbariQuestSes/AWS::SSM::Parameter//ganbari-quest/ses/config-set-name',
			'GanbariQuestSes/AWS::SSM::Parameter//ganbari-quest/ses/sender-email',
		],
	),
	...group(
		'deploy.yml / deploy-aws-staging.yml が update-function-code / logs tail / smoke test で functionName を固定名参照 (infra/CLAUDE.md §EventBridge Cron Rules の ops コマンド含む)',
		[
			'GanbariQuestAuth/AWS::Lambda::Function/ganbari-quest-cognito-custom-message',
			'GanbariQuestAuthStaging/AWS::Lambda::Function/ganbari-quest-staging-cognito-custom-message',
			'GanbariQuestCompute/AWS::Lambda::Function/ganbari-quest-app',
			'GanbariQuestCompute/AWS::Lambda::Function/ganbari-quest-app-demo',
			'GanbariQuestCompute/AWS::Lambda::Function/ganbari-quest-cron-dispatcher',
			'GanbariQuestComputeStaging/AWS::Lambda::Function/ganbari-quest-staging-app',
			'GanbariQuestOps/AWS::Lambda::Function/ganbari-quest-health-check',
			'GanbariQuestOps/AWS::Lambda::Function/ganbari-quest-ops-alert-forwarder',
			'GanbariQuestSes/AWS::Lambda::Function/ganbari-quest-ses-receive',
		],
	),
	...group(
		'Lambda functionName 固定に対応する /aws/lambda/<fn> の固定 path (retention 管理を CDK 側で確定させるため事前 provision)',
		[
			'GanbariQuestCompute/AWS::Logs::LogGroup//aws/lambda/ganbari-quest-app',
			'GanbariQuestCompute/AWS::Logs::LogGroup//aws/lambda/ganbari-quest-app-demo',
			'GanbariQuestCompute/AWS::Logs::LogGroup//aws/lambda/ganbari-quest-cron-dispatcher',
			'GanbariQuestComputeStaging/AWS::Logs::LogGroup//aws/lambda/ganbari-quest-staging-app',
			'GanbariQuestOps/AWS::Logs::LogGroup//aws/lambda/ganbari-quest-health-check',
			'GanbariQuestOps/AWS::Logs::LogGroup//aws/lambda/ganbari-quest-ops-alert-forwarder',
		],
	),
	...group(
		'EventBridge Rule 固定名は ops 運用コマンド (`aws events list-rules --name-prefix ganbari-quest-cron`、infra/CLAUDE.md) の識別子契約',
		[
			'GanbariQuestCompute/AWS::Events::Rule/ganbari-quest-cron-age-recalc',
			'GanbariQuestCompute/AWS::Events::Rule/ganbari-quest-cron-deletion-warning-emails',
			'GanbariQuestCompute/AWS::Events::Rule/ganbari-quest-cron-export-build',
			'GanbariQuestCompute/AWS::Events::Rule/ganbari-quest-cron-lifecycle-emails',
			'GanbariQuestCompute/AWS::Events::Rule/ganbari-quest-cron-pmf-survey',
			'GanbariQuestCompute/AWS::Events::Rule/ganbari-quest-cron-retention-cleanup',
			'GanbariQuestCompute/AWS::Events::Rule/ganbari-quest-cron-stripe-webhook-delivery-check',
			'GanbariQuestCompute/AWS::Events::Rule/ganbari-quest-cron-trial-notifications',
			'GanbariQuestOps/AWS::Events::Rule/ganbari-quest-aws-health',
			'GanbariQuestOps/AWS::Events::Rule/ganbari-quest-health-check',
			'GanbariQuestDsql/AWS::Events::Rule/ganbari-quest-dsql-backup-failed',
		],
	),
	...group(
		'CloudWatch Alarm 固定名は ops runbook / Discord 通知の識別子 (infra/CLAUDE.md §CloudWatch Alarm)',
		[
			// #4375 follow-up: AI provider が使えない状態の観測 alarm。
			// runbook / 通知方針表がこの名前で参照する。
			'GanbariQuestOps/AWS::CloudWatch::Alarm/ganbari-quest-ai-provider-unavailable',
			// #4726: AI 呼び出しの fallback 率 alarm。ai-provider-unavailable と同じく
			// 通知方針表 (ops-alert-policy.ts) がこの名前で参照する。
			'GanbariQuestOps/AWS::CloudWatch::Alarm/ganbari-quest-ai-fallback-rate',
			'GanbariQuestOps/AWS::CloudWatch::Alarm/ganbari-quest-auth-entitlement-db-unavailable',
			// #4363 T4: /ops アクセス拒否の観測 alarm (再評価トリガーの発火経路)
			'GanbariQuestOps/AWS::CloudWatch::Alarm/ganbari-quest-ops-access-denied',
			'GanbariQuestOps/AWS::CloudWatch::Alarm/ganbari-quest-cloudfront-5xx',
			'GanbariQuestOps/AWS::CloudWatch::Alarm/ganbari-quest-cron-dispatcher-errors',
			// #4327: 顧客データ物理削除の部分失敗。runbook (grace-period-deletion-operations.md §2) が
			// この名前で参照するため固定名が要る。
			'GanbariQuestOps/AWS::CloudWatch::Alarm/ganbari-quest-grace-period-partial-failure',
			'GanbariQuestOps/AWS::CloudWatch::Alarm/ganbari-quest-lambda-concurrent',
			'GanbariQuestOps/AWS::CloudWatch::Alarm/ganbari-quest-lambda-duration-p99',
			'GanbariQuestOps/AWS::CloudWatch::Alarm/ganbari-quest-lambda-errors',
			'GanbariQuestOps/AWS::CloudWatch::Alarm/ganbari-quest-lambda-throttles',
			'GanbariQuestOps/AWS::CloudWatch::Alarm/ganbari-quest-lambda-url-4xx-spike',
			'GanbariQuestOps/AWS::CloudWatch::Alarm/ganbari-quest-lambda-url-5xx',
			// #4399 follow-up: 通知そのものが届かなかったことの観測 alarm。
			// runbook (ops-alert-notification.md §6) と通知方針表 (ops-alert-policy.ts) が
			// この名前で参照するため固定名が要る。
			'GanbariQuestOps/AWS::CloudWatch::Alarm/ganbari-quest-ops-alert-forward-failed',
		],
	),
	...group('SNS Topic 固定名は ops / SES notification 設定の識別子', [
		'GanbariQuestOps/AWS::SNS::Topic/ganbari-quest-ops-alerts',
		'GanbariQuestSes/AWS::SNS::Topic/ses-bounce-notifications',
		'GanbariQuestSes/AWS::SNS::Topic/ses-complaint-notifications',
	]),
	...group(
		'CloudFront::Function は Name が CFN 必須 prop で CDK が常に literal を emit する (明示/自動を template から区別不能)。現状名を pin',
		[
			'GanbariQuestNetwork/AWS::CloudFront::Function/ganbari-quest-demo-query-slash-encode',
			'GanbariQuestNetwork/AWS::CloudFront::Function/ganbari-quest-query-slash-encode',
		],
	),
	...group(
		'AWS Backup 系 (#3437 で命名済)。vault は #3881 当該 orphan の実例だが RETAIN stateful のため rename = replacement 不可、現状名を pin (掃除は runbooks/rollback-orphan-cleanup.md)',
		[
			'GanbariQuestDsql/AWS::Backup::BackupVault/ganbari-quest-dsql-vault',
			'GanbariQuestDsql/AWS::Backup::BackupPlan/ganbari-quest-dsql-daily',
			'GanbariQuestDsql/AWS::IAM::Role/ganbari-quest-dsql-backup-role',
		],
	),
	...group(
		'#3907 RETAIN-orphan 保全 vault。既存物理 vault (recovery point 保持中、AWS Backup が削除拒否) と同一名の維持が in-place DeletionPolicy 更新の前提であり、rename = replacement CREATE (= #3881 class そのもの) を誘発するため明示名必須。物理 empty→delete は gated ops (storage-stack 設計書 §3.1)',
		['GanbariQuestStorage/AWS::Backup::BackupVault/ganbari-quest-vault'],
	),
	...group('Budgets budgetName は console / cost 監視の識別子 (account 内 unique 制約)', [
		'GanbariQuestDsql/AWS::Budgets::Budget/ganbari-quest-dsql-backup-guardrail',
		'GanbariQuestDsql/AWS::Budgets::Budget/ganbari-quest-dsql-guardrail',
		'GanbariQuestOps/AWS::Budgets::Budget/ganbari-quest-monthly',
	]),
	...group('demo Lambda 実行 role (ADR-0048 IAM role 分離)。deploy 運用で固定名参照', [
		'GanbariQuestCompute/AWS::IAM::Role/ganbari-quest-app-demo-role',
	]),
];

const ALLOWLIST_KEYS: ReadonlySet<string> = new Set(NAMED_RESOURCE_ALLOWLIST.map((e) => e.key));

describe('#3881 明示物理名 allowlist ratchet (rollback-orphan already-exists class の構造的予防)', () => {
	const templates = buildAllTemplates();
	const found = new Set<string>();
	for (const [stackName, template] of templates) {
		for (const key of collectNamedResources(stackName, template)) {
			found.add(key);
		}
	}

	it('[G1] instantiate 対象 11 stack を漏れなく synth できる (網羅性の担保)', () => {
		// stack を追加したら本数を増やす。silent に synth 対象が減っていないことの guard。
		expect(templates.length).toBe(11);
	});

	it('[G2] 明示物理名を持つ全リソースが allowlist 内である (新規明示名 = fail)', () => {
		const unexpected = [...found].filter((k) => !ALLOWLIST_KEYS.has(k)).sort();
		expect(
			unexpected,
			`allowlist 外の明示物理名を検出 (${unexpected.length} 件):\n${unexpected.join('\n')}\n\n` +
				'新規リソースは物理名 prop (roleName / bucketName / functionName 等) を**省略**し、' +
				'CloudFormation auto-naming に委ねるのが既定 (rollback-orphan の already-exists 衝突を' +
				'構造回避、#3881 / AWS 公式推奨)。明示名が本当に必要な場合のみ、stack 側に justification ' +
				'コメントを書き、本 test の NAMED_RESOURCE_ALLOWLIST に reason 付き entry を追加する。',
		).toEqual([]);
	});

	it('[G3] allowlist に stale entry が無い (撤去済みリソース = entry 削除必須、ratchet 一方通行)', () => {
		const stale = NAMED_RESOURCE_ALLOWLIST.map((e) => e.key)
			.filter((k) => !found.has(k))
			.sort();
		expect(
			stale,
			`allowlist にあるが synth で生成されない明示物理名 (${stale.length} 件):\n${stale.join('\n')}\n\n` +
				'リソースを撤去 / auto-naming 化したら、対応 entry を NAMED_RESOURCE_ALLOWLIST から削除する。',
		).toEqual([]);
	});

	it('[G4] 実測集合と allowlist が過不足なく一致する (数の drift を 1 行で可視化)', () => {
		expect(found.size).toBe(NAMED_RESOURCE_ALLOWLIST.length);
		expect(new Set(found)).toEqual(ALLOWLIST_KEYS);
	});
});

describe('#3881 ratchet が有効に機能する (negative test / failing-test-first、ADR-0061)', () => {
	it('明示物理名を持つ新規リソースが現れたら検出される (物理確認)', () => {
		// 故意に「明示 bucketName を持つ新規 bucket」を probe stack に作り、検出ロジックが
		// allowlist 外 violation として返すことを実 synth で実証する (= #3881 と同 class の混入)。
		const app = makeApp();
		const probe = new cdk.Stack(app, 'GanbariQuestProbe', { env });
		new cdk.aws_s3.Bucket(probe, 'ProbeNamedBucket', {
			bucketName: 'ganbari-quest-probe-named-bucket',
		});
		const probeFound = collectNamedResources('GanbariQuestProbe', Template.fromStack(probe));
		const unexpected = [...probeFound].filter((k) => !ALLOWLIST_KEYS.has(k));
		expect(unexpected).toContain(
			'GanbariQuestProbe/AWS::S3::Bucket/ganbari-quest-probe-named-bucket',
		);
	});

	it('物理名を省略した (auto-naming) リソースは検出対象にならない (推奨経路が無摩擦であること)', () => {
		const app = makeApp();
		const probe = new cdk.Stack(app, 'GanbariQuestProbeAuto', { env });
		new cdk.aws_s3.Bucket(probe, 'ProbeAutoNamedBucket'); // bucketName 省略 = CFN auto-naming
		const probeFound = collectNamedResources('GanbariQuestProbeAuto', Template.fromStack(probe));
		expect([...probeFound].filter((k) => k.includes('ProbeAutoNamedBucket'))).toEqual([]);
	});
});
