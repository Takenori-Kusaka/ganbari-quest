// tests/unit/infra/staging-cdk.test.ts
// #2873 (EPIC #2861 D 系) — AWS staging 3 stack の CDK 構造検証。
//
// このテストは 2 つの責務を持つ:
//   (1) prod 不変 guard (load-bearing): `stagingEnabled` 無し (= envConfig 未指定) で synth した
//       prod template の物理名 (`ganbari-quest` table / `ganbari-quest-app` Fn /
//       `ganbari-quest-users-v2` pool 等) と構成 (Backup / demo Fn / cron Rule / Firehose /
//       SES env) が従来どおりであることを assertion する。optional envConfig 導入で
//       prod template が変わった瞬間に CI が落ちる (ADR-0019 rename=Replacement 等価の防御)。
//   (2) staging template assert: STAGING_ENV_CONFIG で synth した staging stack が
//       prefix 分離 / Backup・demo Fn・cron Rule・Firehose 不在 / staging env
//       (外部サービス secret 非注入) になっていることを assertion する。
//
// context stub パターンは tests/unit/infra/multi-lambda-cdk.test.ts を踏襲。
// 参考: docs/design/13-AWSサーバレスアーキテクチャ設計書.md §4.3 / infra/lib/env-config.ts

import * as cdk from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { beforeAll, describe, expect, it } from 'vitest';
import { AuthStack } from '../../../infra/lib/auth-stack';
import { ComputeStack } from '../../../infra/lib/compute-stack';
import { STAGING_ENV_CONFIG } from '../../../infra/lib/env-config';
import { StorageStack } from '../../../infra/lib/storage-stack';

const env: cdk.Environment = { account: '000000000000', region: 'us-east-1' };

// cspell:ignore TESTPOOL
/**
 * prod 同等 (envConfig 未指定) の 3 stack を synth する。
 * context は multi-lambda-cdk.test.ts と同じ stub (opsSecretKey + parentGateCookieSecret)。
 */
function buildProdStacks(): {
	storage: StorageStack;
	auth: AuthStack;
	compute: ComputeStack;
} {
	const app = new cdk.App({
		context: {
			'ssm:account=000000000000:parameterName=/ganbari-quest/cognito/user-pool-id:region=us-east-1':
				'us-east-1_TESTPOOL',
			'ssm:account=000000000000:parameterName=/ganbari-quest/cognito/client-id:region=us-east-1':
				'test-client-id',
			'ssm:account=000000000000:parameterName=/ganbari-quest/cognito/domain:region=us-east-1':
				'auth.ganbari-quest.com',
			'ssm:account=000000000000:parameterName=/ganbari-quest/context-token-secret:region=us-east-1':
				'test-context-token-secret',
			opsSecretKey: 'test-ops-secret-key',
			parentGateCookieSecret: 'test-parent-gate-secret-do-not-use-do-not-use',
		},
	});
	const storage = new StorageStack(app, 'TestStorage', { env });
	const auth = new AuthStack(app, 'TestAuth', { env });
	const compute = new ComputeStack(app, 'TestCompute', {
		env,
		table: storage.table,
		assetsBucket: storage.assetsBucket,
		repository: storage.repository,
	});
	return { storage, auth, compute };
}

/**
 * staging 3 stack (STAGING_ENV_CONFIG) を synth する。
 * 意図的に cronSecret / opsSecretKey を context に渡さない —
 * #1586 guard が enableCronDispatcher 分岐内に移動したことの実証 (#2873 handoff spec)。
 */
