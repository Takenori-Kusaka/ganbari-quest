// tests/unit/infra/ops-alert-forwarder-observability.test.ts
// #4399 follow-up — 「通知が届かなかったこと」に気付ける状態を固定する。
//
// #4399 で alarm の既定が「届ける」になったが、その通知は SNS → 転送 Lambda → Discord webhook
// の一本道を通る。転送 Lambda は失敗を全経路で握り潰して例外を投げないため、**末端で捨てられた
// 通知は Errors metric にも乗らず、誰にも分からない**。Discord は channel 単位の rate limit を
// 持つので、16 alarm が同時に鳴る「最も通知が必要な瞬間」ほど 429 で消える。
//
// 3 層で固定する (ai-provider-unavailable-alarm.test.ts / entitlement-fail-closed-alarm.test.ts と同型):
//
//   [A] Lambda 実挙動 … 実 HTTP サーバ相手に成功 / 非 2xx / timeout / network を再現し、
//                       metric 用の log が「出る / 出ない」を実測する
//   [B] CDK 構造 …… MetricFilter 2 本 + 失敗 alarm が期待の namespace / 閾値 / 通知先で存在する
//
// [A] は CDK と同じ定数 (`ops-alert-log-terms.ts`) で実 log 行を照合するため、「filter を定義した
// が 1 件もマッチしない」(= 作ったが効いていない) も同時に潰れる。書き手と読み手が同一 SSOT を
// import しているので literal の drift 検証 test は要らない。

import * as http from 'node:http';
import * as cdk from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { ComputeStack } from '../../../infra/lib/compute-stack';
import { NetworkStack } from '../../../infra/lib/network-stack';
import {
	OPS_ALERT_FORWARD_FAILED_LOG_TERM,
	OPS_ALERT_FORWARD_SUCCEEDED_LOG_TERM,
} from '../../../infra/lib/ops-alert-log-terms';
import { ALARM_NOTIFY_POLICY } from '../../../infra/lib/ops-alert-policy';
import { OpsStack } from '../../../infra/lib/ops-stack';
import { StorageStack } from '../../../infra/lib/storage-stack';

// cspell:ignore TESTPOOL

const ALARM_NAME = 'ganbari-quest-ops-alert-forward-failed';
const METRIC_NAMESPACE = 'GanbariQuest/Ops';

// ================================================================
// [A] Lambda 実挙動
// ================================================================

interface DiscordStub {
	server: http.Server;
	port: number;
	received: number;
}

/**
 * Discord webhook の代わりに応答する stub サーバ。
 *
 * - `statusCode` … その status を返す
 * - `hang: true` … 応答を返さない (Lambda 側の 5 秒 timeout を実発火させる)
 * - `destroy: true` … socket を切る (network error を実発火させる)
 */
async function startDiscordStub(
	behavior: { statusCode?: number; hang?: boolean; destroy?: boolean } = {},
): Promise<DiscordStub> {
	const stub: DiscordStub = { server: null as unknown as http.Server, port: 0, received: 0 };

	const server = http.createServer((req, res) => {
		stub.received += 1;
		req.resume();
		if (behavior.destroy) {
			req.socket.destroy();
			return;
		}
		if (behavior.hang) return; // 応答を返さない
		req.on('end', () => {
			res.statusCode = behavior.statusCode ?? 204;
			res.end(behavior.statusCode && behavior.statusCode >= 400 ? 'rate limited' : '');
		});
	});

	await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
	const addr = server.address();
	if (typeof addr === 'string' || addr === null) throw new Error('stub address');
	stub.server = server;
	stub.port = addr.port;
	return stub;
}

async function stopDiscordStub(stub: DiscordStub): Promise<void> {
	stub.server.closeAllConnections?.();
	await new Promise<void>((resolve) => stub.server.close(() => resolve()));
}

/** CloudWatch alarm を 1 件だけ含む SNS イベント。 */
function snsEvent(alarmName = 'ganbari-quest-lambda-url-5xx') {
	return {
		Records: [
			{
				Sns: {
					Message: JSON.stringify({
						AlarmName: alarmName,
						NewStateValue: 'ALARM',
						NewStateReason: 'Threshold Crossed',
						Region: 'US East (N. Virginia)',
						StateChangeTime: '2026-08-07T00:00:00.000Z',
					}),
				},
			},
		],
	};
}

async function loadHandler(webhookUrl: string | undefined, opts: { suppressAll?: boolean } = {}) {
	vi.resetModules();
	process.env.DISCORD_WEBHOOK_INCIDENT = webhookUrl ?? '';
	if (opts.suppressAll) {
		// 抑止 (notify: false) の挙動を、方針表の実 entry に依存せず再現する。
		// #4399 で全件 notify: true になったため、表を読むだけでは抑止経路を踏めない。
		vi.doMock('../../../infra/lib/ops-alert-policy', () => ({
			shouldNotifyToDiscord: () => false,
			ALARM_NOTIFY_POLICY: {},
		}));
	}
	const mod = await import('../../../infra/lambda/ops-alert-forwarder/index.ts');
	return mod.handler;
}

