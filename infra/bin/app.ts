#!/usr/bin/env node
import * as path from 'node:path';
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { AuthStack } from '../lib/auth-stack';
import { ComputeStack } from '../lib/compute-stack';
import { STAGING_ENV_CONFIG } from '../lib/env-config';
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

// --- ADR-0048 Multi-Lambda Demo (#2097 week 4) ---
// demo Lambda 用の追加 context:
//   - demoDomainName: default `demo.${domainName}` (例: demo.ganbari-quest.com)
//   - demoCertificateArn: default `certificateArn` (本番が wildcard 証明書なら同 ARN で OK)
// PR body の "cert situation" として、本番 certificateArn が wildcard か apex 専用か明記する。
const demoDomainName = app.node.tryGetContext('demoDomainName') as string | undefined;
const demoCertificateArn = app.node.tryGetContext('demoCertificateArn') as string | undefined;

// --- #3087 解決策 B: /_app/immutable/* の S3 origin offload ---
// `-c staticAssetsS3Offload=true` 指定時のみ有効。deploy.yml が deploy 済 Docker image から
// `docker cp /app/client` で抽出した build artifact を `infra/static-assets` に配置する。
// flag 未指定 (default) では従来構成 (Origin Shield 経由 Lambda、#3087 解決策 A) を維持する。
const staticAssetsS3Offload = String(app.node.tryGetContext('staticAssetsS3Offload')) === 'true';
const staticAssetsSourceDir = staticAssetsS3Offload
	? path.join(__dirname, '..', 'static-assets')
	: undefined;

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
	certificateArn,
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
	// ADR-0048 Multi-Lambda Demo (#2097 week 4)
	demoFunctionUrl: compute.demoFunctionUrl,
	demoDomainName,
	demoCertificateArn,
	// #3087 解決策 B
	staticAssetsS3Offload,
	staticAssetsSourceDir,
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
const discordWebhookHealth = app.node.tryGetContext('discordWebhookHealth') as string | undefined;
new OpsStack(app, `${appName}Ops`, {
	env,
	description: 'Monitoring, Alerts, Budgets, Cost Management for Ganbari Quest',
	lambdaFn: compute.fn,
	table: storage.table,
	distribution: network.distribution,
	// #1214: health-check Lambda が叩くターゲット。CloudFront 経由は geoRestriction('JP')
	// に阻まれるため、Function URL (authType: NONE) を直接参照する。
	functionUrl: compute.functionUrl,
	// #1376 AC6: cron dispatcher Lambda エラーを既存 SNS topic で通知
	cronDispatcherFn: compute.cronDispatcherFn,
	opsEmail,
	discordWebhookHealth,
});

// --- AWS staging 3 stack (#2873 / EPIC #2861 D 系) ---
// `-c stagingEnabled=true` 時のみ instantiate する context gate。
// 本番の `cdk deploy --all` / `cdk diff --all` (deploy.yml) は context 無しで実行されるため
// 挙動不変 (staging との混線防止)。staging deploy は .github/workflows/deploy-aws-staging.yml が
// 3 stack を明示列挙して行う (`--all` 不使用)。
// Network / Ses / Ops は省略: Function URL 直アクセスで検証する (CloudFront は
// geoRestriction JP のため本番 e2e も Function URL 直の実績パターン踏襲)。
const stagingEnabled = String(app.node.tryGetContext('stagingEnabled')) === 'true';
if (stagingEnabled) {
	const stagingStorage = new StorageStack(app, `${appName}StorageStaging`, {
		env,
		description: 'DynamoDB + S3 + ECR for Ganbari Quest (staging, #2873)',
		envConfig: STAGING_ENV_CONFIG,
	});

	// staging Auth: custom domain / Google IdP / Route53 省略 (googleClientId 未指定で
	// 既存条件分岐が自然 skip)。Cognito default domain + SSM domain param は stack 内で必ず書く。
	const stagingAuth = new AuthStack(app, `${appName}AuthStaging`, {
		env,
		description: 'Cognito User Pool for Ganbari Quest (staging, #2873)',
		envConfig: STAGING_ENV_CONFIG,
	});

	const stagingCompute = new ComputeStack(app, `${appName}ComputeStaging`, {
		env,
		description: 'Lambda (SvelteKit) for Ganbari Quest (staging, #2873)',
		table: stagingStorage.table,
		assetsBucket: stagingStorage.assetsBucket,
		repository: stagingStorage.repository,
		envConfig: STAGING_ENV_CONFIG,
	});

	for (const stack of [stagingStorage, stagingAuth, stagingCompute]) {
		cdk.Tags.of(stack).add('gq-env', 'staging');
	}
}

app.synth();
