// tests/unit/infra/ops-alert-policy.test.ts
// #4189 — CloudWatch アラームの通知方針が「宣言漏れなく」「理由付きで」保たれることを固定する。
//
// ## 何を守るか（オーナー決裁 2026-08-07 で 2026-08-03 の解釈を是正）
//
// 1. **既定は「届ける」** — alarm を足したら Discord に出るのが既定。全件が無音の状態を作らない
// 2. **抑止は是正作業中の例外だけ** — `notify: false` は「いま恒常発火していて、その原因を直す作業が
//    進行中」の場合に限る。reason に **是正作業の参照 (`#NNNN`) を必須**にする
//    （Issue に限らない。番号空間は PR と共通で、gate を通すためだけの起票を招かないようにする）
// 3. **宣言漏れを作らない** — OpsStack が作る alarm は全件が方針表に載っている
// 4. **理由が実質空でない** — 「何がどれくらい鳴っているか / どこで直しているか」が書かれている（#4237 と同型）
//
// alarm 名は CDK synth した**実テンプレート**から取る（source の grep ではなく実際に作られるもの）。
// stack 構築の context stub は `ops-static-assets-alarm.test.ts` を踏襲する。

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as cdk from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ComputeStack } from '../../../infra/lib/compute-stack';
import { NetworkStack } from '../../../infra/lib/network-stack';
import { ALARM_NOTIFY_POLICY, shouldNotifyToDiscord } from '../../../infra/lib/ops-alert-policy';
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

/** S3 offload ON（= alarm が最大数作られる構成）で OpsStack を synth する。 */
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
	});
	return Template.fromStack(ops as unknown as cdk.Stack);
}

const STUB_REASONS = ['todo', 'tbd', 'n/a', 'na', '-', '—', '未定', 'なし', '?', '??'];

/** 理由として成立しているか。成立しない場合は理由文字列を返す。 */
function findReasonDefect(reason: unknown): string | null {
	if (typeof reason !== 'string') return `文字列ではありません (${typeof reason})`;
	const trimmed = reason.trim();
	if (trimmed.length === 0) return '空です';
	if (STUB_REASONS.includes(trimmed.toLowerCase())) return `定型 stub です (「${trimmed}」)`;
	if (trimmed.length < 8) return `短すぎます (${trimmed.length} 字)`;
	return null;
}

let fixtureDir: string;
let template: Template;

beforeAll(() => {
	fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gq-ops-policy-'));
	const immutable = path.join(fixtureDir, '_app', 'immutable', 'chunks');
	fs.mkdirSync(immutable, { recursive: true });
	fs.writeFileSync(path.join(immutable, 'app.abc123.js'), 'export const x = 1;\n');
	template = buildOpsTemplate(fixtureDir);
}, 120_000);

afterAll(() => {
	if (fixtureDir) fs.rmSync(fixtureDir, { recursive: true, force: true });
});

function synthAlarmNames(): string[] {
	const alarms = template.findResources('AWS::CloudWatch::Alarm');
	return Object.values(alarms)
		.map((r) => (r as { Properties?: { AlarmName?: string } }).Properties?.AlarmName)
		.filter((n): n is string => typeof n === 'string')
		.sort();
}

/**
 * 是正作業の参照 (`#NNNN`)。抑止を「作業中の例外」に縛るための必須項目。
 *
 * **Issue 番号に限らない** — GitHub の番号空間は Issue と PR で共通で、直している作業を
 * 辿れれば目的を満たす。ここで「Issue 必須」と書くと、この gate を通すためだけの起票が
 * 起きる（チーム憲章 §0 ルール 7: 装置の改善は Issue にしない）ため、PR 番号でも満たせる。
 */
const WORK_REF = /#\d{3,}/;

