/**
 * tests/unit/infra/vapid-push-wiring.test.ts (#4706)
 *
 * 本番の Web Push (リマインダー / ストリーク警告 / 達成通知) は VAPID 鍵が Lambda env に無いと 1 通も送れない。
 * `notification-service.ts` は鍵が無いと warn を出して `sent: 0` を返すだけなので、配線が欠けても
 * cron は 200 のまま「送信 0 件」を返し続け、誰も気づかない (実測: 2026-09-11〜23 の本番で
 * 送信判定 1,710 回すべてが鍵なしで止まっていた)。
 *
 * 守る不変条件:
 *   1. 本番 app Lambda の env に VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY が context から載る
 *   2. 本番で鍵が未指定 / 形式不正 / 組になっていない (片方だけの作り直し・取り違え) なら synth error
 *   3. demo Lambda と staging には鍵を配らない (秘密鍵を匿名公開の demo や push を配信しない環境に置かない)
 *   4. deploy.yml が鍵を必須 secret として検証し、本番 ComputeStack を選択する cdk 実行に渡す
 */

import { createECDH } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as cdk from 'aws-cdk-lib';
import { Annotations, Match, Template } from 'aws-cdk-lib/assertions';
import { describe, expect, it } from 'vitest';
import { ComputeStack } from '../../../infra/lib/compute-stack';
import { type GqEnvConfig, STAGING_ENV_CONFIG } from '../../../infra/lib/env-config';
import { StorageStack } from '../../../infra/lib/storage-stack';
import { isVapidKeyPair } from '../../../infra/lib/vapid-context';

const env: cdk.Environment = { account: '000000000000', region: 'us-east-1' };

/** 秘密鍵 (base64url 43 文字) から組になる公開鍵 (87 文字) を導く。テスト用の非秘密ダミーを作るためだけに使う。 */
function publicKeyOf(privateKey: string): string {
	const ecdh = createECDH('prime256v1');
	ecdh.setPrivateKey(Buffer.from(privateKey, 'base64url'));
	return ecdh.getPublicKey('base64url');
}

const PRIVATE_KEY = 'a'.repeat(43);
const PUBLIC_KEY = publicKeyOf(PRIVATE_KEY);
/** 形式は正しいが PRIVATE_KEY とは組にならない公開鍵 */
const OTHER_PUBLIC_KEY = publicKeyOf('c'.repeat(43));
const VAPID_ERROR = Match.stringLikeRegexp('VAPID');

type LambdaFn = { Properties: { Environment?: { Variables?: Record<string, unknown> } } };

function lambdaEnv(stack: cdk.Stack, functionName: string): Record<string, unknown> {
	const fns = Template.fromStack(stack).findResources('AWS::Lambda::Function', {
		Properties: { FunctionName: functionName },
	});
	expect(Object.keys(fns), `${functionName} が synth されていない`).toHaveLength(1);
	return (Object.values(fns)[0] as LambdaFn).Properties.Environment?.Variables ?? {};
}

function buildCompute(
	extraContext: Record<string, unknown> = {},
	envConfig?: GqEnvConfig,
): cdk.Stack {
	const app = new cdk.App({
		context: {
			opsSecretKey: 'test-ops-secret-key',
			parentGateCookieSecret: 'test-parent-gate-secret-do-not-use-do-not-use',
			dsqlEndpoint: 'testcluster1234.dsql.us-east-1.on.aws',
			dsqlClusterArn: 'arn:aws:dsql:us-east-1:000000000000:cluster/testcluster1234',
			originVerifySecret: 'origin-verify-secret-for-unit-test-0000000',
			...extraContext,
		},
	});
	const storage = new StorageStack(app, 'VapidStorage', { env, envConfig });
	return new ComputeStack(app, 'VapidCompute', {
		env,
		assetsBucket: storage.assetsBucket,
		repository: storage.repository,
		envConfig,
	}) as unknown as cdk.Stack;
}

describe('#4706 isVapidKeyPair (synth の判定)', () => {
	it('web-push が生成する鍵ペアを受け付ける', async () => {
		const webpush = (await import('web-push')).default;
		for (let i = 0; i < 20; i++) {
			const { publicKey, privateKey } = webpush.generateVAPIDKeys();
			expect(isVapidKeyPair(publicKey, privateKey)).toBe(true);
		}
	});

	it.each([
		['未指定', '', ''],
		['秘密鍵だけ未指定', PUBLIC_KEY, ''],
		['公開鍵と秘密鍵の取り違え', PRIVATE_KEY, PUBLIC_KEY],
		['組にならない公開鍵 (片方だけ作り直した)', OTHER_PUBLIC_KEY, PRIVATE_KEY],
		// 片側だけ不正な入力。両側とも不正な入力だけでは `&&` → `||` の取り違えや ^$ アンカー削除を検知できない
		['秘密鍵が 44 文字 (公開鍵は正しい)', PUBLIC_KEY, `${PRIVATE_KEY}a`],
		['公開鍵が 88 文字 (秘密鍵は正しい)', `${PUBLIC_KEY}A`, PRIVATE_KEY],
		['base64url でない文字を含む', PUBLIC_KEY, `${'a'.repeat(42)}+`],
		['P-256 の秘密鍵として無効 (0)', PUBLIC_KEY, 'A'.repeat(43)],
	])('%s は拒否する', (_label, publicKey, privateKey) => {
		expect(isVapidKeyPair(publicKey, privateKey)).toBe(false);
	});
});

