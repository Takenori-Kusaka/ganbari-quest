// tests/unit/infra/ai-fallback-rate-metric.test.ts
// #4726: AI 呼び出しの fallback 率を観測する MetricFilter の構造検証。
//
// #5109 で fallback 率の Alarm (metric math で 3 metric 分の課金) は撤去した (alarm は無料枠の
// 10 本に絞る、tests/unit/infra/cloudwatch-alarm-budget.test.ts)。率は分子・分母の 2 metric の
// Sum から読めるため、MetricFilter とアプリ側の log 出力は残す。
//
// ## なぜ既存の ai-provider-unavailable では足りないか
//
// `ganbari-quest-ai-provider-unavailable` は **可用性クラスの失敗** (権限 / 資格情報 /
// モデル未存在) でしか発火しない。#4726 の本番障害は `ValidationException`
// (base model ID を on-demand で呼べない) で、全リクエストが 100% fallback に落ちていたのに
// 通知は 1 通も出ず、発見はオーナーの手動実行だった。`ValidationException` を可用性クラスに
// 足すのは不可 (入力起因の失敗で AI 全停止に倒れる) なので、latch ではなく **率** を見る。
//
// 固定の 3 層は ai-provider-unavailable-alarm.test.ts と同型:
//   [A] CDK 構造 …… MetricFilter 2 本 (分子 / 分母) が存在し、Alarm は作らない (#5109)
//   [B] SSOT drift … CDK の literal 検索語がアプリ側の定数と一致する
//   [C] 実マッチ …… アプリが実際に書き出す行が filter pattern にマッチする

import * as cdk from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ComputeStack } from '../../../infra/lib/compute-stack';
import { NetworkStack } from '../../../infra/lib/network-stack';
import { ALARM_NOTIFY_POLICY } from '../../../infra/lib/ops-alert-policy';
import {
	AI_CALL_FAILED_LOG_TERM,
	AI_CALL_SUCCEEDED_LOG_TERM,
	OpsStack,
} from '../../../infra/lib/ops-stack';
import { StorageStack } from '../../../infra/lib/storage-stack';
import {
	AI_CALL_FAILED_LOG_TERM as APP_FAILED_TERM,
	AI_CALL_SUCCEEDED_LOG_TERM as APP_SUCCEEDED_TERM,
} from '../../../src/lib/server/ai/availability';

// cspell:ignore TESTPOOL

const env: cdk.Environment = { account: '000000000000', region: 'us-east-1' };

const ALARM_NAME = 'ganbari-quest-ai-fallback-rate';

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

describe('[A] fallback 率の MetricFilter が CDK に定義されている', () => {
	it('[A1] 分子 (失敗) / 分母 (成功) の MetricFilter が両方作られる', () => {
		withLogGroupTemplate.hasResourceProperties('AWS::Logs::MetricFilter', {
			FilterPattern: `"${AI_CALL_FAILED_LOG_TERM}"`,
			MetricTransformations: Match.arrayWith([
				Match.objectLike({
					MetricNamespace: 'GanbariQuest/Ai',
					MetricName: 'AiCallFailed',
					MetricValue: '1',
					DefaultValue: 0,
				}),
			]),
		});
		withLogGroupTemplate.hasResourceProperties('AWS::Logs::MetricFilter', {
			FilterPattern: `"${AI_CALL_SUCCEEDED_LOG_TERM}"`,
			MetricTransformations: Match.arrayWith([
				Match.objectLike({
					MetricNamespace: 'GanbariQuest/Ai',
					MetricName: 'AiCallSucceeded',
					MetricValue: '1',
					DefaultValue: 0,
				}),
			]),
		});
	});

	it('[A2] fallback 率の Alarm は作らない (#5109: alarm は無料枠の 10 本に絞った)', () => {
		const alarms = withLogGroupTemplate.findResources('AWS::CloudWatch::Alarm');
		const names = Object.values(alarms).map(
			(r) => (r.Properties as { AlarmName: string }).AlarmName,
		);
		expect(names).not.toContain(ALARM_NAME);
		expect(ALARM_NOTIFY_POLICY[ALARM_NAME]).toBeUndefined();
	});

	it('[A3] appLogGroup 未指定なら MetricFilter も作らない (監視 cost ゼロ)', () => {
		withoutLogGroupTemplate.resourcePropertiesCountIs(
			'AWS::Logs::MetricFilter',
			{ FilterPattern: `"${AI_CALL_FAILED_LOG_TERM}"` },
			0,
		);
	});
});

describe('[B] CDK literal ↔ アプリ側 SSOT の drift', () => {
	it('[B1] 検索語がアプリ側定数と完全一致する', () => {
		expect(AI_CALL_FAILED_LOG_TERM).toBe(APP_FAILED_TERM);
		expect(AI_CALL_SUCCEEDED_LOG_TERM).toBe(APP_SUCCEEDED_TERM);
	});

	// 2 つの filter pattern が互いにマッチすると分子と分母が混ざり、率が意味を失う。
	it('[B2] 失敗と成功の検索語は互いに部分文字列でない', () => {
		expect(AI_CALL_FAILED_LOG_TERM.includes(AI_CALL_SUCCEEDED_LOG_TERM)).toBe(false);
		expect(AI_CALL_SUCCEEDED_LOG_TERM.includes(AI_CALL_FAILED_LOG_TERM)).toBe(false);
	});
});

