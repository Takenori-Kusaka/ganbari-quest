import * as path from 'node:path';
import * as cdk from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambdaNode from 'aws-cdk-lib/aws-lambda-nodejs';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as ses from 'aws-cdk-lib/aws-ses';
import * as sesActions from 'aws-cdk-lib/aws-ses-actions';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import type { Construct } from 'constructs';

export interface SesStackProps extends cdk.StackProps {
	domainName?: string;
	discordWebhookSupport?: string;
}

export class SesStack extends cdk.Stack {
	constructor(scope: Construct, id: string, props: SesStackProps) {
		super(scope, id, props);

		const domainName = props.domainName ?? 'ganbari-quest.com';
		const discordWebhookSupport = props.discordWebhookSupport ?? '';

		// 1. Route53 Hosted Zone のルックアップ
		const hostedZone = route53.HostedZone.fromLookup(this, 'Zone', {
			domainName,
		});

		// 2. SES Email Identity（ドメイン検証 + Easy DKIM）
		new ses.EmailIdentity(this, 'EmailIdentity', {
			identity: ses.Identity.publicHostedZone(hostedZone),
			mailFromDomain: `mail.${domainName}`,
		});

		// 3. Configuration Set（レピュテーション監視）
		const configSet = new ses.ConfigurationSet(this, 'ConfigSet', {
			configurationSetName: 'ganbari-quest-config',
			reputationMetrics: true,
		});

		// 4. SNS Topics（バウンス・苦情通知）
		const bounceTopic = new sns.Topic(this, 'BounceTopic', {
			topicName: 'ses-bounce-notifications',
		});
		const complaintTopic = new sns.Topic(this, 'ComplaintTopic', {
			topicName: 'ses-complaint-notifications',
		});

		// 5. Event Destinations
		configSet.addEventDestination('BounceDestination', {
			destination: ses.EventDestination.snsTopic(bounceTopic),
			events: [ses.EmailSendingEvent.BOUNCE, ses.EmailSendingEvent.REJECT],
		});
		configSet.addEventDestination('ComplaintDestination', {
			destination: ses.EventDestination.snsTopic(complaintTopic),
			events: [ses.EmailSendingEvent.COMPLAINT],
		});

		// 6. SSM パラメータ
		new ssm.StringParameter(this, 'SenderEmail', {
			parameterName: '/ganbari-quest/ses/sender-email',
			stringValue: `noreply@${domainName}`,
		});
		new ssm.StringParameter(this, 'ConfigSetName', {
			parameterName: '/ganbari-quest/ses/config-set-name',
			stringValue: configSet.configurationSetName ?? 'ganbari-quest-config',
		});

		// ============================================================
		// SES 受信パイプライン (#0251)
		// support@ganbari-quest.com → S3保存 → Lambda → Discord通知 + 自動応答
		// ============================================================

		// 7. Route 53 MX レコード（SES 受信エンドポイント）
		new route53.MxRecord(this, 'SupportMxRecord', {
			zone: hostedZone,
			values: [
				{
					priority: 10,
					hostName: 'inbound-smtp.us-east-1.amazonaws.com',
				},
			],
			ttl: cdk.Duration.minutes(5),
		});

		// 8. S3 バケット（メール原文保存用）
		const mailBucket = new s3.Bucket(this, 'SupportMailBucket', {
			bucketName: `ganbari-quest-support-mail-${this.account}`,
			removalPolicy: cdk.RemovalPolicy.RETAIN,
			encryption: s3.BucketEncryption.S3_MANAGED,
			blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
			lifecycleRules: [
				{
					expiration: cdk.Duration.days(365),
				},
			],
		});

		// SES がバケットに書き込めるようにポリシー追加
		mailBucket.addToResourcePolicy(
			new iam.PolicyStatement({
				principals: [new iam.ServicePrincipal('ses.amazonaws.com')],
				actions: ['s3:PutObject'],
				resources: [mailBucket.arnForObjects('*')],
				conditions: {
					StringEquals: { 'AWS:SourceAccount': this.account },
				},
			}),
		);

		// 9. メール受信処理 Lambda
		const receiveHandler = new lambdaNode.NodejsFunction(this, 'SesReceiveHandler', {
			functionName: 'ganbari-quest-ses-receive',
			entry: path.join(__dirname, '..', 'lambda', 'ses-receive', 'index.ts'),
			handler: 'handler',
			runtime: lambda.Runtime.NODEJS_20_X,
			architecture: lambda.Architecture.ARM_64,
			memorySize: 256,
			timeout: cdk.Duration.seconds(30),
			environment: {
				MAIL_BUCKET: mailBucket.bucketName,
				SUPPORT_EMAIL: `support@${domainName}`,
				DOMAIN_NAME: domainName,
				...(discordWebhookSupport ? { DISCORD_WEBHOOK_SUPPORT: discordWebhookSupport } : {}),
			},
			bundling: {
				minify: true,
				sourceMap: false,
				externalModules: ['@aws-sdk/client-ses', '@aws-sdk/client-s3'],
			},
		});

		// Lambda に S3 読み取り + SES 送信権限
		mailBucket.grantRead(receiveHandler);
		receiveHandler.addToRolePolicy(
			new iam.PolicyStatement({
				actions: ['ses:SendEmail', 'ses:SendRawEmail'],
				resources: ['*'],
			}),
		);

		// 10. SES Receipt Rule Set
		const ruleSet = new ses.ReceiptRuleSet(this, 'SupportRuleSet', {
			receiptRuleSetName: 'ganbari-quest-support',
		});

		ruleSet.addRule('SupportRule', {
			recipients: [`support@${domainName}`],
			actions: [
				new sesActions.S3({
					bucket: mailBucket,
					objectKeyPrefix: 'incoming/',
				}),
				new sesActions.Lambda({
					function: receiveHandler,
					invocationType: sesActions.LambdaInvocationType.EVENT,
				}),
			],
			scanEnabled: true,
		});

		// --- Outputs ---
		new cdk.CfnOutput(this, 'BounceTopicArn', {
			value: bounceTopic.topicArn,
		});
		new cdk.CfnOutput(this, 'ComplaintTopicArn', {
			value: complaintTopic.topicArn,
		});
		new cdk.CfnOutput(this, 'SupportMailBucketName', {
			value: mailBucket.bucketName,
		});
		new cdk.CfnOutput(this, 'SesReceiveFunctionArn', {
			value: receiveHandler.functionArn,
		});
	}
}
