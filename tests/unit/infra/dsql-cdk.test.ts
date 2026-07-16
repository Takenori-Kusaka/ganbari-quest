// tests/unit/infra/dsql-cdk.test.ts
// EPIC #3424 / M4-E item 12 (#3429 #3431 #3432) / 設計 SSOT: infra/lib/dsql-stack.ts
//
// DsqlStack の CDK template 契約:
//   - CfnCluster は deletion protection 既定 true (#3429、誤 destroy の物理拒否)
//   - コストガードレール: TotalDPU 日次 / Storage 80% の 2 alarm + Budgets $1 (80/100%) (#3431)
//   - 可観測性 dashboard (OccConflicts/QueryTimeouts/CommitLatency/接続数) (#3432)
//   - `-c dsqlEnabled=true` 無しでは合成されない (M5 承認前の誤 deploy 防止)

import * as cdk from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { beforeAll, describe, expect, it } from 'vitest';
import { DsqlStack } from '../../../infra/lib/dsql-stack';

describe('DsqlStack (EPIC #3424 M4-E item 12)', () => {
	let template: Template;

	beforeAll(() => {
		const app = new cdk.App();
		const stack = new DsqlStack(app, 'TestDsql', { opsEmail: 'ops@example.com' });
		template = Template.fromStack(stack);
	});

	it('[I1] DSQL cluster が deletion protection true で 1 個作成される (#3429)', () => {
		template.resourceCountIs('AWS::DSQL::Cluster', 1);
		template.hasResourceProperties('AWS::DSQL::Cluster', {
			DeletionProtectionEnabled: true,
		});
	});

	it('[I2] deletionProtection=false 指定時のみ DP が外れる (撤去 runbook の 2 段目)', () => {
		const app = new cdk.App();
		const stack = new DsqlStack(app, 'TestDsqlNoDp', { deletionProtection: false });
		Template.fromStack(stack).hasResourceProperties('AWS::DSQL::Cluster', {
			DeletionProtectionEnabled: false,
		});
	});

	it('[I2b] ClusterEndpoint / ClusterArn output を持つ (M5 DoD4: workflow が OutputKey 名で解決する契約)', () => {
		// deploy-aws-staging.yml (DSQL lane) が describe-stacks --query OutputKey==... で取得する。
		template.hasOutput('ClusterEndpoint', {});
		template.hasOutput('ClusterArn', {});
	});

	it('[I3] コストガードレール alarm 2 本 (TotalDPU 日次 3,225 / Storage 0.8GiB) (#3431)', () => {
		template.resourceCountIs('AWS::CloudWatch::Alarm', 2);
		template.hasResourceProperties('AWS::CloudWatch::Alarm', {
			MetricName: 'TotalDPU',
			Namespace: 'AWS/AuroraDSQL',
			Statistic: 'Sum',
			Period: 86400,
			Threshold: 3225,
		});
		template.hasResourceProperties('AWS::CloudWatch::Alarm', {
			MetricName: 'ClusterStorageSize',
			Namespace: 'AWS/AuroraDSQL',
			Threshold: 0.8 * 1024 * 1024 * 1024,
		});
	});

	it('[I3b] 両 alarm の description が一次対応 runbook link を含む (#3730、2am 発見時の可観測性)', () => {
		// runbook link が silent に消えると alarm 発火時の一次対応導線が失われる (#3432 residual)。
		const alarms = template.findResources('AWS::CloudWatch::Alarm');
		const descriptions = Object.values(alarms).map(
			(alarm) => alarm.Properties.AlarmDescription as string,
		);
		expect(descriptions).toHaveLength(2);
		for (const description of descriptions) {
			expect(description).toContain('docs/runbooks/dsql-alert-response.md');
		}
	});

	it('[I4] alarm は SNS topic に通知し、opsEmail が subscribe される', () => {
		template.resourceCountIs('AWS::SNS::Topic', 1);
		template.hasResourceProperties('AWS::SNS::Subscription', {
			Protocol: 'email',
			Endpoint: 'ops@example.com',
		});
		const alarms = template.findResources('AWS::CloudWatch::Alarm');
		for (const alarm of Object.values(alarms)) {
			expect(alarm.Properties.AlarmActions).toHaveLength(1);
		}
	});

	it('[I5] Budgets $1 が 80% / 100% の 2 段通知で作成される (#3431)', () => {
		template.resourceCountIs('AWS::Budgets::Budget', 1);
		template.hasResourceProperties('AWS::Budgets::Budget', {
			Budget: Match.objectLike({
				BudgetName: 'ganbari-quest-dsql-guardrail',
				BudgetType: 'COST',
				TimeUnit: 'MONTHLY',
				BudgetLimit: { Amount: 1, Unit: 'USD' },
			}),
			NotificationsWithSubscribers: Match.arrayWith([
				Match.objectLike({ Notification: Match.objectLike({ Threshold: 80 }) }),
				Match.objectLike({ Notification: Match.objectLike({ Threshold: 100 }) }),
			]),
		});
	});

	it('[I6] opsEmail 未指定なら Budgets を作らない (通知先なしの Budget は無意味)', () => {
		const app = new cdk.App();
		const stack = new DsqlStack(app, 'TestDsqlNoEmail');
		Template.fromStack(stack).resourceCountIs('AWS::Budgets::Budget', 0);
	});

	it('[I7] 可観測性 dashboard に OccConflicts/QueryTimeouts/CommitLatency/接続数 が載る (#3432)', () => {
		template.resourceCountIs('AWS::CloudWatch::Dashboard', 1);
		const dashboards = template.findResources('AWS::CloudWatch::Dashboard');
		const body = JSON.stringify(Object.values(dashboards)[0]?.Properties?.DashboardBody);
		for (const metric of [
			'OccConflicts',
			'QueryTimeouts',
			'CommitLatency',
			'ClusterConnectionCount',
			'TotalDPU',
			'ClusterStorageSize',
		]) {
			expect(body).toContain(metric);
		}
	});
});

