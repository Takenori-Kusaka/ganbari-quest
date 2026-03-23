#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { AuthStack } from '../lib/auth-stack';
import { ComputeStack } from '../lib/compute-stack';
import { NetworkStack } from '../lib/network-stack';
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

const auth = new AuthStack(app, `${appName}Auth`, {
	env,
	description: 'Cognito User Pool for Ganbari Quest',
	appDomain: domainName,
});

const compute = new ComputeStack(app, `${appName}Compute`, {
	env,
	description: 'Lambda (SvelteKit) + API Gateway for Ganbari Quest',
	table: storage.table,
	assetsBucket: storage.assetsBucket,
	repository: storage.repository,
	userPoolId: auth.userPool.userPoolId,
	userPoolClientId: auth.userPoolClient.userPoolClientId,
});

new NetworkStack(app, `${appName}Network`, {
	env,
	description: 'CloudFront + Route53 + ACM for Ganbari Quest',
	functionUrl: compute.functionUrl,
	assetsBucket: storage.assetsBucket,
	domainName,
	certificateArn,
});

app.synth();
