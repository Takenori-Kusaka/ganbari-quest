/**
 * tests/unit/infra/origin-verify-header.test.ts (#4280 案 b)
 *
 * CloudFront → origin の front door header が「付いていること」と、
 * 「付け忘れた配備が作れないこと」を機械で固定する。
 *
 * 守る不変条件:
 *   1. Lambda を指す全 origin に `x-origin-verify` が付く (default 動作 + /_app/* の 2 本)
 *   2. secret 未指定の synth は throw で止まる (空文字で防御が黙って消える形を作らない、#4266 教訓)
 *   3. deploy workflow の **全 cdk 実行** が `-c originVerifySecret` を渡す
 *      (どの cdk 実行も infra/bin/app.ts を通るため、1 箇所でも欠けると deploy が止まる)
 *
 * アプリ側の判定 (どの path を保護するか / webhook・cron を壊さないか) は
 * `tests/unit/security/origin-verify.test.ts` が担当する。
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as cdk from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { beforeAll, describe, expect, it } from 'vitest';
import { ComputeStack } from '../../../infra/lib/compute-stack';
import { NetworkStack } from '../../../infra/lib/network-stack';
import {
	originVerifyContextKey,
	resolveOriginVerifySecret,
} from '../../../infra/lib/origin-verify-context';
import { StorageStack } from '../../../infra/lib/storage-stack';

const env: cdk.Environment = { account: '000000000000', region: 'us-east-1' };
const SECRET = 'origin-verify-secret-for-unit-test-0000000';
const HEADER = 'x-origin-verify';

interface OriginLike {
	OriginCustomHeaders?: Array<{ HeaderName?: string; HeaderValue?: string }>;
}

/** NetworkStack を synth し、distribution ごとの origin 配列を logicalId 付きで返す。 */
function synthDistributions(): Array<{ logicalId: string; origins: OriginLike[] }> {
	const app = new cdk.App({
		context: {
			// route53 / acm の fromLookup が credentials を要求するため lookup cache を注入する
			// (multi-lambda-cdk.test.ts と同値。AWS API は呼ばれない)。
			// demo distribution は `demoFunctionUrl && domainName` の両方が揃って初めて生成されるため、
			// domainName を渡す = hosted-zone lookup が必要になる。
			'hosted-zone:account=000000000000:domainName=ganbari-quest.com:region=us-east-1': {
				Id: '/hostedzone/Z00000000000000000000',
				Name: 'ganbari-quest.com.',
			},
			opsSecretKey: 'test-ops-secret-key',
			parentGateCookieSecret: 'test-parent-gate-secret-do-not-use-do-not-use',
			dsqlEndpoint: 'testcluster1234.dsql.us-east-1.on.aws',
			dsqlClusterArn: 'arn:aws:dsql:us-east-1:000000000000:cluster/testcluster1234',
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
		originVerifySecret: SECRET,
		domainName: 'ganbari-quest.com',
		certificateArn: 'arn:aws:acm:us-east-1:000000000000:certificate/test',
		demoFunctionUrl: compute.demoFunctionUrl,
	});
	const resources = Template.fromStack(network).findResources('AWS::CloudFront::Distribution');
	return Object.entries(resources).map(([logicalId, r]) => ({
		logicalId,
		origins: (r.Properties?.DistributionConfig?.Origins ?? []) as OriginLike[],
	}));
}

function verifyHeaderCount(origins: OriginLike[]): number {
	return origins.filter((o) =>
		(o.OriginCustomHeaders ?? []).some((h) => h.HeaderName === HEADER && h.HeaderValue === SECRET),
	).length;
}

describe('#4280 CloudFront が front door header を付与する', () => {
	// synth は Lambda asset bundling を伴い数十秒かかるため 1 回だけ実行して共有する
	let distributions: Array<{ logicalId: string; origins: OriginLike[] }>;

	// synth は Lambda asset bundling を含み既定 hook timeout (10s) を超える
	beforeAll(() => {
		distributions = synthDistributions();
	}, 180_000);

	it('本番 distribution の Lambda origin 2 本 (default + /_app/*) に header が付く', () => {
		const prod = distributions.filter((d) => !d.logicalId.startsWith('Demo'));
		expect(prod).toHaveLength(1);
		// Lambda を指す origin は 2 本 (lambdaOrigin / staticAssetOrigin)。S3 origin (error pages)
		// は OAC で守られるため対象外。
		expect(verifyHeaderCount(prod[0]?.origins ?? [])).toBe(2);
	});

	it('header 値は secret そのもの (別値・空文字が混ざらない)', () => {
		const prod = distributions.find((d) => !d.logicalId.startsWith('Demo'));
		const headers = (prod?.origins ?? []).flatMap((o) => o.OriginCustomHeaders ?? []);
		const verify = headers.filter((h) => h.HeaderName === HEADER);
		expect(verify.length).toBeGreaterThan(0);
		for (const h of verify) expect(h.HeaderValue).toBe(SECRET);
	});

	it('demo distribution には付けない (demo Lambda に secret を注入しないため、付けると全滅する)', () => {
		// demo Lambda は本番 secret を一切注入しない設計 (ADR-0048)。CloudFront 側だけ header を
		// 付けても origin は検査しないので無意味であり、逆に「付けたのに検査してない」ように見える。
		// 意図的に付けないことを固定する。
		const demo = distributions.filter((d) => d.logicalId.startsWith('Demo'));
		expect(demo.length).toBeGreaterThan(0);
		for (const d of demo) expect(verifyHeaderCount(d.origins)).toBe(0);
	});
});

describe('#4280 secret 未指定の synth は止まる (silent skip 禁止、ADR-0024)', () => {
	const reader = (value: unknown) => ({ tryGetContext: () => value });

	it.each([[undefined], [''], ['   '], [null], [123]])('context が %p なら throw する', (value) => {
		expect(() => resolveOriginVerifySecret(reader(value))).toThrow(/originVerifySecret/);
	});

	it('32 文字未満なら throw する (アプリ側 env schema の下限と揃える)', () => {
		expect(() => resolveOriginVerifySecret(reader('short-secret'))).toThrow(/短すぎます/);
	});

	it('32 文字以上なら trim した値を返す', () => {
		expect(resolveOriginVerifySecret(reader(`  ${SECRET}  `))).toBe(SECRET);
	});

	it('エラーメッセージが対処方法 (gh secret set / -c) を含む', () => {
		let message = '';
		try {
			resolveOriginVerifySecret(reader(undefined));
		} catch (e) {
			message = (e as Error).message;
		}
		// 止めるだけで直し方を書かない guard にしない (#4273 と同じ規律)
		expect(message).toContain('gh secret set ORIGIN_VERIFY_SECRET');
		expect(message).toContain(`-c ${originVerifyContextKey}=`);
	});
});

describe('#4280 deploy workflow の全 cdk 実行が context を渡す', () => {
	// infra/bin/app.ts が throw する以上、1 箇所でも欠けるとその step で deploy が止まる。
	// 「動かしてみて気づく」ではなく PR 時点で検出する (ADR-0061 shift-left)。
	const root = join(__dirname, '..', '..', '..');

	it.each([
		'.github/workflows/deploy.yml',
		'.github/workflows/deploy-aws-staging.yml',
	])('%s の cdk step が全て -c originVerifySecret を持つ', (relPath) => {
		const yml = readFileSync(join(root, relPath), 'utf8');
		// `- name:` 単位の step に切り、cdk を叩く step だけを検査する
		const steps = yml.split(/^ {6}- name: /m).slice(1);
		const cdkSteps = steps.filter((s) => s.includes('npx cdk'));
		expect(cdkSteps.length).toBeGreaterThan(0);

		const missing = cdkSteps
			.filter((s) => !s.includes(`-c ${originVerifyContextKey}=`))
			.map((s) => (s.split('\n')[0] ?? '').trim());
		expect(missing).toEqual([]);
	});

	it('本番 smoke (Function URL 直) に front door header が渡る', () => {
		// 本番 CloudFront は geoRestriction JP、GitHub Actions runner は日本国外のため、
		// production smoke は Function URL を直接叩く。header を渡し忘れると login 後の
		// /admin が 404 になり、deploy のたびに偽の赤が出る (#4280)。
		const yml = readFileSync(join(root, '.github/workflows/deploy.yml'), 'utf8');
		const smokeStep = yml
			.split(/^ {6}- name: /m)
			.find((s) => s.includes('playwright.production.config.ts'));
		expect(smokeStep).toBeDefined();
		expect(smokeStep).toContain('ORIGIN_VERIFY_SECRET');
	});

	it('secret を持つときの production smoke は trace を録らない (public repo の artifact 経由の漏洩防止)', () => {
		// Playwright の trace は request header をそのまま記録する。本リポジトリは public で
		// test-results/ は artifact として誰でも取得できるため、secret 保持時は trace を off にする。
		const cfg = readFileSync(join(root, 'playwright.production.config.ts'), 'utf8');
		expect(cfg).toMatch(/originVerifySecret\s*\?\s*'off'/);
		// header 注入自体も残っていること (trace off だけして header を消す改変を検出する)
		expect(cfg).toContain("'x-origin-verify': originVerifySecret");
	});

	it.each([
		'.github/workflows/deploy.yml',
		'.github/workflows/deploy-aws-staging.yml',
	])('%s が ORIGIN_VERIFY_SECRET を必須 secret として検証する', (relPath) => {
		const yml = readFileSync(join(root, relPath), 'utf8');
		expect(yml).toContain('ORIGIN_VERIFY_SECRET');
		// `for s in ... ORIGIN_VERIFY_SECRET ...` の必須ループに載っていること
		expect(yml).toMatch(/for s in [^\n]*ORIGIN_VERIFY_SECRET/);
	});
});
