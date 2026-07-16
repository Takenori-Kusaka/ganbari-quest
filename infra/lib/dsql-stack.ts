import * as cdk from 'aws-cdk-lib';
import * as budgets from 'aws-cdk-lib/aws-budgets';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as cw_actions from 'aws-cdk-lib/aws-cloudwatch-actions';
import * as dsql from 'aws-cdk-lib/aws-dsql';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as subscriptions from 'aws-cdk-lib/aws-sns-subscriptions';
import type { Construct } from 'constructs';

/**
 * DSQL クラスタ + コストガードレール + 可観測性 dashboard (EPIC #3424 M4-E item 12)。
 *
 * 設計 SSOT: docs/research/2026-06-28-aurora-dsql-adoption.md §運用 (metric 名 / 閾値) /
 * m4-implementation-plan.md §3.8-12 / #3429 (CfnCluster + DP) / #3431 (Alarm + Budgets) /
 * #3432 (dashboard)。
 *
 * - **`-c dsqlEnabled=true` の context gate 経由でのみ instantiate される** (bin/app.ts)。
 *   本番 deploy は M5 cutover のユーザー承認事項 (Auto Mode ガイドライン) であり、既定の
 *   `cdk deploy` では本 stack は合成されない。
 * - コスト前提: 無料枠 10 万 DPU/月 + 1GB storage、scale-to-zero (PoC 実測 TotalDPU 3.53 =
 *   枠の 0.0035%)。ガードレールは「¥100/月を超えない」の機械検知 (超過時に人が止める)。
 * - **実 IAM policy (DbConnect 最小権限 / DbConnectAdmin 分離 + append-only 表 GRANT 除外)
 *   は本 stack の scope 外**: M3 §3.4 B6 により cutover 前 hard blocker として M5 で配線する
 *   (GRANT は DDL 側 = migration runner の責務と連動するため)。
 */
export interface DsqlStackProps extends cdk.StackProps {
	/** アラーム / Budgets 通知先メール。未指定時は SNS topic のみ作成 (subscription なし)。 */
	opsEmail?: string;
	/** deletion protection (既定 true = M4 plan「DP=true 既定」。撤去 runbook は DP=false → destroy の 2 段)。 */
	deletionProtection?: boolean;
}

export class DsqlStack extends cdk.Stack {
	public readonly cluster: dsql.CfnCluster;

