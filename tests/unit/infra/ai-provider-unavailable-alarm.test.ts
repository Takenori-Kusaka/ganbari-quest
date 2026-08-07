// tests/unit/infra/ai-provider-unavailable-alarm.test.ts
// #4375 follow-up (PO 決裁 2026-08-07): AI 不達を運営に届ける MetricFilter + Alarm の構造検証。
//
// 顧客には「システム側の問題で、運営に通知済み」と出す。**その約束の実装**が本経路であり、
// 経路が黙って壊れると顧客に嘘をつき続けることになる。そこで entitlement fail-closed
// (#3998) と同じ 3 層で固定する:
//
//   [A] CDK 構造 …… MetricFilter / Alarm が期待の namespace / 閾値 / 通知先で存在する
//   [B] SSOT drift … CDK の literal 検索語がアプリ側の定数と一致する
//                    (CDK tsconfig rootDir の制約で src を import できないため literal で持つ)
//   [C] 実マッチ …… アプリが実際に書き出す行が filter pattern にマッチする
//                    (定義したが 1 件もマッチしない filter = 作ったが効いていない、を防ぐ)

import * as cdk from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ComputeStack } from '../../../infra/lib/compute-stack';
import { NetworkStack } from '../../../infra/lib/network-stack';
import { ALARM_NOTIFY_POLICY } from '../../../infra/lib/ops-alert-policy';
import { AI_PROVIDER_UNAVAILABLE_LOG_TERM, OpsStack } from '../../../infra/lib/ops-stack';
import { StorageStack } from '../../../infra/lib/storage-stack';
import { AI_PROVIDER_UNAVAILABLE_LOG_TERM as APP_LOG_TERM } from '../../../src/lib/server/ai/availability';

// cspell:ignore TESTPOOL

const env: cdk.Environment = { account: '000000000000', region: 'us-east-1' };

const ALARM_NAME = 'ganbari-quest-ai-provider-unavailable';

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

describe('[A] AI 不達の MetricFilter / Alarm が CDK に定義されている', () => {
	it('[A1] MetricFilter が期待の pattern / metric で作られる', () => {
		withLogGroupTemplate.hasResourceProperties('AWS::Logs::MetricFilter', {
			FilterPattern: `"${AI_PROVIDER_UNAVAILABLE_LOG_TERM}"`,
			MetricTransformations: Match.arrayWith([
				Match.objectLike({
					MetricNamespace: 'GanbariQuest/Ai',
					MetricName: 'AiProviderUnavailable',
					MetricValue: '1',
					DefaultValue: 0,
				}),
			]),
		});
	});

	// この log は「プロセス内で理由ごとに 1 回」しか出ない疎な系列で、障害が続いても件数は増えない。
	// entitlement fail-closed 型の「2 window 継続で発火」に変えると、終日 AI が死んでいても
	// 鳴らないまま顧客だけが影響を受ける。1 件 / 1 window 即発火であることを固定する。
	it('[A2] Alarm が「1 件 / 1 window で即発火」/ 既存 SNS topic に接続されている', () => {
		withLogGroupTemplate.hasResourceProperties('AWS::CloudWatch::Alarm', {
			AlarmName: ALARM_NAME,
			Namespace: 'GanbariQuest/Ai',
			MetricName: 'AiProviderUnavailable',
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
			OKActions: Match.arrayWith([Match.objectLike({ Ref: Match.stringLikeRegexp('OpsAlerts') })]),
		});
	});

	it('[A3] appLogGroup 未指定なら Alarm を作らない (監視 cost ゼロ)', () => {
		const alarms = withoutLogGroupTemplate.findResources('AWS::CloudWatch::Alarm');
		const names = Object.values(alarms).map(
			(r) => (r.Properties as { AlarmName: string }).AlarmName,
		);
		expect(names).not.toContain(ALARM_NAME);
	});

	it('[A4] 通知方針表に宣言されている (#4189 no-silent-gap)', () => {
		expect(ALARM_NOTIFY_POLICY[ALARM_NAME]).toBeDefined();
	});
});

describe('[B] CDK literal ↔ アプリ側 SSOT の drift', () => {
	it('[B1] 検索語がアプリ側定数と完全一致する', () => {
		expect(AI_PROVIDER_UNAVAILABLE_LOG_TERM).toBe(APP_LOG_TERM);
	});
});

describe('[C] filter pattern が実際の log 出力にマッチする', () => {
	let captured: string[];

	beforeEach(() => {
		captured = [];
		vi.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => {
			captured.push(args.map(String).join(' '));
		});
	});

	it('[C1] 実際に書き出される行が filter にマッチし、無関係な行にはマッチしない', async () => {
		const { markProviderUnavailable, resetAiAvailabilityLatch } = await import(
			'../../../src/lib/server/ai/availability'
		);
		const { logger } = await import('../../../src/lib/server/logger');

		resetAiAvailabilityLatch();
		markProviderUnavailable('bedrock-claude');

		// CloudWatch の `"..."` 形式 filter pattern は「その文字列を含む行」にマッチする。
		const matched = captured.filter((line) => line.includes(AI_PROVIDER_UNAVAILABLE_LOG_TERM));
		expect(matched).toHaveLength(1);

		captured = [];
		logger.warn('[receipt-ocr] AI response');
		expect(captured.filter((line) => line.includes(AI_PROVIDER_UNAVAILABLE_LOG_TERM))).toHaveLength(
			0,
		);

		resetAiAvailabilityLatch();
	});
});