function buildStagingStacks(): {
	storage: StorageStack;
	auth: AuthStack;
	compute: ComputeStack;
} {
	const app = new cdk.App({
		context: {
			parentGateCookieSecret: 'test-parent-gate-secret-do-not-use-do-not-use',
		},
	});
	const storage = new StorageStack(app, 'TestStorageStaging', {
		env,
		envConfig: STAGING_ENV_CONFIG,
	});
	const auth = new AuthStack(app, 'TestAuthStaging', {
		env,
		envConfig: STAGING_ENV_CONFIG,
	});
	const compute = new ComputeStack(app, 'TestComputeStaging', {
		env,
		table: storage.table,
		assetsBucket: storage.assetsBucket,
		repository: storage.repository,
		envConfig: STAGING_ENV_CONFIG,
	});
	return { storage, auth, compute };
}

let prodStorage: Template;
let prodAuth: Template;
let prodCompute: Template;
let stagingStorage: Template;
let stagingAuth: Template;
let stagingCompute: Template;

beforeAll(() => {
	const prod = buildProdStacks();
	prodStorage = Template.fromStack(prod.storage as unknown as cdk.Stack);
	prodAuth = Template.fromStack(prod.auth as unknown as cdk.Stack);
	prodCompute = Template.fromStack(prod.compute as unknown as cdk.Stack);

	const staging = buildStagingStacks();
	stagingStorage = Template.fromStack(staging.storage as unknown as cdk.Stack);
	stagingAuth = Template.fromStack(staging.auth as unknown as cdk.Stack);
	stagingCompute = Template.fromStack(staging.compute as unknown as cdk.Stack);
}, 120_000); // CDK synth は重い (6 stack で 5-10s)

