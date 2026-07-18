import * as cdk from 'aws-cdk-lib';
import * as backup from 'aws-cdk-lib/aws-backup';
import * as budgets from 'aws-cdk-lib/aws-budgets';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as cw_actions from 'aws-cdk-lib/aws-cloudwatch-actions';
import * as dsql from 'aws-cdk-lib/aws-dsql';
import * as events from 'aws-cdk-lib/aws-events';
import * as eventsTargets from 'aws-cdk-lib/aws-events-targets';
import * as iam from 'aws-cdk-lib/aws-iam';
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

		// ── 5. AWS Backup (物理 backup、#3437) ──
		// DSQL は自動 backup 機構を持たないため AWS Backup で cluster 全体の full backup を
		// 日次取得する。**DSQL の backup は full snapshot のみ (PITR/継続 backup ではない)** —
		// 復元は AWS Backup が新 cluster を作成し (source 上書きなし)、DSQL_ENDPOINT 切替が必要
		// (runbook: docs/runbooks/dsql-restore.md)。アプリ層 backup-archive (JSON/CSV、#3376) は
		// 論理 backup として別レイヤー併存 (役割分担は data-model §6.4)。cluster ARN を **明示 assign**
		// するため AWS Backup の Service Opt-in は不要 (explicit resource assignment は opt-in 設定に
		// 依らず対象化される、AWS Backup 仕様)。staging は使い捨て (#2873) のため backup を省略する。
		const isStaging = nameSuffix === '-staging';
		if (!isStaging) {
			const backupVault = new backup.BackupVault(this, 'DsqlBackupVault', {
				backupVaultName: `ganbari-quest-dsql${nameSuffix}-vault`,
				// backup vault は誤削除で復元不能ゆえ RETAIN (stack 削除でも backup を残す)。
				removalPolicy: cdk.RemovalPolicy.RETAIN,
			});
			const backupPlan = new backup.BackupPlan(this, 'DsqlBackupPlan', {
				backupPlanName: `ganbari-quest-dsql${nameSuffix}-daily`,
				backupPlanRules: [
					new backup.BackupPlanRule({
						ruleName: 'daily-7day-retention',
						// 02:00 UTC (低トラフィック帯)。**月額コスト設計 (< ¥10、マネタイズ整合)**:
						//   AWS Backup warm storage = $0.05/GB-month (us-east-1、DSQL は cold tier 非対応)。
						//   月額 ≈ retention_points(7) × ClusterStorageSize × $0.05。
						//   実測 (2026-07-17) ClusterStorageSize = 1.35 MiB → 7 × 0.00132GiB × $0.05
						//   ≈ $0.0005/月 ≈ **¥0.07/月** (¥10 の 140 分の 1)。¥10 (≈$0.067) 到達は cluster
						//   ~190 MiB 相当 (現状の ~145 倍)。下の DsqlBackupBudget が ¥10 接近で通知し、
						//   その時点で retention を短縮する (runbook: dsql-restore.md §コスト)。
						scheduleExpression: events.Schedule.cron({ hour: '2', minute: '0' }),
						deleteAfter: cdk.Duration.days(7),
						backupVault: backupVault,
					}),
				],
			});
			// backup / restore を AWS Backup が assume する role を**明示 provision** する (#3437 F-4)。
			// CDK 自動生成 role は backup 権限のみで restore 権限を持たず、`AWSBackupDefaultServiceRole`
			// は console 初回操作でしか作られない (IaC 環境では未 provision の可能性)。両 managed policy を
			// 付けた named role を CDK で確定生成し、backup selection と restore job (runbook §2 の
			// --iam-role-arn) の双方で同一 role を使う (role 不整合による復元失敗を防止)。
			const backupRole = new iam.Role(this, 'DsqlBackupRole', {
				roleName: `ganbari-quest-dsql${nameSuffix}-backup-role`,
				assumedBy: new iam.ServicePrincipal('backup.amazonaws.com'),
				description: 'AWS Backup が DSQL cluster の backup / restore を実行する role (#3437)',
				managedPolicies: [
					iam.ManagedPolicy.fromAwsManagedPolicyName(
						'service-role/AWSBackupServiceRolePolicyForBackup',
					),
					iam.ManagedPolicy.fromAwsManagedPolicyName(
						'service-role/AWSBackupServiceRolePolicyForRestores',
					),
				],
			});
			backupPlan.addSelection('DsqlCluster', {
				resources: [backup.BackupResource.fromArn(this.cluster.attrResourceArn)],
				role: backupRole,
			});

			// backup ジョブ失敗の検知 (#3437 F-2 / ADR-0024 (d): silent fail 防止)。AWS Backup は
			// DSQL の唯一の DR 手段のため、日次 backup が毎晩 silent fail しても誰も気づかない =
			// EPIC #3424 が塞いだはずの DR 空白の再現。EventBridge で Backup Job State Change の
			// 失敗系 (FAILED / ABORTED / EXPIRED) を捕捉し、上で無条件生成済の DsqlAlerts SNS topic
			// へ通知する (コスト guardrail の DsqlBackupBudget はコスト検知でありジョブ失敗検知ではない)。
			// topic は opsEmail 未指定でも存在するため silent skip しない (ADR-0024 ルール 1)。opsEmail
			// 未注入時は email subscription なし = メール未達だが rule / topic は provision される
			// (staging は本 backup ブロック自体に入らないため対象外)。vault 名で scope し、同一
			// アカウントの無関係 backup 失敗を拾わない。
			new events.Rule(this, 'DsqlBackupJobFailed', {
				ruleName: `ganbari-quest-dsql${nameSuffix}-backup-failed`,
				description:
					'AWS Backup ジョブ失敗 (FAILED/ABORTED/EXPIRED) を検知し DsqlAlerts へ通知 (#3437 / ADR-0024 (d)) 一次対応: docs/runbooks/dsql-restore.md',
				eventPattern: {
					source: ['aws.backup'],
					detailType: ['Backup Job State Change'],
					detail: {
						state: ['FAILED', 'ABORTED', 'EXPIRED'],
						backupVaultName: [backupVault.backupVaultName],
					},
				},
				targets: [new eventsTargets.SnsTopic(topic)],
			});

			// restore job (runbook §2 の start-restore-job --iam-role-arn) が使う role ARN を配布。
			new cdk.CfnOutput(this, 'BackupRoleArn', {
				value: backupRole.roleArn,
				description: 'AWS Backup backup/restore role ARN (dsql-restore.md の --iam-role-arn)',
			});

			// 月額 backup コストを ¥10 未満に保つ guardrail (マネタイズ整合)。AWS Backup storage は
			// DSQL の RDS budget (上記 $1) と別 attribution ('Backup' service) になり得るため専用 budget を
			// 置き、$0.07 (≈¥10) の 80%/100% で通知する (接近したら retention 短縮 → dsql-restore.md)。
			if (props?.opsEmail) {
				new budgets.CfnBudget(this, 'DsqlBackupBudget', {
					budget: {
						budgetName: `ganbari-quest-dsql${nameSuffix}-backup-guardrail`,
						budgetType: 'COST',
						timeUnit: 'MONTHLY',
						// $0.07 ≈ ¥10 (¥150/$ 換算)。設計目標「月額 < ¥10」の hard 上限監視。
						budgetLimit: { amount: 0.07, unit: 'USD' },
						costFilters: { Service: ['AWS Backup'] },
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
		}

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