// #3703 / #3708: dashboard / budget の物理名は staging / prod で一意でなければならない。
// 同一アカウント・同一リージョンに GanbariQuestDsql (本番) と GanbariQuestDsqlStaging が同居するため、
// 物理名がハードコード同名だと CloudFormation 'already exists' で本番 cutover deploy が fail する
// (2026-07-13 本番 cutover が 4 回連続 fail した実障害)。nameSuffix 導出 (stack id に 'staging' を
// 含むか) の guard test。heuristic が壊れる / 削られると本番・staging の名前衝突が再発するため、
// 実 stack id (deploy workflows が使う 'GanbariQuestDsql' / 'GanbariQuestDsqlStaging') で assert する。
describe('DsqlStack nameSuffix guard (#3703 / #3708 staging・prod 物理名一意性)', () => {
	/** stack id で synth し dashboard / budget 物理名を取り出す。 */
	function physicalNames(stackId: string): { dashboard: string; budget: string } {
		const app = new cdk.App();
		const stack = new DsqlStack(app, stackId, { opsEmail: 'ops@example.com' });
		const template = Template.fromStack(stack);
		const dashboards = template.findResources('AWS::CloudWatch::Dashboard');
		const budgets = template.findResources('AWS::Budgets::Budget');
		const dashboard = Object.values(dashboards)[0]?.Properties?.DashboardName as string;
		const budget = Object.values(budgets)[0]?.Properties?.Budget?.BudgetName as string;
		return { dashboard, budget };
	}

	it('[N1] 本番 stack id (GanbariQuestDsql) は suffix 無しの物理名', () => {
		const names = physicalNames('GanbariQuestDsql');
		expect(names.dashboard).toBe('ganbari-quest-dsql');
		expect(names.budget).toBe('ganbari-quest-dsql-guardrail');
	});

	it('[N2] staging stack id (GanbariQuestDsqlStaging) は -staging suffix 付き物理名', () => {
		const names = physicalNames('GanbariQuestDsqlStaging');
		expect(names.dashboard).toBe('ganbari-quest-dsql-staging');
		expect(names.budget).toBe('ganbari-quest-dsql-guardrail-staging');
	});

	it('[N3] 本番と staging の物理名は衝突しない (cutover 4 連続 fail の再発 guard)', () => {
		const prod = physicalNames('GanbariQuestDsql');
		const staging = physicalNames('GanbariQuestDsqlStaging');
		expect(prod.dashboard).not.toBe(staging.dashboard);
		expect(prod.budget).not.toBe(staging.budget);
	});
});
