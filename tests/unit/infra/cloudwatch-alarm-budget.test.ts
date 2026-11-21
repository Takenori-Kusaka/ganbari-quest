// tests/unit/infra/cloudwatch-alarm-budget.test.ts
// #5109 — CloudWatch alarm を無料枠の 10 本に保つ。
//
// alarm は `ActionsEnabled=false` にしても課金が続き、無料枠 (10 alarm-metric) を超えた分は
// 1 metric あたり $0.10/月かかる。metric math の alarm は使う metric の数だけ数える。
// 2026-10 時点で 23 本 (うち 1 本は 2 metric を使う metric math) あり、約 $1.5/月かかっていた。
// オーナー承認のうえ「お金・データ・全面障害に直結するもの」の 10 本に絞った。
//
// 本 test は `infra/bin/app.ts` が本番 deploy (deploy.yml) で synth する構成
// (`staticAssetsS3Offload=true` / `dsqlEnabled=true`) と、staging 系 (`stagingEnabled=true` /
// `dsqlStagingEnabled=true`) を合わせた **全 stack** を synth し、alarm の集合を固定する。
//
// alarm を足すときは同じ PR で 1 本減らし、下の EXPECTED_ALARMS を更新する。
// 11 本目を足すと課金が始まるため、増やすならオーナーの判断を取る。

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as cdk from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AuthStack } from '../../../infra/lib/auth-stack';
import { ComputeStack } from '../../../infra/lib/compute-stack';
import { DsqlStack } from '../../../infra/lib/dsql-stack';
import { STAGING_ENV_CONFIG } from '../../../infra/lib/env-config';
import { NetworkStack } from '../../../infra/lib/network-stack';
import { OpsStack } from '../../../infra/lib/ops-stack';
import { SesStack } from '../../../infra/lib/ses-stack';
import { StorageStack } from '../../../infra/lib/storage-stack';

// cspell:ignore TESTPOOL ZTEST

const env: cdk.Environment = { account: '000000000000', region: 'us-east-1' };
const APP_NAME = 'GanbariQuest';
const DOMAIN = 'ganbari-quest.com';
const CERT_ARN = 'arn:aws:acm:us-east-1:000000000000:certificate/test';

/** CloudWatch の alarm 無料枠 (alarm-metric 数)。 */
const FREE_TIER_ALARM_METRICS = 10;

/**
 * 残す 10 本 (#5109 の PO 決定)。`<stack id>/<AlarmName または論理 ID>` で書く。
 * DsqlStack の alarm は物理名を持たない (CFN auto-naming) ため論理 ID で識別する。
 */
const EXPECTED_ALARMS = [
	'GanbariQuestDsql/TotalDpuDaily',
	'GanbariQuestOps/ganbari-quest-ai-provider-unavailable',
	'GanbariQuestOps/ganbari-quest-auth-entitlement-db-unavailable',
	'GanbariQuestOps/ganbari-quest-cloudfront-5xx',
	'GanbariQuestOps/ganbari-quest-cron-dispatcher-errors',
	'GanbariQuestOps/ganbari-quest-grace-period-partial-failure',
	'GanbariQuestOps/ganbari-quest-lambda-errors',
	'GanbariQuestOps/ganbari-quest-lambda-url-5xx',
	'GanbariQuestOps/ganbari-quest-ops-access-denied',
	'GanbariQuestOps/ganbari-quest-push-send-failed',
] as const;

const CTX: Record<string, unknown> = {
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
	'hosted-zone:account=000000000000:domainName=ganbari-quest.com:region=us-east-1': {
		Id: '/hostedzone/ZTEST',
		Name: 'ganbari-quest.com.',
	},
};

interface AlarmEntry {
	/** `<stack id>/<AlarmName or 論理 ID>` */
	key: string;
	/** この alarm が使う metric の数 (metric math なら式が参照する metric の数)。 */
	metricCount: number;
}

let fixtureDir: string;
let alarms: AlarmEntry[];

function collectAlarms(stack: cdk.Stack, out: AlarmEntry[]): void {
	const resources = Template.fromStack(stack).findResources('AWS::CloudWatch::Alarm');
	for (const [logicalId, resource] of Object.entries(resources)) {
		const props = (resource as { Properties?: Record<string, unknown> }).Properties ?? {};
		// 物理名が無い alarm は論理 ID (末尾 8 桁は CDK が付ける hash) で識別する
		const name =
			typeof props.AlarmName === 'string' ? props.AlarmName : logicalId.replace(/[0-9A-F]{8}$/, '');
		const metrics = props.Metrics as Array<{ MetricStat?: unknown }> | undefined;
		const metricCount = metrics ? metrics.filter((m) => m.MetricStat !== undefined).length : 1;
		out.push({ key: `${stack.stackName}/${name}`, metricCount });
	}
}

