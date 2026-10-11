// tests/unit/infra/cloudfront-error-responses-5050.test.ts
// #5050: origin が返す 500 を CloudFront の静的ページに差し替えない。
//
// 静的ページ (旧 infra/error-pages/500.html) は子供向けのひらがなで、エラー ID も持てない。
// 差し替えていた間は、保護者の操作で起きた 500 でも「おとうさん・おかあさんに おしえてね」の画面が出て、
// 問い合わせに使える ID が消えていた。SvelteKit の `+error.svelte` はロール別の文言と ID を持つので、
// 500 はそちらを通す。origin に届かない 502 / 503 / 504 だけが静的ページを使う。

import * as cdk from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { beforeAll, describe, expect, it } from 'vitest';
import { ComputeStack } from '../../../infra/lib/compute-stack';
import { NetworkStack } from '../../../infra/lib/network-stack';
import { StorageStack } from '../../../infra/lib/storage-stack';

// cspell:ignore hostedzone TESTPOOL
const env: cdk.Environment = { account: '000000000000', region: 'us-east-1' };
const CERT = 'arn:aws:acm:us-east-1:000000000000:certificate/00000000-0000-0000-0000-000000000000';

let template: Template | undefined;

beforeAll(() => {
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
			dsqlEndpoint: 'testcluster1234.dsql.us-east-1.on.aws',
			dsqlClusterArn: 'arn:aws:dsql:us-east-1:000000000000:cluster/testcluster1234',
		},
	});
	const storage = new StorageStack(app, 'GanbariQuestStorage', { env });
	const compute = new ComputeStack(app, 'GanbariQuestCompute', {
		env,
		assetsBucket: storage.assetsBucket,
		repository: storage.repository,
	});
	const network = new NetworkStack(app, 'GanbariQuestNetwork', {
		env,
		functionUrl: compute.functionUrl,
		originVerifySecret: 'test-origin-verify-secret-0000000000000000',
		domainName: 'ganbari-quest.com',
		certificateArn: CERT,
		demoFunctionUrl: compute.demoFunctionUrl,
	});
	template = Template.fromStack(network);
}, 120_000);

describe('#5050 CloudFront の errorResponses', () => {
	it('500 を静的ページに差し替えない (保護者向け文言と問い合わせ用 ID を origin の応答から出す)', () => {
		if (!template) throw new Error('template not synthesized');
		const distributions = Object.values(template.findResources('AWS::CloudFront::Distribution'));
		expect(distributions.length).toBeGreaterThan(0);
		for (const res of distributions) {
			const config = res.Properties?.DistributionConfig as {
				CustomErrorResponses?: { ErrorCode: number; ResponsePagePath?: string }[];
			};
			const codes = (config.CustomErrorResponses ?? []).map((r) => r.ErrorCode);
			expect(codes).not.toContain(500);
		}
	});

	it('origin に届かない 502 / 503 / 504 は静的ページのまま', () => {
		if (!template) throw new Error('template not synthesized');
		const [res] = Object.values(template.findResources('AWS::CloudFront::Distribution'));
		const config = res?.Properties?.DistributionConfig as {
			CustomErrorResponses?: { ErrorCode: number; ResponsePagePath?: string }[];
		};
		const byCode = new Map((config.CustomErrorResponses ?? []).map((r) => [r.ErrorCode, r]));
		for (const code of [502, 503, 504]) {
			expect(byCode.get(code)?.ResponsePagePath).toBe(`/error/${code}.html`);
		}
	});
});
