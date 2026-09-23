// tests/unit/infra/push-notification-alarm.test.ts
// #4706 follow-up (ADR-0024 alarm): 保護者向け Web Push が送れていないことを運営に届ける
// MetricFilter + Alarm の構造検証。
//
// push の失敗は顧客の画面にも cron の応答にも出ない。`sendPushNotification` は鍵が無ければ
// warn を出して `sent: 0` を返し、push サービスに拒否されても 1 行 error を出すだけで、
// cron は 200 を返し続ける (実測: 本番ログ 2026-09-13〜23 の送信判定 1,710 回が鍵なしで止まっていた)。
// 保護者は「届くはずの通知が届いていない」ことに自分では気付けない。
//
// entitlement fail-closed (#3998) / AI 不達 (#4375) と同じ 3 層で固定する:
//
//   [A] CDK 構造 …… MetricFilter / Alarm が期待の namespace / 閾値 / 通知先で存在する
//   [B] SSOT drift … CDK の literal 検索語がアプリ側の定数と一致する
//                    (CDK tsconfig rootDir の制約で src を import できないため literal で持つ)
//   [C] 実マッチ …… アプリが実際に書き出す行が filter pattern にマッチする
//                    (定義したが 1 件もマッチしない filter = 作ったが効いていない、を防ぐ)

import * as cdk from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ComputeStack } from '../../../infra/lib/compute-stack';
import { NetworkStack } from '../../../infra/lib/network-stack';
import { ALARM_NOTIFY_POLICY } from '../../../infra/lib/ops-alert-policy';
import {
	OpsStack,
	PUSH_SEND_FAILED_LOG_TERM,
	PUSH_VAPID_MISSING_LOG_TERM,
} from '../../../infra/lib/ops-stack';
import { StorageStack } from '../../../infra/lib/storage-stack';
import {
	PUSH_SEND_FAILED_LOG_TERM as APP_SEND_FAILED_LOG_TERM,
	PUSH_VAPID_MISSING_LOG_TERM as APP_VAPID_MISSING_LOG_TERM,
	sendPushNotification,
} from '../../../src/lib/server/services/notification-service';

// cspell:ignore TESTPOOL

// [C] で `sendPushNotification` を実際に走らせるため、DB と push サービスだけを差し替える。
// logger は本物を使う — 本番で CloudWatch に届くのは logger が console に書いた行そのものだから。
vi.mock('$lib/server/db/push-subscription-repo', () => ({
	findByTenant: vi.fn(),
	deleteByEndpoint: vi.fn(),
	insertLog: vi.fn(),
	countLogsBetween: vi.fn(),
}));
vi.mock('$lib/server/db/settings-repo', () => ({
	getSettings: vi.fn(),
}));
vi.mock('web-push', () => ({
	default: {
		setVapidDetails: vi.fn(),
		sendNotification: vi.fn(),
	},
}));

import webpush from 'web-push';
import { countLogsBetween, findByTenant } from '$lib/server/db/push-subscription-repo';
import { getSettings } from '$lib/server/db/settings-repo';

const env: cdk.Environment = { account: '000000000000', region: 'us-east-1' };

const VAPID_MISSING_ALARM = 'ganbari-quest-push-vapid-missing';
const SEND_FAILED_ALARM = 'ganbari-quest-push-send-failed';
const NAMESPACE = 'GanbariQuest/Notification';

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

function buildOpsTemplate(opts: { withAppLogGroup: boolean }): Template {
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
		originVerifySecret: 'test-origin-verify-secret-0000000000000000',
		domainName: 'ganbari-quest.com',
		certificateArn: 'arn:aws:acm:us-east-1:000000000000:certificate/test',
		demoFunctionUrl: compute.demoFunctionUrl,
	});
	const ops = new OpsStack(app, 'TestOps', {
		env,
		lambdaFn: compute.fn,
		distribution: network.distribution,
		functionUrl: compute.functionUrl,
		cronDispatcherFn: compute.cronDispatcherFn,
		appLogGroup: opts.withAppLogGroup ? compute.appLogGroup : undefined,
		opsEmail: 'ops@example.com',
	});
	return Template.fromStack(ops);
}

// CDK synth (Docker image asset の hash 計算を含む) は数十秒かかるため 1 回だけ組む
let withLogGroupTemplate: Template;
let withoutLogGroupTemplate: Template;

beforeAll(() => {
	withLogGroupTemplate = buildOpsTemplate({ withAppLogGroup: true });
	withoutLogGroupTemplate = buildOpsTemplate({ withAppLogGroup: false });
}, 180_000);

