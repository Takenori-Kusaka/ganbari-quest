import * as path from 'node:path';
import * as cdk from 'aws-cdk-lib';
import * as budgets from 'aws-cdk-lib/aws-budgets';
import type * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as cw_actions from 'aws-cdk-lib/aws-cloudwatch-actions';
import type * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as events from 'aws-cdk-lib/aws-events';
import * as events_targets from 'aws-cdk-lib/aws-events-targets';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambdaNode from 'aws-cdk-lib/aws-lambda-nodejs';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as subscriptions from 'aws-cdk-lib/aws-sns-subscriptions';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import type { Construct } from 'constructs';

export interface OpsStackProps extends cdk.StackProps {
	lambdaFn: lambda.Function;
	table: dynamodb.TableV2;
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
	opsEmail?: string;
	discordWebhookHealth?: string;
}

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

		if (opsEmail) {
			opsTopic.addSubscription(new subscriptions.EmailSubscription(opsEmail));
		}

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

		// P1: DynamoDB Throttled Requests
		const dynamoThrottles = new cloudwatch.Alarm(this, 'DynamoDBThrottles', {
			alarmName: 'ganbari-quest-dynamodb-throttles',
			alarmDescription: 'DynamoDB スロットリング: 5分間に1回以上',
			metric: new cloudwatch.Metric({
				namespace: 'AWS/DynamoDB',
				metricName: 'ThrottledRequests',
				dimensionsMap: { TableName: props.table.tableName! },
				period: cdk.Duration.minutes(5),
				statistic: 'Sum',
			}),
			threshold: 1,
			evaluationPeriods: 1,
			comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
		});
		dynamoThrottles.addAlarmAction(alarmAction);

		// P0: DynamoDB System Errors
		const dynamoSystemErrors = new cloudwatch.Alarm(this, 'DynamoDBSystemErrors', {
			alarmName: 'ganbari-quest-dynamodb-system-errors',
			alarmDescription: 'DynamoDB システムエラー: 5分間に1回以上',
			metric: new cloudwatch.Metric({
				namespace: 'AWS/DynamoDB',
				metricName: 'SystemErrors',
				dimensionsMap: { TableName: props.table.tableName! },
				period: cdk.Duration.minutes(5),
				statistic: 'Sum',
			}),
			threshold: 1,
			evaluationPeriods: 1,
			comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
		});
		dynamoSystemErrors.addAlarmAction(alarmAction);
		dynamoSystemErrors.addOkAction(alarmAction);

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

		// P1: DynamoDB Consumed Capacity (RCU+WCU combined, hourly)
		// 無料枠10アラームの最後の1枠を使用（9→10）
		const dynamoConsumedCapacity = new cloudwatch.Alarm(this, 'DynamoDBConsumedCapacity', {
			alarmName: 'ganbari-quest-dynamodb-consumed-capacity',
			alarmDescription: 'DynamoDB 消費容量（RCU+WCU）が1時間で10,000を超過。クエリループの可能性',
			metric: new cloudwatch.MathExpression({
				expression: 'rcu + wcu',
				usingMetrics: {
					rcu: new cloudwatch.Metric({
						namespace: 'AWS/DynamoDB',
						metricName: 'ConsumedReadCapacityUnits',
						dimensionsMap: { TableName: props.table.tableName! },
						period: cdk.Duration.hours(1),
						statistic: 'Sum',
					}),
					wcu: new cloudwatch.Metric({
						namespace: 'AWS/DynamoDB',
						metricName: 'ConsumedWriteCapacityUnits',
						dimensionsMap: { TableName: props.table.tableName! },
						period: cdk.Duration.hours(1),
						statistic: 'Sum',
					}),
				},
				period: cdk.Duration.hours(1),
			}),
			threshold: 10000,
			evaluationPeriods: 1,
			comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
		});
		dynamoConsumedCapacity.addAlarmAction(alarmAction);

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
					new cloudwatch.GraphWidget({
						title: 'DynamoDB — Read/Write Capacity',
						left: [
							new cloudwatch.Metric({
								namespace: 'AWS/DynamoDB',
								metricName: 'ConsumedReadCapacityUnits',
								dimensionsMap: { TableName: props.table.tableName! },
								period: cdk.Duration.minutes(5),
								statistic: 'Sum',
								label: 'Read CU',
							}),
							new cloudwatch.Metric({
								namespace: 'AWS/DynamoDB',
								metricName: 'ConsumedWriteCapacityUnits',
								dimensionsMap: { TableName: props.table.tableName! },
								period: cdk.Duration.minutes(5),
								statistic: 'Sum',
								label: 'Write CU',
							}),
						],
						width: 12,
					}),
				],
				[
					new cloudwatch.SingleValueWidget({
						title: 'Alarm Status',
						metrics: [lambdaErrors.metric, dynamoSystemErrors.metric, lambdaUrl5xx.metric],
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
					service: ['LAMBDA', 'DYNAMODB', 'CLOUDFRONT', 'COGNITO', 'S3'],
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

		const healthCheckFn = new lambdaNode.NodejsFunction(this, 'HealthCheckFn', {
			functionName: 'ganbari-quest-health-check',
			entry: path.join(__dirname, '..', 'lambda', 'health-check', 'index.ts'),
			handler: 'handler',
			runtime: lambda.Runtime.NODEJS_20_X,
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
