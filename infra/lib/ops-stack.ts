import * as path from 'node:path';
import * as cdk from 'aws-cdk-lib';
import * as budgets from 'aws-cdk-lib/aws-budgets';
import type * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as cw_actions from 'aws-cdk-lib/aws-cloudwatch-actions';
import * as events from 'aws-cdk-lib/aws-events';
import * as events_targets from 'aws-cdk-lib/aws-events-targets';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambdaNode from 'aws-cdk-lib/aws-lambda-nodejs';
import * as logs from 'aws-cdk-lib/aws-logs';
import type * as s3 from 'aws-cdk-lib/aws-s3';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as subscriptions from 'aws-cdk-lib/aws-sns-subscriptions';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import type { Construct } from 'constructs';

export interface OpsStackProps extends cdk.StackProps {
	lambdaFn: lambda.Function;
	distribution: cloudfront.Distribution;
	/**
	 * #1214: health-check Lambda が叩くターゲット URL を Function URL に直結するため。
	 * CloudFront 経由だと geoRestriction('JP') で us-east-1 Lambda からは 403 になる。
	 */
	functionUrl: lambda.FunctionUrl;
	/**
	 * #1376 AC6: cron dispatcher Lambda のエラーを CloudWatch Alarm で通知するため。
	 */
	cronDispatcherFn?: lambda.Function;
	/**
	 * #3402-1: staticAssetsS3Offload=true 時のみ生成される immutable アセット S3 origin bucket。
	 * 指定時のみ S3 origin 専用 4xx/5xx alarm を作成する (offload OFF = undefined = alarm も cost も無し)。
	 */
	staticAssetsBucket?: s3.Bucket;
	/**
	 * #3998: アプリ Lambda の LogGroup (ComputeStack が生成)。
	 * 指定時のみ log 由来 MetricFilter + Alarm を作成する (未指定 = 監視 cost ゼロ)。
	 */
	appLogGroup?: logs.ILogGroup;
	opsEmail?: string;
	discordWebhookHealth?: string;
	/**
	 * #4189: CloudWatch アラームの転送先 Discord webhook。
	 * 空だと転送 Lambda が error log を残す（deploy 側の gate で空を落とす）。
	 */
	discordWebhookIncident?: string;
}

/**
 * #3998: entitlement fail-closed が 503 として表面化したことを表す log の検索語。
 *
 * SSOT は `TenantEntitlementUnavailableError.ALERT_KIND`
 * (`src/lib/server/auth/tenant-entitlement.ts`) と `src/hooks.server.ts` の
 * `[auth-alert] ${kind}` prefix。CDK の tsconfig rootDir は infra/ 固定でアプリ側 src を
 * import できないため literal で持つが、
 * `tests/unit/infra/entitlement-fail-closed-alarm.test.ts` が両者の drift を機械検証する
 * (CRON_JOBS ↔ schedule-registry と同じ構図)。
 */
export const ENTITLEMENT_FAIL_CLOSED_LOG_TERM = '[auth-alert] auth-entitlement-db-unavailable';

/**
 * #4363 T4: `/ops` へのアクセス拒否を数えるための log 用語 (SSOT)。
 *
 * `docs/design/14-セキュリティ設計書.md` §5.2.9 の再評価トリガー T4 は
 * 「ops アカウントの認証失敗・不審ログインを 1 件でも観測したら MFA を戻す」だが、
 * **その観測をする経路が無かった** (#4368 merge 時点)。MFA 要求を外した現在、
 * `/ops` の防御は Cognito 認証 + ops group 所属の 2 つだけであり、
 * 対象は全顧客の売上・コホート・コスト・PL である。
 *
 * `requireOpsAccess()` が拒否したときにこの用語を含む log を 1 行出し、
 * ここで metric 化する。**値は載せない** — 誰が / どの identity かは
 * 一切含めず「拒否が起きた」ことだけを数える (`alert.ts` の既存規約と同じ)。
 */
export const OPS_ACCESS_DENIED_LOG_TERM = '[auth-alert] ops-access-denied';

/**
 * #4327: 顧客データの物理削除 (grace-period-deletion cron) が**部分的に失敗**したことを表す
 * log の検索語。
 *
 * SSOT は `GRACE_PERIOD_PARTIAL_FAILURE_LOG_TERM`
 * (`src/lib/server/services/grace-period-service.ts`)。上記 entitlement 版と同じく rootDir
 * 制約で import できないため literal で持ち、
 * `tests/unit/infra/grace-period-deletion-safety.test.ts` が drift を機械検証する。
 *
 * この失敗は「途中まで消えたテナント」を意味し、放置すると顧客データが中途半端な状態で
 * 残り続ける。dispatcher の Errors metric (endpoint が 500 を返すため発火する) だけでは
 * どの cron が失敗したのか分からないため、専用の metric で切り分け可能にする。
 */
