// tests/unit/infra/staging-lambda-env-ssot.test.ts
// #4352 — staging Lambda の env は CDK synth 出力を SSOT とする。
//
// 事故の実物: 監査が手で入れた `STRIPE_PRICE_*_MONTHLY` が full staging deploy (success) を
// 跨いで残存した。原因は 2 つ:
//   (1) CloudFormation は out-of-band drift を戻さない (テンプレートが同一ならリソースを触らない)
//   (2) deploy workflow の ORIGIN resolve step が **live env を読んで merge して書き戻す**ため、
//       手で足した env が毎回「正式な設定」として再コミットされる
//
// ここで固定する不変条件:
//   (b) deploy の最後に、live env のキー集合が CDK SSOT と一致することを検査して fail できる
//   (a) env の書き戻しは live env を読まず、synth 出力から組み立てた完全な集合で全上書きする
//
// 期待キーは **synth 出力から導出する** (workflow に手で列挙しない — 列挙は必ず腐る、PO 決裁)。

import * as cdk from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { describe, expect, it } from 'vitest';
import { ComputeStack } from '../../../infra/lib/compute-stack';
import { STAGING_ENV_CONFIG } from '../../../infra/lib/env-config';
import { StorageStack } from '../../../infra/lib/storage-stack';
import {
	deriveDesiredEnv,
	readLambdaEnvFromTemplate,
	verifyEnvKeys,
} from '../../../scripts/lambda-env-ssot.mjs';

const FUNCTION_NAME = 'ganbari-quest-staging-app';

/** compute-stack の staging Lambda を模した synth 出力 (値の一部は CFN intrinsic)。 */
function fixtureTemplate(): unknown {
	return {
		Resources: {
			OtherFn: {
				Type: 'AWS::Lambda::Function',
				Properties: {
					FunctionName: 'ganbari-quest-staging-health',
					Environment: { Variables: {} },
				},
			},
			SvelteKitFnABC123: {
				Type: 'AWS::Lambda::Function',
				Properties: {
					FunctionName: FUNCTION_NAME,
					Environment: {
						Variables: {
							DATA_SOURCE: 'dsql',
							AUTH_MODE: 'cognito',
							ORIGIN: 'https://staging-origin-placeholder.invalid',
							COGNITO_CALLBACK_URL: 'https://staging-origin-placeholder.invalid/auth/callback',
							COGNITO_LOGOUT_URL: 'https://staging-origin-placeholder.invalid/auth/login',
							// cross-stack / SSM 由来はクライアント側で解決できない intrinsic
							ASSETS_BUCKET: { 'Fn::ImportValue': 'GanbariQuestStorageStaging:AssetsBucket' },
							COGNITO_USER_POOL_ID: { Ref: 'SsmParameterValueUserPoolId' },
						},
					},
				},
			},
		},
	};
}

describe('#4352 (b) env キー差分検査 — 想定外キーがあれば fail し、キー名だけを出す', () => {
	it('live に CDK SSOT 外のキーがあれば ok=false + そのキー名を返す', () => {
		const result = verifyEnvKeys({
			expectedKeys: ['DATA_SOURCE', 'ORIGIN'],
			actualKeys: ['DATA_SOURCE', 'ORIGIN', 'STRIPE_PRICE_STANDARD_MONTHLY'],
		});
		expect(result.ok).toBe(false);
		expect(result.unexpected).toEqual(['STRIPE_PRICE_STANDARD_MONTHLY']);
		expect(result.missing).toEqual([]);
	});

	it('CDK SSOT にあるキーが live から欠けていても fail する (片側検査にしない)', () => {
		const result = verifyEnvKeys({
			expectedKeys: ['DATA_SOURCE', 'STRIPE_SECRET_KEY'],
			actualKeys: ['DATA_SOURCE'],
		});
		expect(result.ok).toBe(false);
		expect(result.missing).toEqual(['STRIPE_SECRET_KEY']);
	});

	it('一致していれば ok=true', () => {
		const result = verifyEnvKeys({
			expectedKeys: ['B', 'A'],
			actualKeys: ['A', 'B'],
		});
		expect(result.ok).toBe(true);
	});

	it('formatVerifyReport 相当の出力に値が混ざらない (キー名だけ) — 秘密を CI ログに出さない', () => {
		const result = verifyEnvKeys({
			expectedKeys: ['STRIPE_SECRET_KEY'],
			actualKeys: ['STRIPE_SECRET_KEY', 'INJECTED'],
		});
		// 返すのはキー名の配列だけ。値を受け取る口自体を持たない (受け取れれば必ずいつか出る)。
		expect(JSON.stringify(result)).not.toContain('sk_test');
		expect(Object.keys(result).sort()).toEqual(['missing', 'ok', 'unexpected']);
	});
});

