// tests/unit/infra/entitlement-fail-closed-alarm.test.ts
// #3998: entitlement 解決の fail-closed を検知する MetricFilter + Alarm の構造検証。
//
// 本 test が守る不変条件は 3 つある。CDK template だけを見る test は「定義したが 1 件も
// マッチしない filter」を通してしまい、#3969 と同じ「作ったが効いていない」形になるため、
// **filter pattern が実際に出力される log 行にマッチすること**まで踏み込んで検証する。
//
//   [A] CDK 構造 …… MetricFilter / Alarm が期待の namespace / 閾値 / 通知先で存在する
//   [B] SSOT drift … CDK の literal 検索語がアプリ側の ALERT_KIND / prefix と一致する
//                    (CDK tsconfig rootDir の制約で src を import できないため literal で持つ。
//                     CRON_JOBS ↔ schedule-registry と同じ構図)
//   [C] 実マッチ …… logger が Lambda 上で実際に書き出す文字列を捕捉し、その行が
//                    filter pattern にマッチすること / 無関係な行にはマッチしないこと
//
// context stub パターンは tests/unit/infra/ops-static-assets-alarm.test.ts を踏襲。

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as cdk from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ComputeStack } from '../../../infra/lib/compute-stack';
import { NetworkStack } from '../../../infra/lib/network-stack';
import { ENTITLEMENT_FAIL_CLOSED_LOG_TERM, OpsStack } from '../../../infra/lib/ops-stack';
import { StorageStack } from '../../../infra/lib/storage-stack';
import { TenantEntitlementUnavailableError } from '../../../src/lib/server/auth/tenant-entitlement';

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

/** appLogGroup を渡す / 渡さないで OpsStack の template を作る */
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

function readRepoFile(relPath: string): string {
	return fs.readFileSync(path.resolve(__dirname, '../../..', relPath), 'utf-8');
}

// CDK synth (Docker image asset の hash 計算を含む) は数十秒かかるため 1 回だけ組む
let withLogGroupTemplate: Template;
let withoutLogGroupTemplate: Template;

beforeAll(() => {
	withLogGroupTemplate = buildOpsTemplate({ withAppLogGroup: true });
	withoutLogGroupTemplate = buildOpsTemplate({ withAppLogGroup: false });
}, 180_000);

describe('#3998 [A] entitlement fail-closed の MetricFilter / Alarm が CDK に定義されている', () => {
	it('[A1] appLogGroup 指定時に MetricFilter が期待の pattern / metric で作られる', () => {
		const template = withLogGroupTemplate;

		template.hasResourceProperties('AWS::Logs::MetricFilter', {
			FilterPattern: `"${ENTITLEMENT_FAIL_CLOSED_LOG_TERM}"`,
			MetricTransformations: Match.arrayWith([
				Match.objectLike({
					MetricNamespace: 'GanbariQuest/Auth',
					MetricName: 'EntitlementDbUnavailable',
					MetricValue: '1',
					DefaultValue: 0,
				}),
			]),
		});
	});

	it('[A2] Alarm が閾値 5 / 5 分 / 既存 SNS topic に接続されている', () => {
		const template = withLogGroupTemplate;

		template.hasResourceProperties('AWS::CloudWatch::Alarm', {
			AlarmName: 'ganbari-quest-auth-entitlement-db-unavailable',
			Namespace: 'GanbariQuest/Auth',
			MetricName: 'EntitlementDbUnavailable',
			Statistic: 'Sum',
			Period: 300,
			Threshold: 5,
			EvaluationPeriods: 1,
			ComparisonOperator: 'GreaterThanOrEqualToThreshold',
			TreatMissingData: 'notBreaching',
			// 既存アラームと同じ通知先 (OpsAlerts SNS topic) に接続されていること
			AlarmActions: Match.arrayWith([
				Match.objectLike({ Ref: Match.stringLikeRegexp('OpsAlerts') }),
			]),
			OKActions: Match.arrayWith([Match.objectLike({ Ref: Match.stringLikeRegexp('OpsAlerts') })]),
		});
	});

	it('[A3] appLogGroup 未指定なら MetricFilter も Alarm も作らない (監視 cost ゼロ)', () => {
		const template = withoutLogGroupTemplate;

		template.resourceCountIs('AWS::Logs::MetricFilter', 0);
		const alarms = template.findResources('AWS::CloudWatch::Alarm');
		const names = Object.values(alarms).map(
			(r) => (r.Properties as { AlarmName: string }).AlarmName,
		);
		expect(names).not.toContain('ganbari-quest-auth-entitlement-db-unavailable');
	});

	it('[A4] app.ts が ComputeStack の LogGroup を OpsStack に渡している (配線漏れ検出)', () => {
		expect(readRepoFile('infra/bin/app.ts')).toContain('appLogGroup: compute.appLogGroup');
	});
});