export const GRACE_PERIOD_PARTIAL_FAILURE_LOG_TERM = '[grace-period-deletion] partial failure';

/**
 * #4375 follow-up (オーナー決裁 2026-08-07): AI provider が使えない状態にあることを表す log の検索語。
 *
 * SSOT は `AI_PROVIDER_UNAVAILABLE_LOG_TERM` (`src/lib/server/ai/availability.ts`)。
 * 上記 2 件と同じく rootDir 制約で import できないため literal で持ち、
 * `tests/unit/infra/ai-provider-unavailable-alarm.test.ts` が drift を機械検証する。
 *
 * AI が使えない間、顧客は領収書の手入力に落ちる (有料機能が事実上死んでいる)。この経路が
 * 無いと運営はそれに気付けない — #4366 merge 時点は log を 1 行も出さない完全な silent だった。
 * log には理由の分類 (`not-configured` / `latched`) しか載せない — 識別子や例外本文は載せない。
 */
export const AI_PROVIDER_UNAVAILABLE_LOG_TERM = '[ai-alert] ai-provider-unavailable';

export class OpsStack extends cdk.Stack {
	constructor(scope: Construct, id: string, props: OpsStackProps) {
		super(scope, id, props);

		const opsEmail = props.opsEmail ?? (this.node.tryGetContext('opsEmail') as string | undefined);

		// ================================================================
		// 1. SNS Topic — all alarms send here
		// ================================================================
		const opsTopic = new sns.Topic(this, 'OpsAlerts', {
			topicName: 'ganbari-quest-ops-alerts',
			displayName: 'がんばりクエスト 運用通知',
		});

		// #4189 (オーナー決裁 2026-08-03、案 B): 宛先は **Discord に寄せる**。メール
		// subscription は張らない。転送は下記 OpsAlertForwarder が担い、alarm ごとに
		// 出す / 出さないを `ops-alert-policy.ts` で判定する（既定は出さない）。
		//
		// `opsEmail` は DsqlStack の Budget 通知（EMAIL 固定の AWS 仕様）でまだ使うため
		// props 自体は残すが、**本 topic には subscribe しない**。
		void opsEmail;

		const discordWebhookIncident =
			props.discordWebhookIncident ??
			(this.node.tryGetContext('discordWebhookIncident') as string | undefined) ??
			'';

		const opsAlertForwarderLogGroup = new logs.LogGroup(this, 'OpsAlertForwarderLogGroup', {
			logGroupName: '/aws/lambda/ganbari-quest-ops-alert-forwarder',
			retention: logs.RetentionDays.TWO_WEEKS,
			removalPolicy: cdk.RemovalPolicy.DESTROY,
		});

		const opsAlertForwarder = new lambdaNode.NodejsFunction(this, 'OpsAlertForwarder', {
			functionName: 'ganbari-quest-ops-alert-forwarder',
			entry: path.join(__dirname, '..', 'lambda', 'ops-alert-forwarder', 'index.ts'),
			handler: 'handler',
			runtime: lambda.Runtime.NODEJS_22_X,
			architecture: lambda.Architecture.ARM_64,
			memorySize: 128,
			timeout: cdk.Duration.seconds(15),
			environment: {
				// 未設定なら Lambda 側が error log を残す (silent skip しない、ADR-0024 ルール 1)。
				// deploy 側は `.github/workflows/deploy.yml` が空を検出して落とす。
				...(discordWebhookIncident ? { DISCORD_WEBHOOK_INCIDENT: discordWebhookIncident } : {}),
			},
			bundling: { minify: true, sourceMap: false },
		});
		opsAlertForwarder.node.addDependency(opsAlertForwarderLogGroup);

		opsTopic.addSubscription(new subscriptions.LambdaSubscription(opsAlertForwarder));

		const alarmAction = new cw_actions.SnsAction(opsTopic);

		// ================================================================
		// 2. CloudWatch Alarms (9 of 10 free-tier basic alarms)
		// ================================================================

		// P0: Lambda Errors
		const lambdaErrors = props.lambdaFn
			.metricErrors({ period: cdk.Duration.minutes(5) })
			.createAlarm(this, 'LambdaErrors', {
				alarmName: 'ganbari-quest-lambda-errors',
				alarmDescription: 'Lambda エラー: 5分間に3回以上',
				threshold: 3,
				evaluationPeriods: 1,
				comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
			});
		lambdaErrors.addAlarmAction(alarmAction);
		lambdaErrors.addOkAction(alarmAction);

		// P0: Lambda Throttles
		const lambdaThrottles = props.lambdaFn
			.metricThrottles({ period: cdk.Duration.minutes(5) })
			.createAlarm(this, 'LambdaThrottles', {
				alarmName: 'ganbari-quest-lambda-throttles',
				alarmDescription: 'Lambda スロットリング: 5分間に1回以上',
				threshold: 1,
				evaluationPeriods: 1,
				comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
			});
		lambdaThrottles.addAlarmAction(alarmAction);

		// P1: Lambda Duration (P99 > 10s)
		const lambdaDuration = new cloudwatch.Alarm(this, 'LambdaDuration', {
			alarmName: 'ganbari-quest-lambda-duration-p99',
			alarmDescription: 'Lambda レイテンシ P99 > 10秒',
			metric: props.lambdaFn.metricDuration({
				period: cdk.Duration.minutes(5),
				statistic: 'p99',
			}),
			threshold: 10_000,
			evaluationPeriods: 1,
			comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
		});
		lambdaDuration.addAlarmAction(alarmAction);

		// P1: Lambda Concurrent Executions
		const lambdaConcurrency = new cloudwatch.Alarm(this, 'LambdaConcurrentExec', {
			alarmName: 'ganbari-quest-lambda-concurrent',
			alarmDescription: 'Lambda 同時実行数 > 50',
			metric: props.lambdaFn.metric('ConcurrentExecutions', {
				period: cdk.Duration.minutes(1),
				statistic: 'Maximum',
			}),
			threshold: 50,
			evaluationPeriods: 1,
			comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
		});
		lambdaConcurrency.addAlarmAction(alarmAction);

		// #3438 (EPIC #3424): DynamoDB alarms (Throttles / SystemErrors / ConsumedCapacity) を撤去。
		// DB backend は Aurora DSQL に一本化済で DynamoDB table は存在しない (metric の TableName が
		// 指す table が無く常時 empty)。DSQL の監視は DsqlStack が担う。

		// P0: Lambda Function URL 5xx (used as API Gateway proxy)
		const lambdaUrl5xx = new cloudwatch.Alarm(this, 'LambdaUrl5xx', {
			alarmName: 'ganbari-quest-lambda-url-5xx',
			alarmDescription: 'Lambda Function URL 5xx: 5分間に5回以上',
			metric: new cloudwatch.Metric({
				namespace: 'AWS/Lambda',
				metricName: 'Url5xxCount',
				dimensionsMap: { FunctionName: props.lambdaFn.functionName },
				period: cdk.Duration.minutes(5),
				statistic: 'Sum',
			}),
			threshold: 5,
			evaluationPeriods: 1,
			comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
		});
		lambdaUrl5xx.addAlarmAction(alarmAction);
		lambdaUrl5xx.addOkAction(alarmAction);

		// P1: Lambda Function URL 4xx spike
		const lambdaUrl4xx = new cloudwatch.Alarm(this, 'LambdaUrl4xx', {
			alarmName: 'ganbari-quest-lambda-url-4xx-spike',
			alarmDescription: 'Lambda Function URL 4xx スパイク: 5分間に50回以上',
			metric: new cloudwatch.Metric({
				namespace: 'AWS/Lambda',
				metricName: 'Url4xxCount',
				dimensionsMap: { FunctionName: props.lambdaFn.functionName },
				period: cdk.Duration.minutes(5),
				statistic: 'Sum',
			}),
			threshold: 50,
			evaluationPeriods: 1,
			comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
		});
		lambdaUrl4xx.addAlarmAction(alarmAction);

		// P0: CloudFront 5xx Error Rate (> 5%)
		const cf5xx = new cloudwatch.Alarm(this, 'CloudFront5xx', {
			alarmName: 'ganbari-quest-cloudfront-5xx',
			alarmDescription: 'CloudFront 5xxエラー率 > 5%',
			metric: new cloudwatch.Metric({
				namespace: 'AWS/CloudFront',
				metricName: '5xxErrorRate',
				dimensionsMap: {
					DistributionId: props.distribution.distributionId,
					Region: 'Global',
				},
				period: cdk.Duration.minutes(5),
				statistic: 'Average',
			}),
			threshold: 5,
			evaluationPeriods: 1,
			comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
		});
		cf5xx.addAlarmAction(alarmAction);
		cf5xx.addOkAction(alarmAction);

		// P0: entitlement 解決 fail-closed (#3998)
		//
		// #3963 で `resolveContext` は課金状態を毎リクエスト DB から引くようになり、解決に
		// 失敗したら context を発行しない (fail-closed)。この副作用として DB 障害中は有効な
		// Cookie を持つユーザーが軒並み 503 になる。PO はこの trade-off を承認したが、
		// **承認の前提は「起きたら気付けること」**である。
		//
		// 既存 alarm では拾えない:
		//   - Lambda Errors …… hooks.server.ts が例外を握って 503 Response を返すため invocation error にならない
		//   - Url5xx ………… 拾える可能性はあるが「DB 由来の権限剥奪」と他の 5xx を区別できず、
		//                     原因の切り分け (= incident 対応の最初の分岐) ができない
		//   - Url4xx spike … 3xx / 4xx ではないため乗らない
		// そのため log 本文を唯一の情報源として MetricFilter で metric 化する。
		if (props.appLogGroup) {
			const entitlementFailClosed = new logs.MetricFilter(this, 'EntitlementFailClosedFilter', {
				logGroup: props.appLogGroup,
				filterPattern: logs.FilterPattern.literal(`"${ENTITLEMENT_FAIL_CLOSED_LOG_TERM}"`),
				metricNamespace: 'GanbariQuest/Auth',
				metricName: 'EntitlementDbUnavailable',
				metricValue: '1',
				defaultValue: 0,
			});

			// 閾値の根拠 (#3998 AC3):
			//   1 件 = 1 リクエストが 503 になった、という単位になるように filter は
			//   hooks.server.ts の 503 応答 1 行だけを数える (DB 解決失敗そのものの log 行は
			//   `auth-entitlement-db-unavailable` で Logs Insights から追えるが metric には数えない)。
			//
			//   **一過性かどうかは「件数」ではなく「継続時間」で判定する**。
			//   件数で引く (例: 5 分 5 件) と、契約世帯が数戸という現在の規模では夜間・早朝の障害中に
			//   閾値へ到達せず、全員が終夜 503 のまま誰も気付けない (既存 lambda-url-5xx と粒度を
			//   揃えたくなるが、あちらはトラフィック量に比例する metric、こちらは 1 件出た時点で
			//   「DB が読めていない」を意味する全ユーザー同時被弾型で、性質が異なる)。
			//   そこで 1 件を閾値としつつ、15 分 (5 分 × 3) のうち 2 window で発生したときに鳴らす。
			//   DSQL の OCC 競合 / 瞬断による単発失敗は 1 window で収まるため鳴らず、
			//   5 分以上継続する障害は低トラフィックでも捕捉できる。
			//   metric は該当 log が無い間データ点を持たないため treatMissingData=NOT_BREACHING。
			const entitlementFailClosedAlarm = new cloudwatch.Alarm(this, 'EntitlementFailClosed', {
				alarmName: 'ganbari-quest-auth-entitlement-db-unavailable',
				alarmDescription:
					'課金状態を DB から解決できず 503 になったリクエスト: 15分内の2つの5分window で発生 (#3998 fail-closed)',
				metric: entitlementFailClosed.metric({
					period: cdk.Duration.minutes(5),
					statistic: 'Sum',
				}),
				threshold: 1,
				evaluationPeriods: 3,
				datapointsToAlarm: 2,
				comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
				treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
			});
			entitlementFailClosedAlarm.addAlarmAction(alarmAction);
			entitlementFailClosedAlarm.addOkAction(alarmAction);

			// #4363 T4: `/ops` アクセス拒否の観測。
			//
			// 設計書 §5.2.9 の T4 は「認証失敗・不審ログインを 1 件でも観測したら MFA を戻す」
			// だが、#4368 で MFA 要求を外した時点では **観測経路そのものが無かった**。
			// トリガーは発火しようが無く、記載だけが残る状態だった。
			//
			// 閾値の根拠:
			//   `/ops` は運営者しか触らない画面で、正常運用では拒否は起きない。
			//   1 件でも「入れない誰か」が居ることは、パスワード試行か group 設定の
			//   取り違えのどちらかを意味する。どちらも T4 が想定する「実害の兆候」である。
			//   そこで entitlement fail-closed と同じ形 (5 分 window / 1 件閾値) を使うが、
			//   **datapointsToAlarm は 1** にする — あちらは「継続したら障害」だが、
			//   こちらは単発でも見に行く価値がある (誤検知しても運営者 1 人が確認するだけ)。
			const opsAccessDenied = new logs.MetricFilter(this, 'OpsAccessDeniedFilter', {
				logGroup: props.appLogGroup,
				filterPattern: logs.FilterPattern.literal(`"${OPS_ACCESS_DENIED_LOG_TERM}"`),
				metricNamespace: 'GanbariQuest/Auth',
				metricName: 'OpsAccessDenied',
				metricValue: '1',
				defaultValue: 0,
			});

			const opsAccessDeniedAlarm = new cloudwatch.Alarm(this, 'OpsAccessDenied', {
				alarmName: 'ganbari-quest-ops-access-denied',
				alarmDescription:
					'/ops へのアクセスが拒否された: 5分内に1件以上 (#4363 T4 再評価トリガーの観測経路)',
				metric: opsAccessDenied.metric({
					period: cdk.Duration.minutes(5),
					statistic: 'Sum',
				}),
				threshold: 1,
				evaluationPeriods: 1,
				datapointsToAlarm: 1,
				comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
				treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
			});
			opsAccessDeniedAlarm.addAlarmAction(alarmAction);
			opsAccessDeniedAlarm.addOkAction(alarmAction);

			// #4375 follow-up: AI provider が使えない状態の観測。
			//
			// 顧客には「写真ではなくシステム側の不具合で、運営が検知済み」と出す。その「検知済み」を
			// 事実にするのがこの経路で、Discord の障害通知まで届く (オーナー決裁 2026-08-07)。
			//
			// 閾値の根拠:
			//   この log は **プロセス内で理由ごとに 1 回**しか出ない (per-request で出すと
			//   本物の異常が埋もれるため、#4366 害 c)。つまり「障害が続くほど件数が増える」
			//   metric ではなく、Lambda コンテナが新しく立つたびに 1 件出るだけの疎な系列になる。
			//   そのため entitlement fail-closed 側の「15 分のうち 2 window で継続」型は使えない
			//   (低トラフィック時は 2 window 埋まらず、終日 AI が死んでいても鳴らない)。
			//   ops-access-denied と同じ **1 件 / 1 window で即発火** (datapointsToAlarm: 1) にする。
			//   1 件 = 少なくとも 1 世帯が「AI 読み取りが使えない」画面を見た状態であり、
			//   単発でも見に行く価値がある。
			//   誤検知しても運営者 1 人が CloudWatch を確認するだけで済む。
			//   log が無い間はデータ点自体が無いため treatMissingData=NOT_BREACHING。
			const aiProviderUnavailable = new logs.MetricFilter(this, 'AiProviderUnavailableFilter', {
				logGroup: props.appLogGroup,
				filterPattern: logs.FilterPattern.literal(`"${AI_PROVIDER_UNAVAILABLE_LOG_TERM}"`),
				metricNamespace: 'GanbariQuest/Ai',
				metricName: 'AiProviderUnavailable',
				metricValue: '1',
				defaultValue: 0,
			});

			const aiProviderUnavailableAlarm = new cloudwatch.Alarm(this, 'AiProviderUnavailable', {
				alarmName: 'ganbari-quest-ai-provider-unavailable',
				alarmDescription:
					'AI provider が使えない状態 (未設定 / 権限なし / キー不正): 5分内に1件以上。顧客は領収書の手入力に落ちている',
				metric: aiProviderUnavailable.metric({
					period: cdk.Duration.minutes(5),
					statistic: 'Sum',
				}),
				threshold: 1,
				evaluationPeriods: 1,
				datapointsToAlarm: 1,
				comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
				treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
			});
			aiProviderUnavailableAlarm.addAlarmAction(alarmAction);
			// **OK action は付けない。** この信号からは復旧を推定できないため。
			// log は latch により理由ごとにプロセス内 1 回しか出ない疎な系列で、AI が終日
			// 死んだままでも 2 window 目以降はデータ点が無い。treatMissingData=NOT_BREACHING と
			// 合わさると alarm は自動的に OK へ戻るので、OK action を付ければ「復旧しました」に
			// 等しい通知が Discord に飛ぶ。運営は直ったと誤認して手を止め、顧客は使えないまま
			// 放置される (沈黙より悪い)。しかも顧客には「運営が検知済み」と表示しているため、
			// その約束を自ら裏切ることになる。
			// 復旧を鳴らしたいなら、OK 遷移を流用せず **復旧を表す信号** (例: AI 呼び出しの
			// 成功 metric) を作って別 alarm にすること。
			// 固定: tests/unit/infra/ai-provider-unavailable-alarm.test.ts [A2b]

			// P0: 顧客データ物理削除の部分失敗 (#4327)
			//
			// grace-period-deletion cron は「消したら戻せない」処理を 1 日 1 回走らせる。
			// 部分失敗 (tenantsFailed > 0) は「途中まで消えたテナント」が生まれた合図であり、
			// 気付くのが遅れるほど回復の選択肢が減る (単一テナントの復旧手段は無い —
			// docs/runbooks/grace-period-deletion-operations.md §復旧の限界)。
			//
			// endpoint が 500 を返すため dispatcher の Errors metric にも乗るが、
			// あちらは「どれかの cron が失敗した」までしか分からない。切り分けのために
			// log 本文を情報源とする専用 metric を持つ。
			//
			// 閾値: 1 件で即発火。cron は 1 日 1 回のためデータ点が密には出ず、
			// 「複数 window で継続」を待つと丸 1 日以上気付けない。log が無い間は
			// データ点自体が無いため treatMissingData=NOT_BREACHING。
			const gracePeriodPartialFailure = new logs.MetricFilter(
				this,
				'GracePeriodPartialFailureFilter',
				{
					logGroup: props.appLogGroup,
					filterPattern: logs.FilterPattern.literal(`"${GRACE_PERIOD_PARTIAL_FAILURE_LOG_TERM}"`),
					metricNamespace: 'GanbariQuest/Deletion',
					metricName: 'GracePeriodPartialFailure',
					metricValue: '1',
					defaultValue: 0,
				},
			);

			const gracePeriodPartialFailureAlarm = new cloudwatch.Alarm(
				this,
				'GracePeriodPartialFailure',
				{
					alarmName: 'ganbari-quest-grace-period-partial-failure',
					alarmDescription:
						'顧客データの物理削除が途中で失敗した (途中まで消えたテナントが存在する可能性) (#4327)',
					metric: gracePeriodPartialFailure.metric({
						period: cdk.Duration.hours(1),
						statistic: 'Sum',
					}),
					threshold: 1,
					evaluationPeriods: 1,
					datapointsToAlarm: 1,
					comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
					treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
				},
			);
			gracePeriodPartialFailureAlarm.addAlarmAction(alarmAction);
			gracePeriodPartialFailureAlarm.addOkAction(alarmAction);
		}

		// P0: Cron Dispatcher Lambda Errors (#1376 AC6)
		// CronDispatcherFn が prop として渡された場合のみアラームを作成する（最小構成）
		if (props.cronDispatcherFn) {
			const cronDispatcherErrors = props.cronDispatcherFn
				.metricErrors({ period: cdk.Duration.minutes(5) })
				.createAlarm(this, 'CronDispatcherErrors', {
					alarmName: 'ganbari-quest-cron-dispatcher-errors',
					alarmDescription: 'Cron Dispatcher Lambda エラー: 5分間に1回以上 (#1376)',
					threshold: 1,
					evaluationPeriods: 1,
					comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
				});
			cronDispatcherErrors.addAlarmAction(alarmAction);
			cronDispatcherErrors.addOkAction(alarmAction);
		}

		// P1: 静的アセット S3 origin 4xx/5xx (#3402-1, ADR-0024 ルール D)
		// staticAssetsS3Offload=true で /_app/immutable/* を S3(OAC) から配信するとき、部分 upload 失敗 /
		// OAC 誤設定で S3 が 4xx/5xx を返し、親画面 JS チャンクが欠落して白画面化しうる。既存の
		// distribution-level CloudFront5xx alarm は S3 origin の 4xx (403/404) を捉えられないため、S3
		// request metrics (AWS/S3 4xxErrors/5xxErrors) を直接監視して misconfig を継続検知する
		// (deploy 後の post-deploy smoke を transitive にしか検出しない gap を埋める)。bucket が渡された
		// とき (= offload 有効時) のみ作成し、offload OFF では alarm も監視 cost も発生させない。
		if (props.staticAssetsBucket) {
			const s3OriginDims = {
				BucketName: props.staticAssetsBucket.bucketName,
				FilterId: 'EntireBucket',
			};
			const staticS3_4xx = new cloudwatch.Alarm(this, 'StaticAssetsS3Origin4xx', {
				alarmName: 'ganbari-quest-static-assets-s3-4xx',
				alarmDescription:
					'静的アセット S3 origin 4xx (OAC 誤設定 / 部分 upload 欠落): 5分間に10回以上 (#3402)',
				metric: new cloudwatch.Metric({
					namespace: 'AWS/S3',
					metricName: '4xxErrors',
					dimensionsMap: s3OriginDims,
					period: cdk.Duration.minutes(5),
					statistic: 'Sum',
				}),
				threshold: 10,
				evaluationPeriods: 1,
				comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
				treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
			});
			staticS3_4xx.addAlarmAction(alarmAction);
			staticS3_4xx.addOkAction(alarmAction);

			const staticS3_5xx = new cloudwatch.Alarm(this, 'StaticAssetsS3Origin5xx', {
				alarmName: 'ganbari-quest-static-assets-s3-5xx',
				alarmDescription: '静的アセット S3 origin 5xx (S3 障害): 5分間に5回以上 (#3402)',
				metric: new cloudwatch.Metric({
					namespace: 'AWS/S3',
					metricName: '5xxErrors',
					dimensionsMap: s3OriginDims,
					period: cdk.Duration.minutes(5),
					statistic: 'Sum',
				}),
				threshold: 5,
				evaluationPeriods: 1,
				comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
				treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
			});
			staticS3_5xx.addAlarmAction(alarmAction);
			staticS3_5xx.addOkAction(alarmAction);
		}

		// ================================================================
		// 3. CloudWatch Dashboard
		// ================================================================
		new cloudwatch.Dashboard(this, 'OpsDashboard', {
			dashboardName: 'ganbari-quest-ops',
			widgets: [
				[
					new cloudwatch.GraphWidget({
						title: 'Lambda — Invocations & Errors',
						left: [
							props.lambdaFn.metricInvocations({ period: cdk.Duration.minutes(5) }),
							props.lambdaFn.metricErrors({ period: cdk.Duration.minutes(5) }),
						],
						width: 12,
					}),
					new cloudwatch.GraphWidget({
						title: 'Lambda — Duration (p50/p99)',
						left: [
							props.lambdaFn.metricDuration({
								period: cdk.Duration.minutes(5),
								statistic: 'p50',
								label: 'p50',
							}),
							props.lambdaFn.metricDuration({
								period: cdk.Duration.minutes(5),
								statistic: 'p99',
								label: 'p99',
							}),
						],
						width: 12,
					}),
				],
				[
					new cloudwatch.GraphWidget({
						title: 'Lambda — Throttles & Concurrent',
						left: [
							props.lambdaFn.metricThrottles({ period: cdk.Duration.minutes(5) }),
							props.lambdaFn.metric('ConcurrentExecutions', {
								period: cdk.Duration.minutes(5),
								statistic: 'Maximum',
							}),
						],
						width: 12,
					}),
				],
				[
					new cloudwatch.SingleValueWidget({
						title: 'Alarm Status',
						// #3438: DynamoDB — Read/Write Capacity widget + dynamoSystemErrors metric を撤去
						// (DB backend は DSQL に一本化、DynamoDB table 無し)。
						metrics: [lambdaErrors.metric, lambdaUrl5xx.metric],
						width: 24,
					}),
				],
			],
		});

		// ================================================================
		// 4. AWS Budgets — $5/month with 3-tier alerts
		// ================================================================
		new budgets.CfnBudget(this, 'MonthlyBudget', {
			budget: {
				budgetName: 'ganbari-quest-monthly',
				budgetLimit: { amount: 5, unit: 'USD' },
				budgetType: 'COST',
				timeUnit: 'MONTHLY',
			},
			notificationsWithSubscribers: opsEmail
				? [
						{
							notification: {
								comparisonOperator: 'GREATER_THAN',
								notificationType: 'ACTUAL',
								threshold: 50,
								thresholdType: 'PERCENTAGE',
							},
							subscribers: [{ subscriptionType: 'EMAIL', address: opsEmail }],
						},
						{
							notification: {
								comparisonOperator: 'GREATER_THAN',
								notificationType: 'ACTUAL',
								threshold: 80,
								thresholdType: 'PERCENTAGE',
							},
							subscribers: [{ subscriptionType: 'EMAIL', address: opsEmail }],
						},
						{
							notification: {
								comparisonOperator: 'GREATER_THAN',
								notificationType: 'FORECASTED',
								threshold: 100,
								thresholdType: 'PERCENTAGE',
							},
							subscribers: [{ subscriptionType: 'EMAIL', address: opsEmail }],
						},
					]
				: [],
		});

		// 5. Cost Anomaly Detection
		// AWS アカウントのデフォルト "Default-Services-Monitor" を使用
		// （カスタムモニター作成はアカウント上限との競合で AlreadyExists エラーが発生するため削除）

		// ================================================================
		// 6. AWS Health → EventBridge → SNS (AWS障害の自動通知)
		// ================================================================
		new events.Rule(this, 'AwsHealthAlert', {
			ruleName: 'ganbari-quest-aws-health',
			description: 'AWS Health: 使用中サービスの障害・計画メンテナンス通知',
			eventPattern: {
				source: ['aws.health'],
				detailType: ['AWS Health Event'],
				detail: {
					// #3438: DYNAMODB を除去 (DB backend は DSQL に一本化)。
					service: ['LAMBDA', 'CLOUDFRONT', 'COGNITO', 'S3'],
					eventTypeCategory: ['issue', 'scheduledChange'],
				},
			},
			targets: [new events_targets.SnsTopic(opsTopic)],
		});

		// ================================================================
		// 7. External Health Check Prober (#1121)
		// Separate Lambda that pings /api/health every 1 hour.
		// Reports failures/degradation to Discord webhook.
		// ================================================================
		const discordWebhookHealth =
			props.discordWebhookHealth ??
			(this.node.tryGetContext('discordWebhookHealth') as string | undefined) ??
			'';

		const healthCheckLogGroup = new logs.LogGroup(this, 'HealthCheckLogGroup', {
			logGroupName: '/aws/lambda/ganbari-quest-health-check',
			retention: logs.RetentionDays.THREE_DAYS,
			removalPolicy: cdk.RemovalPolicy.DESTROY,
		});

		// #1214: CloudFront は geoRestriction('JP') を掛けているため、us-east-1 Lambda
		// からは常時 403 になる。Function URL (authType: NONE) を直叩きして Lambda/DB の
		// 生存確認に用途を限定する。CloudFront 層の障害は本 Lambda では検知できない
		// （別途 CloudWatch Synthetics 等で補完する方針 — 本 Issue のスコープ外）。
		// #1469: 週次実行統計を保持する SSM パラメータ
		const weeklyStatsParam = new ssm.StringParameter(this, 'HealthCheckWeeklyStats', {
			parameterName: '/ganbari-quest/health-check/weekly-stats',
			stringValue: '{}',
			description: 'Health check Lambda の週次実行統計（ハートビート通知用）',
			tier: ssm.ParameterTier.STANDARD,
		});

		// #1828: AWS Lambda Node.js 20.x EOL (2026-04-30) 対応で 22.x へ migration
		const healthCheckFn = new lambdaNode.NodejsFunction(this, 'HealthCheckFn', {
			functionName: 'ganbari-quest-health-check',
			entry: path.join(__dirname, '..', 'lambda', 'health-check', 'index.ts'),
			handler: 'handler',
			runtime: lambda.Runtime.NODEJS_22_X,
			architecture: lambda.Architecture.ARM_64,
			memorySize: 128,
			timeout: cdk.Duration.seconds(30),
			environment: {
				HEALTH_CHECK_URL: props.functionUrl.url,
				SSM_WEEKLY_STATS_PARAM: weeklyStatsParam.parameterName,
				...(discordWebhookHealth ? { DISCORD_WEBHOOK_HEALTH: discordWebhookHealth } : {}),
			},
			bundling: {
				minify: true,
				sourceMap: false,
			},
		});
		healthCheckFn.node.addDependency(healthCheckLogGroup);

		// #1470: 前回通知ステータス永続化用 SSM パラメータ（初期値 "normal"）
		const lastNotifiedStatusParam = new ssm.StringParameter(this, 'HealthCheckLastNotifiedStatus', {
			parameterName: '/ganbari-quest/health-check/last-notified-status',
			stringValue: 'normal',
			description: 'Health check Lambda が最後に Discord 通知したステータス（復旧通知判定用）',
			tier: ssm.ParameterTier.STANDARD,
		});

		// #1470 + #1469: SSM GetParameter / PutParameter 権限を付与（2 パラメータ）
		healthCheckFn.addToRolePolicy(
			new iam.PolicyStatement({
				actions: ['ssm:GetParameter', 'ssm:PutParameter'],
				resources: [lastNotifiedStatusParam.parameterArn, weeklyStatsParam.parameterArn],
			}),
		);

		// EventBridge Rule: trigger every 1 hour
		new events.Rule(this, 'HealthCheckSchedule', {
			ruleName: 'ganbari-quest-health-check',
			description: 'External health check prober: 1時間ごとに /api/health を確認',
			schedule: events.Schedule.rate(cdk.Duration.hours(1)),
			targets: [new events_targets.LambdaFunction(healthCheckFn)],
		});

		// ================================================================
		// Outputs
		// ================================================================
		new cdk.CfnOutput(this, 'OpsTopicArn', { value: opsTopic.topicArn });
		new cdk.CfnOutput(this, 'DashboardUrl', {
			value: `https://${this.region}.console.aws.amazon.com/cloudwatch/home?region=${this.region}#dashboards:name=ganbari-quest-ops`,
		});
		new cdk.CfnOutput(this, 'HealthCheckFunctionArn', {
			value: healthCheckFn.functionArn,
		});
	}
}
