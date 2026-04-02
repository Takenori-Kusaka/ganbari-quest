#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { AuthStack } from '../lib/auth-stack';
import { ComputeStack } from '../lib/compute-stack';
import { NetworkStack } from '../lib/network-stack';
import { OpsStack } from '../lib/ops-stack';
import { SesStack } from '../lib/ses-stack';
import { StorageStack } from '../lib/storage-stack';

const app = new cdk.App();

const env: cdk.Environment = {
	account: process.env.CDK_DEFAULT_ACCOUNT,
	region: 'us-east-1',
};

const appName = 'GanbariQuest';

// Custom domain (deploy with -c domainName=ganbari-quest.com -c certificateArn=arn:...)
const domainName = app.node.tryGetContext('domainName') as string | undefined;
const certificateArn = app.node.tryGetContext('certificateArn') as string | undefined;

const storage = new StorageStack(app, `${appName}Storage`, {
	env,
	description: 'DynamoDB + S3 for Ganbari Quest',
});

// Google OAuth (deploy with -c googleClientId=xxx -c googleClientSecret=xxx)
const googleClientId = app.node.tryGetContext('googleClientId') as string | undefined;
const googleClientSecret = app.node.tryGetContext('googleClientSecret') as string | undefined;

new AuthStack(app, `${appName}Auth`, {
	env,
	description: 'Cognito User Pool for Ganbari Quest',
	appDomain: domainName,
	googleClientId,
	googleClientSecret,
});

// ComputeStack は SSM パラメータ経由で Cognito 設定を取得（cross-stack export 回避）
const compute = new ComputeStack(app, `${appName}Compute`, {
	env,
	description: 'Lambda (SvelteKit) + API Gateway for Ganbari Quest',
	table: storage.table,
	assetsBucket: storage.assetsBucket,
	repository: storage.repository,
});

const network = new NetworkStack(app, `${appName}Network`, {
	env,
	description: 'CloudFront + Route53 + ACM for Ganbari Quest',
	functionUrl: compute.functionUrl,
	domainName,
	certificateArn,
});

// SES Stack: メール送信基盤 + 受信パイプライン（support@ganbari-quest.com）
const discordWebhookSupport = app.node.tryGetContext('discordWebhookSupport') as string | undefined;
new SesStack(app, `${appName}Ses`, {
	env,
	description: 'SES Email Infrastructure for Ganbari Quest',
	domainName,
	discordWebhookSupport,
});

// OpsStack: 監視・アラート + コスト防衛 (deploy with -c opsEmail=you@example.com)
const opsEmail = app.node.tryGetContext('opsEmail') as string | undefined;
new OpsStack(app, `${appName}Ops`, {
	env,
	description: 'Monitoring, Alerts, Budgets, Cost Management for Ganbari Quest',
	lambdaFn: compute.fn,
	table: storage.table,
	distribution: network.distribution,
	opsEmail,
});

app.synth();