/** bin/app.ts の本番 deploy 構成 + staging 構成と同じ wire で全 stack を組む。 */
function synthAllAlarms(sourceDir: string): AlarmEntry[] {
	const app = new cdk.App({ context: CTX });

	const storage = new StorageStack(app, `${APP_NAME}Storage`, { env });
	const auth = new AuthStack(app, `${APP_NAME}Auth`, {
		env,
		appDomain: DOMAIN,
		certificateArn: CERT_ARN,
	});
	const compute = new ComputeStack(app, `${APP_NAME}Compute`, {
		env,
		assetsBucket: storage.assetsBucket,
		repository: storage.repository,
	});
	const network = new NetworkStack(app, `${APP_NAME}Network`, {
		env,
		functionUrl: compute.functionUrl,
		originVerifySecret: 'test-origin-verify-secret-0000000000000000',
		domainName: DOMAIN,
		certificateArn: CERT_ARN,
		demoFunctionUrl: compute.demoFunctionUrl,
		demoDomainName: `demo.${DOMAIN}`,
		demoCertificateArn: CERT_ARN,
		// deploy.yml は本番で常に offload を有効にする
		staticAssetsS3Offload: true,
		staticAssetsSourceDir: sourceDir,
	});
	const ses = new SesStack(app, `${APP_NAME}Ses`, { env, domainName: DOMAIN });
	const ops = new OpsStack(app, `${APP_NAME}Ops`, {
		env,
		lambdaFn: compute.fn,
		distribution: network.distribution,
		functionUrl: compute.functionUrl,
		cronDispatcherFn: compute.cronDispatcherFn,
		appLogGroup: compute.appLogGroup,
		opsEmail: 'ops@example.com',
	});
	const dsql = new DsqlStack(app, `${APP_NAME}Dsql`, { env, opsEmail: 'ops@example.com' });
	const dsqlStaging = new DsqlStack(app, `${APP_NAME}DsqlStaging`, {
		env,
		deletionProtection: false,
	});

	const sStorage = new StorageStack(app, `${APP_NAME}StorageStaging`, {
		env,
		envConfig: STAGING_ENV_CONFIG,
	});
	const sAuth = new AuthStack(app, `${APP_NAME}AuthStaging`, {
		env,
		envConfig: STAGING_ENV_CONFIG,
	});
	const sCompute = new ComputeStack(app, `${APP_NAME}ComputeStaging`, {
		env,
		assetsBucket: sStorage.assetsBucket,
		repository: sStorage.repository,
		envConfig: STAGING_ENV_CONFIG,
	});
	const sNetwork = new NetworkStack(app, `${APP_NAME}NetworkStaging`, {
		env,
		functionUrl: sCompute.functionUrl,
		originVerifySecret: 'test-origin-verify-secret-0000000000000000',
		resourcePrefix: STAGING_ENV_CONFIG.resourcePrefix,
		geoRestrictionCountries: [],
	});

	const out: AlarmEntry[] = [];
	for (const stack of [
		storage,
		auth,
		compute,
		network,
		ses,
		ops,
		dsql,
		dsqlStaging,
		sStorage,
		sAuth,
		sCompute,
		sNetwork,
	]) {
		collectAlarms(stack, out);
	}
	return out;
}

beforeAll(() => {
	fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gq-alarm-budget-'));
	const immutable = path.join(fixtureDir, '_app', 'immutable', 'chunks');
	fs.mkdirSync(immutable, { recursive: true });
	fs.writeFileSync(path.join(immutable, 'app.abc123.js'), 'export const x = 1;\n');
	alarms = synthAllAlarms(fixtureDir);
}, 180_000);

afterAll(() => {
	if (fixtureDir) fs.rmSync(fixtureDir, { recursive: true, force: true });
});

describe('#5109 CloudWatch alarm を無料枠に収める', () => {
	it('全 stack の alarm がちょうど PO 決定の 10 本である', () => {
		const keys = alarms.map((a) => a.key).sort();
		expect(
			keys,
			'alarm の集合が変わりました。足すなら同じ PR で 1 本減らし、EXPECTED_ALARMS を更新してください',
		).toEqual([...EXPECTED_ALARMS].sort());
	});

	it('alarm-metric の合計が無料枠 (10) を超えない (metric math は使う metric の数で数える)', () => {
		const total = alarms.reduce((sum, a) => sum + a.metricCount, 0);
		expect(total).toBeLessThanOrEqual(FREE_TIER_ALARM_METRICS);
	});

	it('staging の DSQL stack は alarm を作らない (使い捨てで、作ると本番と同じく課金される)', () => {
		expect(alarms.filter((a) => a.key.startsWith('GanbariQuestDsqlStaging/'))).toEqual([]);
	});
});
