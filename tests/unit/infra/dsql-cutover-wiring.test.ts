// tests/unit/infra/dsql-cutover-wiring.test.ts
// EPIC #3424 / #3438 Phase 2A — compute-stack の DSQL backend 配線の CDK 構造検証。
//
// #3438 Phase 2A で DSQL を**無条件の唯一 backend** に既定化した (旧 `dsqlEnabled` flag と
// 「flag なしは DATA_SOURCE=dynamodb fallback」= #2873 prod template 不変条件を撤去。prod は
// 既に DSQL 稼働のため CDK 既定を実態に一致させ、dead な dynamodb への silent 巻戻しを排除)。
//
// このテストの責務:
//   (1) [W1] endpoint / clusterArn を注入した既定 synth が DATA_SOURCE=dsql + DSQL_ENDPOINT +
//       DSQL_USER=app_user を Lambda env に持ち、実行 role に dsql:DbConnect (cluster ARN 限定) を
//       付与し **dsql:DbConnectAdmin は付与しない** (M3 §3.4 B6: DDL/GRANT は migration runner の
//       別クレデンシャル経路) こと。DATA_SOURCE は決して dynamodb にならない (fallback 撤去の機械保証)。
//       analytics 保存先の DynamoDB table env は別レイヤーとして維持 (撤去は #3805 後)。
//   (2) [W2/W3] fail-close: endpoint / clusterArn 未注入なら synth error (dsql は必須 backend、
//       endpoint 無し deploy = cold start 全 500 化の silent 誤 deploy 防止、ADR-0006)。
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
const FULL_DSQL_CONTEXT: Record<string, string> = {
	dsqlEndpoint: TEST_DSQL_ENDPOINT,
	dsqlClusterArn: TEST_DSQL_ARN,
};

const cdkErrors = (compute: ComputeStack): string[] =>
	compute.node
		.findAll()
		.flatMap((c) => c.node.metadata)
		.filter((m) => m.type === 'aws:cdk:error')
		.map((m) => String(m.data));

describe('compute-stack DSQL backend 配線 (EPIC #3424 / #3438 Phase 2A 無条件 dsql)', {
	timeout: 30_000,
}, () => {
	it('[W1] 既定 synth (endpoint/ARN 注入): DATA_SOURCE=dsql + DSQL_ENDPOINT + app_user + DbConnect (ARN 限定、Admin なし)', () => {
		const compute = buildCompute(FULL_DSQL_CONTEXT);
		const template = Template.fromStack(compute);

		const envVars = mainFnEnv(template);
		expect(envVars.DATA_SOURCE).toBe('dsql');
		expect(envVars.DSQL_ENDPOINT).toBe(TEST_DSQL_ENDPOINT);
		// #3646: DbConnect は custom db role 専用 (admin は DbConnectAdmin 必要) のため app_user を固定注入。
		expect(envVars.DSQL_USER).toBe('app_user');
		// #3438 Phase 2A: dynamodb fallback は撤去済 (DATA_SOURCE は決して dynamodb にならない)。
		expect(envVars.DATA_SOURCE).not.toBe('dynamodb');
		// analytics 保存先の DynamoDB table env は維持 (別レイヤー、撤去は #3805 後)。
		expect(envVars.ANALYTICS_TABLE_NAME).toBeDefined();

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
		expect(allPolicyActions(template)).not.toContain('dsql:DbConnectAdmin');
	});

	it('[W2 fail-close] endpoint 未注入: synth が error annotation で失敗する (dsql は必須 backend)', () => {
		const errors = cdkErrors(buildCompute({ dsqlClusterArn: TEST_DSQL_ARN }));
		expect(errors.length).toBeGreaterThan(0);
		expect(errors.join(' ')).toContain('dsqlEndpoint');
	});

	it('[W3 fail-close] clusterArn 未注入: synth が error annotation で失敗する', () => {
		const errors = cdkErrors(buildCompute({ dsqlEndpoint: TEST_DSQL_ENDPOINT }));
		expect(errors.length).toBeGreaterThan(0);
		expect(errors.join(' ')).toContain('dsqlClusterArn');
	});
});
