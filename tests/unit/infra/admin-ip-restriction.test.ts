// tests/unit/infra/admin-ip-restriction.test.ts
// #4266 — /admin ・ /api/v1/admin ・ /ops の IP allowlist 層が「渡し忘れると黙って消える」構造の根絶。
//
// 起点となった欠陥 (第 20 回統合監査):
//   `network-stack.ts` は `adminAllowedIps` context が空のとき、CloudFront Function の
//   IP フィルタ分岐を三項演算子で**丸ごと落としていた**。deploy-aws-staging.yml は同 context を
//   1 箇所も渡していなかったため、staging の /admin ・ /api/v1/admin ・ /ops は
//   geo 制限 (#4204 で撤廃) も IP allowlist も無い **0 層公開**になっていた。
//   「staging では掛けない」という判断はどこにも書かれておらず、決裁の射程外で防御層が外れていた。
//
// 本 test が固定する不変条件 (ADR-0024 ENV silent skip 禁止):
//   [A] 宣言なしに IP 制限が消えない — context 未指定かつ opt-out 未宣言なら **synth が throw**
//   [B] opt-out は「理由」とセットでのみ成立する — 空 / 短すぎる理由は throw
//   [C] opt-out したときは無制限であることが template から読み取れ、警告が synth に出る
//   [D] context を渡したときは 3 path すべてに IP フィルタが載る
//   [E] no-silent-gap — prod / staging の全 cdk 実行 step が context を渡している
//       (CDK 側が正しくても workflow が渡さなければ [A] で deploy が落ちるだけで、
//        「落ちてから気づく」ことになる。PR 時点で検出する)

import { readFileSync } from 'node:fs';
import * as cdk from 'aws-cdk-lib';
import { Annotations, Match, Template } from 'aws-cdk-lib/assertions';
import { describe, expect, it } from 'vitest';
import { ComputeStack } from '../../../infra/lib/compute-stack';
import { STAGING_ENV_CONFIG } from '../../../infra/lib/env-config';
import { NetworkStack } from '../../../infra/lib/network-stack';
import { StorageStack } from '../../../infra/lib/storage-stack';

const env: cdk.Environment = { account: '000000000000', region: 'us-east-1' };

/** 全 stack の addError guard を満たす非秘密ダミー context (staging-cdk.test.ts と同型)。 */
const BASE_CONTEXT: Record<string, unknown> = {
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
};

/**
 * NetworkStack を 1 本 synth する。`extraContext` で adminAllowedIps / opt-out を切り替える。
 * staging=true で staging と同じ prefix / geoRestriction なし構成にする。
 */
function buildNetwork(extraContext: Record<string, unknown>, staging = false): NetworkStack {
	const app = new cdk.App({ context: { ...BASE_CONTEXT, ...extraContext } });
	const envConfig = staging ? STAGING_ENV_CONFIG : undefined;
	const suffix = staging ? 'Staging' : '';
	const storage = new StorageStack(app, `GanbariQuestStorage${suffix}`, { env, envConfig });
	const compute = new ComputeStack(app, `GanbariQuestCompute${suffix}`, {
		env,
		assetsBucket: storage.assetsBucket,
		repository: storage.repository,
		envConfig,
	});
	return new NetworkStack(app, `GanbariQuestNetwork${suffix}`, {
		env,
		functionUrl: compute.functionUrl,
		...(staging
			? { resourcePrefix: STAGING_ENV_CONFIG.resourcePrefix, geoRestrictionCountries: [] }
			: {}),
	});
}

/** `<prefix>-query-slash-encode` (= admin IP フィルタを載せる方) の FunctionCode を取り出す。 */
function viewerFunctionCode(network: NetworkStack, prefix = 'ganbari-quest'): string {
	const t = Template.fromStack(network);
	const fns = t.findResources('AWS::CloudFront::Function');
	const match = Object.values(fns).find(
		(r) =>
			(r as { Properties?: { Name?: string } }).Properties?.Name === `${prefix}-query-slash-encode`,
	) as { Properties?: { FunctionCode?: string } } | undefined;
	expect(match, `${prefix}-query-slash-encode が template に存在しない`).toBeDefined();
	return match?.Properties?.FunctionCode ?? '';
}

/** admin IP 制限が掛かる 3 path。ここを減らす変更は本 test で落ちる。 */
const PROTECTED_PATHS = ['/admin', '/api/v1/admin', '/ops'];

