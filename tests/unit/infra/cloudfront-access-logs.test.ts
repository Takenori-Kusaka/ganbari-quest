// tests/unit/infra/cloudfront-access-logs.test.ts
// #4320: CloudFront アクセスログ (標準ログ = S3 直配信) の不変条件を synth 後 template で固定する。
//
// ## なぜ必要か
// #4309 (`/ops/export` が未認証で売上台帳 CSV を返していた) の調査で、「実際に誰かが取得したか」を
// 事後確認する手段が無いことが実害として顕在化した。ログが無い限り、次に同種の露出が起きても
// 被害範囲を確定できない (= 漏れていないことを説明できない)。
//
// 本 test は「有効化されていること」だけでなく、**有効化の条件 (オーナー決裁 2026-08-06)** を固定する:
//   条件 1: 保管 3 日 (S3 lifecycle expiration)
//   条件 2: 月額 20 円以内 → 標準ログ (S3 配信、CloudFront 課金なし) のみ。リアルタイムログを使わない
// さらにプライバシー面の不変条件 (cookie を記録しない / bucket を公開しない) を固定する。
// これらは人の注意力では守れない (次に誰かが `logIncludesCookies: true` を足しても気づけない)。

import * as cdk from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { beforeAll, describe, expect, it } from 'vitest';
import { ComputeStack } from '../../../infra/lib/compute-stack';
import { STAGING_ENV_CONFIG } from '../../../infra/lib/env-config';
import { NetworkStack } from '../../../infra/lib/network-stack';
import { StorageStack } from '../../../infra/lib/storage-stack';

// cspell:ignore hostedzone TESTPOOL
const env: cdk.Environment = { account: '000000000000', region: 'us-east-1' };
const CERT = 'arn:aws:acm:us-east-1:000000000000:certificate/00000000-0000-0000-0000-000000000000';

/** オーナー決裁 (2026-08-06) の条件 1。緩めるには再決裁が要る。 */
const RETENTION_DAYS = 3;

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
 * bin/app.ts と同じ stack id / props で NetworkStack を synth する。
 * prod は demo distribution 込み (domainName + demoFunctionUrl)、staging は prefix + geo 解除。
 */
function synthNetwork(staging: boolean): Template {
	const app = makeApp();
	const envConfig = staging ? STAGING_ENV_CONFIG : undefined;
	const suffix = staging ? 'Staging' : '';
	const storage = new StorageStack(app, `GanbariQuestStorage${suffix}`, { env, envConfig });
	const compute = new ComputeStack(app, `GanbariQuestCompute${suffix}`, {
		env,
		assetsBucket: storage.assetsBucket,
		repository: storage.repository,
		envConfig,
	});
	const network = new NetworkStack(app, `GanbariQuestNetwork${suffix}`, {
		env,
		functionUrl: compute.functionUrl,
		originVerifySecret: 'test-origin-verify-secret-0000000000000000',
		...(staging
			? { resourcePrefix: STAGING_ENV_CONFIG.resourcePrefix, geoRestrictionCountries: [] }
			: {
					domainName: 'ganbari-quest.com',
					certificateArn: CERT,
					demoFunctionUrl: compute.demoFunctionUrl,
				}),
	});
	return Template.fromStack(network);
}

// CDK synth は重い (Lambda bundling を含む)。variant ごとに 1 回だけ synth して使い回す。
const templates: Record<'prod' | 'staging', Template | undefined> = {
	prod: undefined,
	staging: undefined,
};
beforeAll(() => {
	templates.prod = synthNetwork(false);
	templates.staging = synthNetwork(true);
}, 120_000);

function buildNetwork(staging: boolean): Template {
	const t = templates[staging ? 'staging' : 'prod'];
	if (!t) throw new Error('template not synthesized (beforeAll が走っていない)');
	return t;
}

/** template 中の全 CloudFront Distribution を [logicalId, DistributionConfig] で返す。 */
function distributions(t: Template): [string, Record<string, unknown>][] {
	const found = t.findResources('AWS::CloudFront::Distribution');
	return Object.entries(found).map(([id, res]) => [
		id,
		(res.Properties?.DistributionConfig ?? {}) as Record<string, unknown>,
	]);
}