describe('#4706 本番 app Lambda に VAPID 鍵が配られる', () => {
	it('context の鍵が app Lambda の env に載り、demo Lambda には載らない', () => {
		const compute = buildCompute({ vapidPublicKey: PUBLIC_KEY, vapidPrivateKey: PRIVATE_KEY });
		const appEnv = lambdaEnv(compute, 'ganbari-quest-app');
		expect(appEnv.VAPID_PUBLIC_KEY).toBe(PUBLIC_KEY);
		expect(appEnv.VAPID_PRIVATE_KEY).toBe(PRIVATE_KEY);
		// demo は匿名公開のため秘密鍵を置かない
		const demoEnv = lambdaEnv(compute, 'ganbari-quest-app-demo');
		expect(demoEnv.VAPID_PUBLIC_KEY).toBeUndefined();
		expect(demoEnv.VAPID_PRIVATE_KEY).toBeUndefined();
		expect(Annotations.fromStack(compute).findError('*', VAPID_ERROR)).toHaveLength(0);
	}, 120_000);

	it('鍵が未指定なら synth error (送信 0 件のまま deploy が通る形を作らない)', () => {
		const compute = buildCompute();
		Annotations.fromStack(compute).hasError('*', VAPID_ERROR);
	}, 120_000);

	it('組にならない鍵 (片方だけ作り直した) なら synth error', () => {
		const compute = buildCompute({
			vapidPublicKey: OTHER_PUBLIC_KEY,
			vapidPrivateKey: PRIVATE_KEY,
		});
		Annotations.fromStack(compute).hasError('*', VAPID_ERROR);
	}, 120_000);

	it('staging は context に鍵があっても env に載せず、未指定でも synth error にしない', () => {
		const withKeys = buildCompute(
			{ vapidPublicKey: PUBLIC_KEY, vapidPrivateKey: PRIVATE_KEY },
			STAGING_ENV_CONFIG,
		);
		const stagingEnv = lambdaEnv(withKeys, 'ganbari-quest-staging-app');
		expect(stagingEnv.VAPID_PUBLIC_KEY).toBeUndefined();
		expect(stagingEnv.VAPID_PRIVATE_KEY).toBeUndefined();
		const withoutKeys = buildCompute({}, STAGING_ENV_CONFIG);
		expect(Annotations.fromStack(withoutKeys).findError('*', VAPID_ERROR)).toHaveLength(0);
	}, 120_000);
});

describe('#4706 deploy.yml が VAPID 鍵を配る', () => {
	const yml = readFileSync(join(__dirname, '../../..', '.github/workflows/deploy.yml'), 'utf8');
	const steps = yml.split(/\n\s+- name: /);
	// `${{ … }}` は GitHub Actions の式。JS の template literal として展開させないため連結で組む。
	const secretRef = (name: string) => `\${{ secrets.${name} }}`;

	it.each([
		'VAPID_PUBLIC_KEY',
		'VAPID_PRIVATE_KEY',
	])('%s を Validate required secrets で必須検証する', (name) => {
		const validate = steps.find((s) => s.startsWith('Validate required secrets'));
		expect(validate, 'Validate required secrets step が見つからない').toBeDefined();
		expect(validate).toMatch(new RegExp(`for s in [^\\n]*\\b${name}\\b`));
		expect(validate).toContain(`${name}: ${secretRef(name)}`);
	});

	// CDK CLI が addError で止めるのは *選択した* stack (と上流) だけ。本番 ComputeStack を選択するのは
	// `-c dsqlEndpoint=` を渡す step (diff --all / deploy --all。env-distribution-closure [AR1] と同じ判別)。
	// Storage / Dsql 単独の step は本番 Compute を合成はするが選択しないので、鍵が無くても止まらない。
	it('本番 ComputeStack を選択する全 cdk 実行が VAPID 鍵を渡す', () => {
		const computeSteps = steps.filter(
			(s) => s.includes('npx cdk') && s.includes('-c dsqlEndpoint='),
		);
		expect(computeSteps.length).toBeGreaterThanOrEqual(2);
		for (const step of computeSteps) {
			expect(step).toContain(`-c vapidPublicKey=${secretRef('VAPID_PUBLIC_KEY')}`);
			expect(step).toContain(`-c vapidPrivateKey=${secretRef('VAPID_PRIVATE_KEY')}`);
		}
	});
});