/** console.log / console.error / console.warn の出力を 1 本の配列にまとめて捕まえる。 */
function captureConsole(): { lines: string[]; restore: () => void } {
	const lines: string[] = [];
	const record = (...args: unknown[]) => {
		lines.push(args.map((a) => (typeof a === 'string' ? a : String(a))).join(' '));
	};
	const spies = [
		vi.spyOn(console, 'log').mockImplementation(record),
		vi.spyOn(console, 'error').mockImplementation(record),
		vi.spyOn(console, 'warn').mockImplementation(record),
	];
	return {
		lines,
		restore: () => {
			for (const s of spies) s.mockRestore();
		},
	};
}

describe('[A] 転送 Lambda が「届いた / 届かなかった」を log に残す (#4399 follow-up)', () => {
	const originalWebhook = process.env.DISCORD_WEBHOOK_INCIDENT;

	afterEach(() => {
		if (originalWebhook === undefined) delete process.env.DISCORD_WEBHOOK_INCIDENT;
		else process.env.DISCORD_WEBHOOK_INCIDENT = originalWebhook;
	});

	it('2xx で返ったら成功 log が出る (失敗 log は出ない)', async () => {
		const stub = await startDiscordStub({ statusCode: 204 });
		const cap = captureConsole();
		try {
			const handler = await loadHandler(`http://127.0.0.1:${stub.port}/webhook`);
			await handler(snsEvent());
		} finally {
			cap.restore();
			await stopDiscordStub(stub);
		}

		expect(stub.received, 'stub に届いていません (テスト自体が成立していません)').toBe(1);
		expect(
			cap.lines.filter((l) => l.includes(OPS_ALERT_FORWARD_SUCCEEDED_LOG_TERM)),
			'転送成功の log が出ていません。流入量 (1 週間の Sum) が数えられません',
		).toHaveLength(1);
		expect(
			cap.lines.filter((l) => l.includes(OPS_ALERT_FORWARD_FAILED_LOG_TERM)),
			'成功したのに失敗 log が出ています',
		).toHaveLength(0);
	});

	it('429 (rate limit) で失敗 log が出る — 同時多発時に通知が消える経路', async () => {
		const stub = await startDiscordStub({ statusCode: 429 });
		const cap = captureConsole();
		try {
			const handler = await loadHandler(`http://127.0.0.1:${stub.port}/webhook`);
			await handler(snsEvent());
		} finally {
			cap.restore();
			await stopDiscordStub(stub);
		}

		const failed = cap.lines.filter((l) => l.includes(OPS_ALERT_FORWARD_FAILED_LOG_TERM));
		expect(failed, '429 で捨てられたのに失敗 log が出ていません').toHaveLength(1);
		expect(failed[0], '失敗の分類 (reason=http-429) が読み取れません').toContain('reason=http-429');
		expect(
			cap.lines.filter((l) => l.includes(OPS_ALERT_FORWARD_SUCCEEDED_LOG_TERM)),
			'失敗したのに成功 log が出ています (流入量が過大に数えられます)',
		).toHaveLength(0);
	});

	it('socket 断で failed reason=network が出る', async () => {
		const stub = await startDiscordStub({ destroy: true });
		const cap = captureConsole();
		try {
			const handler = await loadHandler(`http://127.0.0.1:${stub.port}/webhook`);
			await handler(snsEvent());
		} finally {
			cap.restore();
			await stopDiscordStub(stub);
		}

		const failed = cap.lines.filter((l) => l.includes(OPS_ALERT_FORWARD_FAILED_LOG_TERM));
		expect(failed, 'socket 断で失敗 log が出ていません').toHaveLength(1);
		expect(failed[0]).toContain('reason=network');
	});

	it('応答が返らないと failed reason=timeout が出る (実 timeout 5 秒)', async () => {
		const stub = await startDiscordStub({ hang: true });
		const cap = captureConsole();
		try {
			const handler = await loadHandler(`http://127.0.0.1:${stub.port}/webhook`);
			await handler(snsEvent());
		} finally {
			cap.restore();
			await stopDiscordStub(stub);
		}

		const failed = cap.lines.filter((l) => l.includes(OPS_ALERT_FORWARD_FAILED_LOG_TERM));
		// 1 回の timeout を 1 件としてだけ数える。`req.destroy()` は直後に 'error' も
		// 発火させるため、素朴に書くと timeout + network の 2 件になり、
		// 「何通届かなかったか」が実態より多く見える (metric の信頼性が壊れる)。
		expect(failed, 'timeout が 1 件として数えられていません').toHaveLength(1);
		expect(failed[0]).toContain('reason=timeout');
		expect(failed.join('\n'), 'timeout が network としても二重に数えられています').not.toContain(
			'reason=network',
		);
	}, 20_000);

	it('webhook 未設定なら failed reason=no-webhook が出る (#4119 の「0 通」を数える)', async () => {
		const cap = captureConsole();
		try {
			const handler = await loadHandler(undefined);
			await handler(snsEvent());
		} finally {
			cap.restore();
		}

		const failed = cap.lines.filter((l) => l.includes(OPS_ALERT_FORWARD_FAILED_LOG_TERM));
		expect(
			failed,
			'webhook 未設定は「全通知が 0 通」だが失敗として数えられていません',
		).toHaveLength(1);
		expect(failed[0]).toContain('reason=no-webhook');
	});

	it('抑止 (notify: false) は成功にも失敗にも数えない', async () => {
		// 抑止は「送っていない」であって「届かなかった」ではない。両者を混ぜると
		// 流入量も失敗率も読めなくなる。
		const stub = await startDiscordStub({ statusCode: 204 });
		const cap = captureConsole();
		try {
			const handler = await loadHandler(`http://127.0.0.1:${stub.port}/webhook`, {
				suppressAll: true,
			});
			await handler(snsEvent());

			expect(stub.received, '抑止したのに送信されています').toBe(0);
			expect(
				cap.lines.filter(
					(l) =>
						l.includes(OPS_ALERT_FORWARD_SUCCEEDED_LOG_TERM) ||
						l.includes(OPS_ALERT_FORWARD_FAILED_LOG_TERM),
				),
				'抑止が転送 metric に数えられています',
			).toHaveLength(0);
		} finally {
			cap.restore();
			await stopDiscordStub(stub);
		}
	});
});

