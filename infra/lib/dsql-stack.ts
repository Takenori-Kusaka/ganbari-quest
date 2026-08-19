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
import { assetsBucketArn, PROD_ENV_CONFIG } from './env-config';

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
				// NOTE: IAM Role description は AWS 制約により ASCII/Latin-1 (U+00FF 以下) のみ許容。
				// 日本語を入れると deploy 時 InvalidRequest → CREATE_FAILED → stack rollback になる (#3870)。
				description:
					'AWS Backup role for DSQL cluster and S3 assets backup / restore (#3437 / #4724)',
				managedPolicies: [
					iam.ManagedPolicy.fromAwsManagedPolicyName(
						'service-role/AWSBackupServiceRolePolicyForBackup',
					),
					iam.ManagedPolicy.fromAwsManagedPolicyName(
						'service-role/AWSBackupServiceRolePolicyForRestores',
					),
					// #4724: S3 backup / restore は上の 2 本では認可されない (AWS Backup の S3 対応は
					// 専用の managed policy を要求する)。付けないと backup job が AccessDenied で
					// 失敗し続ける — 下の DsqlBackupJobFailed rule で気付けるが、そもそも取れていない。
					iam.ManagedPolicy.fromAwsManagedPolicyName(
						'service-role/AWSBackupServiceRolePolicyForS3Backup',
					),
					iam.ManagedPolicy.fromAwsManagedPolicyName(
						'service-role/AWSBackupServiceRolePolicyForS3Restore',
					),
				],
			});
			backupPlan.addSelection('DsqlCluster', {
				resources: [backup.BackupResource.fromArn(this.cluster.attrResourceArn)],
				role: backupRole,
			});

			// #4724: 顧客がアップロードした**子供の写真・声**を保護対象に入れる。
			//
			// これらは S3 `ganbari-quest-assets-<account>` の `tenants/<tenantId>/` 配下にあり、
			// #3437 時点の selection は DSQL cluster だけだったため **S3 は保護対象外**だった。
			// 退会処理の `deleteByPrefix(tenants/<tenantId>/)` が prefix 単位で消すため、
			// tenantId や猶予判定を誤れば写真と録音は失われる。「DSQL だけ復元できて写真が戻らない」
			// 復元は顧客にとって復元ではない (#4580 G7)。
			//
			// 同じ plan / 同じ vault に載せるのが要点:
			//   - vault が同じなので、下の DsqlBackupJobFailed rule (vault 名で scope) が
			//     S3 backup job の失敗もそのまま拾う (新しい通知経路を作らない)
			//   - retention も DSQL と同じ 7 日。片方だけ長いと復元時点が揃わない
			//
			// **選択はバケット単位である** — AWS Backup for S3 は prefix filter を持たない。
			// このバケットには顧客ファイル (`tenants/` / `exports/`) のほかに Firehose が書く
			// ログ archive (`logs/`) が同居する。ログは lifecycle `archive-logs-to-glacier` で
			// 1 日後に Glacier へ落ち、**AWS Backup for S3 は Glacier 系ストレージクラスを
			// 対象にしない**ため、定常状態で backup 対象になるのは顧客ファイル + 直近 1 日分の
			// ログに留まる。
			//
			// この前提が崩れた場合 (ログ量の急増 / lifecycle の変更) は
			// **下の DsqlBackupBudget ($0.07 ≈ ¥10) が鳴る**。budget は DSQL 単体を前提に
			// 引いた値のままにしてあり、S3 を足したことで前提が崩れたなら気付ける側に倒れる
			// (上限を先に緩めると、崩れたことを誰も知らないまま課金だけ増える)。
			//
			// **前提条件は 2 つある。どちらも CDK では表現できないので runbook / deploy 手順で確認する:**
			//   1. バケットのバージョニングが有効 (AWS Backup for S3 の要件)。
			//      StorageStack が `versioned: true` で作る (#4724)。順序上 Storage を先に deploy する
			//   2. **リージョンの Service opt-in で S3 が有効**
			//      (`aws backup describe-region-settings --region us-east-1` の
			//       ResourceTypeOptInPreference.S3 が true)。false のままだと selection は作成できても
			//      backup job が走らず、**失敗すらせず単に何も取れない** = 一番気付けない壊れ方になる。
			//      有効化: `aws backup update-region-settings --resource-type-opt-in-preference S3=true`
			//      (手順 SSOT: docs/runbooks/dsql-restore.md §S3 assets)
			//
			// バケット名は env-config の `assetsBucketArn()` を両 stack が共有し、
			// cross-stack export を増やさない。
			// prod のみ (この block 自体が `!isStaging` 配下、staging の assets は使い捨て)。
			backupPlan.addSelection('AssetsBucket', {
				resources: [
					backup.BackupResource.fromArn(
						assetsBucketArn(PROD_ENV_CONFIG.resourcePrefix, this.account),
					),
				],
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
					'AWS Backup ジョブ失敗 (FAILED/ABORTED/EXPIRED/PARTIAL) を検知し DsqlAlerts へ通知 (#3437 / #4724 / ADR-0024 (d)) 一次対応: docs/runbooks/dsql-restore.md',
				eventPattern: {
					source: ['aws.backup'],
					detailType: ['Backup Job State Change'],
					detail: {
						// #4724: `PARTIAL` を足す。S3 backup は一部オブジェクトだけ失敗しても
						// job 全体は FAILED にならず PARTIAL で終わる — 3 値のままだと
						// 「毎晩走っているが写真が入っていない」が通知ゼロで成立してしまう。
						state: ['FAILED', 'ABORTED', 'EXPIRED', 'PARTIAL'],
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
