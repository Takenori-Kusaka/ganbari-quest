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