// ================================================================
// [B] CDK 構造
// ================================================================

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

let template: Template;

beforeAll(() => {
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
		appLogGroup: compute.appLogGroup,
	});
	template = Template.fromStack(ops);
}, 180_000);

describe('[B] 転送の成否が metric 化され、失敗が alarm になる', () => {
	it('成功 / 失敗の MetricFilter が転送 Lambda の LogGroup に付いている', () => {
		template.hasResourceProperties('AWS::Logs::MetricFilter', {
			FilterPattern: `"${OPS_ALERT_FORWARD_SUCCEEDED_LOG_TERM}"`,
			MetricTransformations: Match.arrayWith([
				Match.objectLike({
					MetricNamespace: METRIC_NAMESPACE,
					MetricName: 'AlertForwardSucceeded',
					MetricValue: '1',
					DefaultValue: 0,
				}),
			]),
		});

		template.hasResourceProperties('AWS::Logs::MetricFilter', {
			FilterPattern: `"${OPS_ALERT_FORWARD_FAILED_LOG_TERM}"`,
			MetricTransformations: Match.arrayWith([
				Match.objectLike({
					MetricNamespace: METRIC_NAMESPACE,
					MetricName: 'AlertForwardFailed',
					MetricValue: '1',
					DefaultValue: 0,
				}),
			]),
		});
	});

	it('転送失敗 alarm が 1 件でも発火し、SNS に通知される', () => {
		template.hasResourceProperties('AWS::CloudWatch::Alarm', {
			AlarmName: ALARM_NAME,
			MetricName: 'AlertForwardFailed',
			Namespace: METRIC_NAMESPACE,
			Threshold: 1,
			EvaluationPeriods: 1,
			ComparisonOperator: 'GreaterThanOrEqualToThreshold',
			TreatMissingData: 'notBreaching',
			AlarmActions: Match.anyValue(),
			OKActions: Match.anyValue(),
		});
	});

	it('方針表に entry があり notify: true (no-silent-gap gate が拾うことの確認)', () => {
		const policy = ALARM_NOTIFY_POLICY[ALARM_NAME];
		expect(
			policy,
			`${ALARM_NAME} が ALARM_NOTIFY_POLICY に未宣言です (ops-alert-policy.test.ts の ` +
				'no-silent-gap がこれを検出するはずです)',
		).toBeDefined();
		expect(policy?.notify, '転送失敗の alarm を無音にしたら気付く手段が無くなります').toBe(true);
		// 自己参照の限界 (この alarm 自身も同じ転送経路を通る) を reason に明記させる
		expect(
			policy?.reason ?? '',
			'この alarm 自身が転送経路に依存するため、連鎖失敗時に何が起きるかを reason に書いてください',
		).toMatch(/自己参照|同じ経路|同じ転送/);
	});
});