describe('#4352 期待キーは synth 出力から導出する (手で列挙しない)', () => {
	it('FunctionName 一致の Lambda の Environment.Variables を取り出す', () => {
		const env = readLambdaEnvFromTemplate(fixtureTemplate(), FUNCTION_NAME);
		expect(Object.keys(env).sort()).toEqual([
			'ASSETS_BUCKET',
			'AUTH_MODE',
			'COGNITO_CALLBACK_URL',
			'COGNITO_LOGOUT_URL',
			'COGNITO_USER_POOL_ID',
			'DATA_SOURCE',
			'ORIGIN',
		]);
	});

	it('対象 Lambda が template に無ければ throw する (静かに空集合を返さない)', () => {
		expect(() => readLambdaEnvFromTemplate(fixtureTemplate(), 'no-such-fn')).toThrow(/no-such-fn/);
	});
});

describe('#4352 (a) 望ましい env は live を読まずに組み立て、未知キーを落とす', () => {
	const liveEnv = {
		DATA_SOURCE: 'dsql',
		AUTH_MODE: 'cognito',
		ORIGIN: 'https://staging-origin-placeholder.invalid',
		COGNITO_CALLBACK_URL: 'https://staging-origin-placeholder.invalid/auth/callback',
		COGNITO_LOGOUT_URL: 'https://staging-origin-placeholder.invalid/auth/login',
		ASSETS_BUCKET: 'ganbari-quest-staging-assets',
		COGNITO_USER_POOL_ID: 'us-east-1_STAGING',
		// 手で注入された drift
		STRIPE_PRICE_STANDARD_MONTHLY: 'price_manual',
		STRIPE_PRICE_FAMILY_MONTHLY: 'price_manual2',
	};
	const overrides = {
		ORIGIN: 'https://d123.cloudfront.net',
		COGNITO_CALLBACK_URL: 'https://d123.cloudfront.net/auth/callback',
		COGNITO_LOGOUT_URL: 'https://d123.cloudfront.net/auth/login',
	};

	it('手で注入された env は desired に含まれない (= 次の deploy で消える)', () => {
		const { desired, droppedKeys } = deriveDesiredEnv({
			templateEnv: readLambdaEnvFromTemplate(fixtureTemplate(), FUNCTION_NAME),
			liveEnv,
			overrides,
		});
		expect(desired.STRIPE_PRICE_STANDARD_MONTHLY).toBeUndefined();
		expect(desired.STRIPE_PRICE_FAMILY_MONTHLY).toBeUndefined();
		expect(droppedKeys).toEqual(['STRIPE_PRICE_FAMILY_MONTHLY', 'STRIPE_PRICE_STANDARD_MONTHLY']);
	});

	it('template の literal 値がそのまま使われ、override 3 本が実 URL に置き換わる', () => {
		const { desired } = deriveDesiredEnv({
			templateEnv: readLambdaEnvFromTemplate(fixtureTemplate(), FUNCTION_NAME),
			liveEnv,
			overrides,
		});
		expect(desired.DATA_SOURCE).toBe('dsql');
		expect(desired.ORIGIN).toBe('https://d123.cloudfront.net');
		expect(desired.COGNITO_CALLBACK_URL).toBe('https://d123.cloudfront.net/auth/callback');
		expect(desired.COGNITO_LOGOUT_URL).toBe('https://d123.cloudfront.net/auth/login');
	});

	it('CFN intrinsic (Ref / ImportValue) の値だけは live から引き継ぎ、その事実を返す', () => {
		const { desired, unresolvedKeys } = deriveDesiredEnv({
			templateEnv: readLambdaEnvFromTemplate(fixtureTemplate(), FUNCTION_NAME),
			liveEnv,
			overrides,
		});
		expect(desired.ASSETS_BUCKET).toBe('ganbari-quest-staging-assets');
		expect(desired.COGNITO_USER_POOL_ID).toBe('us-east-1_STAGING');
		expect(unresolvedKeys).toEqual(['ASSETS_BUCKET', 'COGNITO_USER_POOL_ID']);
	});

	it('intrinsic のキーが live にも無ければ throw する (空文字で埋めて起動を壊さない)', () => {
		const { ASSETS_BUCKET: _dropped, ...withoutBucket } = liveEnv;
		expect(() =>
			deriveDesiredEnv({
				templateEnv: readLambdaEnvFromTemplate(fixtureTemplate(), FUNCTION_NAME),
				liveEnv: withoutBucket,
				overrides,
			}),
		).toThrow(/ASSETS_BUCKET/);
	});

	it('template に無いキーを override で足そうとしたら throw する (SSOT 外の env を workflow から生やさない)', () => {
		expect(() =>
			deriveDesiredEnv({
				templateEnv: readLambdaEnvFromTemplate(fixtureTemplate(), FUNCTION_NAME),
				liveEnv,
				overrides: { ...overrides, MAINTENANCE_MODE: 'true' },
			}),
		).toThrow(/MAINTENANCE_MODE/);
	});
});