describe('#4320 CloudFront アクセスログ', () => {
	// [A-1] 「ログが出ていない」= 漏洩の事後確認ができない、が本 Issue の実害そのもの。
	// **本 stack が作る全 distribution** が対象 (片方だけ記録する状態を作らせない)。
	it.each([
		['prod', false],
		['staging', true],
	])('%s の全 distribution が標準ログを S3 に配信する', (_name, staging) => {
		const dists = distributions(buildNetwork(staging as boolean));
		expect(dists.length).toBeGreaterThan(0);
		for (const [id, config] of dists) {
			const logging = config.Logging as { Bucket?: unknown; Prefix?: string } | undefined;
			expect(logging, `${id} に Logging がない (アクセスログ無効)`).toBeDefined();
			expect(logging?.Bucket, `${id} の Logging.Bucket が空`).toBeDefined();
			expect(typeof logging?.Prefix, `${id} の Logging.Prefix が未設定`).toBe('string');
		}
	});

	// [A-2] prod は本番 / demo で prefix を分ける (同一 bucket に混ざると調査時に読み分けられない)。
	it('prod は本番 / demo の prefix が衝突しない', () => {
		const prefixes = distributions(buildNetwork(false)).map(
			([, c]) => (c.Logging as { Prefix?: string }).Prefix,
		);
		expect(prefixes).toHaveLength(2);
		expect(new Set(prefixes).size).toBe(2);
	});

	// [A-3] cookie には認証 session / parent-gate session が載る。記録すると
	// 「ログの漏洩 = session の漏洩」になり、調査のための仕組みが新しい漏洩経路になる。
	it.each([
		['prod', false],
		['staging', true],
	])('%s は cookie を記録しない', (_name, staging) => {
		for (const [id, config] of distributions(buildNetwork(staging as boolean))) {
			const logging = config.Logging as { IncludeCookies?: boolean };
			expect(logging.IncludeCookies ?? false, `${id} が cookie を記録している`).toBe(false);
		}
	});

	// [A-4] オーナー決裁の条件 2 (月 20 円以内)。リアルタイムログは Kinesis 課金が乗るため使わない。
	// 標準ログ (S3 配信) は CloudFront 側課金なし。
	it.each([
		['prod', false],
		['staging', true],
	])('%s はリアルタイムログ (有料) を作らない', (_name, staging) => {
		const t = buildNetwork(staging as boolean);
		t.resourceCountIs('AWS::CloudFront::RealtimeLogConfig', 0);
		t.resourceCountIs('AWS::Kinesis::Stream', 0);
	});

	// [A-5] オーナー決裁の条件 1 (保管 3 日)。lifecycle が無い / 日数が伸びると、
	// 「コストが構造的に上限化されている」という有効化の前提そのものが崩れる。
	// ログは client IP / URI (query 含む) を持つため、保持最小化はプライバシー面の要請でもある。
	it.each([
		['prod', false],
		['staging', true],
	])(`%s のログ bucket は ${RETENTION_DAYS} 日で自動削除する`, (_name, staging) => {
		buildNetwork(staging as boolean).hasResourceProperties('AWS::S3::Bucket', {
			LifecycleConfiguration: {
				Rules: Match.arrayWith([
					Match.objectLike({ Status: 'Enabled', ExpirationInDays: RETENTION_DAYS }),
				]),
			},
		});
	});

	// [A-6] ログ bucket 自体が「IP + アクセス先 URL の一覧」= 個人情報。公開されたら本末転倒。
	// ObjectWriter は CloudFront 標準ログ (legacy) が ACL でログを書くために必須
	// (これが無いと deploy 時に配信設定が拒否される)。SSE-KMS は標準ログ非対応のため AES256。
	it.each([
		['prod', false],
		['staging', true],
	])('%s のログ bucket は非公開 + 暗号化 + ACL 有効', (_name, staging) => {
		buildNetwork(staging as boolean).hasResourceProperties('AWS::S3::Bucket', {
			LifecycleConfiguration: {
				Rules: Match.arrayWith([Match.objectLike({ ExpirationInDays: RETENTION_DAYS })]),
			},
			PublicAccessBlockConfiguration: {
				BlockPublicAcls: true,
				BlockPublicPolicy: true,
				IgnorePublicAcls: true,
				RestrictPublicBuckets: true,
			},
			BucketEncryption: {
				ServerSideEncryptionConfiguration: [
					{ ServerSideEncryptionByDefault: { SSEAlgorithm: 'AES256' } },
				],
			},
			OwnershipControls: { Rules: [{ ObjectOwnership: 'ObjectWriter' }] },
		});
	});

	// [A-7] 明示物理名を付けない (#3881 rollback-orphan の `already exists` class)。
	// prod / staging が同一アカウントに同居するため、固定名だと衝突もする。
	it.each([
		['prod', false],
		['staging', true],
	])('%s のログ bucket は物理名を明示しない', (_name, staging) => {
		const buckets = Object.values(buildNetwork(staging as boolean).findResources('AWS::S3::Bucket'))
			.map((r) => r.Properties ?? {})
			.filter((p) =>
				p.LifecycleConfiguration?.Rules?.some?.(
					(r: { Id?: string }) => r.Id === 'expire-access-logs',
				),
			);
		expect(buckets).toHaveLength(1);
		expect(buckets[0].BucketName).toBeUndefined();
	});
});
