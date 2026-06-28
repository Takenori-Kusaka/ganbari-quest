// tests/unit/infra/static-assets-s3-offload.test.ts
// #3087 解決策 B — /_app/immutable/* の S3 origin offload の CDK 構造検証。
//
// このテストは 2 つの load-bearing 責務を持つ:
//   (1) 非 replacement guard (AC3、最重要): S3 offload ON にしても既存 CloudFront Distribution
//       (CDN / DemoCDN) の論理 ID と、既存 s3ErrorOrigin の OAC 論理 ID (origin index 2 由来 =
//       CDNOrigin2...) が churn しないことを template-level で assert する。distribution 置換は
//       本番ダウンを招くため、宣言順 preempt (/error/* → /_app/immutable/* → /_app/*) を崩す
//       将来変更を PR-lane (deploy 前 check-cdk-replacement.mjs gate より前倒し) で検知する。
//   (2) offload 構造 assert: flag ON で /_app/immutable/* が S3 (OAC) origin を指し、専用 bucket +
//       BucketDeployment が生成されること。flag OFF (default) では一切生成されず従来構成のまま。
//
// flag OFF の従来構成 (origins=3 / OAC=1) は multi-lambda-cdk.test.ts C-2b が別途固定している。
// 本 test の OFF assert はその二重防御。
//
// context stub パターンは tests/unit/infra/multi-lambda-cdk.test.ts を踏襲。
// 参考: infra/lib/network-stack.ts (staticAssetsS3Offload) / docs/design/13-AWSサーバレスアーキテクチャ設計書.md

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as cdk from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ComputeStack } from '../../../infra/lib/compute-stack';
import { NetworkStack } from '../../../infra/lib/network-stack';
import { StorageStack } from '../../../infra/lib/storage-stack';

// cspell:ignore TESTPOOL oacs

const env: cdk.Environment = { account: '000000000000', region: 'us-east-1' };

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
		},
	});
}

function buildNetwork(opts: {
	app: cdk.App;
	staticAssetsS3Offload?: boolean;
	staticAssetsSourceDir?: string;
}): NetworkStack {
	const storage = new StorageStack(opts.app, 'TestStorage', { env });
	const compute = new ComputeStack(opts.app, 'TestCompute', {
		env,
		table: storage.table,
		assetsBucket: storage.assetsBucket,
		repository: storage.repository,
	});
	return new NetworkStack(opts.app, 'TestNetwork', {
		env,
		functionUrl: compute.functionUrl,
		domainName: 'ganbari-quest.com',
		certificateArn: 'arn:aws:acm:us-east-1:000000000000:certificate/test',
		demoFunctionUrl: compute.demoFunctionUrl,
		staticAssetsS3Offload: opts.staticAssetsS3Offload,
		staticAssetsSourceDir: opts.staticAssetsSourceDir,
	});
}

type CfnDistribution = {
	Properties?: {
		DistributionConfig?: {
			Origins?: Array<{ Id?: string; OriginAccessControlId?: unknown; S3OriginConfig?: unknown }>;
			CacheBehaviors?: Array<{ PathPattern?: string; TargetOriginId?: string }>;
		};
	};
};

function distribution(template: Template, prefix: string): CfnDistribution {
	const distributions = template.findResources('AWS::CloudFront::Distribution');
	const entry = Object.entries(distributions).find(([lid]) => lid.startsWith(prefix));
	expect(entry, `distribution with logical id prefix ${prefix} must exist`).toBeDefined();
	return entry?.[1] as CfnDistribution;
}

// ---- fixture: SvelteKit immutable assets ディレクトリ (build/client 相当) ----
let fixtureDir: string;
let onTemplate: Template;
let offTemplate: Template;

beforeAll(() => {
	fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gq-static-assets-'));
	const immutable = path.join(fixtureDir, '_app', 'immutable', 'chunks');
	fs.mkdirSync(immutable, { recursive: true });
	fs.writeFileSync(path.join(immutable, 'app.abc123.js'), 'export const x = 1;\n');
	fs.writeFileSync(path.join(immutable, 'entry.def456.js'), 'export const y = 2;\n');

	onTemplate = Template.fromStack(
		buildNetwork({
			app: makeApp(),
			staticAssetsS3Offload: true,
			staticAssetsSourceDir: fixtureDir,
		}) as unknown as cdk.Stack,
	);
	offTemplate = Template.fromStack(buildNetwork({ app: makeApp() }) as unknown as cdk.Stack);
}, 60_000);