describe('[C] filter pattern が実際の log 出力にマッチする', () => {
	let warnLines: string[];
	let infoLines: string[];

	beforeEach(() => {
		warnLines = [];
		infoLines = [];
		vi.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => {
			warnLines.push(args.map(String).join(' '));
		});
		// logger.info は console.log へ出す (#3692)
		vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
			infoLines.push(args.map(String).join(' '));
		});
	});

	// 分子だけ level を上げると LOG_LEVEL=warn を配った瞬間に分母が消え、
	// fallback 率が「1 件でも失敗すれば 100%」に化ける。対称であることを固定する。
	it('[C3] 成功と失敗を同じ log level (info = console.log) で出す', async () => {
		const { withAvailabilityTracking, resetAiAvailabilityLatch } = await import(
			'../../../src/lib/server/ai/availability'
		);
		resetAiAvailabilityLatch();

		await withAvailabilityTracking('bedrock-claude', async () => 'ok');
		await expect(
			withAvailabilityTracking('bedrock-claude', async () => {
				throw Object.assign(new Error('boom'), { name: 'ValidationException' });
			}),
		).rejects.toThrow();

		expect(infoLines.filter((l) => l.includes(AI_CALL_SUCCEEDED_LOG_TERM))).toHaveLength(1);
		expect(infoLines.filter((l) => l.includes(AI_CALL_FAILED_LOG_TERM))).toHaveLength(1);
		expect(warnLines.filter((l) => l.includes(AI_CALL_FAILED_LOG_TERM))).toHaveLength(0);
		resetAiAvailabilityLatch();
	});

	// #4726 で tracking 範囲を「使える結果を得るまで」に広げた分、latch 判定に晒される例外面が
	// 増えた。レスポンス解析の失敗は入力起因であり、AI 全停止に倒してはいけない。
	it('[C4] レスポンス解析の失敗 (tool_use 欠落 / JSON 不正) では latch しない', async () => {
		const { withAvailabilityTracking, isProviderLatchedUnavailable, resetAiAvailabilityLatch } =
			await import('../../../src/lib/server/ai/availability');

		for (const message of [
			'No tool_use block in Bedrock response',
			'No valid JSON in Gemini response',
		]) {
			resetAiAvailabilityLatch();
			await expect(
				withAvailabilityTracking('bedrock-claude', async () => {
					throw new Error(message);
				}),
			).rejects.toThrow(message);
			expect(
				isProviderLatchedUnavailable('bedrock-claude'),
				`"${message}" で latch すると 4 サービス + 領収書 OCR が cold start まで一斉に縮退する`,
			).toBe(false);
		}
		resetAiAvailabilityLatch();
	});

	it('[C1] 成功呼び出しが分母の filter にマッチする', async () => {
		const { withAvailabilityTracking, resetAiAvailabilityLatch } = await import(
			'../../../src/lib/server/ai/availability'
		);
		resetAiAvailabilityLatch();

		await withAvailabilityTracking('bedrock-claude', async () => 'ok');

		expect(infoLines.filter((l) => l.includes(AI_CALL_SUCCEEDED_LOG_TERM))).toHaveLength(1);
		expect(infoLines.filter((l) => l.includes(AI_CALL_FAILED_LOG_TERM))).toHaveLength(0);
		resetAiAvailabilityLatch();
	});

	// #4726 の再現: ValidationException は可用性クラスではないので latch されないが、
	// fallback は起きている。この行が出ないと率が計算できず #4726 が再演する。
	it('[C2] ValidationException (可用性クラス外) でも分子の filter にマッチし、latch はしない', async () => {
		const { withAvailabilityTracking, isProviderLatchedUnavailable, resetAiAvailabilityLatch } =
			await import('../../../src/lib/server/ai/availability');
		resetAiAvailabilityLatch();

		const validationError = Object.assign(
			new Error(
				"Invocation of model ID anthropic.claude-haiku-4-5-20251001-v1:0 with on-demand throughput isn't supported.",
			),
			{ name: 'ValidationException' },
		);

		await expect(
			withAvailabilityTracking('bedrock-claude', async () => {
				throw validationError;
			}),
		).rejects.toThrow(validationError);

		const matched = infoLines.filter((l) => l.includes(AI_CALL_FAILED_LOG_TERM));
		expect(matched).toHaveLength(1);
		// 分類 (例外クラス名) までは載せる。メッセージ本文は載せない。
		expect(matched[0]).toContain('error=ValidationException');
		expect(matched[0]).not.toContain('on-demand throughput');

		// 可用性クラスではないので latch しない (入力起因の失敗で AI 全停止に倒さない)
		expect(isProviderLatchedUnavailable('bedrock-claude')).toBe(false);
		resetAiAvailabilityLatch();
	});
});
