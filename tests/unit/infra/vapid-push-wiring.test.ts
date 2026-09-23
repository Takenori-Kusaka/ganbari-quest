/**
 * tests/unit/infra/vapid-push-wiring.test.ts (#4706)
 *
 * 本番の Web Push (リマインダー / ストリーク警告) は VAPID 鍵が Lambda env に無いと 1 通も送れない。
 * `notification-service.ts` は鍵が無いと warn を出して `sent: 0` を返すだけなので、配線が欠けても
 * cron は 200 のまま「送信 0 件」を返し続け、誰も気づかない (実測: 2026-09-11〜23 の本番で
 * 送信判定 1,710 回すべてが鍵なしで止まっていた)。
 *
 * 守る不変条件:
 *   1. 本番 app Lambda の env に VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY が context から載る
 *   2. 本番で鍵が未指定 / 形式不正 (公開鍵と秘密鍵の取り違えを含む) なら synth error で deploy を止める
 *   3. deploy.yml が鍵を必須 secret として検証し、Compute を synth する全 cdk 実行に渡す
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as cdk from 'aws-cdk-lib';
import { Annotations, Match, Template } from 'aws-cdk-lib/assertions';
import { describe, expect, it } from 'vitest';
import { ComputeStack } from '../../../infra/lib/compute-stack';
import { StorageStack } from '../../../infra/lib/storage-stack';

const env: cdk.Environment = { account: '000000000000', region: 'us-east-1' };
// 形式だけ本物に合わせたダミー (公開鍵 = 65 byte の base64url 87 文字 / 秘密鍵 = 32 byte の 43 文字)
const PUBLIC_KEY = `B${'A'.repeat(86)}`;
const PRIVATE_KEY = 'a'.repeat(43);
const VAPID_ERROR = Match.stringLikeRegexp('VAPID');

function buildCompute(extraContext: Record<string, unknown> = {}): cdk.Stack {
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
	const storage = new StorageStack(app, 'VapidStorage', { env });
	return new ComputeStack(app, 'VapidCompute', {
		env,
		assetsBucket: storage.assetsBucket,
		repository: storage.repository,
	}) as unknown as cdk.Stack;
}

describe('#4706 本番 app Lambda に VAPID 鍵が配られる', () => {
	it('context の鍵が app Lambda の env に載る', () => {
		const compute = buildCompute({ vapidPublicKey: PUBLIC_KEY, vapidPrivateKey: PRIVATE_KEY });
		Template.fromStack(compute).hasResourceProperties('AWS::Lambda::Function', {
			FunctionName: 'ganbari-quest-app',
			Environment: {
				Variables: Match.objectLike({
					VAPID_PUBLIC_KEY: PUBLIC_KEY,
					VAPID_PRIVATE_KEY: PRIVATE_KEY,
				}),
			},
		});
		expect(Annotations.fromStack(compute).findError('*', VAPID_ERROR)).toHaveLength(0);
	}, 120_000);

	it('鍵が未指定なら synth error (送信 0 件のまま deploy が通る形を作らない)', () => {
		const compute = buildCompute();
		Annotations.fromStack(compute).hasError('*', VAPID_ERROR);
	}, 120_000);

	it('公開鍵と秘密鍵を取り違えると synth error', () => {
		const compute = buildCompute({ vapidPublicKey: PRIVATE_KEY, vapidPrivateKey: PUBLIC_KEY });
		Annotations.fromStack(compute).hasError('*', VAPID_ERROR);
	}, 120_000);
});

describe('#4706 deploy.yml が VAPID 鍵を配る', () => {
	const yml = readFileSync(join(__dirname, '../../..', '.github/workflows/deploy.yml'), 'utf8');

	it.each(['VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY'])('%s を必須 secret として検証する', (name) => {
		expect(yml).toMatch(new RegExp(`for s in [^\\n]*\\b${name}\\b`));
		expect(yml).toContain(`${name}: \${{ secrets.${name} }}`);
	});

	// Compute stack を synth する cdk 実行は parentGateCookieSecret を渡している。
	// そのすべてが VAPID 鍵も渡していること (1 箇所でも欠けると、その実行だけ synth error で止まる)。
	it('parentGateCookieSecret を渡す全 cdk 実行が VAPID 鍵も渡す', () => {
		const count = (needle: string) => yml.split(needle).length - 1;
		const computeRuns = count('-c parentGateCookieSecret=');
		expect(computeRuns).toBeGreaterThan(0);
		// `${{ … }}` は GitHub Actions の式。JS の template literal として展開させないため連結で組む。
		const secretRef = (name: string) => `\${{ secrets.${name} }}`;
		expect(count(`-c vapidPublicKey=${secretRef('VAPID_PUBLIC_KEY')}`)).toBe(computeRuns);
		expect(count(`-c vapidPrivateKey=${secretRef('VAPID_PRIVATE_KEY')}`)).toBe(computeRuns);
	});
});