afterAll(() => {
	if (fixtureDir) fs.rmSync(fixtureDir, { recursive: true, force: true });
});

describe('#3087 解決策 B — /_app/immutable/* S3 origin offload', () => {
	describe('AC3: 既存 distribution の非 replacement (最重要)', () => {
		it('CloudFront Distribution は 2 本のまま (CDN / DemoCDN 論理 ID 不変)', () => {
			onTemplate.resourceCountIs('AWS::CloudFront::Distribution', 2);
			expect(Object.keys(distribution(onTemplate, 'CDN').Properties ?? {}).length).toBeGreaterThan(
				0,
			);
			expect(
				Object.keys(distribution(onTemplate, 'DemoCDN').Properties ?? {}).length,
			).toBeGreaterThan(0);
		});

		it('既存 s3ErrorOrigin の OAC 論理 ID が CDNOrigin2 由来で安定 (宣言順 preempt が崩れていない)', () => {
			// /error/* を /_app/immutable/* / /_app/* より先に宣言し s3Error を origin index 2 に固定。
			// CDNOrigin2 → 別 index への変化 = error origin OAC replace = CloudFront churn の signal。
			const oacs = onTemplate.findResources('AWS::CloudFront::OriginAccessControl');
			const errorOac = Object.keys(oacs).find((id) =>
				id.startsWith('CDNOrigin2S3OriginAccessControl'),
			);
			expect(errorOac, 'error origin OAC must stay at CDNOrigin2 (non-replacement)').toBeDefined();
		});

		it('本番 CDN の origin は 4 本 (lambda1 / s3Error2 / s3Immutable3 / shield-lambda4)、s3Error は index 2 を保持', () => {
			const origins = distribution(onTemplate, 'CDN').Properties?.DistributionConfig?.Origins ?? [];
			expect(origins.length).toBe(4);
			// S3 (OAC) origin は s3Error(index2) と s3Immutable(index3) のちょうど 2 本。
			const s3Origins = origins.filter(
				(o) => o.OriginAccessControlId != null || o.S3OriginConfig != null,
			);
			expect(s3Origins.length).toBe(2);
			// error origin は index 2 のまま (新規 immutable origin に displace されない)。
			// Origin Id は構築パス prefix + hash suffix を含む (例: TestNetworkCDNOrigin2AA3327FF)
			// ため substring 判定する。
			const ids = origins.map((o) => String(o.Id));
			expect(ids.some((id) => id.includes('CDNOrigin2'))).toBe(true);
			expect(ids.some((id) => id.includes('CDNOrigin3'))).toBe(true);
		});
	});

	describe('AC1/AC2: /_app/immutable/* が S3 (OAC) origin を指す', () => {
		it('本番 CDN に PathPattern=/_app/immutable/* behavior があり S3 immutable origin (CDNOrigin3) を指す', () => {
			const cfg = distribution(onTemplate, 'CDN').Properties?.DistributionConfig;
			const behavior = (cfg?.CacheBehaviors ?? []).find(
				(b) => b.PathPattern === '/_app/immutable/*',
			);
			expect(behavior, '/_app/immutable/* behavior が存在する').toBeDefined();
			// immutable origin は index 3 (CDNOrigin3) = S3 (OAC)。Lambda(CDNOrigin1/4) ではない。
			expect(String(behavior?.TargetOriginId)).toContain('CDNOrigin3');
			// S3 origin (index3) は OAC を持つ。
			const origins = cfg?.Origins ?? [];
			const immutableOrigin = origins.find((o) => o.Id === behavior?.TargetOriginId);
			expect(
				immutableOrigin?.OriginAccessControlId,
				'S3 immutable origin は OAC 経由',
			).toBeDefined();
		});

		it('/_app/* (version.json 等 non-immutable) は引き続き Lambda + Origin Shield origin を指す', () => {
			const cfg = distribution(onTemplate, 'CDN').Properties?.DistributionConfig;
			const behavior = (cfg?.CacheBehaviors ?? []).find((b) => b.PathPattern === '/_app/*');
			expect(behavior).toBeDefined();
			const origins = cfg?.Origins ?? [];
			const appOrigin = origins.find((o) => o.Id === behavior?.TargetOriginId);
			// shield lambda origin は S3 ではない (OAC を持たない HTTP custom origin)。
			expect(appOrigin?.OriginAccessControlId).toBeUndefined();
			expect(appOrigin?.S3OriginConfig).toBeUndefined();
		});

		it('demo CDN にも /_app/immutable/* behavior があり S3 origin (DemoCDNOrigin2) を指す (本番同型)', () => {
			const cfg = distribution(onTemplate, 'DemoCDN').Properties?.DistributionConfig;
			const behavior = (cfg?.CacheBehaviors ?? []).find(
				(b) => b.PathPattern === '/_app/immutable/*',
			);
			expect(behavior).toBeDefined();
			expect(String(behavior?.TargetOriginId)).toContain('DemoCDNOrigin2');
			const oacs = onTemplate.findResources('AWS::CloudFront::OriginAccessControl');
			const demoOac = Object.keys(oacs).find((id) =>
				id.startsWith('DemoCDNOrigin2S3OriginAccessControl'),
			);
			expect(demoOac, 'demo immutable origin OAC が存在する').toBeDefined();
		});
	});

	describe('S3 bucket + BucketDeployment', () => {
		it('専用 bucket ganbari-quest-static-assets-<account> が BLOCK_ALL + SSE で生成される', () => {
			const buckets = onTemplate.findResources('AWS::S3::Bucket');
			const serialized = JSON.stringify(buckets);
			expect(serialized).toContain('ganbari-quest-static-assets-');
			onTemplate.hasResourceProperties('AWS::S3::Bucket', {
				BucketName: Match.stringLikeRegexp('^ganbari-quest-static-assets-'),
				BucketEncryption: {
					ServerSideEncryptionConfiguration: [
						{ ServerSideEncryptionByDefault: { SSEAlgorithm: 'AES256' } },
					],
				},
				PublicAccessBlockConfiguration: {
					BlockPublicAcls: true,
					BlockPublicPolicy: true,
					IgnorePublicAcls: true,
					RestrictPublicBuckets: true,
				},
			});
		});

		it('immutable cache-control 付きで BucketDeployment が _app/immutable prefix に upload する', () => {
			const deployments = onTemplate.findResources('Custom::CDKBucketDeployment');
			const matched = Object.values(deployments).filter((d) => {
				const props = (d as { Properties?: Record<string, unknown> }).Properties ?? {};
				return (
					props.DestinationBucketKeyPrefix === '_app/immutable' &&
					JSON.stringify(props.SystemMetadata ?? props).includes('max-age=31536000')
				);
			});
			expect(matched.length).toBe(1);
		});
	});

	describe('AC3 / ADR-0006: flag ON + asset 不在で synth が hard-fail (silent skip 禁止)', () => {
		it('staticAssetsSourceDir 未指定で throw する', () => {
			expect(() => buildNetwork({ app: makeApp(), staticAssetsS3Offload: true })).toThrow(
				/staticAssetsS3Offload=true requires SvelteKit immutable assets/,
			);
		});

		it('source dir に _app/immutable が無い場合 throw する', () => {
			const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gq-empty-'));
			try {
				expect(() =>
					buildNetwork({
						app: makeApp(),
						staticAssetsS3Offload: true,
						staticAssetsSourceDir: emptyDir,
					}),
				).toThrow(/requires SvelteKit immutable assets/);
			} finally {
				fs.rmSync(emptyDir, { recursive: true, force: true });
			}
		});
	});

	describe('flag OFF (default) で従来構成を維持 (本番不変条件の二重防御)', () => {
		it('S3 static-assets bucket / BucketDeployment を生成しない', () => {
			const buckets = offTemplate.findResources('AWS::S3::Bucket');
			expect(JSON.stringify(buckets)).not.toContain('ganbari-quest-static-assets-');
			// OAC は error origin の 1 本のみ (CDNOrigin2)。
			const oacs = offTemplate.findResources('AWS::CloudFront::OriginAccessControl');
			expect(Object.keys(oacs).length).toBe(1);
			expect(Object.keys(oacs)[0]).toMatch(/^CDNOrigin2S3OriginAccessControl/);
		});

		it('本番 CDN の origin は従来どおり 3 本 (lambda1 / s3Error2 / shield-lambda3)', () => {
			const origins =
				distribution(offTemplate, 'CDN').Properties?.DistributionConfig?.Origins ?? [];
			expect(origins.length).toBe(3);
		});

		it('/_app/immutable/* behavior は存在しない (offload OFF では /_app/* のみ)', () => {
			const cfg = distribution(offTemplate, 'CDN').Properties?.DistributionConfig;
			const immutable = (cfg?.CacheBehaviors ?? []).find(
				(b) => b.PathPattern === '/_app/immutable/*',
			);
			expect(immutable).toBeUndefined();
		});
	});
});
