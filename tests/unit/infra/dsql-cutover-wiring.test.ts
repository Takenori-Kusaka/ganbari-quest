// tests/unit/infra/dsql-cutover-wiring.test.ts
// EPIC #3424 M5 (DoD 3) — compute-stack の DSQL cutover 配線の CDK 構造検証。
//
// このテストは 2 つの責務を持つ:
//   (1) prod 不変 guard (load-bearing): `dsqlEnabled` context 無しで synth した prod template が
//       従来どおり DATA_SOURCE=dynamodb で、dsql:DbConnect policy を一切持たないことを assert。
//       flag-gated 配線が既定 deploy の template を 1 byte も変えないことの機械保証
//       (prod template 不変条件 #2873 / ADR-0019)。
//   (2) dsqlEnabled=true 時の配線 assert: DATA_SOURCE=dsql + DSQL_ENDPOINT が Lambda env に入り、
//       実行 role に dsql:DbConnect (resource = cluster ARN 限定) が付与され、
//       **dsql:DbConnectAdmin は付与されない** (M3 §3.4 B6 実行時ロールモデル: DDL/GRANT は
//       migration runner の別クレデンシャル経路) ことを assert。
//   (3) fail-close: dsqlEnabled=true で endpoint / clusterArn 未注入なら synth error
//       (cold start 全 500 化の silent 誤 deploy 防止、ADR-0006)。
//
// context stub パターンは staging-cdk.test.ts / multi-lambda-cdk.test.ts を踏襲。

import * as cdk from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { describe, expect, it } from 'vitest';
import { ComputeStack } from '../../../infra/lib/compute-stack';
import { StorageStack } from '../../../infra/lib/storage-stack';

const env: cdk.Environment = { account: '000000000000', region: 'us-east-1' };

const TEST_DSQL_ENDPOINT = 'testcluster1234.dsql.us-east-1.on.aws';
const TEST_DSQL_ARN = 'arn:aws:dsql:us-east-1:000000000000:cluster/testcluster1234';

// cspell:ignore TESTPOOL
const BASE_CONTEXT: Record<string, string> = {
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
};

function buildCompute(extraContext: Record<string, string> = {}): ComputeStack {
	const app = new cdk.App({ context: { ...BASE_CONTEXT, ...extraContext } });
	const storage = new StorageStack(app, 'TestStorage', { env });
	return new ComputeStack(app, 'TestCompute', {
		env,
		table: storage.table,
		assetsBucket: storage.assetsBucket,
		repository: storage.repository,
	});
}

/** SvelteKitFn (prod main Fn) の env Variables を template から取り出す。 */
function mainFnEnv(template: Template): Record<string, unknown> {
	const fns = template.findResources('AWS::Lambda::Function', {
		Properties: { FunctionName: 'ganbari-quest-app' },
	});
	const fn = Object.values(fns)[0] as {
		Properties: { Environment: { Variables: Record<string, unknown> } };
	};
	return fn.Properties.Environment.Variables;
}

/** template 内の全 IAM Policy から Action 文字列を平坦収集する。 */
function allPolicyActions(template: Template): string[] {
	const policies = template.findResources('AWS::IAM::Policy');
	const actions: string[] = [];
	for (const p of Object.values(policies) as {
		Properties: { PolicyDocument: { Statement: { Action: string | string[] }[] } };
	}[]) {
		for (const stmt of p.Properties.PolicyDocument.Statement) {
			const a = stmt.Action;
			if (Array.isArray(a)) actions.push(...a);
			else if (typeof a === 'string') actions.push(a);
		}
	}
	return actions;
}

// #3661: aws-cdk-lib の初回ロード + 各 test の ComputeStack synth (Template.fromStack) が
// 高負荷環境で vitest 既定 5s を超える (実測 5-8s、--testTimeout=30000 で PASS)。
// hooks-integration.test.ts と同型の describe-level timeout で吸収する
// (assertion 内容は不変、ADR-0061 same-class 対処)。
describe('compute-stack DSQL cutover 配線 (EPIC #3424 M5 DoD3、flag-gated)', {
	timeout: 30_000,
}, () => {
	it('[W1 prod 不変 guard] dsqlEnabled 無し: DATA_SOURCE=dynamodb 維持 + dsql:* policy ゼロ', () => {
		const compute = buildCompute();
		const template = Template.fromStack(compute);

		const envVars = mainFnEnv(template);
		expect(envVars.DATA_SOURCE).toBe('dynamodb');
		expect(envVars.DSQL_ENDPOINT).toBeUndefined();

		const actions = allPolicyActions(template);
		expect(actions.filter((a) => a.startsWith('dsql:'))).toEqual([]);
	});

	it('[W2 cutover 配線] dsqlEnabled=true: DATA_SOURCE=dsql + DSQL_ENDPOINT + DbConnect (ARN 限定、Admin なし)', () => {
		const compute = buildCompute({
			dsqlEnabled: 'true',
			dsqlEndpoint: TEST_DSQL_ENDPOINT,
			dsqlClusterArn: TEST_DSQL_ARN,
		});
		const template = Template.fromStack(compute);

		const envVars = mainFnEnv(template);
		expect(envVars.DATA_SOURCE).toBe('dsql');
		expect(envVars.DSQL_ENDPOINT).toBe(TEST_DSQL_ENDPOINT);
		// #3646: DbConnect は custom db role 専用 (admin は DbConnectAdmin 必要)。既定 admin の
		// まま接続すると staging cycle 4 同様に接続不能になるため app_user 注入を固定する。
		expect(envVars.DSQL_USER).toBe('app_user');

		// DbConnect が cluster ARN 限定で付与される (ワイルドカード禁止)
		template.hasResourceProperties('AWS::IAM::Policy', {
			PolicyDocument: {
				Statement: Match.arrayWith([
					Match.objectLike({
						Action: 'dsql:DbConnect',
						Effect: 'Allow',
						Resource: TEST_DSQL_ARN,
					}),
				]),
			},
		});

		// DbConnectAdmin (DDL/GRANT 用) は実行時 role に付与しない (M3 §3.4 B6)
		const actions = allPolicyActions(template);
		expect(actions).not.toContain('dsql:DbConnectAdmin');
	});

	it('[W3 fail-close] dsqlEnabled=true + endpoint 未注入: synth が error annotation で失敗する', () => {
		const compute = buildCompute({ dsqlEnabled: 'true', dsqlClusterArn: TEST_DSQL_ARN });
		const errors = compute.node
			.findAll()
			.flatMap((c) => c.node.metadata)
			.filter((m) => m.type === 'aws:cdk:error');
		expect(errors.length).toBeGreaterThan(0);
		expect(String(errors[0]?.data)).toContain('dsqlEndpoint');
	});

	it('[W3b fail-close] dsqlEnabled=true + clusterArn 未注入: synth が error annotation で失敗する', () => {
		const compute = buildCompute({ dsqlEnabled: 'true', dsqlEndpoint: TEST_DSQL_ENDPOINT });
		const errors = compute.node
			.findAll()
			.flatMap((c) => c.node.metadata)
			.filter((m) => m.type === 'aws:cdk:error');
		expect(errors.length).toBeGreaterThan(0);
		expect(String(errors[0]?.data)).toContain('dsqlClusterArn');
	});
});