describe('#4266 admin IP allowlist が宣言なしに消えない', () => {
	// [A] 本丸。空 context で分岐が消えていた欠陥そのもの。
	it('adminAllowedIps 未指定 + opt-out 未宣言なら synth が throw する', () => {
		expect(() => buildNetwork({})).toThrowError(/adminAllowedIps/);
	});

	it('adminAllowedIps が空文字でも throw する (secret 未設定時の展開結果)', () => {
		expect(() => buildNetwork({ adminAllowedIps: '' })).toThrowError(/adminAllowedIps/);
	});

	it('カンマだけ等、実 IP が 1 件も残らない指定も throw する', () => {
		expect(() => buildNetwork({ adminAllowedIps: ' , , ' })).toThrowError(/adminAllowedIps/);
	});

	// [B] 理由の非強制を作らない (#3956 教訓)。opt-out は理由とセットでのみ成立する。
	it('opt-out 宣言に理由が無ければ throw する', () => {
		expect(() => buildNetwork({ adminIpRestrictionOptOut: '' })).toThrowError(/adminAllowedIps/);
		expect(() => buildNetwork({ adminIpRestrictionOptOut: true })).toThrowError(
			/adminIpRestrictionOptOut/,
		);
	});

	it('opt-out の理由が短すぎる場合は throw する', () => {
		expect(() => buildNetwork({ adminIpRestrictionOptOut: 'temp' })).toThrowError(
			/adminIpRestrictionOptOut/,
		);
	});

	// [C] opt-out したなら「無制限である」ことが template と synth ログから読める。
	it('理由つき opt-out は throw せず、無制限であることが template から読み取れる', () => {
		const reason = '#4266 一時的に IP allowlist 無しで検証するため';
		const network = buildNetwork({ adminIpRestrictionOptOut: reason }, true);
		const code = viewerFunctionCode(network, STAGING_ENV_CONFIG.resourcePrefix);
		expect(code).not.toContain('ALLOWED_IPS');
		for (const p of PROTECTED_PATHS) {
			expect(code).not.toContain(p);
		}
	}, 60_000);

	it('理由つき opt-out は理由を添えた警告を synth に出す', () => {
		const reason = '#4266 一時的に IP allowlist 無しで検証するため';
		const network = buildNetwork({ adminIpRestrictionOptOut: reason }, true);
		const warnings = Annotations.fromStack(network as unknown as cdk.Stack).findWarning(
			'*',
			Match.anyValue(),
		);
		const joined = warnings.map((w) => String(w.entry.data)).join('\n');
		expect(joined).toContain(reason);
	}, 60_000);

	// [D] 通常経路。3 path すべてに載っていること。
	it('adminAllowedIps 指定時は 3 path すべてに IP フィルタが載る', () => {
		const network = buildNetwork({ adminAllowedIps: '203.0.113.1, 198.51.100.7' });
		const code = viewerFunctionCode(network);
		for (const p of PROTECTED_PATHS) {
			expect(code, `${p} の IP フィルタ分岐が無い`).toContain(p);
		}
		expect(code).toContain('203.0.113.1');
		expect(code).toContain('198.51.100.7');
		expect(code).toContain('403');
	}, 60_000);

	it('staging でも同じ IP フィルタが載る (prod と staging で防御層を変えない)', () => {
		const network = buildNetwork({ adminAllowedIps: '203.0.113.1' }, true);
		const code = viewerFunctionCode(network, STAGING_ENV_CONFIG.resourcePrefix);
		for (const p of PROTECTED_PATHS) {
			expect(code, `${p} の IP フィルタ分岐が無い`).toContain(p);
		}
	}, 60_000);
});

// ---------------------------------------------------------------------------
// [E] no-silent-gap: CDK 側が正しくても workflow が context を渡さなければ deploy が落ちる。
// 「落ちてから気づく」ではなく PR 時点で検出する (staging-cdk.test.ts [N-5] と同じ発想)。
// ---------------------------------------------------------------------------
/** workflow yml を step 単位に割り、`npx cdk deploy|diff` を含む step の本文を返す。 */
function cdkSteps(ymlPath: string): { name: string; body: string }[] {
	const yml = readFileSync(ymlPath, 'utf8');
	const parts = yml.split(/^ {6}- name: /m).slice(1);
	return parts
		.map((p) => ({ name: (p.split('\n')[0] ?? '').trim(), body: p }))
		.filter((s) => /npx cdk (deploy|diff)/.test(s.body));
}

describe('#4266 deploy workflow が adminAllowedIps を渡し漏らさない', () => {
	for (const wf of ['.github/workflows/deploy.yml', '.github/workflows/deploy-aws-staging.yml']) {
		it(`${wf} の全 cdk 実行 step が adminAllowedIps を渡している`, () => {
			const steps = cdkSteps(wf);
			// 空集合同士の比較で緑になるのを防ぐ (step を 1 つも拾えていなければ検査が成立していない)。
			expect(steps.length, `${wf} で cdk 実行 step を 1 つも拾えていない`).toBeGreaterThan(0);
			const missing = steps.filter((s) => !s.body.includes('adminAllowedIps')).map((s) => s.name);
			expect(
				missing,
				`context 未指定の cdk 実行 step があります (synth が throw して deploy が落ちます): ${missing.join(' / ')}`,
			).toEqual([]);
		});
	}

	it('staging も本番と同じ secrets.ADMIN_ALLOWED_IPS を参照する (別 secret を作らない)', () => {
		const yml = readFileSync('.github/workflows/deploy-aws-staging.yml', 'utf8');
		expect(yml).toContain('secrets.ADMIN_ALLOWED_IPS');
	});
});