describe('#4189 CloudWatch アラームの通知方針', () => {
	it('[母数] 方針表が空でない', () => {
		expect(Object.keys(ALARM_NOTIFY_POLICY).length, '方針表が空です').toBeGreaterThan(0);
	});

	it('全 entry の理由が空でも stub でもない', () => {
		const defects = Object.entries(ALARM_NOTIFY_POLICY)
			.map(([name, policy]) => {
				const defect = findReasonDefect(policy.reason);
				return defect ? `${name}: ${defect}` : null;
			})
			.filter((v): v is string => v !== null);

		expect(
			defects,
			'通知方針の理由が実質空です。**なぜ今は鳴らさないのか / なぜ鳴らすのか**を書いてください',
		).toEqual([]);
	});

	it('全 alarm が無音の状態を作らない (既定は「届ける」)', () => {
		const notifying = Object.entries(ALARM_NOTIFY_POLICY)
			.filter(([, p]) => p.notify)
			.map(([n]) => n)
			.sort();

		// 抑止を「既定」にすると、全件が notify: false のまま誰にも届かない状態が
		// 誰の目にも留まらずに成立する（実際に成立した）。既定が「届ける」である以上、
		// 通知される alarm が 1 件も無い状態は方針の誤用として弾く。
		expect(
			notifying.length,
			'notify: true の alarm が 0 件です。既定は「届ける」であり、全 alarm を無音にすることは' +
				'方針表の用途ではありません（抑止は恒常発火の是正作業中に限った例外です）',
		).toBeGreaterThan(0);
	});

	it('notify: false は是正作業の参照 (#NNNN) が必須 (抑止を作業中の例外に縛る)', () => {
		const defects = Object.entries(ALARM_NOTIFY_POLICY)
			.filter(([, p]) => !p.notify)
			.filter(([, p]) => !WORK_REF.test(p.reason))
			.map(([n]) => n)
			.sort();

		expect(
			defects,
			'notify: false なのに是正作業の参照 (#NNNN) が reason にありません。抑止してよいのは' +
				'「いま恒常発火していて、その原因を直す作業が進行中」の場合だけです。' +
				'(a) 何がどれくらいの頻度で鳴っているか (b) どこで直しているか を reason に書いてください。' +
				'#NNNN は Issue でも PR でも構いません（GitHub の番号空間は共通で、直す作業を追えれば足ります）。' +
				'書けないなら notify: true にします',
		).toEqual([]);
	});

	it('未宣言の alarm 名は「届ける」に倒れる (握り潰さない)', () => {
		// 宣言漏れは no-silent-gap test が CI で止める。runtime まで漏れた場合に
		// 黙って捨てると #4119 / #4174 の「経路はあるのに 0 通」を再演するため、
		// 判断できないものは転送する（転送 Lambda の parse 失敗時の扱いと同じ向き）。
		expect(shouldNotifyToDiscord('ganbari-quest-undeclared-alarm')).toBe(true);
	});

	it('no-silent-gap: OpsStack が作る alarm が全件 方針表に載っている', () => {
		const alarmNames = synthAlarmNames();

		expect(
			alarmNames.length,
			'synth した alarm が 0 件です (stack 構築が壊れています)',
		).toBeGreaterThan(0);

		const undeclared = alarmNames.filter((n) => !(n in ALARM_NOTIFY_POLICY)).sort();
		expect(
			undeclared,
			'方針が未宣言の alarm があります。infra/lib/ops-alert-policy.ts に理由付きで追加してください。' +
				'未宣言のままだと「既定で鳴らない」状態が誰にも気付かれずに埋もれます',
		).toEqual([]);

		// 逆方向: 撤去済 alarm が表に残ると、次に同名を足したとき古い判断が効いてしまう
		const stale = Object.keys(ALARM_NOTIFY_POLICY)
			.filter((n) => !alarmNames.includes(n))
			.sort();
		expect(
			stale,
			'撤去済の alarm が方針表に残っています。ops-alert-policy.ts から外してください',
		).toEqual([]);
	});
});
