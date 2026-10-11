// tests/unit/infra/slo-dashboard.test.ts
// #4978: SLI/SLO 定義書 (docs/design/32) の SLO が「定義はあるが計算されていない」状態だった。
//
// 旧定義は可用性の計測元を CloudFront アクセスログに置いていたが、ログは 3 日で消えるため
// 月次の可用性は原理的に出せなかった。SLO は Lambda Function URL の標準メトリクス
// (UrlRequestCount / Url5xxCount / UrlRequestLatency) から dashboard 上で直接計算する。
//
// 固定するのは「dashboard に直近 30 日の SLO が出ること」:
//   - 可用性 = 1 - Url5xxCount / UrlRequestCount (metric math)
//   - レイテンシ = UrlRequestLatency の p50 / p95 / p99 (コールドスタートを含む)
//   - 集計窓は閲覧者の時間範囲に依存しない直近 30 日

import * as cdk from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { beforeAll, describe, expect, it } from 'vitest';
import { ComputeStack } from '../../../infra/lib/compute-stack';
import { NetworkStack } from '../../../infra/lib/network-stack';
import { OpsStack, SLO_TARGETS } from '../../../infra/lib/ops-stack';
import { StorageStack } from '../../../infra/lib/storage-stack';

// cspell:ignore TESTPOOL

const env: cdk.Environment = { account: '000000000000', region: 'us-east-1' };

function buildOpsTemplate(): Template {
	const app = new cdk.App({
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
		originVerifySecret: 'test-origin-verify-secret-0000000000000000',
		domainName: 'ganbari-quest.com',
		certificateArn: 'arn:aws:acm:us-east-1:000000000000:certificate/test',
		demoFunctionUrl: compute.demoFunctionUrl,
	});
	const ops = new OpsStack(app, 'TestOps', {
		env,
		lambdaFn: compute.fn,
		distribution: network.distribution,
		functionUrl: compute.functionUrl,
		cronDispatcherFn: compute.cronDispatcherFn,
		opsEmail: 'ops@example.com',
	});
	return Template.fromStack(ops);
}

// CDK synth (Docker image asset の hash 計算を含む) は数十秒かかるため 1 回だけ組む
let dashboardBody: string;

beforeAll(() => {
	const template = buildOpsTemplate();
	const dashboards = Object.values(template.findResources('AWS::CloudWatch::Dashboard'));
	expect(dashboards).toHaveLength(1);
	dashboardBody = JSON.stringify(
		(dashboards[0] as { Properties: { DashboardBody: unknown } }).Properties.DashboardBody,
	);
}, 180_000);

describe('ops dashboard に直近 30 日の SLO が計算されて載る (#4978)', () => {
	it('可用性を Function URL のリクエスト数と 5xx 数から metric math で出す', () => {
		expect(dashboardBody).toContain('UrlRequestCount');
		expect(dashboardBody).toContain('Url5xxCount');
		// 5xx が 0 件の期間に欠損 (no data) で可用性が出なくなるのを防ぐ
		expect(dashboardBody).toMatch(/100 \* \(1 - FILL\(\w+, ?0\) \/ \w+\)/);
	});

	it('レイテンシは コールドスタートを含む UrlRequestLatency の p50 / p95 / p99', () => {
		expect(dashboardBody).toContain('UrlRequestLatency');
		for (const stat of ['p50', 'p95', 'p99']) {
			expect(dashboardBody).toContain(`\\"stat\\":\\"${stat}\\"`);
		}
	});

	it('集計窓は閲覧者の時間範囲に依らず直近 30 日で固定する', () => {
		expect(dashboardBody).toContain('\\"start\\":\\"-P30D\\"');
		expect(dashboardBody).toContain('\\"setPeriodToTimeRange\\":true');
	});

	it('widget の見出しに目標値を出す (目標の SSOT は SLO_TARGETS)', () => {
		expect(dashboardBody).toContain(`target ${SLO_TARGETS.availabilityPercent}`);
		expect(dashboardBody).toContain(`p99 < ${SLO_TARGETS.latencyMs.p99}`);
	});
});
