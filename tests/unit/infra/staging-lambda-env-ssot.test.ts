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
import { deriveDesiredEnv, readLambdaEnvFromTemplate } from '../../../scripts/lambda-env-ssot.mjs';

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

// (b) の判定ロジック自体 (extra / missing / --strict / 必須キー) の unit は
// tests/unit/scripts/check-lambda-env-drift.test.ts が持つ。判定 script が 1 本になったので、
// 本 file は (a) 全上書きの導出と、workflow への配線だけを固定する。

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
		expect(yml).toContain('scripts/check-lambda-env-drift.mjs');
		const idx = yml.indexOf('- name: Lambda env drift check (staging');
		expect(idx, 'env キー差分検査 step が見つからない').toBeGreaterThan(-1);
		// step の終端 = 次の step の宣言、または次の step のコメントブロック (空行 + コメント) の手前。
		// コメントブロックまで含めると、隣の step が持つ `continue-on-error` の説明文を誤って拾う。
		const ends = [yml.indexOf('\n      - name: ', idx + 10), yml.indexOf('\n\n      #', idx + 10)]
			.filter((n) => n > -1)
			.sort((a, b) => a - b);
		const step = yml.slice(idx, ends[0] ?? yml.length);
		expect(step).not.toContain('continue-on-error');
		// staging は Step 13 が synth 出力のキー集合で全上書きするため、live は template と
		// 完全一致が唯一の正解。missing を warning に逃がさない (--strict)。
		expect(step).toContain('--strict');
	});

	it('(b) の許可リストは (a) と同じ出どころ (別ファイルに手で並べない)', async () => {
		const yml = await readWorkflow();
		// 検査は cdk deploy が出力した同じ template を読む。workflow 内に env キーの列挙が現れないこと。
		expect(yml).toContain('--template infra/cdk.out/GanbariQuestComputeStaging.template.json');
		expect(yml).not.toMatch(/STAGING_ALLOWED_ENV_KEYS/);
	});

	it('(b) hard-fail する env 検査は 1 本だけ、かつ後続の検証より後ろにある (#4365 / #4389 の再退行防止)', async () => {
		const yml = await readWorkflow();
		// deploy job の途中で hard-fail させると、後続の検証 (PII guard / DSQL 並行検証 / rollback 判定)
		// が丸ごと skip される。#4389 が末尾へ移したばかりの配置を、2 本目の判定を中盤に足す形で
		// 巻き戻さないことを機械で固定する。
		const steps = [...yml.matchAll(/^ {6}- name: (.+)$/gm)].map((m) => ({
			name: (m[1] ?? '').trim(),
			index: m.index ?? 0,
		}));
		// コメント行は落とす。「なぜ 1 本に統合したか」を説明する散文が step の実行内容として
		// 数えられると、説明を書くほど検査が誤検知する。
		const bodyOf = (i: number) =>
			yml
				.slice(steps[i]?.index ?? 0, steps[i + 1]?.index ?? yml.length)
				.split('\n')
				.filter((line) => !line.trim().startsWith('#'))
				.join('\n');

		const envCheckSteps = steps
			.map((s, i) => ({ ...s, body: bodyOf(i) }))
			.filter(
				(s) =>
					s.body.includes('check-lambda-env-drift.mjs') ||
					s.body.includes('lambda-env-ssot.mjs verify'),
			);
		expect(
			envCheckSteps.map((s) => s.name),
			'env キー集合の判定は 1 本に統合する (2 本あると基準が食い違ったとき、どちらが正か決められない)',
		).toHaveLength(1);

		const envCheckAt = envCheckSteps[0]?.index ?? -1;
		for (const laterName of ['Staging PII guard', 'DSQL staging concurrency test']) {
			const other = steps.find((s) => s.name.startsWith(laterName));
			expect(other, `${laterName} step が見つからない`).toBeDefined();
			expect(
				envCheckAt,
				`env 検査が「${laterName}」より前にあると、env が 1 本ずれただけでこの検証が skip される`,
			).toBeGreaterThan(other?.index ?? Number.POSITIVE_INFINITY);
		}
	});

	it('(a) 秘密を含む一時 file の削除が失敗経路も覆う (trap EXIT)', async () => {
		const yml = await readWorkflow();
		const idx = yml.indexOf('- name: Resolve ORIGIN from CloudFront');
		expect(idx, 'ORIGIN 解決 step が見つからない').toBeGreaterThan(-1);
		const step = yml.slice(idx, yml.indexOf('\n      # Step 14', idx));
		// GitHub の既定 shell は `bash -e`。後始末を成功パスの末尾に置くと、途中で落ちたときだけ
		// 秘密入り JSON が job 末尾まで runner に残る。
		expect(step).toMatch(/trap '[^']*rm -f[^']*' EXIT/s);
		for (const tmp of [
			'staging-live-env-before.json',
			'staging-desired-env.json',
			'staging-update-env.json',
		]) {
			const trapBlock = step.slice(step.indexOf('trap '), step.indexOf("' EXIT"));
			expect(trapBlock, `${tmp} が trap の削除対象に含まれていない`).toContain(tmp);
		}
	});
});
