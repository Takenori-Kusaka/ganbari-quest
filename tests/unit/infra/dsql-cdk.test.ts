// tests/unit/infra/dsql-cdk.test.ts
// EPIC #3424 / M4-E item 12 (#3429 #3431 #3432) / 設計 SSOT: infra/lib/dsql-stack.ts
//
// DsqlStack の CDK template 契約:
//   - CfnCluster は deletion protection 既定 true (#3429、誤 destroy の物理拒否)
//   - コストガードレール: TotalDPU 日次 / Storage 80% の 2 alarm + Budgets $1 (80/100%) (#3431)
//   - 可観測性 dashboard (OccConflicts/QueryTimeouts/CommitLatency/接続数) (#3432)
//   - AWS Backup: 日次 full backup plan + backup/restore role 明示 provision + 失敗検知 rule (#3437)
//   - `-c dsqlEnabled=true` 無しでは合成されない (M5 承認前の誤 deploy 防止)

import * as cdk from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { beforeAll, describe, expect, it } from 'vitest';
import { DsqlStack } from '../../../infra/lib/dsql-stack';

describe('DsqlStack (EPIC #3424 M4-E item 12)', () => {
	let template: Template;

	// #3975: CDK 合成 1 回目は `aws-cdk-lib` (jsii bundle) の cold load を含み、Windows ローカルでは
	// vite.config.ts の既定 `hookTimeout: 10_000` を超える (実測 18.1s / CI Linux は収まるため CI のみ green)。
	// 「ローカル pre-ready Step 3 だけが恒常 red」= 本物の fail が「またいつものやつ」として無視される状態を作る。
	// 本ディレクトリの他 6 suite は既に明示 timeout (60s / 120s) を持っており、本 suite だけが未指定だった。
	// 60s は実測の約 3.3x。合成が壊れて戻らないケースは打ち切られるため無検査化ではない。
	beforeAll(() => {
		const app = new cdk.App();
		const stack = new DsqlStack(app, 'TestDsql', { opsEmail: 'ops@example.com' });
		template = Template.fromStack(stack);
	}, 60_000);

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
		// DSQL guardrail ($1) + backup guardrail ($0.07、#3437) の 2 budget。
		template.resourceCountIs('AWS::Budgets::Budget', 2);
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

	it('[I8] AWS Backup: prod は日次 full backup plan (7日保持) + cluster ARN 明示 selection (#3437)', () => {
		// DSQL は自動 backup を持たないため AWS Backup で cluster full backup を日次取得。
		template.resourceCountIs('AWS::Backup::BackupVault', 1);
		template.resourceCountIs('AWS::Backup::BackupPlan', 1);
		// #4724: DSQL cluster + assets バケット (子供の写真・声) の 2 selection。
		// 内訳の固定は tests/unit/infra/assets-backup.test.ts [B1]/[B2]。
		template.resourceCountIs('AWS::Backup::BackupSelection', 2);
		// daily rule + 7 日保持 (Pre-PMF 最小 DR 窓)。
		template.hasResourceProperties('AWS::Backup::BackupPlan', {
			BackupPlan: {
				BackupPlanRule: Match.arrayWith([Match.objectLike({ Lifecycle: { DeleteAfterDays: 7 } })]),
			},
		});
		// cluster ARN を明示 assign (Service Opt-in 不要の根拠。ARN は cluster の attrResourceArn)。
		template.hasResourceProperties('AWS::Backup::BackupSelection', {
			BackupSelection: Match.objectLike({
				Resources: Match.arrayWith([
					Match.objectLike({ 'Fn::GetAtt': Match.arrayWith(['ResourceArn']) }),
				]),
			}),
		});
	});

	it('[I8b] backup 月額コスト guardrail budget $0.07 (≈¥10) が存在する (#3437、マネタイズ整合)', () => {
		// 月額 backup コスト < ¥10 の設計目標を hard 監視。AWS Backup service filter で $0.07 上限。
		template.hasResourceProperties('AWS::Budgets::Budget', {
			Budget: Match.objectLike({
				BudgetName: 'ganbari-quest-dsql-backup-guardrail',
				BudgetLimit: { Amount: 0.07, Unit: 'USD' },
				CostFilters: Match.objectLike({ Service: ['AWS Backup'] }),
			}),
		});
	});

	it('[I8c] backup ジョブ失敗を EventBridge → DsqlAlerts SNS で検知する (#3437 F-2 / ADR-0024 (d))', () => {
		// 日次 backup が silent fail しても誰も気づかない = DR 空白の再現 (ADR-0024 生成インシデント根本原因 D)。
		// Backup Job State Change の失敗系を捕捉し、コスト guardrail (budget) ではなく「ジョブ失敗」を検知する。
		template.hasResourceProperties('AWS::Events::Rule', {
			EventPattern: Match.objectLike({
				source: ['aws.backup'],
				'detail-type': ['Backup Job State Change'],
				detail: Match.objectLike({
					state: ['FAILED', 'ABORTED', 'EXPIRED'],
				}),
			}),
		});
		// alert 先は新規 SNS を作らず既存 DsqlAlerts topic に相乗り (SNS topic は依然 1 個)。
		template.resourceCountIs('AWS::SNS::Topic', 1);
		const rules = template.findResources('AWS::Events::Rule', {
			Properties: {
				EventPattern: Match.objectLike({ source: ['aws.backup'] }),
			},
		});
		const backupFailRule = Object.values(rules)[0];
		expect(backupFailRule?.Properties?.Targets).toHaveLength(1);
		// target は SNS topic (Ref で DsqlAlerts を指す)。
		expect(JSON.stringify(backupFailRule?.Properties?.Targets)).toContain('DsqlAlerts');
	});

	it('[I8d] backup/restore role を明示 provision し selection に配線する (#3437 F-4、role 不整合防止)', () => {
		// CDK 自動生成 role は backup 権限のみ。restore job (runbook §2) が使えるよう backup + restore の
		// 2 managed policy を付けた named role を確定生成する (AWSBackupDefaultServiceRole 依存を排除)。
		template.hasResourceProperties('AWS::IAM::Role', {
			RoleName: 'ganbari-quest-dsql-backup-role',
			AssumeRolePolicyDocument: Match.objectLike({
				Statement: Match.arrayWith([
					Match.objectLike({
						Principal: Match.objectLike({ Service: 'backup.amazonaws.com' }),
					}),
				]),
			}),
			ManagedPolicyArns: Match.arrayWith([
				Match.objectLike({
					'Fn::Join': Match.arrayWith([
						Match.arrayWith([Match.stringLikeRegexp('AWSBackupServiceRolePolicyForBackup')]),
					]),
				}),
				Match.objectLike({
					'Fn::Join': Match.arrayWith([
						Match.arrayWith([Match.stringLikeRegexp('AWSBackupServiceRolePolicyForRestores')]),
					]),
				}),
			]),
		});
		// BackupSelection が上記 role を参照する (自動生成 role でなく named role)。
		template.hasResourceProperties('AWS::Backup::BackupSelection', {
			BackupSelection: Match.objectLike({
				IamRoleArn: Match.objectLike({
					'Fn::GetAtt': Match.arrayWith([Match.stringLikeRegexp('^DsqlBackupRole')]),
				}),
			}),
		});
		// restore job が使う role ARN を output で配布する (runbook の --iam-role-arn)。
		template.hasOutput('BackupRoleArn', {});
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

	it('[N4] staging は AWS Backup を作らない / 本番は作る (#3437、使い捨て staging で backup コスト回避)', () => {
		const app = new cdk.App();
		const prod = Template.fromStack(new DsqlStack(app, 'GanbariQuestDsql'));
		const staging = Template.fromStack(new DsqlStack(new cdk.App(), 'GanbariQuestDsqlStaging'));
		prod.resourceCountIs('AWS::Backup::BackupPlan', 1);
		staging.resourceCountIs('AWS::Backup::BackupVault', 0);
		staging.resourceCountIs('AWS::Backup::BackupPlan', 0);
		staging.resourceCountIs('AWS::Backup::BackupSelection', 0);
		// backup 付随リソース (role / 失敗検知 rule) も staging では作らない (#3437 F-2/F-4)。
		prod.resourceCountIs('AWS::IAM::Role', 1);
		staging.resourceCountIs('AWS::IAM::Role', 0);
		prod.resourceCountIs('AWS::Events::Rule', 1);
		staging.resourceCountIs('AWS::Events::Rule', 0);
	});
});