function okActionsOf(template: Template, alarmName: string): unknown[] {
	const alarms = template.findResources('AWS::CloudWatch::Alarm', {
		Properties: { AlarmName: alarmName },
	});
	const entries = Object.values(alarms);
	expect(entries, `${alarmName} が synth されていません`).toHaveLength(1);
	const properties = entries[0]?.Properties as { OKActions?: unknown[] } | undefined;
	return properties?.OKActions ?? [];
}

describe('[A] push 不達の MetricFilter / Alarm が CDK に定義されている', () => {
	it('[A1] 鍵欠落と送信失敗の MetricFilter が、それぞれの検索語で作られる', () => {
		withLogGroupTemplate.hasResourceProperties('AWS::Logs::MetricFilter', {
			FilterPattern: `"${PUSH_VAPID_MISSING_LOG_TERM}"`,
			MetricTransformations: Match.arrayWith([
				Match.objectLike({
					MetricNamespace: NAMESPACE,
					MetricName: 'PushVapidMissing',
					MetricValue: '1',
					DefaultValue: 0,
				}),
			]),
		});
		withLogGroupTemplate.hasResourceProperties('AWS::Logs::MetricFilter', {
			FilterPattern: `"${PUSH_SEND_FAILED_LOG_TERM}"`,
			MetricTransformations: Match.arrayWith([
				Match.objectLike({
					MetricNamespace: NAMESPACE,
					MetricName: 'PushSendFailed',
					MetricValue: '1',
					DefaultValue: 0,
				}),
			]),
		});
	});

	// 本番は CDK synth が鍵の組を検査してから deploy するため、正常運用で鍵欠落は起きない。
	// 1 件でも出たら Lambda env が壊れている (手で消された / 配線が外れた)。即発火にする。
	it('[A2] 鍵欠落の Alarm は 1 件 / 1 window で即発火し、既存 SNS topic に繋がる', () => {
		withLogGroupTemplate.hasResourceProperties('AWS::CloudWatch::Alarm', {
			AlarmName: VAPID_MISSING_ALARM,
			Namespace: NAMESPACE,
			MetricName: 'PushVapidMissing',
			Statistic: 'Sum',
			Period: 300,
			Threshold: 1,
			EvaluationPeriods: 1,
			DatapointsToAlarm: 1,
			ComparisonOperator: 'GreaterThanOrEqualToThreshold',
			TreatMissingData: 'notBreaching',
			AlarmActions: Match.arrayWith([
				Match.objectLike({ Ref: Match.stringLikeRegexp('OpsAlerts') }),
			]),
		});
	});

	// 送信は 1 家庭 1 日 3 通までなので、失敗の系列は疎になる。1 件で鳴らすと push サービスの
	// 単発 timeout で鳴り、長い window で件数を積むと鍵の組違い (全送信が 401/403) でも
	// 気付くのが翌日以降になる。1 時間に 2 件 = 「単発ではない」の最小で切る。
	it('[A3] 送信失敗の Alarm は 1 時間に 2 件以上で発火し、既存 SNS topic に繋がる', () => {
		withLogGroupTemplate.hasResourceProperties('AWS::CloudWatch::Alarm', {
			AlarmName: SEND_FAILED_ALARM,
			Namespace: NAMESPACE,
			MetricName: 'PushSendFailed',
			Statistic: 'Sum',
			Period: 3600,
			Threshold: 2,
			EvaluationPeriods: 1,
			DatapointsToAlarm: 1,
			ComparisonOperator: 'GreaterThanOrEqualToThreshold',
			TreatMissingData: 'notBreaching',
			AlarmActions: Match.arrayWith([
				Match.objectLike({ Ref: Match.stringLikeRegexp('OpsAlerts') }),
			]),
		});
	});

	// どちらの log も「送ろうとしたとき」にしか出ない。送信が無い window はデータ点が無く、
	// treatMissingData=NOT_BREACHING で alarm は OK に戻る。これは「直った」ではなく
	// 「その間に誰にも送ろうとしなかった」でも起きるので、OK action を付けると
	// 鍵が無いままでも「復旧しました」に等しい通知が Discord に飛ぶ (沈黙より悪い)。
	it.each([
		VAPID_MISSING_ALARM,
		SEND_FAILED_ALARM,
	])('[A4] %s は OK action を持たない (データ点が無いことは復旧を意味しないため)', (alarmName) => {
		expect(
			okActionsOf(withLogGroupTemplate, alarmName),
			'この alarm の OK 遷移は「復旧」ではなく「送信が無かった」でも起きます。' +
				'OK action を付けると偽の復旧通知になります',
		).toEqual([]);
	});

	it('[A5] appLogGroup 未指定なら Alarm を作らない (監視 cost ゼロ)', () => {
		const alarms = withoutLogGroupTemplate.findResources('AWS::CloudWatch::Alarm');
		const names = Object.values(alarms).map(
			(r) => (r.Properties as { AlarmName: string }).AlarmName,
		);
		expect(names).not.toContain(VAPID_MISSING_ALARM);
		expect(names).not.toContain(SEND_FAILED_ALARM);
	});

	it.each([
		VAPID_MISSING_ALARM,
		SEND_FAILED_ALARM,
	])('[A6] %s は通知方針表に「届ける」で宣言されている (#4189 no-silent-gap)', (alarmName) => {
		expect(ALARM_NOTIFY_POLICY[alarmName]?.notify).toBe(true);
	});
});

