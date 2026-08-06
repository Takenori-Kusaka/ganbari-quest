// tests/unit/infra/ops-alert-destination.test.ts
// #4189 — CloudWatch アラームの宛先が「メール」から「Discord 転送 Lambda」に移ったことを固定する。
//
// ## なぜ test で押さえるか
//
// #4189 の実害は「**alarm は存在するのに宛先が 0 件**」だった。宛先の付け替えは
// 目視では確認しづらく（synth 結果を人が読む必要がある）、退行しても alarm は
// 作られ続けるため**画面上は何も壊れて見えない**。以下 3 点を機械で固定する。
//
//   1. topic に **email subscription を張らない**（案 B: メールはやめる）
//   2. topic に **lambda subscription が 1 件ある**（宛先ゼロに戻らない）
//   3. **staging に alarm を作らない**（オーナー決裁の制約 ①: stg のノイズで本番を見落とさない）
//
// deploy 済みの実環境検証は `.github/workflows/deploy.yml` の
// "Ops alarm destination verification" が担う（synth と実物の両輪）。

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as cdk from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ComputeStack } from '../../../infra/lib/compute-stack';
import { NetworkStack } from '../../../infra/lib/network-stack';
import { OpsStack } from '../../../infra/lib/ops-stack';
import { StorageStack } from '../../../infra/lib/storage-stack';

// cspell:ignore TESTPOOL

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

/** opsEmail を **あえて渡して** も email subscription が作られないことを見る。 */
function buildOpsTemplate(sourceDir: string): Template {
	const app = makeApp();
	const storage = new StorageStack(app, 'TestStorage', { env });
	const compute = new ComputeStack(app, 'TestCompute', {
		env,
		assetsBucket: storage.assetsBucket,
		repository: storage.repository,
	});
	const network = new NetworkStack(app, 'TestNetwork', {
		env,
		functionUrl: compute.functionUrl,
		// #4280: front door shared secret (NetworkStackProps 必須)。テスト用ダミー値。
		originVerifySecret: 'test-origin-verify-secret-0000000000000000',
		domainName: 'ganbari-quest.com',
		certificateArn: 'arn:aws:acm:us-east-1:000000000000:certificate/test',
		demoFunctionUrl: compute.demoFunctionUrl,
		staticAssetsS3Offload: true,
		staticAssetsSourceDir: sourceDir,
	});
	const ops = new OpsStack(app, 'TestOps', {
		env,
		lambdaFn: compute.fn,
		distribution: network.distribution,
		functionUrl: compute.functionUrl,
		cronDispatcherFn: compute.cronDispatcherFn,
		staticAssetsBucket: network.staticAssetsBucket,
		appLogGroup: compute.appLogGroup,
		opsEmail: 'ops@example.com',
		discordWebhookIncident: 'https://discord.com/api/webhooks/test',
	});
	return Template.fromStack(ops as unknown as cdk.Stack);
}

let fixtureDir: string;
let template: Template;

beforeAll(() => {
	fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gq-ops-dest-'));
	const immutable = path.join(fixtureDir, '_app', 'immutable', 'chunks');
	fs.mkdirSync(immutable, { recursive: true });
	fs.writeFileSync(path.join(immutable, 'app.abc123.js'), 'export const x = 1;\n');
	template = buildOpsTemplate(fixtureDir);
}, 120_000);

afterAll(() => {
	if (fixtureDir) fs.rmSync(fixtureDir, { recursive: true, force: true });
});

describe('#4189 ops alarm の宛先', () => {
	it('email subscription を張らない (opsEmail を渡しても)', () => {
		const subs = template.findResources('AWS::SNS::Subscription');
		const emailSubs = Object.values(subs).filter(
			(r) => (r as { Properties?: { Protocol?: string } }).Properties?.Protocol === 'email',
		);
		expect(
			emailSubs,
			'ops-alerts topic に email subscription があります。案 B (Discord に寄せる) では張りません',
		).toEqual([]);
	});

	it('lambda subscription が 1 件以上ある (宛先ゼロに戻らない)', () => {
		template.hasResourceProperties('AWS::SNS::Subscription', {
			Protocol: 'lambda',
		});
	});

	it('転送 Lambda に webhook が env として渡る', () => {
		template.hasResourceProperties('AWS::Lambda::Function', {
			FunctionName: 'ganbari-quest-ops-alert-forwarder',
			Environment: {
				Variables: Match.objectLike({
					DISCORD_WEBHOOK_INCIDENT: 'https://discord.com/api/webhooks/test',
				}),
			},
		});
	});

	it('alarm が 1 件以上あり、全て SNS topic を action に持つ', () => {
		const alarms = template.findResources('AWS::CloudWatch::Alarm');
		const names = Object.keys(alarms);
		expect(names.length, 'alarm が 0 件です').toBeGreaterThan(0);

		const withoutAction = names.filter((k) => {
			const actions = (alarms[k] as { Properties?: { AlarmActions?: unknown[] } }).Properties
				?.AlarmActions;
			return !Array.isArray(actions) || actions.length === 0;
		});
		expect(
			withoutAction,
			'AlarmActions を持たない alarm があります (鳴っても SNS に流れません)',
		).toEqual([]);
	});

	it('制約 ①: staging 側 stack に OpsStack を作らない (bin/app.ts)', () => {
		// stg のアラートがリリース以外で届くと、本番の異常が埋もれる (オーナー決裁 2026-08-03)。
		// 現状 staging は Storage / Auth / Compute の 3 stack のみで alarm を持たない。
		// 将来 `stagingEnabled` ブロックに Ops を足したらここで落ちる。
		const binSource = fs.readFileSync(path.join(__dirname, '../../../infra/bin/app.ts'), 'utf-8');
		const stagingBlock = binSource.slice(binSource.indexOf('if (stagingEnabled)'));
		expect(
			stagingBlock.includes('OpsStack'),
			'staging ブロックで OpsStack を生成しています。stg の alarm が本番と同じ経路で鳴ると、' +
				'本番の異常が埋もれます (#4189 オーナー決裁の制約 ①)。' +
				'staging に監視を入れる場合は別 topic / 別 webhook にしてから本 assertion を更新してください',
		).toBe(false);
	});
});