// CDK synth は初回 construct tree 構築で 5s 既定 timeout を超える (実測 ~19s) ため明示指定する。
describe('#4352 実 synth 出力に対して動く (fixture だけで緑にしない)', { timeout: 60_000 }, () => {
	// fixture が本物の template 形状とズレていたら、workflow では動かないのに test だけ緑になる。
	// 実 staging ComputeStack を synth して、script が実物を読めることを固定する。
	function synthStagingComputeTemplate(): unknown {
		const env: cdk.Environment = { account: '000000000000', region: 'us-east-1' };
		const app = new cdk.App({
			context: {
				parentGateCookieSecret: 'test-parent-gate-secret-do-not-use-do-not-use',
				dsqlEndpoint: 'testcluster1234.dsql.us-east-1.on.aws',
				dsqlClusterArn: 'arn:aws:dsql:us-east-1:000000000000:cluster/testcluster1234',
			},
		});
		const storage = new StorageStack(app, 'TestStorageStaging', {
			env,
			envConfig: STAGING_ENV_CONFIG,
		});
		const compute = new ComputeStack(app, 'TestComputeStaging', {
			env,
			assetsBucket: storage.assetsBucket,
			repository: storage.repository,
			envConfig: STAGING_ENV_CONFIG,
		});
		return Template.fromStack(compute).toJSON();
	}

	it('実 template から staging Lambda の env を読め、override 3 本が存在する', () => {
		const templateEnv = readLambdaEnvFromTemplate(
			synthStagingComputeTemplate(),
			'ganbari-quest-staging-app',
		);
		// workflow が --set する 3 本が SSOT 側に無いと derive は throw する (override guard)。
		expect(Object.keys(templateEnv)).toEqual(
			expect.arrayContaining(['ORIGIN', 'COGNITO_CALLBACK_URL', 'COGNITO_LOGOUT_URL']),
		);
		expect(templateEnv.DATA_SOURCE).toBe('dsql');
	});

	it('実 template + live env から desired env を組み立てられ、SSOT 外キーが落ちる', () => {
		const templateEnv = readLambdaEnvFromTemplate(
			synthStagingComputeTemplate(),
			'ganbari-quest-staging-app',
		);
		// intrinsic キーは live から引き継ぐ想定なので、live に全キーの値を用意する。
		const liveEnv: Record<string, string> = {};
		for (const key of Object.keys(templateEnv)) liveEnv[key] = 'live-value';
		liveEnv.STRIPE_PRICE_STANDARD_MONTHLY = 'price_manual';

		const origin = 'https://d123.cloudfront.net';
		const { desired, droppedKeys } = deriveDesiredEnv({
			templateEnv,
			liveEnv,
			overrides: {
				ORIGIN: origin,
				COGNITO_CALLBACK_URL: `${origin}/auth/callback`,
				COGNITO_LOGOUT_URL: `${origin}/auth/login`,
			},
		});
		expect(droppedKeys).toContain('STRIPE_PRICE_STANDARD_MONTHLY');
		expect(desired.STRIPE_PRICE_STANDARD_MONTHLY).toBeUndefined();
		expect(desired.ORIGIN).toBe(origin);
		// placeholder が実 URL に置き換わっていること (置換漏れは CSRF 403 として顧客影響になる)
		expect(JSON.stringify(desired)).not.toContain('staging-origin-placeholder.invalid');
		// 値が全て string であること (aws CLI は string 以外を受け付けない)
		for (const value of Object.values(desired)) expect(typeof value).toBe('string');
	});
});