describe('[B] CDK literal ↔ アプリ側 SSOT の drift', () => {
	it('[B1] 検索語がアプリ側定数と完全一致する', () => {
		expect(PUSH_VAPID_MISSING_LOG_TERM).toBe(APP_VAPID_MISSING_LOG_TERM);
		expect(PUSH_SEND_FAILED_LOG_TERM).toBe(APP_SEND_FAILED_LOG_TERM);
	});
});

describe('[C] filter pattern が実際の log 出力にマッチする', () => {
	let captured: string[];
	const savedEnv = { ...process.env };

	beforeEach(() => {
		vi.clearAllMocks();
		captured = [];
		for (const method of ['log', 'warn', 'error'] as const) {
			vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
				captured.push(args.map(String).join(' '));
			});
		}
		process.env.AUTH_MODE = 'cognito';
		// 昼間 JST (12:00) でサイレント時間帯を避け、日次上限にも当たらないようにする
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2026-05-18T03:00:00Z'));
		vi.mocked(getSettings).mockResolvedValue({});
		vi.mocked(countLogsBetween).mockResolvedValue(0);
		vi.mocked(findByTenant).mockResolvedValue([
			{
				id: '1',
				tenantId: 'T1',
				endpoint: 'https://fcm.googleapis.com/fcm/send/x',
				keysP256dh: 'p',
				keysAuth: 'a',
				userAgent: null,
				subscriberRole: 'parent',
				createdAt: '',
			},
		] as unknown as Awaited<ReturnType<typeof findByTenant>>);
	});

	afterEach(() => {
		vi.useRealTimers();
		vi.restoreAllMocks();
		process.env = { ...savedEnv };
	});

	const matching = (term: string) => captured.filter((line) => line.includes(term));

	it('[C1] 鍵が無いときに書き出される行が鍵欠落の filter にマッチする', async () => {
		delete process.env.VAPID_PUBLIC_KEY;
		delete process.env.VAPID_PRIVATE_KEY;

		await sendPushNotification('T1', 'reminder', 'title', 'body');

		expect(matching(PUSH_VAPID_MISSING_LOG_TERM)).toHaveLength(1);
		expect(matching(PUSH_SEND_FAILED_LOG_TERM)).toHaveLength(0);
	});

	it('[C2] push サービスが拒否した (403) 行が送信失敗の filter にマッチし、status を持つ', async () => {
		process.env.VAPID_PUBLIC_KEY = 'test-public-key';
		process.env.VAPID_PRIVATE_KEY = 'test-private-key';
		vi.mocked(webpush.sendNotification).mockRejectedValue(
			Object.assign(new Error('Received unexpected response code'), { statusCode: 403 }),
		);

		await sendPushNotification('T1', 'reminder', 'title', 'body');

		const lines = matching(PUSH_SEND_FAILED_LOG_TERM);
		expect(lines).toHaveLength(1);
		expect(lines[0]).toContain('status=403');
		expect(matching(PUSH_VAPID_MISSING_LOG_TERM)).toHaveLength(0);
	});

	it('[C3] 失効した購読 (410) の自動削除は送信失敗として数えない (保護者側の解除で、障害ではない)', async () => {
		process.env.VAPID_PUBLIC_KEY = 'test-public-key';
		process.env.VAPID_PRIVATE_KEY = 'test-private-key';
		vi.mocked(webpush.sendNotification).mockRejectedValue(
			Object.assign(new Error('Gone'), { statusCode: 410 }),
		);

		await sendPushNotification('T1', 'reminder', 'title', 'body');

		expect(matching(PUSH_SEND_FAILED_LOG_TERM)).toHaveLength(0);
	});

	it('[C4] 送信に成功した行はどちらの filter にもマッチしない', async () => {
		process.env.VAPID_PUBLIC_KEY = 'test-public-key';
		process.env.VAPID_PRIVATE_KEY = 'test-private-key';
		vi.mocked(webpush.sendNotification).mockResolvedValue(
			{} as Awaited<ReturnType<typeof webpush.sendNotification>>,
		);

		await sendPushNotification('T1', 'reminder', 'title', 'body');

		expect(matching(PUSH_SEND_FAILED_LOG_TERM)).toHaveLength(0);
		expect(matching(PUSH_VAPID_MISSING_LOG_TERM)).toHaveLength(0);
	});
});