describe('#3998 [B] CDK literal ↔ アプリ側 SSOT の drift', () => {
	it('[B1] 検索語が ALERT_KIND を含む', () => {
		expect(ENTITLEMENT_FAIL_CLOSED_LOG_TERM).toContain(
			TenantEntitlementUnavailableError.ALERT_KIND,
		);
	});

	it('[B2] 検索語の prefix が hooks.server.ts の出力形と一致する', () => {
		// hooks.server.ts は `[auth-alert] ${kind}: ...` の形で 503 応答時に 1 行出す。
		// prefix を変えたらここが落ちる (= filter が無言で 0 件になるのを防ぐ)。
		expect(readRepoFile('src/hooks.server.ts')).toMatch(/`\[auth-alert\] \$\{kind\}:/);
		expect(ENTITLEMENT_FAIL_CLOSED_LOG_TERM).toBe(
			`[auth-alert] ${TenantEntitlementUnavailableError.ALERT_KIND}`,
		);
	});

	it('[B3] DB 解決失敗の log 行も kind で追える (Logs Insights の網羅性)', () => {
		expect(readRepoFile('src/lib/server/auth/tenant-entitlement.ts')).toMatch(
			/\[AUTH\] \$\{TenantEntitlementUnavailableError\.ALERT_KIND\}:/,
		);
	});
});

describe('#3998 [C] filter pattern が実際の log 出力にマッチする', () => {
	// CloudWatch の `"..."` 形式 filter pattern は「その文字列を含む行」にマッチする。
	// logger が Lambda 上で書くのは console 出力そのものなので、console を捕まえて
	// 実バイト列に対して包含判定する。
	function matchesFilter(logLine: string): boolean {
		return logLine.includes(ENTITLEMENT_FAIL_CLOSED_LOG_TERM);
	}

	let captured: string[];
	// biome-ignore lint/suspicious/noExplicitAny: console spy の restore 用
	let errorSpy: any;

	beforeEach(() => {
		captured = [];
		errorSpy = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
			captured.push(args.map(String).join(' '));
		});
	});

	afterEach(() => {
		errorSpy.mockRestore();
	});

	it('[C1] 503 応答時に logger が書く行が filter にマッチする', async () => {
		const { logger } = await import('../../../src/lib/server/logger');
		const kind = TenantEntitlementUnavailableError.ALERT_KIND;

		// hooks.server.ts の respondEntitlementUnavailable と同一形の呼び出し
		logger.error(
			`[auth-alert] ${kind}: 課金状態を DB から解決できず context を発行しませんでした`,
			{
				requestId: 'req-1',
				tenantId: 't-1',
				context: { kind, path: '/admin', errorSummary: 'connection refused' },
			},
		);

		expect(captured.some(matchesFilter)).toBe(true);
	});

	it('[C2] 無関係な error log は filter にマッチしない (誤発火しない)', async () => {
		const { logger } = await import('../../../src/lib/server/logger');

		logger.error('[STRIPE] Webhook handler failed: evt_1 type=invoice.paid', {
			error: 'boom',
		});

		expect(captured.some(matchesFilter)).toBe(false);
	});

	it('[C3] DB 解決失敗そのものの行は kind で追えるが metric には数えない', async () => {
		const { logger } = await import('../../../src/lib/server/logger');
		const kind = TenantEntitlementUnavailableError.ALERT_KIND;

		logger.error(`[AUTH] ${kind}: Failed to resolve tenant entitlement from DB`, {
			context: { kind, tenantId: 't-1' },
		});

		// Logs Insights (kind 単独) では拾える
		expect(captured.some((l) => l.includes(kind))).toBe(true);
		// 一方 metric は「503 になったリクエスト数」を単位にしたいので数えない
		expect(captured.some(matchesFilter)).toBe(false);
	});
});
