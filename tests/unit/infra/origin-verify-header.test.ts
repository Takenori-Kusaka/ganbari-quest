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
import { Annotations, Match, Template } from 'aws-cdk-lib/assertions';
import { beforeAll, describe, expect, it } from 'vitest';
import { ComputeStack } from '../../../infra/lib/compute-stack';
import { NetworkStack } from '../../../infra/lib/network-stack';
import {
	originVerifyContextKey,
	originVerifyPreviousContextKey,
	resolveOriginVerifyPreviousSecret,
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

/**
 * workflow yaml の `run: |` (literal block) 内で、前行が `\` で終わっていない `-c ...` 行を返す (#4364)。
 *
 * literal block では行がそのままシェルの別コマンドになるため、`\` が欠けた `-c ...` は
 * `-c: command not found` で step を落とし、同時にその cdk 実行へ context が渡らない。
 * `run: >-` (folded) は YAML 側が空白で連結するため `\` は不要 = 検査対象外。
 */
function findOrphanContextLines(yml: string, label: string): string[] {
	const lines = yml.split('\n');
	const orphans: string[] = [];
	let literalIndent = -1; // literal block を開いた `run:` の indent (-1 = ブロック外)

	for (const [i, line] of lines.entries()) {
		const runScalar = /^(\s*)run:\s*(\||>-?)\s*$/.exec(line);
		if (runScalar) {
			literalIndent = runScalar[2] === '|' ? (runScalar[1] ?? '').length : -1;
			continue;
		}
		// block は「indent が run: 以下の非空行」で終わる (YAML の block scalar 規則)
		const trimmed = line.trim();
		if (
			literalIndent >= 0 &&
			trimmed !== '' &&
			line.length - line.trimStart().length <= literalIndent
		) {
			literalIndent = -1;
		}
		if (literalIndent < 0 || !trimmed.startsWith('-c ')) continue;
		if (!(lines[i - 1] ?? '').trimEnd().endsWith('\\'))
			orphans.push(`${label}:${i + 1}: ${trimmed}`);
	}
	return orphans;
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

describe('#4364 Lambda env への旧 secret 注入', () => {
	const PREVIOUS = 'origin-verify-previous-secret-for-unit-test';

	/** ComputeStack を synth し、アプリ Lambda (SvelteKitFn) の Environment.Variables を返す。 */
	function synthAppEnv(context: Record<string, unknown>): Record<string, unknown> {
		const app = new cdk.App({
			context: {
				opsSecretKey: 'test-ops-secret-key',
				parentGateCookieSecret: 'test-parent-gate-secret-do-not-use-do-not-use',
				dsqlEndpoint: 'testcluster1234.dsql.us-east-1.on.aws',
				dsqlClusterArn: 'arn:aws:dsql:us-east-1:000000000000:cluster/testcluster1234',
				[originVerifyContextKey]: SECRET,
				...context,
			},
		});
		const storage = new StorageStack(app, 'EnvStorage', { env });
		const compute = new ComputeStack(app, 'EnvCompute', {
			env,
			assetsBucket: storage.assetsBucket,
			repository: storage.repository,
		});
		const fns = Template.fromStack(compute).findResources('AWS::Lambda::Function');
		const appFn = Object.entries(fns).find(([logicalId]) => logicalId.startsWith('SvelteKitFn'));
		expect(appFn).toBeDefined();
		return (appFn?.[1]?.Properties?.Environment?.Variables ?? {}) as Record<string, unknown>;
	}

	it('context 指定時に ORIGIN_VERIFY_SECRET_PREVIOUS が載る (これが無いと旧 header を受理できない)', () => {
		const vars = synthAppEnv({ [originVerifyPreviousContextKey]: PREVIOUS });
		expect(vars.ORIGIN_VERIFY_SECRET_PREVIOUS).toBe(PREVIOUS);
		// 現行値も同時に載っていること (旧値だけになると新 header が通らなくなる)
		expect(vars.ORIGIN_VERIFY_SECRET).toBe(SECRET);
	});

	it('context 未指定なら env 自体を作らない (定常状態 = 新値のみ受理)', () => {
		const vars = synthAppEnv({});
		expect(vars).not.toHaveProperty('ORIGIN_VERIFY_SECRET_PREVIOUS');
		expect(vars.ORIGIN_VERIFY_SECRET).toBe(SECRET);
	});
}, 180_000);

describe('#4364 ローテーション中の旧 secret (previous) の解決', () => {
	const reader = (value: unknown) => ({ tryGetContext: () => value });

	it.each([
		[undefined],
		[''],
		['   '],
		[null],
		[123],
	])('context が %p なら undefined (定常状態 = 新値のみ受理。ここで throw してはいけない)', (value) => {
		expect(resolveOriginVerifyPreviousSecret(reader(value))).toBeUndefined();
	});

	it('32 文字以上なら trim した値を返す', () => {
		expect(resolveOriginVerifyPreviousSecret(reader(`  ${SECRET}  `))).toBe(SECRET);
	});

	it('指定されているのに短すぎる場合は throw する (黙って捨てるとローテーション中に 404)', () => {
		// 旧値を渡したつもりが無視される = CloudFront がまだ旧 header を送っている間
		// /admin ・ /api/v1/admin ・ /ops が全顧客で 404 になる。silent skip 禁止 (ADR-0024)。
		expect(() => resolveOriginVerifyPreviousSecret(reader('short-previous'))).toThrow(/短すぎます/);
	});

	it('エラーメッセージが対処方法 (runbook / secret 名) を含む', () => {
		let message = '';
		try {
			resolveOriginVerifyPreviousSecret(reader('short-previous'));
		} catch (e) {
			message = (e as Error).message;
		}
		expect(message).toContain('ORIGIN_VERIFY_SECRET_PREVIOUS');
		expect(message).toContain('docs/runbooks/origin-verify-secret-rotation.md');
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

	it.each([
		'.github/workflows/deploy.yml',
		'.github/workflows/deploy-aws-staging.yml',
	])('%s の cdk step が全て -c originVerifySecretPrevious を持つ (#4364)', (relPath) => {
		// 1 箇所でも欠けると、その cdk 実行だけ旧値を配らない Lambda env が出来上がり、
		// ローテーション中に「その stack 経由で更新された Lambda」だけ 404 になる。
		const yml = readFileSync(join(root, relPath), 'utf8');
		const steps = yml.split(/^ {6}- name: /m).slice(1);
		const cdkSteps = steps.filter((s) => s.includes('npx cdk'));
		expect(cdkSteps.length).toBeGreaterThan(0);

		const missing = cdkSteps
			.filter((s) => !s.includes(`-c ${originVerifyPreviousContextKey}=`))
			.map((s) => (s.split('\n')[0] ?? '').trim());
		expect(missing).toEqual([]);
	});

	it.each([
		'.github/workflows/deploy.yml',
		'.github/workflows/deploy-aws-staging.yml',
	])('%s の `-c` 行が行継続で繋がっている (孤立した -c 行を作らない、#4364)', (relPath) => {
		// `run: |` ブロックで前行の `\` が欠けると、その `-c ...` は**別のシェルコマンド**として
		// 実行され `-c: command not found` で step が落ちる。同時に、その cdk 実行は当該 context を
		// 受け取らないまま走る。実際 deploy-aws-staging.yml の DSQL staging step が
		// `-c opsSecretKey=...` の `\` 欠落でこの状態だった (#4364 で修正)。
		// 文字列一致の context チェックだけでは「書いてあるのに渡っていない」を見逃すため、
		// 継続の物理的な繋がりを別に検査する。
		const yml = readFileSync(join(root, relPath), 'utf8');
		expect(findOrphanContextLines(yml, relPath)).toEqual([]);
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

describe('#4369 follow-up: ORIGIN_VERIFY_SECRET_PREVIOUS 残置の CDK synth warning', () => {
	/** ComputeStack を synth する。前提 context (dsql / parentGateCookieSecret 等) は他 describe と揃える。 */
	function buildCompute(extraContext: Record<string, unknown> = {}): cdk.Stack {
		const app = new cdk.App({
			context: {
				opsSecretKey: 'test-ops-secret-key',
				parentGateCookieSecret: 'test-parent-gate-secret-do-not-use-do-not-use',
				dsqlEndpoint: 'testcluster1234.dsql.us-east-1.on.aws',
				dsqlClusterArn: 'arn:aws:dsql:us-east-1:000000000000:cluster/testcluster1234',
				[originVerifyContextKey]: SECRET,
				...extraContext,
			},
		});
		const storage = new StorageStack(app, 'WarnStorage', { env });
		return new ComputeStack(app, 'WarnCompute', {
			env,
			assetsBucket: storage.assetsBucket,
			repository: storage.repository,
		}) as unknown as cdk.Stack;
	}

	// #4369 follow-up: CDK は cross-stack reference の feature-flag 案内など、本 PR と無関係な
	// warning を常に 1 件以上出す (`crossStackReferencesDefaultStrong` 等)。`findWarning('*', anyValue())`
	// で 0 件を assert すると無関係な CDK 標準 warning に誤爆するため、**本 PR が出す warning のパターンだけ**
	// を matcher に絞る (anyValue ではなく stringLikeRegexp)。
	const OUR_WARNING_PATTERN = Match.stringLikeRegexp('ORIGIN_VERIFY_SECRET_PREVIOUS');

	it('originVerifySecretPrevious が設定されていると synth warning が出る (段 3 未実施の可視化)', () => {
		const compute = buildCompute({
			[originVerifyPreviousContextKey]: 'origin-verify-previous-secret-for-unit-test',
		});
		Annotations.fromStack(compute).hasWarning('*', OUR_WARNING_PATTERN);
	});

	it('未指定 (定常状態) なら本 warning は出ない (CDK 標準 warning は対象外)', () => {
		const compute = buildCompute();
		const warnings = Annotations.fromStack(compute).findWarning('*', OUR_WARNING_PATTERN);
		expect(warnings).toHaveLength(0);
	});

	it('warning が出ても synth は止まらない (addError にはしていない、ローテーション中は正常な状態のため)', () => {
		// buildCompute が例外を投げずに完了すること自体が実証 (addWarning は Annotations に積むだけで
		// deploy を止めない。addError であればここで throw する)。
		const compute = buildCompute({
			[originVerifyPreviousContextKey]: 'origin-verify-previous-secret-for-unit-test',
		});
		const errors = Annotations.fromStack(compute).findError('*', Match.anyValue());
		expect(errors).toHaveLength(0);
	}, 30_000);

	it('warning メッセージが対処方法 (runbook 段 3) を含む', () => {
		const compute = buildCompute({
			[originVerifyPreviousContextKey]: 'origin-verify-previous-secret-for-unit-test',
		});
		const warnings = Annotations.fromStack(compute).findWarning('*', OUR_WARNING_PATTERN);
		expect(warnings.length).toBeGreaterThan(0);
		const messages = warnings.map((w) => (w as { entry?: { data?: string } }).entry?.data ?? '');
		expect(messages.some((m) => m.includes('docs/runbooks/origin-verify-secret-rotation.md'))).toBe(
			true,
		);
	});
});