	constructor(scope: Construct, id: string, props?: DsqlStackProps) {
		super(scope, id, props);

		// #3703 hotfix: staging (GanbariQuestDsqlStaging) と本番 (GanbariQuestDsql) は同一アカウント・
		// 同一リージョンに同居するため、dashboard / budget の物理名が同名だと CloudFormation
		// 'already exists' で deploy fail する (本番 cutover 初回で顕在化)。stack id から suffix を
		// 導出して一意化する (cluster/topic/alarm は論理 ID 由来で自動一意のため対象外)。
		const nameSuffix = id.toLowerCase().includes('staging') ? '-staging' : '';

		// ── 1. DSQL クラスタ (L1、#3429。DP=true 既定で誤 destroy を物理拒否) ──
		this.cluster = new dsql.CfnCluster(this, 'Cluster', {
			deletionProtectionEnabled: props?.deletionProtection ?? true,
			tags: [{ key: 'app', value: 'ganbari-quest' }],
		});

		const clusterId = this.cluster.attrIdentifier;
		const dim = { ClusterId: clusterId };

		// ── 2. 通知 topic ──
		const topic = new sns.Topic(this, 'DsqlAlerts', {
			displayName: 'GanbariQuest DSQL alerts',
		});
		if (props?.opsEmail) {
			topic.addSubscription(new subscriptions.EmailSubscription(props.opsEmail));
		}
		const alarmAction = new cw_actions.SnsAction(topic);

		// ── 3. コストガードレール alarm (#3431: TotalDPU / Storage の 2 本に限定。
		//       可観測性 metric は alarm でなく dashboard で見る = 無料枠 10 alarm を温存) ──

		// 無料枠 10 万 DPU/月 ≈ 3,225 DPU/日 (research doc 閾値)。日次 Sum で超過を検知。
		const totalDpuAlarm = new cloudwatch.Alarm(this, 'TotalDpuDaily', {
			metric: new cloudwatch.Metric({
				namespace: 'AWS/AuroraDSQL',
				metricName: 'TotalDPU',
				dimensionsMap: dim,
				statistic: 'Sum',
				period: cdk.Duration.days(1),
			}),
			threshold: 3225,
			evaluationPeriods: 1,
			comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
			treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
			alarmDescription:
				'DSQL TotalDPU が無料枠ペース (10万 DPU/月 ≈ 3,225/日) を超過 (#3431。DPU 単価: Write は Read の約 27 倍) 一次対応: docs/runbooks/dsql-alert-response.md',
		});
		totalDpuAlarm.addAlarmAction(alarmAction);

		// 無料枠 1GB に 80% 接近で通知 (storage は $0.40/GB-month、消し忘れ検知)。
		const storageAlarm = new cloudwatch.Alarm(this, 'StorageSize', {
			metric: new cloudwatch.Metric({
				namespace: 'AWS/AuroraDSQL',
				metricName: 'ClusterStorageSize',
				dimensionsMap: dim,
				statistic: 'Maximum',
				period: cdk.Duration.hours(6),
			}),
			threshold: 0.8 * 1024 * 1024 * 1024, // 0.8 GiB (bytes)
			evaluationPeriods: 1,
			comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
			treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
			alarmDescription:
				'DSQL storage が無料枠 1GB の 80% に接近 (#3431) 一次対応: docs/runbooks/dsql-alert-response.md',
		});
		storageAlarm.addAlarmAction(alarmAction);

		// ── 4. Budgets ¥100 ガードレール (#3431: 80% / 100% の 2 段通知)。
		//       Budgets は USD のみのため $1 (≈¥150) を上限とし、実質「課金が発生したら知る」。
		//       Cost Anomaly Detection はアカウント単位リソース (PoC 時に手動作成済の
		//       dsql-poc-guardrail 系と重複し得る) のため IaC 化せず ops runbook 管理とする。 ──
		if (props?.opsEmail) {
			new budgets.CfnBudget(this, 'DsqlBudget', {
				budget: {
					budgetName: `ganbari-quest-dsql-guardrail${nameSuffix}`,
					budgetType: 'COST',
					timeUnit: 'MONTHLY',
					budgetLimit: { amount: 1, unit: 'USD' },
					costFilters: {
						// Aurora DSQL の課金 (RDS 配下に計上される)。過剰通知より取りこぼし防止を
						// 優先し、DSQL 単独でのフィルタが安定するまで RDS service で括る。
						Service: ['Amazon Relational Database Service'],
					},
				},
				notificationsWithSubscribers: [80, 100].map((threshold) => ({
					notification: {
						notificationType: 'ACTUAL',
						comparisonOperator: 'GREATER_THAN',
						threshold,
						thresholdType: 'PERCENTAGE',
					},
					subscribers: [{ subscriptionType: 'EMAIL', address: props.opsEmail as string }],
				})),
			});
		}

		// ── 5. 可観測性 dashboard (#3432: OccConflicts / QueryTimeouts / CommitLatency / 接続数。
		//       metric 名 SSOT = research doc §運用。alarm 化せず可視化に留める) ──
		const obsMetric = (metricName: string, statistic: string) =>
			new cloudwatch.Metric({
				namespace: 'AWS/AuroraDSQL',
				metricName,
				dimensionsMap: dim,
				statistic,
				period: cdk.Duration.minutes(5),
			});

		new cloudwatch.Dashboard(this, 'DsqlDashboard', {
			dashboardName: `ganbari-quest-dsql${nameSuffix}`,
			widgets: [
				[
					new cloudwatch.GraphWidget({
						title: 'DPU (cost driver)',
						left: [
							obsMetric('TotalDPU', 'Sum'),
							obsMetric('ReadDPU', 'Sum'),
							obsMetric('WriteDPU', 'Sum'),
							obsMetric('ComputeDPU', 'Sum'),
						],
						width: 12,
					}),
					new cloudwatch.GraphWidget({
						title: 'Storage',
						left: [obsMetric('ClusterStorageSize', 'Maximum')],
						width: 12,
					}),
				],
				[
					new cloudwatch.GraphWidget({
						title: 'OCC conflicts / query timeouts (40001 retry の実発生率)',
						left: [obsMetric('OccConflicts', 'Sum'), obsMetric('QueryTimeouts', 'Sum')],
						width: 12,
					}),
					new cloudwatch.GraphWidget({
						title: 'Commit latency (P50) / transactions',
						left: [obsMetric('CommitLatency', 'p50')],
						right: [obsMetric('TotalTransactions', 'Sum')],
						width: 12,
					}),
				],
				[
					new cloudwatch.GraphWidget({
						title: '接続数 (AWS/Usage: 上限 10,000 / DbConnect 100 req/s)',
						left: [
							new cloudwatch.Metric({
								namespace: 'AWS/Usage',
								metricName: 'ResourceCount',
								dimensionsMap: {
									Type: 'Resource',
									Resource: 'ClusterConnectionCount',
									Service: 'AuroraDSQL',
									Class: 'None',
								},
								statistic: 'Maximum',
								period: cdk.Duration.minutes(5),
							}),
						],
						width: 12,
					}),
				],
			],
		});

		new cdk.CfnOutput(this, 'ClusterIdentifier', { value: clusterId });
		new cdk.CfnOutput(this, 'ClusterEndpoint', {
			value: `${clusterId}.dsql.${this.region}.on.aws`,
			description: 'DSQL 接続 endpoint (connection.ts の DSQL_ENDPOINT に配布)',
		});
		// EPIC #3424 M5 DoD4: deploy workflow が describe-stacks で取得し、compute-stack の
		// dsql:DbConnect resource 限定 (-c dsqlClusterArn) に渡す。
		new cdk.CfnOutput(this, 'ClusterArn', {
			value: this.cluster.attrResourceArn,
			description: 'DSQL cluster ARN (dsql:DbConnect の resource 限定に使用)',
		});
	}
}
