#!/usr/bin/env node
import * as path from 'node:path';
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { AuthStack } from '../lib/auth-stack';
import { ComputeStack } from '../lib/compute-stack';
import { DsqlStack } from '../lib/dsql-stack';
import { STAGING_ENV_CONFIG } from '../lib/env-config';
import { NetworkStack } from '../lib/network-stack';
import { OpsStack } from '../lib/ops-stack';
import { resolveOriginVerifySecret } from '../lib/origin-verify-context';
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

// #4280 案 b: CloudFront → origin の shared secret。**未設定なら synth をここで止める**
// (空文字で素通しすると header 無しの distribution + 無効なアプリ側検査 = 黙って無防備になる)。
// prod / staging は同一 AWS アカウント内の同居構成で、PARENT_GATE_COOKIE_SECRET /
// OPS_SECRET_KEY と同じく 1 本の secret を共有する。
const originVerifySecret = resolveOriginVerifySecret(app.node);

const storage = new StorageStack(app, `${appName}Storage`, {
	env,
	description: 'S3 + ECR for Ganbari Quest (DB backend は DsqlStack、#3438)',
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
	assetsBucket: storage.assetsBucket,
	repository: storage.repository,
});

const network = new NetworkStack(app, `${appName}Network`, {
	env,
	description: 'CloudFront + Route53 + ACM for Ganbari Quest',
	functionUrl: compute.functionUrl,
	originVerifySecret,
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
	distribution: network.distribution,
	// #1214: health-check Lambda が叩くターゲット。CloudFront 経由は geoRestriction('JP')
	// に阻まれるため、Function URL (authType: NONE) を直接参照する。
	functionUrl: compute.functionUrl,
	// #1376 AC6: cron dispatcher Lambda エラーを既存 SNS topic で通知
	cronDispatcherFn: compute.cronDispatcherFn,
	// #3402-1: offload 有効時のみ生成される S3 origin bucket。undefined なら S3 alarm を作らない。
	staticAssetsBucket: network.staticAssetsBucket,
	// #3998: entitlement fail-closed を log 由来 MetricFilter で拾うためのアプリ LogGroup
	appLogGroup: compute.appLogGroup,
	opsEmail,
	discordWebhookHealth,
	// #4189: CloudWatch アラームの転送先 (オーナー決裁 2026-08-03、案 B)。
	// **メール subscription はもう張らない**ため、これが空だと alarm が鳴っても誰にも届かない。
	// deploy.yml 側で空を検出して deploy を止める。
	discordWebhookIncident: app.node.tryGetContext('discordWebhookIncident') as string | undefined,
});

// --- DSQL stack (EPIC #3424 M4-E item 12 / #3429 #3431 #3432) ---
// `-c dsqlEnabled=true` 時のみ instantiate する context gate。DSQL クラスタの本番作成 /
// cutover は M5 のユーザー承認事項 (Auto Mode ガイドライン: 本番デプロイ / DB スキーマ変更は
// 確認必須) のため、既定の `cdk deploy --all` では合成されない。
const dsqlEnabled = String(app.node.tryGetContext('dsqlEnabled')) === 'true';
if (dsqlEnabled) {
	new DsqlStack(app, `${appName}Dsql`, {
		env,
		description: 'Aurora DSQL cluster + cost guardrail + observability (EPIC #3424)',
		opsEmail,
	});
}

// --- DSQL staging cluster (EPIC #3424 M5 DoD4 / #3429) ---
// `-c dsqlStagingEnabled=true` 時のみ instantiate。deploy-aws-staging.yml の dsql opt-in lane が
// deploy し、staging Lambda (DATA_SOURCE=dsql) の接続先 + schema provisioning (dsql:migrate) の
// 対象になる。staging は捨てて作り直す前提のため deletion protection を外す (本番 Dsql は DP=true
// 既定のまま)。alarm/Budgets subscription は本番系に限定 (opsEmail 非注入 = 通知ノイズ防止)。
const dsqlStagingEnabled = String(app.node.tryGetContext('dsqlStagingEnabled')) === 'true';
if (dsqlStagingEnabled) {
	new DsqlStack(app, `${appName}DsqlStaging`, {
		env,
		description: 'Aurora DSQL staging cluster (EPIC #3424 M5 DoD4、PDCA 用・DP なし)',
		deletionProtection: false,
	});
}

// --- AWS staging 3 stack (#2873 / EPIC #2861 D 系) ---
// `-c stagingEnabled=true` 時のみ instantiate する context gate。
// 本番の `cdk deploy --all` / `cdk diff --all` (deploy.yml) は context 無しで実行されるため
// 挙動不変 (staging との混線防止)。staging deploy は .github/workflows/deploy-aws-staging.yml が
// 3 stack を明示列挙して行う (`--all` 不使用)。
// Ses / Ops は省略。**Network (CloudFront) は #4204 で staging にも必要**になった:
// SvelteKit の名前付き form action (`?/action`) は Lambda Function URL がクエリの
// スラッシュを拒否するため 400 になり、CloudFront Function `<prefix>-query-slash-encode`
// が `?/x` → `?%2Fx` に書き換えて初めて通る。これが無いと staging では
// **ログインもサインアップもできない** (= 認証後の画面に到達する手段がゼロ)。
const stagingEnabled = String(app.node.tryGetContext('stagingEnabled')) === 'true';
if (stagingEnabled) {
	const stagingStorage = new StorageStack(app, `${appName}StorageStaging`, {
		env,
		description: 'S3 + ECR for Ganbari Quest (staging, #2873 / DB backend は DSQL)',
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
		assetsBucket: stagingStorage.assetsBucket,
		repository: stagingStorage.repository,
		envConfig: STAGING_ENV_CONFIG,
	});

	// #4204: staging 用 CloudFront。**custom domain / ACM 証明書は不要** —
	// `network-stack.ts` の domainNames/certificate は `props.domainName && certificate` の
	// 条件展開で、未指定なら既定の `*.cloudfront.net` で成立する (Route53 / ACM も同じガード内)。
	//
	// geoRestriction は `[]` = 制限なし。post-deploy smoke を回す GitHub Actions runner が
	// 日本国外にあり、JP allowlist を残すと 403 で smoke が回らないため。
	// **前提: staging に本番データが入っていないこと** (PO 実測 2026-08-02: 本番 cluster
	// 1,801,692 bytes に対し staging 1,031,956 bytes = 57%。snapshot コピーなら同等以上になる)。
	// **staging に本番データを入れる運用が将来生まれたら JP allowlist を戻す** (PO 条件)。
	const stagingNetwork = new NetworkStack(app, `${appName}NetworkStaging`, {
		env,
		description: 'CloudFront for Ganbari Quest (staging, #4204 form action の query slash encode)',
		functionUrl: stagingCompute.functionUrl,
		originVerifySecret,
		resourcePrefix: STAGING_ENV_CONFIG.resourcePrefix,
		geoRestrictionCountries: [],
	});

	for (const stack of [stagingStorage, stagingAuth, stagingCompute, stagingNetwork]) {
		cdk.Tags.of(stack).add('gq-env', 'staging');
	}
}

app.synth();
