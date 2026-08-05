// tests/unit/infra/admin-no-ip-allowlist.test.ts
// #4266 (PO 決裁 2026-08-05): CloudFront の admin IP allowlist を廃止したことの回帰 guard。
//
// 廃止理由 (実測):
//   - 旧 CloudFront Function は `/admin` `/api/v1/admin` `/ops` を 1 つの allowlist で遮断していた。
//     `/admin` は**保護者 (顧客) の見守り画面**であり、allowlist を有効化すると有料家庭を含む
//     全顧客が 403 になる (`ADMIN_ALLOWED_IPS` が未登録だったことが結果的に顧客を守っていた)。
//   - 運営者のグローバル IP は固定でなく、プロキシ経由では `event.viewer.ip` が回線 IP と一致しない
//     (実測: `162.120.184.213` の逆引きが `...v4.fetch.tunnel.googlezip.net`)。
//
// 本 test が守る不変条件 = **顧客締め出し経路を二度と作らない**:
//   1. 生成される CloudFront Function に `/admin` を条件にした遮断が無い
//   2. `adminAllowedIps` context を渡しても挙動が変わらない (context が復活しても無効)
//   3. `/ops` も CloudFront 層では遮断しない (アプリ層 ops group + MFA が主防御、hasOpsAccess)
//
// 主防御側の回帰 test は tests/unit/routes/ops-mfa-guard.test.ts。

import * as cdk from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { beforeAll, describe, expect, it } from 'vitest';
import { ComputeStack } from '../../../infra/lib/compute-stack';
import { NetworkStack } from '../../../infra/lib/network-stack';
import { StorageStack } from '../../../infra/lib/storage-stack';

const env: cdk.Environment = { account: '000000000000', region: 'us-east-1' };

/** NetworkStack を synth し、CloudFront Function の関数コード一覧を返す。 */
function synthFunctionCodes(extraContext: Record<string, unknown> = {}): string[] {
	const app = new cdk.App({
		context: {
			opsSecretKey: 'test-ops-secret-key',
			parentGateCookieSecret: 'test-parent-gate-secret-do-not-use-do-not-use',
			dsqlEndpoint: 'testcluster1234.dsql.us-east-1.on.aws',
			dsqlClusterArn: 'arn:aws:dsql:us-east-1:000000000000:cluster/testcluster1234',
			...extraContext,
		},
	});
	const storage = new StorageStack(app, 'TestStorage', { env });
	const compute = new ComputeStack(app, 'TestCompute', {
		env,
		assetsBucket: storage.assetsBucket,
		repository: storage.repository,
	});
	const network = new NetworkStack(app, 'TestNetwork', {
		env,
		functionUrl: compute.functionUrl,
	});
	const resources = Template.fromStack(network).findResources('AWS::CloudFront::Function');
	return Object.values(resources).map((r) => String(r.Properties?.FunctionCode ?? ''));
}

describe('#4266 CloudFront に admin IP allowlist を復活させない', () => {
	// synth は Lambda asset bundling を伴い数十秒かかるため 1 回だけ実行して共有する
	let codes: string[];
	let codesWithLegacyContext: string[];

	beforeAll(() => {
		codes = synthFunctionCodes();
		codesWithLegacyContext = synthFunctionCodes({ adminAllowedIps: '203.0.113.10,203.0.113.11' });
	}, 120_000);

	it('CloudFront Function が 1 本以上 synth される (前提)', () => {
		expect(codes.length).toBeGreaterThan(0);
	});

	it('関数コードが /admin を条件に遮断していない (顧客締め出し経路の不在)', () => {
		for (const code of codes) {
			expect(code).not.toContain('/admin');
		}
	});

	it('関数コードが /ops を条件に遮断していない (主防御はアプリ層の ops group + MFA)', () => {
		for (const code of codes) {
			expect(code).not.toContain('/ops');
		}
	});

	it('関数コードに 403 応答 / IP 照合が含まれない', () => {
		for (const code of codes) {
			expect(code).not.toContain('403');
			expect(code).not.toContain('ALLOWED_IPS');
			expect(code).not.toContain('event.viewer.ip');
		}
	});

	it('adminAllowedIps context を渡しても関数コードが変化しない (機構ごと撤去済)', () => {
		expect(codesWithLegacyContext).toEqual(codes);
		for (const code of codesWithLegacyContext) {
			expect(code).not.toContain('203.0.113.10');
		}
	});
});