describe('#2873 AWS staging stack (prod 不変 guard + staging template assert)', () => {
	describe('P: prod 不変 guard — envConfig 未指定 synth で従来 prod template を維持', () => {
		it('P-1: Storage — table=ganbari-quest (Retain) / ECR=ganbari-quest (maxImageCount:10) / Backup vault あり', () => {
			prodStorage.hasResourceProperties('AWS::DynamoDB::GlobalTable', {
				TableName: 'ganbari-quest',
			});
			prodStorage.hasResource('AWS::DynamoDB::GlobalTable', {
				DeletionPolicy: 'Retain',
			});

			const repos = prodStorage.findResources('AWS::ECR::Repository');
			expect(Object.keys(repos).length).toBe(1);
			const repo = Object.values(repos)[0] as {
				Properties: { RepositoryName?: string; LifecyclePolicy?: { LifecyclePolicyText?: string } };
			};
			expect(repo.Properties.RepositoryName).toBe('ganbari-quest');
			expect(repo.Properties.LifecyclePolicy?.LifecyclePolicyText).toContain('"countNumber":10');

			prodStorage.hasResourceProperties('AWS::Backup::BackupVault', {
				BackupVaultName: 'ganbari-quest-vault',
			});
			prodStorage.hasResourceProperties('AWS::Backup::BackupPlan', {
				BackupPlan: Match.objectLike({ BackupPlanName: 'ganbari-quest-daily' }),
			});

			// AssetsBucket は `ganbari-quest-assets-<account>` (prefix 不変)
			const buckets = prodStorage.findResources('AWS::S3::Bucket');
			expect(JSON.stringify(buckets)).toContain('ganbari-quest-assets-');
		});

		it('P-2: Auth — pool=ganbari-quest-users-v2 (Retain) / SSM /ganbari-quest/cognito/* / SES email 設定維持', () => {
			prodAuth.hasResourceProperties('AWS::Cognito::UserPool', {
				UserPoolName: 'ganbari-quest-users-v2',
				EmailConfiguration: Match.objectLike({ EmailSendingAccount: 'DEVELOPER' }),
			});
			prodAuth.hasResource('AWS::Cognito::UserPool', {
				DeletionPolicy: 'Retain',
			});
			prodAuth.hasResourceProperties('AWS::SSM::Parameter', {
				Name: '/ganbari-quest/cognito/user-pool-id',
			});
			prodAuth.hasResourceProperties('AWS::SSM::Parameter', {
				Name: '/ganbari-quest/cognito/client-id',
			});
			prodAuth.hasResourceProperties('AWS::Cognito::UserPoolClient', {
				ClientName: 'ganbari-quest-public',
			});
			prodAuth.hasResourceProperties('AWS::Lambda::Function', {
				FunctionName: 'ganbari-quest-cognito-custom-message',
			});
		});

		it('P-3: Compute — fn=ganbari-quest-app / demo Fn / cron-dispatcher + Rule 6 本 / Firehose / SES env が従来どおり', () => {
			prodCompute.hasResourceProperties('AWS::Lambda::Function', {
				FunctionName: 'ganbari-quest-app',
				Environment: {
					Variables: Match.objectLike({
						DATA_SOURCE: 'dynamodb',
						AUTH_MODE: 'cognito',
						ORIGIN: 'https://ganbari-quest.com',
						COGNITO_CALLBACK_URL: 'https://ganbari-quest.com/auth/callback',
						SES_SENDER_EMAIL: 'noreply@ganbari-quest.com',
						SES_CONFIG_SET_NAME: 'ganbari-quest-config',
						USE_LOOKUP_KEY: 'true',
					}),
				},
			});
			prodCompute.hasResourceProperties('AWS::Logs::LogGroup', {
				LogGroupName: '/aws/lambda/ganbari-quest-app',
			});
			prodCompute.hasResourceProperties('AWS::Lambda::Function', {
				FunctionName: 'ganbari-quest-app-demo',
			});
			prodCompute.hasResourceProperties('AWS::Lambda::Function', {
				FunctionName: 'ganbari-quest-cron-dispatcher',
			});
			// CRON_JOBS 6 本 (compute-stack.ts CRON_JOBS SSOT)
			prodCompute.resourceCountIs('AWS::Events::Rule', 6);
			prodCompute.resourceCountIs('AWS::KinesisFirehose::DeliveryStream', 1);
			// SES grant (prod のみ) が従来どおり付与されている
			const policies = prodCompute.findResources('AWS::IAM::Policy');
			expect(JSON.stringify(policies)).toContain('ses:SendEmail');
		});

		it('P-4: prod synth は cronSecret / opsSecretKey 両方欠落で従来どおり throw する (#1586 guard 維持)', () => {
			const app = new cdk.App({
				context: {
					parentGateCookieSecret: 'test-parent-gate-secret-do-not-use-do-not-use',
				},
			});
			const storage = new StorageStack(app, 'GuardStorage', { env });
			expect(
				() =>
					new ComputeStack(app, 'GuardCompute', {
						env,
						table: storage.table,
						assetsBucket: storage.assetsBucket,
						repository: storage.repository,
					}),
			).toThrow(/cron-dispatcher requires cronSecret or opsSecretKey/);
		});
	});

	describe('S-1: staging Storage — prefix 分離 + Backup 不在 + ECR maxImageCount:3 + DESTROY', () => {
		it('table=ganbari-quest-staging で DeletionPolicy=Delete', () => {
			stagingStorage.hasResourceProperties('AWS::DynamoDB::GlobalTable', {
				TableName: 'ganbari-quest-staging',
			});
			stagingStorage.hasResource('AWS::DynamoDB::GlobalTable', {
				DeletionPolicy: 'Delete',
			});
		});

		it('AWS Backup (vault / plan) を構築しない', () => {
			stagingStorage.resourceCountIs('AWS::Backup::BackupVault', 0);
			stagingStorage.resourceCountIs('AWS::Backup::BackupPlan', 0);
		});

		it('ECR repo=ganbari-quest-staging (専用 repo) + maxImageCount:3', () => {
			const repos = stagingStorage.findResources('AWS::ECR::Repository');
			expect(Object.keys(repos).length).toBe(1);
			const repo = Object.values(repos)[0] as {
				Properties: { RepositoryName?: string; LifecyclePolicy?: { LifecyclePolicyText?: string } };
			};
			expect(repo.Properties.RepositoryName).toBe('ganbari-quest-staging');
			expect(repo.Properties.LifecyclePolicy?.LifecyclePolicyText).toContain('"countNumber":3');
		});
	});

	describe('S-2: staging Auth — default domain + SSM domain param 必須書込 + Google IdP / Route53 不在', () => {
		it('pool=ganbari-quest-staging-users-v2 で DeletionPolicy=Delete + SES email 設定なし (Cognito default)', () => {
			const pools = stagingAuth.findResources('AWS::Cognito::UserPool');
			expect(Object.keys(pools).length).toBe(1);
			const pool = Object.values(pools)[0] as {
				DeletionPolicy?: string;
				Properties: { UserPoolName?: string; EmailConfiguration?: unknown };
			};
			expect(pool.Properties.UserPoolName).toBe('ganbari-quest-staging-users-v2');
			expect(pool.DeletionPolicy).toBe('Delete');
			// 本番外部サービス (SES) への副作用ゼロ: EmailSendingAccount=DEVELOPER を構成しない
			expect(JSON.stringify(pool.Properties.EmailConfiguration ?? {})).not.toContain('DEVELOPER');
		});

		it('SSM /ganbari-quest-staging/cognito/* (user-pool-id / client-id / domain) が全て書かれる', () => {
			stagingAuth.hasResourceProperties('AWS::SSM::Parameter', {
				Name: '/ganbari-quest-staging/cognito/user-pool-id',
			});
			stagingAuth.hasResourceProperties('AWS::SSM::Parameter', {
				Name: '/ganbari-quest-staging/cognito/client-id',
			});
			// domain param は Google IdP 無しでも必ず書く (#2873 — ComputeStaging の
			// valueForStringParameter 解決に必要。欠けると Compute deploy が落ちる)
			stagingAuth.hasResourceProperties('AWS::SSM::Parameter', {
				Name: '/ganbari-quest-staging/cognito/domain',
			});
		});

		it('Cognito default domain (prefix=ganbari-quest-staging) を使い、custom domain / Route53 / Google IdP は構築しない', () => {
			stagingAuth.hasResourceProperties('AWS::Cognito::UserPoolDomain', {
				Domain: 'ganbari-quest-staging',
			});
			stagingAuth.resourceCountIs('AWS::Cognito::UserPoolIdentityProvider', 0);
			stagingAuth.resourceCountIs('AWS::Route53::RecordSet', 0);
		});
	});

	describe('S-3: staging Compute — prefix 分離 + demo Fn / cron Rule / Firehose 不在 + 外部サービス env 非注入', () => {
		it('fn=ganbari-quest-staging-app のみ (demo Fn / cron-dispatcher 不在 = Lambda 1 本)', () => {
			stagingCompute.resourceCountIs('AWS::Lambda::Function', 1);
			stagingCompute.hasResourceProperties('AWS::Lambda::Function', {
				FunctionName: 'ganbari-quest-staging-app',
				Architectures: ['arm64'],
				MemorySize: 512,
			});
			stagingCompute.hasResourceProperties('AWS::Logs::LogGroup', {
				LogGroupName: '/aws/lambda/ganbari-quest-staging-app',
			});
		});

		it('EventBridge cron Rule / Firehose log archiving を構築しない', () => {
			stagingCompute.resourceCountIs('AWS::Events::Rule', 0);
			stagingCompute.resourceCountIs('AWS::KinesisFirehose::DeliveryStream', 0);
		});

		it('staging env: DATA_SOURCE=dynamodb + AUTH_MODE=cognito + ORIGIN placeholder + PARENT_GATE_COOKIE_SECRET 注入', () => {
			stagingCompute.hasResourceProperties('AWS::Lambda::Function', {
				FunctionName: 'ganbari-quest-staging-app',
				Environment: {
					Variables: Match.objectLike({
						DATA_SOURCE: 'dynamodb',
						AUTH_MODE: 'cognito',
						// Function URL 自己参照のため synth 時は placeholder。
						// deploy-aws-staging.yml の ORIGIN resolve step が実 URL に更新する (縮退可)
						ORIGIN: 'https://staging-origin-placeholder.invalid',
						PARENT_GATE_COOKIE_SECRET: Match.stringLikeRegexp('^test-parent-gate-secret'),
					}),
				},
			});
		});

		it('外部サービス env (Stripe / Discord / Gemini / SES / cron secret) を一切注入しない (副作用ゼロ)', () => {
			const functions = stagingCompute.findResources('AWS::Lambda::Function', {
				Properties: { FunctionName: 'ganbari-quest-staging-app' },
			});
			expect(Object.keys(functions).length).toBe(1);
			const fnDef = Object.values(functions)[0] as {
				Properties: { Environment?: { Variables?: Record<string, unknown> } };
			};
			const envVars = fnDef.Properties.Environment?.Variables ?? {};

			const forbiddenEnvKeys = [
				'STRIPE_SECRET_KEY',
				'STRIPE_WEBHOOK_SECRET',
				'STRIPE_PRICE_STANDARD_MONTHLY',
				'STRIPE_PRICE_FAMILY_MONTHLY',
				'USE_LOOKUP_KEY',
				'STRIPE_WEBHOOK_SHADOW_MODE',
				'STRIPE_WEBHOOK_SECRET_TEST',
				'GEMINI_API_KEY',
				'CRON_SECRET',
				'OPS_SECRET_KEY',
				'DISCORD_WEBHOOK_SIGNUP',
				'DISCORD_WEBHOOK_BILLING',
				'DISCORD_WEBHOOK_CHURN',
				'DISCORD_WEBHOOK_INCIDENT',
				'DISCORD_WEBHOOK_INQUIRY',
				'FEEDBACK_DISCORD_WEBHOOK_URL',
				'SES_SENDER_EMAIL',
				'SES_CONFIG_SET_NAME',
			];
			for (const key of forbiddenEnvKeys) {
				expect(
					envVars[key],
					`staging Lambda env MUST NOT contain ${key} (external service side-effect)`,
				).toBeUndefined();
			}
		});

		it('SSM 参照は /ganbari-quest-staging/ prefix (CFN Parameter default 経由)', () => {
			// valueForStringParameter は AWS::SSM::Parameter::Value<String> 型の CFN Parameter を生成する。
			// Default 値に staging prefix の parameterName が入ることを assert する。
			const json = JSON.stringify(stagingCompute.toJSON().Parameters ?? {});
			expect(json).toContain('/ganbari-quest-staging/cognito/user-pool-id');
			expect(json).toContain('/ganbari-quest-staging/cognito/client-id');
			expect(json).toContain('/ganbari-quest-staging/cognito/domain');
			expect(json).toContain('/ganbari-quest-staging/context-token-secret');
			expect(json).not.toContain('"/ganbari-quest/cognito');
		});

		it('SES / Cost Explorer の IAM grant を付与しない (blast radius 最小化)', () => {
			const policies = stagingCompute.findResources('AWS::IAM::Policy');
			const serialized = JSON.stringify(policies);
			expect(serialized).not.toContain('ses:SendEmail');
			expect(serialized).not.toContain('ce:GetCostAndUsage');
		});

		it('Function URL は authType=NONE (本番と同じ、Function URL 直アクセスで検証)', () => {
			stagingCompute.hasResourceProperties('AWS::Lambda::Url', {
				AuthType: 'NONE',
			});
		});

		it('staging synth は cronSecret / opsSecretKey 無しで throw しない (#1586 guard の分岐内移動)', () => {
			// buildStagingStacks() が context に cronSecret / opsSecretKey を渡していないのに
			// beforeAll で synth が成功していること自体が実証。ここでは明示再構築で assert する。
			expect(() => buildStagingStacks()).not.toThrow();
		});
	});
});