describe('#4352 deploy-aws-staging.yml の配線 (no-silent-gap)', () => {
	async function readWorkflow(): Promise<string> {
		const { readFileSync } = await import('node:fs');
		return readFileSync('.github/workflows/deploy-aws-staging.yml', 'utf8');
	}

	it('(a) ORIGIN 解決 step が live env の read-modify-write merge をしない', async () => {
		const yml = await readWorkflow();
		// 旧実装: ENV_JSON=$(aws lambda get-function-configuration ... ) → jq '. + {ORIGIN: ...}'
		// この形が残っている限り、手で足した env は毎回 deploy に再コミットされる。
		expect(yml).not.toContain("'. + {ORIGIN");
		expect(yml).not.toContain('. + {ORIGIN');
	});

	it('(a) env は synth 出力 (cdk.out の template) から組み立てる', async () => {
		const yml = await readWorkflow();
		expect(yml).toContain('cdk.out/GanbariQuestComputeStaging.template.json');
		expect(yml).toContain('scripts/lambda-env-ssot.mjs derive');
	});

	it('(b) deploy 後に env キー差分検査があり、advisory に逃がしていない', async () => {
		const yml = await readWorkflow();
		expect(yml).toContain('scripts/lambda-env-ssot.mjs verify');
		const idx = yml.indexOf('- name: Verify staging Lambda env keys');
		expect(idx, 'env キー差分検査 step が見つからない').toBeGreaterThan(-1);
		// step の終端 = 次の step の宣言、または次の step のコメントブロック (空行 + コメント) の手前。
		// コメントブロックまで含めると、隣の step が持つ `continue-on-error` の説明文を誤って拾う。
		const ends = [yml.indexOf('\n      - name: ', idx + 10), yml.indexOf('\n\n      #', idx + 10)]
			.filter((n) => n > -1)
			.sort((a, b) => a - b);
		const step = yml.slice(idx, ends[0]);
		expect(step).not.toContain('continue-on-error');
	});

	it('(b) の許可リストは (a) と同じ出どころ (別ファイルに手で並べない)', async () => {
		const yml = await readWorkflow();
		// verify は derive が書いた成果物を読む。workflow 内に env キーの列挙が現れないこと。
		expect(yml).toContain('--expected');
		expect(yml).not.toMatch(/STAGING_ALLOWED_ENV_KEYS/);
	});
});
