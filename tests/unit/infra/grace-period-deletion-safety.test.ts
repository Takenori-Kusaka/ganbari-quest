// tests/unit/infra/grace-period-deletion-safety.test.ts
// #4327: 顧客データ物理削除まわりの infra 側不変条件。
//
// 守る不変条件:
//   [A] 部分失敗が CloudWatch の専用 metric / alarm に乗る (観測)
//   [B] CDK の literal 検索語がアプリ側の SSOT と一致する (drift)
//   [C] 非冪等な cron だけ自動リトライを切る (再走の防止と、取りこぼしの防止の両立)
//   [D] kill-switch env がアプリ Lambda に配られている (呼ばれても消さない防御)
//
// [C] / [D] は「宣言したつもりで配線が無い」を防ぐため synth 済み template を見る。
// context stub パターンは tests/unit/infra/entitlement-fail-closed-alarm.test.ts を踏襲。

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as cdk from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { beforeAll, describe, expect, it } from 'vitest';
import { ComputeStack } from '../../../infra/lib/compute-stack';
import { NetworkStack } from '../../../infra/lib/network-stack';
import { ALARM_NOTIFY_POLICY } from '../../../infra/lib/ops-alert-policy';
import { GRACE_PERIOD_PARTIAL_FAILURE_LOG_TERM, OpsStack } from '../../../infra/lib/ops-stack';
import { StorageStack } from '../../../infra/lib/storage-stack';
import { GRACE_PERIOD_PARTIAL_FAILURE_LOG_TERM as APP_LOG_TERM } from '../../../src/lib/server/services/grace-period-service';

// cspell:ignore TESTPOOL

const env: cdk.Environment = { account: '000000000000', region: 'us-east-1' };
const ALARM_NAME = 'ganbari-quest-grace-period-partial-failure';

function makeApp(extraContext: Record<string, unknown> = {}): cdk.App {
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
			...extraContext,
		},
	});
}

function build(extraContext: Record<string, unknown> = {}): {
	ops: Template;
	compute: Template;
} {
	const app = makeApp(extraContext);
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
	});
	const ops = new OpsStack(app, 'TestOps', {
		env,
		lambdaFn: compute.fn,
		distribution: network.distribution,
		functionUrl: compute.functionUrl,
		cronDispatcherFn: compute.cronDispatcherFn,
		appLogGroup: compute.appLogGroup,
		opsEmail: 'ops@example.com',
	});
	return { ops: Template.fromStack(ops), compute: Template.fromStack(compute) };
}

let opsTemplate: Template;
let computeTemplate: Template;
let computeDisabledTemplate: Template;

beforeAll(() => {
	const built = build();
	opsTemplate = built.ops;
	computeTemplate = built.compute;
	computeDisabledTemplate = build({ gracePeriodDeletionDisabled: 'true' }).compute;
}, 240_000);

describe('#4327 [A] 部分失敗が専用の metric / alarm に乗る', () => {
	it('[A1] MetricFilter が期待の pattern / metric で作られる', () => {
		opsTemplate.hasResourceProperties('AWS::Logs::MetricFilter', {
			FilterPattern: `"${GRACE_PERIOD_PARTIAL_FAILURE_LOG_TERM}"`,
			MetricTransformations: Match.arrayWith([
				Match.objectLike({
					MetricNamespace: 'GanbariQuest/Deletion',
					MetricName: 'GracePeriodPartialFailure',
					MetricValue: '1',
					DefaultValue: 0,
				}),
			]),
		});
	});

	// cron は 1 日 1 回しか走らない。継続 window を待つ設計にすると気付くまで丸 1 日以上
	// かかり、その間に翌日の実行がさらに削除を進める。1 件で即発火させること。
	it('[A2] Alarm は 1 件で即発火し、SNS topic に接続されている', () => {
		opsTemplate.hasResourceProperties('AWS::CloudWatch::Alarm', {
			AlarmName: ALARM_NAME,
			Namespace: 'GanbariQuest/Deletion',
			MetricName: 'GracePeriodPartialFailure',
			Threshold: 1,
			EvaluationPeriods: 1,
			DatapointsToAlarm: 1,
			TreatMissingData: 'notBreaching',
			AlarmActions: Match.anyValue(),
		});
	});

	it('[A3] 通知方針 (ALARM_NOTIFY_POLICY) に宣言されている', () => {
		expect(ALARM_NOTIFY_POLICY[ALARM_NAME]).toBeDefined();
		expect(ALARM_NOTIFY_POLICY[ALARM_NAME]?.reason.length).toBeGreaterThan(20);
	});
});

describe('#4327 [B] 検索語 SSOT の drift', () => {
	it('[B1] CDK の literal がアプリ側の定数と一致する', () => {
		expect(GRACE_PERIOD_PARTIAL_FAILURE_LOG_TERM).toBe(APP_LOG_TERM);
	});

	it('[B2] endpoint が実際にその定数で log を書いている', () => {
		const source = fs.readFileSync(
			path.resolve(__dirname, '../../..', 'src/routes/api/cron/grace-period-deletion/+server.ts'),
			'utf-8',
		);
		expect(source).toContain('logger.error(GRACE_PERIOD_PARTIAL_FAILURE_LOG_TERM');
	});
});

