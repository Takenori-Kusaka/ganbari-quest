import * as cdk from 'aws-cdk-lib';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as ses from 'aws-cdk-lib/aws-ses';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import type { Construct } from 'constructs';

export interface SesStackProps extends cdk.StackProps {
	domainName?: string;
}

export class SesStack extends cdk.Stack {
	constructor(scope: Construct, id: string, props: SesStackProps) {
		super(scope, id, props);

		const domainName = props.domainName ?? 'ganbari-quest.com';

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

		// --- Outputs ---
		new cdk.CfnOutput(this, 'BounceTopicArn', { value: bounceTopic.topicArn });
		new cdk.CfnOutput(this, 'ComplaintTopicArn', { value: complaintTopic.topicArn });
	}
}