describe('#4327 [C] 非冪等な cron だけ自動リトライを切る', () => {
	/** cron Rule を物理名 (`...-cron-<job>`) で引く。 */
	function cronRuleTargets(jobName: string): Array<Record<string, unknown>> {
		const rules = computeTemplate.findResources('AWS::Events::Rule');
		const hit = Object.values(rules).find(
			(r) => (r.Properties as { Name?: string }).Name === `ganbari-quest-cron-${jobName}`,
		);
		expect(hit, `cron rule ${jobName} が見つからない`).toBeDefined();
		const targets = (hit?.Properties as { Targets?: Array<Record<string, unknown>> }).Targets;
		expect(targets, `${jobName} に target が無い`).toBeDefined();
		return targets ?? [];
	}

	// #4304 back-merge: grace-period-deletion の EventBridge Rule は監査 revert + PO 決裁により
	// **作られていない**。よって「retry が 0 であること」ではなく「Rule 自体が無いこと」を固定する。
	// Rule を復活させるときは、本 test を元の
	//   for (const target of cronRuleTargets('grace-period-deletion')) {
	//     expect(target.RetryPolicy).toEqual({ MaximumRetryAttempts: 0 });
	//   }
	// に戻すこと (retryAttempts: 0 の配線は compute-stack に残してある)。
	it('[C1] grace-period-deletion の Rule は作られていない (監査 revert + PO 決裁 2026-08-06)', () => {
		const rules = computeTemplate.findResources('AWS::Events::Rule');
		const hit = Object.values(rules).find(
			(r) =>
				(r.Properties as { Name?: string }).Name === 'ganbari-quest-cron-grace-period-deletion',
		);
		expect(
			hit,
			'grace-period-deletion の Rule が復活している (#4327 の 4 条件が未解消)',
		).toBeUndefined();
	});

	// 一律 0 にすると「1 回の失敗で取りこぼす」方向に倒れる。とくに deletion-warning-emails は
	// 送信済フラグで冪等であり、retry を切ると 1 度の失敗で **予告のないまま削除される**
	// (#4327 が塞ごうとしている状態そのもの)。pmf-survey は年 2 回起動で 1 失敗 = 6 ヶ月欠測。
	it.each([
		'deletion-warning-emails',
		'pmf-survey',
		'export-build',
		'retention-cleanup',
	])('[C2] 冪等な cron (%s) は既定のリトライを維持する', (jobName) => {
		for (const target of cronRuleTargets(jobName)) {
			expect(target.RetryPolicy).toBeUndefined();
		}
	});

	// grace-period-deletion の Rule が無い現状では 0 本が正。Rule 復活時は
	// `['ganbari-quest-cron-grace-period-deletion']` に戻す ([C1] と対で更新する)。
	it('[C3] リトライを切っている cron は 0 本 (無自覚な横展開の検出)', () => {
		const rules = computeTemplate.findResources('AWS::Events::Rule');
		const cronRules = Object.entries(rules).filter(([, r]) =>
			String((r.Properties as { Name?: string }).Name ?? '').includes('-cron-'),
		);
		// gate 自身の故障検出 (抽出が壊れて 0 件になると全部素通りする)
		expect(cronRules.length).toBeGreaterThanOrEqual(5);

		const disabled = cronRules
			.filter(([, r]) =>
				((r.Properties as { Targets?: Array<Record<string, unknown>> }).Targets ?? []).some(
					(t) => t.RetryPolicy !== undefined,
				),
			)
			.map(([, r]) => (r.Properties as { Name?: string }).Name);

		expect(disabled).toEqual([]);
	});
});

describe('#4327 [D] kill-switch env がアプリ Lambda に配られている', () => {
	// #4721: **既定値は「Rule があるか」から導出する**（context 未指定 = 'false' ではない）。
	//
	// 旧契約は context 未指定なら 'false'（= 削除有効）だった。しかし CRON_JOBS に
	// grace-period-deletion が無い現状では物理削除は起きず、env だけ「有効」と言っていた。
	// その結果「削除は止まっているのに削除予定日を告げる予告メールだけが届く」非対称が生まれた。
	// env を「物理削除が走るか」の唯一の真実にすることで、予告メールの文面が追従できる。
	it('[D1] 既定は Rule の有無から導出する — Rule が無い現状は "true" (#4721)', () => {
		computeTemplate.hasResourceProperties('AWS::Lambda::Function', {
			Environment: Match.objectLike({
				Variables: Match.objectLike({ GRACE_PERIOD_DELETION_DISABLED: 'true' }),
			}),
		});
	});

	// 対照: 導出の入力 (Rule の有無) が実際にそうなっていることを同じ template で確認する。
	// これが無いと [D1] は「常に true を返すだけの検査」と区別がつかない。
	it('[D1b] 実際に grace-period-deletion の EventBridge Rule が作られていない', () => {
		const rules = computeTemplate.findResources('AWS::Events::Rule');
		const names = Object.values(rules).map((r) => (r.Properties as { Name?: string }).Name ?? '');
		expect(names).not.toContain('ganbari-quest-cron-grace-period-deletion');
	});

	it('[D2] context で "true" を渡すと停止状態で deploy できる', () => {
		computeDisabledTemplate.hasResourceProperties('AWS::Lambda::Function', {
			Environment: Match.objectLike({
				Variables: Match.objectLike({ GRACE_PERIOD_DELETION_DISABLED: 'true' }),
			}),
		});
	});

	it('[D3] deploy workflow が context を渡している (配布経路が繋がっている)', () => {
		const workflow = fs.readFileSync(
			path.resolve(__dirname, '../../..', '.github/workflows/deploy.yml'),
			'utf-8',
		);
		expect(workflow).toContain('-c gracePeriodDeletionDisabled=');
	});
});
