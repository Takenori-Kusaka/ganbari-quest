// tests/unit/infra/staging-cdk.test.ts
// #2873 (EPIC #2861 D 系) — AWS staging 3 stack の CDK 構造検証。
//
// このテストは 2 つの責務を持つ:
//   (1) prod 不変 guard (load-bearing): `stagingEnabled` 無し (= envConfig 未指定) で synth した
//       prod template の物理名 (`ganbari-quest-app` Fn / `ganbari-quest-users-v2` pool 等) と
//       構成 (demo Fn / cron Rule / Firehose / SES env) が従来どおりであること、および #3854
//       Deploy-2 で MainTable + AWS Backup + 両 export が撤去済であることを assertion する。
//       optional envConfig 導入で prod template が変わった瞬間に CI が落ちる (ADR-0019 防御)。
//   (2) staging template assert: STAGING_ENV_CONFIG で synth した staging stack が
//       prefix 分離 / MainTable・Backup・demo Fn・cron Rule・Firehose 不在 / staging env
//       (外部サービス secret 非注入) になっていることを assertion する。
//
// context stub パターンは tests/unit/infra/multi-lambda-cdk.test.ts を踏襲。
// 参考: docs/design/13-AWSサーバレスアーキテクチャ設計書.md §4.3 / infra/lib/env-config.ts

import * as cdk from 'aws-cdk-lib';
import { Annotations, Match, Template } from 'aws-cdk-lib/assertions';
import { beforeAll, describe, expect, it } from 'vitest';
import { AuthStack } from '../../../infra/lib/auth-stack';
import { ComputeStack } from '../../../infra/lib/compute-stack';
import { STAGING_ENV_CONFIG } from '../../../infra/lib/env-config';
import { NetworkStack } from '../../../infra/lib/network-stack';
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
			// #3438 Phase 2A: DSQL 無条件 backend の fail-close 回避 (endpoint / clusterArn 必須)
			dsqlEndpoint: 'testcluster1234.dsql.us-east-1.on.aws',
			dsqlClusterArn: 'arn:aws:dsql:us-east-1:000000000000:cluster/testcluster1234',
		},
	});
	const storage = new StorageStack(app, 'TestStorage', { env });
	const auth = new AuthStack(app, 'TestAuth', { env });
	const compute = new ComputeStack(app, 'TestCompute', {
		env,
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
function buildStagingStacks(extraContext: Record<string, string> = {}): {
	storage: StorageStack;
	auth: AuthStack;
	compute: ComputeStack;
} {
	const app = new cdk.App({
		context: {
			parentGateCookieSecret: 'test-parent-gate-secret-do-not-use-do-not-use',
			// #3438 Phase 2B: staging も prod と同型で無条件 DSQL (dual-mode 廃止)。endpoint は必須 (fail-close)。
			dsqlEndpoint: 'testcluster1234.dsql.us-east-1.on.aws',
			dsqlClusterArn: 'arn:aws:dsql:us-east-1:000000000000:cluster/testcluster1234',
			...extraContext,
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
		assetsBucket: storage.assetsBucket,
		repository: storage.repository,
		envConfig: STAGING_ENV_CONFIG,
	});
	return { storage, auth, compute };
}

/**
 * prod (envConfig 未指定 = 本番) の ComputeStack を任意 context で synth する。
 * S-5 (#4104 逆方向 allowlist) 用。
 */
function buildProdCompute(extraContext: Record<string, string> = {}): ComputeStack {
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
			// prod stack は cron-dispatcher を持つため #1586 fail-close で必須
			opsSecretKey: 'test-ops-secret-key',
			parentGateCookieSecret: 'test-parent-gate-secret-do-not-use-do-not-use',
			dsqlEndpoint: 'testcluster1234.dsql.us-east-1.on.aws',
			dsqlClusterArn: 'arn:aws:dsql:us-east-1:000000000000:cluster/testcluster1234',
			...extraContext,
		},
	});
	const storage = new StorageStack(app, 'TestStorageProdKeyGuard', { env });
	return new ComputeStack(app, 'TestComputeProdKeyGuard', {
		env,
		assetsBucket: storage.assetsBucket,
		repository: storage.repository,
	});
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
		it('P-1: Storage — DynamoDB table / Backup plan・selection を持たず Vault は RETAIN で残す (#3854 撤去 + #3881 class 回避 regression guard) / ECR=ganbari-quest (maxImageCount:10) / S3 prefix 不変', () => {
			// #3854 Deploy-2: #3850 の 2-deploy strangler の後半。Deploy-1 (#3855/#3864) が本番反映され
			// consumer(ComputeStack) の MainTable import が消失した後、StorageStack から MainTable +
			// BackupPlan/Selection/Role + 両 export を撤去した (export は in-use でないため削除成功)。
			// prod は removalPolicy=RETAIN のため物理 table + データは orphan 保全 (物理削除は別 ops)。
			// TableV2 は AWS::DynamoDB::GlobalTable として synth されるため、撤去後は両型とも 0 本になる。
			prodStorage.resourceCountIs('AWS::DynamoDB::GlobalTable', 0);
			prodStorage.resourceCountIs('AWS::DynamoDB::Table', 0);

			// BackupPlan / BackupSelection は table を参照する stateless リソースのため撤去済 =
			// 新規 backup は取らない。再度生やしたら CI で落ちる。
			prodStorage.resourceCountIs('AWS::Backup::BackupPlan', 0);
			prodStorage.resourceCountIs('AWS::Backup::BackupSelection', 0);

			// #3881 class 回避: 旧 MainTable 日次 backup 用 vault (ganbari-quest-vault) は recovery point
			// 2 件を保持し、AWS Backup が「recovery point 有り vault の削除」を拒否するため、撤去すると
			// deploy 失敗 → rollback → orphan になる。canonical 解 = vault を RETAIN-orphan で残す
			// (破壊的な backup データ削除は行わない)。vault は 1 本だけ存在し、DeletionPolicy は必ず
			// Retain (旧 removalPolicy DESTROY = DeletionPolicy Delete が CDK 既定 RETAIN に反していた元凶)。
			prodStorage.resourceCountIs('AWS::Backup::BackupVault', 1);
			const vaults = prodStorage.findResources('AWS::Backup::BackupVault');
			const vault = Object.values(vaults)[0] as {
				DeletionPolicy?: string;
				Properties: { BackupVaultName?: string };
			};
			expect(vault.DeletionPolicy).toBe('Retain');
			expect(vault.Properties.BackupVaultName).toBe('ganbari-quest-vault');

			const repos = prodStorage.findResources('AWS::ECR::Repository');
			expect(Object.keys(repos).length).toBe(1);
			const repo = Object.values(repos)[0] as {
				Properties: { RepositoryName?: string; LifecyclePolicy?: { LifecyclePolicyText?: string } };
			};
			expect(repo.Properties.RepositoryName).toBe('ganbari-quest');
			expect(repo.Properties.LifecyclePolicy?.LifecyclePolicyText).toContain('"countNumber":10');

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
						DATA_SOURCE: 'dsql',
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
			// CRON_JOBS 8 本 (compute-stack.ts CRON_JOBS SSOT。#3805 で analytics-aggregator-daily /
			// challenge-aggregator-daily の DynamoDB 事前集計 cron 2 本を撤去し 7→5 本、
			// #3959 で stripe-webhook-delivery-check を追加し 5→6 本、#4033 AC3-AC5 で
			// registry にありながら Rule が無かった age-recalc / grace-period-deletion を追加し 6→8 本)
			prodCompute.resourceCountIs('AWS::Events::Rule', 8);
			prodCompute.resourceCountIs('AWS::KinesisFirehose::DeliveryStream', 1);
			// #3939: L2 化で物理名は固定しない (CFN 自動命名)。固定名に戻すと旧→新置換が
			// 同名衝突で CFN fail する class が再発するため absent を固定する。
			prodCompute.hasResourceProperties('AWS::KinesisFirehose::DeliveryStream', {
				DeliveryStreamName: Match.absent(),
			});
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
						assetsBucket: storage.assetsBucket,
						repository: storage.repository,
					}),
			).toThrow(/cron-dispatcher requires cronSecret or opsSecretKey/);
		});
	});

	describe('#3854: MainTable cross-stack export 2-deploy migration 完遂 (Deploy-2)', () => {
		it('B-3854a: prod StorageStack は MainTable の Ref / Arn export を一切持たない (Deploy-2 撤去完了)', () => {
			// #3854 Deploy-2: Deploy-1 (#3850) が保持していた MainTable の Ref (table 名) / Arn の 2 本の
			// cross-stack export を撤去した。Deploy-1 が本番反映され consumer(Compute) の import が消失した
			// 後のため、両 export とも in-use ではなく安全に削除できた。撤去後は MainTable 由来 export が
			// 1 本も残らない (Ref = 0 / Arn = 0 / 集合 = 0)。旧 B-3850a の「Ref + Arn 両保持」assert を反転。
			const allMainTableExports = prodStorage.findOutputs('*', {
				Export: { Name: Match.stringLikeRegexp('ExportsOutput(Ref|FnGetAtt)MainTable.*') },
			});
			const refExport = prodStorage.findOutputs('*', {
				Export: { Name: Match.stringLikeRegexp('ExportsOutputRefMainTable[0-9A-F]+$') },
			});
			const arnExport = prodStorage.findOutputs('*', {
				Export: { Name: Match.stringLikeRegexp('ExportsOutputFnGetAttMainTable.*Arn.*') },
			});
			expect(Object.keys(refExport).length).toBe(0);
			expect(Object.keys(arnExport).length).toBe(0);
			expect(Object.keys(allMainTableExports).length).toBe(0);
		});

		it('B-3854b: prod ComputeStack は MainTable を import / grant しない (Deploy-1 で除去済、Deploy-2 でも不変)', () => {
			// consumer(Compute) が MainTable への参照を持たないこと (Deploy-1 #3438 で除去、Deploy-2 でも維持):
			//   (1) grantReadWriteData 由来の dynamodb: IAM policy が無い
			//   (2) ExportsOutputFnGetAttMainTable...Arn を Fn::ImportValue する箇所が無い
			// producer(Storage) 側で export を撤去できた前提 = consumer が既に非参照であること。
			const computeJson = JSON.stringify(prodCompute.toJSON());
			expect(computeJson).not.toContain('MainTable');
			const policies = prodCompute.findResources('AWS::IAM::Policy');
			expect(JSON.stringify(policies)).not.toContain('dynamodb:');
		});
	});

	describe('S-1: staging Storage — DynamoDB MainTable / Backup 不在 (#3854 Deploy-2 撤去完了) + ECR maxImageCount:3', () => {
		it('DynamoDB MainTable + Ref/Arn 両 export を持たない (#3854 Deploy-2、staging も prod と同型に撤去)', () => {
			// #3854 Deploy-2: staging も prod と同型に MainTable + 両 export を撤去した。撤去後は table・
			// export ともに 0 本。旧 S-1「MainTable=1 + Ref/Arn export 保持」assert を反転。
			stagingStorage.resourceCountIs('AWS::DynamoDB::GlobalTable', 0);
			stagingStorage.resourceCountIs('AWS::DynamoDB::Table', 0);
			const refExport = stagingStorage.findOutputs('*', {
				Export: { Name: Match.stringLikeRegexp('ExportsOutputRefMainTable[0-9A-F]+$') },
			});
			const arnExport = stagingStorage.findOutputs('*', {
				Export: { Name: Match.stringLikeRegexp('ExportsOutputFnGetAttMainTable.*Arn.*') },
			});
			const allMainTableExports = stagingStorage.findOutputs('*', {
				Export: { Name: Match.stringLikeRegexp('ExportsOutput(Ref|FnGetAtt)MainTable.*') },
			});
			expect(Object.keys(refExport).length).toBe(0);
			expect(Object.keys(arnExport).length).toBe(0);
			expect(Object.keys(allMainTableExports).length).toBe(0);
		});

		it('AWS Backup (vault / plan / selection) を構築しない (enableBackup=false)', () => {
			// staging は enableBackup=false (空 table 起点 + 使い捨て可能で backup 対象が無い) のため
			// vault / plan / selection とも一切構築しない。prod は #3881 class 回避で vault のみ
			// RETAIN-orphan で残す (P-1 参照) が、staging には残すべき recovery point が存在しないため
			// vault も出さない (env 分岐の非対称性は enableBackup gate が担保)。
			stagingStorage.resourceCountIs('AWS::Backup::BackupVault', 0);
			stagingStorage.resourceCountIs('AWS::Backup::BackupPlan', 0);
			stagingStorage.resourceCountIs('AWS::Backup::BackupSelection', 0);
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

		it('staging env: DATA_SOURCE=dsql + AUTH_MODE=cognito + ORIGIN placeholder + PARENT_GATE_COOKIE_SECRET 注入 (#3438 Phase 2A)', () => {
			stagingCompute.hasResourceProperties('AWS::Lambda::Function', {
				FunctionName: 'ganbari-quest-staging-app',
				Environment: {
					Variables: Match.objectLike({
						DATA_SOURCE: 'dsql',
						AUTH_MODE: 'cognito',
						// Function URL 自己参照のため synth 時は placeholder。
						// deploy-aws-staging.yml の ORIGIN resolve step が実 URL に更新する (縮退可)
						ORIGIN: 'https://staging-origin-placeholder.invalid',
						PARENT_GATE_COOKIE_SECRET: Match.stringLikeRegexp('^test-parent-gate-secret'),
					}),
				},
			});
		});

		it('外部サービス env (Discord / Gemini / SES / cron secret / Stripe price) を一切注入しない (副作用ゼロ)', () => {
			const functions = stagingCompute.findResources('AWS::Lambda::Function', {
				Properties: { FunctionName: 'ganbari-quest-staging-app' },
			});
			expect(Object.keys(functions).length).toBe(1);
			const fnDef = Object.values(functions)[0] as {
				Properties: { Environment?: { Variables?: Record<string, unknown> } };
			};
			const envVars = fnDef.Properties.Environment?.Variables ?? {};

			// #4104: Stripe は test mode 限定で注入する例外になったため本リストから外した
			// (test mode は本番顧客・本番決済に影響しない)。context 未注入の本 fixture では
			// 結果的に STRIPE_* が付かないことを下の「未注入なら env に付かない」test が固定する。
			// Discord / Gemini / SES / cron secret は従来どおり一切注入しない。
			const forbiddenEnvKeys = [
				'STRIPE_PRICE_STANDARD_MONTHLY',
				'STRIPE_PRICE_FAMILY_MONTHLY',
				'STRIPE_WEBHOOK_SHADOW_MODE',
				'STRIPE_WEBHOOK_SECRET_TEST',
				'GEMINI_API_KEY',
				'CRON_SECRET',
				'OPS_SECRET_KEY',
				// #4192: signup / billing / churn は**持たないと決めた**ため本番 Lambda にも存在しない
				// (#4174 Q2)。復活の検出は notification-channels-not-owned.test.ts が担うが、
				// demo / staging への漏洩 gate としては列挙を残す (二重防御)。
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

	describe('S-4: staging Stripe test mode (#4104) — test key のみ配備 / live は synth で停止', () => {
		/** staging Lambda の env Variables を取り出す。 */
		function stagingEnvOf(template: Template): Record<string, unknown> {
			const functions = template.findResources('AWS::Lambda::Function', {
				Properties: { FunctionName: 'ganbari-quest-staging-app' },
			});
			const fnDef = Object.values(functions)[0] as {
				Properties: { Environment?: { Variables?: Record<string, unknown> } };
			};
			return fnDef.Properties.Environment?.Variables ?? {};
		}

		it('test key を渡すと STRIPE_SECRET_KEY / STRIPE_WEBHOOK_SECRET / USE_LOOKUP_KEY が注入される', () => {
			const staging = buildStagingStacks({
				stagingStripeSecretKey: 'sk_test_0000000000000000000000000000',
				stagingStripeWebhookSecret: 'whsec_0000000000000000000000000000',
			});
			const env = stagingEnvOf(Template.fromStack(staging.compute as unknown as cdk.Stack));

			expect(env.STRIPE_SECRET_KEY).toBe('sk_test_0000000000000000000000000000');
			expect(env.STRIPE_WEBHOOK_SECRET).toBe('whsec_0000000000000000000000000000');
			// price id は lookup_key 経路で解決するため env を増やさない (#4104、secret 新規登録ゼロ)
			expect(env.USE_LOOKUP_KEY).toBe('true');
			expect(env.STRIPE_PRICE_STANDARD_MONTHLY).toBeUndefined();
			expect(env.STRIPE_PRICE_FAMILY_MONTHLY).toBeUndefined();
		});

		it('context 未注入なら STRIPE_* は env に付かない (従来どおり Stripe 無効で起動)', () => {
			const env = stagingEnvOf(stagingCompute);
			expect(env.STRIPE_SECRET_KEY).toBeUndefined();
			expect(env.STRIPE_WEBHOOK_SECRET).toBeUndefined();
			expect(env.USE_LOOKUP_KEY).toBeUndefined();
		});

		// #4104 条件 2 (PO): **実 live key は使わない**。prefix だけが本物のダミー文字列で検証する。
		// 判定を prefix の形にのみ依存させているのはこのため (Stripe API 疎通で実在性を見る実装にすると
		// ダミーで検証できなくなり、実証の代償が「live key を staging に配備する」= 不可逆になる)。
		// GitHub push protection はダミーでも Stripe key の「形」を検出して push を止めるため、
		// prefix と body を分けて組み立てる (file 上に完成形の文字列を置かない)。
		const dummyKey = (prefix: string) => `${prefix}_${'0'.repeat(28)}`;

		it.each([
			[dummyKey('sk_live'), 'live secret key (ダミー)'],
			[dummyKey('rk_live'), 'live restricted key (ダミー)'],
			[dummyKey('pk_test'), 'publishable key (secret ではない)'],
			['not-a-stripe-key', '未知の形式'],
		])('live / 非 test prefix (%s) は synth を停止する: %s', (key) => {
			const staging = buildStagingStacks({ stagingStripeSecretKey: key });
			// Annotations.addError は deploy 前 (cdk synth) に error として集約され deploy に進ませない。
			Annotations.fromStack(staging.compute as unknown as cdk.Stack).hasError(
				'*',
				Match.stringLikeRegexp('test mode の key ではありません'),
			);
		});

		it('webhook secret が whsec_ 以外なら synth を停止する', () => {
			const staging = buildStagingStacks({
				stagingStripeSecretKey: 'sk_test_0000000000000000000000000000',
				stagingStripeWebhookSecret: 'bogus_secret',
			});
			Annotations.fromStack(staging.compute as unknown as cdk.Stack).hasError(
				'*',
				Match.stringLikeRegexp('webhook signing secret'),
			);
		});

		it('test key のみ (正常系) では synth error が出ない', () => {
			const staging = buildStagingStacks({
				stagingStripeSecretKey: 'sk_test_0000000000000000000000000000',
				stagingStripeWebhookSecret: 'whsec_0000000000000000000000000000',
			});
			const errors = Annotations.fromStack(staging.compute as unknown as cdk.Stack).findError(
				'*',
				Match.anyValue(),
			);
			expect(errors).toHaveLength(0);
		});

		it('prod (envConfig 未指定) には staging Stripe context が影響しない (prod 不変)', () => {
			// staging 用 context を渡しても prod stack の env は従来の stripeSecretKey 経路のまま。
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
					dsqlEndpoint: 'testcluster1234.dsql.us-east-1.on.aws',
					dsqlClusterArn: 'arn:aws:dsql:us-east-1:000000000000:cluster/testcluster1234',
					// staging 専用 context (prod では読まれない)
					stagingStripeSecretKey: 'sk_test_0000000000000000000000000000',
				},
			});
			const storage = new StorageStack(app, 'TestStorageProdInvariant', { env });
			const compute = new ComputeStack(app, 'TestComputeProdInvariant', {
				env,
				assetsBucket: storage.assetsBucket,
				repository: storage.repository,
			});
			const template = Template.fromStack(compute as unknown as cdk.Stack);
			const functions = template.findResources('AWS::Lambda::Function', {
				Properties: { FunctionName: 'ganbari-quest-app' },
			});
			const fnDef = Object.values(functions)[0] as {
				Properties: { Environment?: { Variables?: Record<string, unknown> } };
			};
			const prodEnv = fnDef.Properties.Environment?.Variables ?? {};
			// prod は stripeSecretKey context 未指定なので Stripe secret env は付かない (従来挙動)。
			// staging 用 context (stagingStripeSecretKey) が prod 側に漏れていないことの確認。
			expect(prodEnv.STRIPE_SECRET_KEY).toBeUndefined();
			expect(prodEnv.STRIPE_WEBHOOK_SECRET).toBeUndefined();
			// USE_LOOKUP_KEY は prod では従来から `useLookupKey` context 由来で入る (既定 'true'、
			// #2716 PR-3b cutover)。staging 側の分岐とは別経路であることを固定する
			// (staging context を渡しても prod の値は prod の既定のまま)。
			expect(prodEnv.USE_LOOKUP_KEY).toBe('true');
		});
	});

	describe('S-5: 逆方向 — 本番に test key が入るのを止める (#4104 PO 指摘 2026-07-31)', () => {
		// staging に live が入る事故は二重の誤操作を要し単体では副作用が起きないのに対し、
		// 本番に test key が入る事故は単体で成立し、しかも無通知で成立する
		// (顧客の決済がすべて test mode に流れ、決済成功に見えたまま入金されない)。
		// 実害が大きいのは逆方向のため、prod 側にも同じ allowlist 形の gate を置く。
		const dummyKey = (prefix: string) => `${prefix}_${'0'.repeat(28)}`;

		it.each([
			[dummyKey('sk_test'), 'test secret key (ダミー)'],
			[dummyKey('rk_test'), 'test restricted key (ダミー)'],
			[dummyKey('pk_live'), 'publishable key (secret ではない)'],
			['not-a-stripe-key', '未知の形式'],
		])('本番に非 live prefix (%s) を渡すと synth を停止する: %s', (key) => {
			const compute = buildProdCompute({ stripeSecretKey: key });
			Annotations.fromStack(compute as unknown as cdk.Stack).hasError(
				'*',
				Match.stringLikeRegexp('live mode の key ではありません'),
			);
		});

		it('live prefix の key は synth を通す', () => {
			const compute = buildProdCompute({ stripeSecretKey: dummyKey('sk_live') });
			const errors = Annotations.fromStack(compute as unknown as cdk.Stack).findError(
				'*',
				Match.anyValue(),
			);
			expect(errors).toHaveLength(0);
		});

		it('stripeSecretKey 未指定 (local synth / staging deploy) は素通しする', () => {
			const compute = buildProdCompute();
			const errors = Annotations.fromStack(compute as unknown as cdk.Stack).findError(
				'*',
				Match.anyValue(),
			);
			expect(errors).toHaveLength(0);
		});
	});
});

// ---------------------------------------------------------------------------
// #4204: staging CloudFront。
//
// staging は NetworkStack を deploy していなかったため、SvelteKit の名前付き form action
// (`?/action`) が Lambda Function URL のクエリ文字列スラッシュ拒否に当たり、
// **ログインもサインアップもできない**状態だった (= 認証後の画面に到達する手段がゼロ)。
//
// prod 側は物理名が 2 件ハードコードされており、同一アカウント・同一リージョンに staging を
// 立てると衝突する。prefix 化で分離するが、**prod の物理名が 1 文字でも変わると
// CloudFront distribution / bucket が作り直しになる** (ADR-0019) ため、prod 不変を test で固定する。
// ---------------------------------------------------------------------------
/** アカウント / リージョンで一意になりうる「名前」プロパティ (#4204)。 */
const PHYSICAL_NAME_PROPS = new Set([
	'Name',
	'BucketName',
	'FunctionName',
	'CachePolicyName',
	'OriginRequestPolicyName',
	'ResponseHeadersPolicyName',
]);

/** CFN template を再帰的に歩き、物理名として使われている文字列を集める (#4204)。 */
function collectPhysicalNames(t: Template): string[] {
	const found: string[] = [];
	const walk = (node: unknown): void => {
		if (Array.isArray(node)) {
			for (const v of node) walk(v);
			return;
		}
		if (!node || typeof node !== 'object') return;
		for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
			if (typeof v === 'string' && PHYSICAL_NAME_PROPS.has(k)) found.push(v);
			walk(v);
		}
	};
	walk(t.toJSON().Resources ?? {});
	return found;
}

describe('#4204 staging CloudFront (NetworkStack)', () => {
	function buildNetwork(staging: boolean): Template {
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
				dsqlEndpoint: 'testcluster1234.dsql.us-east-1.on.aws',
				dsqlClusterArn: 'arn:aws:dsql:us-east-1:000000000000:cluster/testcluster1234',
			},
		});
		const envConfig = staging ? STAGING_ENV_CONFIG : undefined;
		// stack id は bin/app.ts と同じにする。CloudFront OriginAccessControl 等
		// **CDK が construct path から自動生成する名前**があり、id を揃えないと
		// 実際には衝突しないものを衝突として検出してしまう (逆も同様)。
		const suffix = staging ? 'Staging' : '';
		const storage = new StorageStack(app, `GanbariQuestStorage${suffix}`, { env, envConfig });
		const compute = new ComputeStack(app, `GanbariQuestCompute${suffix}`, {
			env,
			assetsBucket: storage.assetsBucket,
			repository: storage.repository,
			envConfig,
		});
		const network = new NetworkStack(app, `GanbariQuestNetwork${suffix}`, {
			env,
			functionUrl: compute.functionUrl,
			...(staging
				? { resourcePrefix: STAGING_ENV_CONFIG.resourcePrefix, geoRestrictionCountries: [] }
				: {}),
		});
		return Template.fromStack(network);
	}

	// [N-1] prod 不変 (ADR-0019)。物理名が変わると distribution / bucket が作り直しになる。
	it('prod の物理名と地域制限は従来どおり (prefix 化で変わらない)', () => {
		const t = buildNetwork(false);
		t.hasResourceProperties('AWS::CloudFront::Function', {
			Name: 'ganbari-quest-query-slash-encode',
		});
		t.hasResourceProperties('AWS::S3::Bucket', {
			BucketName: 'ganbari-quest-error-pages-000000000000',
		});
		t.hasResourceProperties('AWS::CloudFront::Distribution', {
			DistributionConfig: Match.objectLike({
				Restrictions: {
					GeoRestriction: { RestrictionType: 'whitelist', Locations: ['JP'] },
				},
			}),
		});
	});

	// [N-2] staging は prefix 分離する。同一アカウント・同一リージョンで物理名が衝突するため。
	it('staging の物理名は prefix で分離される', () => {
		const t = buildNetwork(true);
		t.hasResourceProperties('AWS::CloudFront::Function', {
			Name: 'ganbari-quest-staging-query-slash-encode',
		});
		t.hasResourceProperties('AWS::S3::Bucket', {
			BucketName: 'ganbari-quest-staging-error-pages-000000000000',
		});
	});

	// [N-3] staging は地域制限なし。post-deploy smoke を回す GitHub runner が日本国外にあり、
	// JP allowlist を残すと 403 で smoke が回らない。
	// 前提 = staging に本番データが入っていないこと (PO 実測 2026-08-02)。
	// **staging に本番データを入れる運用が生まれたら JP allowlist を戻す** (PO 条件)。
	it('staging は geoRestriction を持たない', () => {
		const t = buildNetwork(true);
		const distributions = t.findResources('AWS::CloudFront::Distribution');
		for (const d of Object.values(distributions)) {
			expect(
				(d as { Properties?: { DistributionConfig?: { Restrictions?: unknown } } }).Properties
					?.DistributionConfig?.Restrictions,
			).toBeUndefined();
		}
	});

	// [N-4] 本題。これが無いと staging で form action が 1 つも通らない。
	it('staging の default behavior に query-slash-encode Function が付いている', () => {
		const t = buildNetwork(true);
		t.hasResourceProperties('AWS::CloudFront::Distribution', {
			DistributionConfig: Match.objectLike({
				DefaultCacheBehavior: Match.objectLike({
					FunctionAssociations: Match.arrayWith([
						Match.objectLike({ EventType: 'viewer-request' }),
					]),
				}),
			}),
		});
	});

	// [N-4b] **この class の網羅 guard。**
	//
	// 目視で拾った物理名は 2 件だったが、実際には 4 件あった (CloudFront CachePolicy 名は
	// アカウント全体で一意で、staging deploy が 409 AlreadyExists で ROLLBACK した)。
	// 「1 件ずつ prefix を付ける」対処では次に足された名前をまた取りこぼすため、
	// **prod と staging で同じ物理名を 1 つも共有していないこと**を集合として突き合わせる。
	it('prod と staging の NetworkStack が物理名を 1 つも共有しない', () => {
		const prodNames = new Set(collectPhysicalNames(buildNetwork(false)));
		const stagingNames = collectPhysicalNames(buildNetwork(true));
		const shared = stagingNames.filter((n) => prodNames.has(n));
		expect(
			shared,
			`prod と同じ物理名を staging が使っている (同一アカウント・同一リージョンで衝突する): ${shared.join(', ')}`,
		).toEqual([]);
		// 空集合同士の比較で緑になるのを防ぐ (名前を 1 つも拾えていなければ検査が成立していない)。
		expect(prodNames.size).toBeGreaterThan(0);
		expect(stagingNames.length).toBeGreaterThan(0);
	});

	// [N-1b] prod 不変の根拠を「既定値」だけに預けない (adversarial review business 軸)。
	//
	// prod の物理名は `resourcePrefix` の既定値が 'ganbari-quest' であることだけで守られている。
	// **app.ts が prod 側にも resourcePrefix / geoRestrictionCountries を渡し始めた瞬間**、
	// CloudFront Distribution / bucket / CachePolicy が一斉に Replacement になり本番が落ちる
	// (ADR-0019)。呼び出し側が変わったことを検出する。
	it('bin/app.ts が prod の NetworkStack に prefix / geoRestriction を渡していない', async () => {
		const { readFileSync } = await import('node:fs');
		const src = readFileSync('infra/bin/app.ts', 'utf8');
		// prod の instantiate は `new NetworkStack(app, \`${appName}Network\`, {` から対応する `});` まで。
		// 正規表現で探す (通常文字列に `${` を書くと biome noTemplateCurlyInString に当たる)。
		const start = src.search(/new NetworkStack\(app, `\$\{appName\}Network`/);
		expect(start, 'prod NetworkStack の instantiate が見つからない').toBeGreaterThan(-1);
		const prodBlock = src.slice(start, src.indexOf('\n\t});', start));
		expect(prodBlock).not.toContain('resourcePrefix');
		expect(prodBlock).not.toContain('geoRestrictionCountries');
	});

	// [N-7] geoRestriction を外したことの代償を、人の注意力ではなく機械で見張る (PO 決裁 2026-08-02)。
	//
	// staging を全世界公開にした前提は「実在のメールアドレスを登録しない」という運用ルール。
	// **人が守るなら、守られなかったことに気づく手段がいる。**
	it('staging に allowlist 外のメールが登録されたら気づける', async () => {
		const { readFileSync } = await import('node:fs');
		const yml = readFileSync('.github/workflows/deploy-aws-staging.yml', 'utf8');

		// 許可ドメインは **宣言**する。「使い捨てっぽい」の推測判定は穴になるため置かない。
		// 参照 (`$STAGING_ALLOWED_EMAIL_DOMAINS`) が残っていても宣言が消えていれば
		// 全ドメインが allowlist 外になり通知が壊れるので、**宣言側**を見る。
		// 正規表現の m フラグで行頭を見る (env の宣言行だけに当てる)。
		const hasDeclaration = /^ {2}STAGING_ALLOWED_EMAIL_DOMAINS: *[a-z]/m.test(yml);
		expect(hasDeclaration, '許可ドメインの宣言 (workflow env) が見つかりません').toBe(true);
		// 実登録者を実物から取る (synth や設定値ではなく Cognito を見る)
		expect(yml).toContain('cognito-idp list-users');
		// 気づける先 = incident チャネル
		expect(yml).toContain('DISCORD_WEBHOOK_INCIDENT');

		// **deploy は止めない** (既に登録済のものは手遅れで、止めても意味がない)。
		const guard = yml.slice(yml.indexOf('- name: Staging PII guard'));
		expect(guard.slice(0, guard.indexOf('- name: ', 10))).toContain('continue-on-error: true');
	});

	// [N-8] 許可ドメインの二重管理を作らない。runbook にリストを複製すると必ずズレる。
	it('runbook は allowlist を複製せず workflow を SSOT として参照する', async () => {
		const { readFileSync } = await import('node:fs');
		const runbook = readFileSync('docs/runbooks/staging-live-verification.md', 'utf8');
		expect(runbook).toContain('STAGING_ALLOWED_EMAIL_DOMAINS');
		// #4117 の担当者が最初に読む場所に警告があること
		expect(runbook.slice(0, 1200)).toContain('実在のメールアドレスを登録しない');
	});

	// [N-5] 配線の no-silent-gap。CDK 側が正しくても deploy 対象に入っていなければ意味がない。
	it('deploy-aws-staging.yml の STAGING_STACKS に NetworkStaging が含まれる', async () => {
		const { readFileSync } = await import('node:fs');
		const yml = readFileSync('.github/workflows/deploy-aws-staging.yml', 'utf8');
		const line = yml.split(/\r?\n/).find((l) => l.trim().startsWith('STAGING_STACKS:'));
		expect(line).toBeDefined();
		expect(line).toContain('GanbariQuestNetworkStaging');
	});

	// [N-6] ORIGIN / smoke は CloudFront を入口にする。Function URL 直だと form action は
	// 原理的に通らないため、入口がズレていると smoke が本物を検証しない。
	it('smoke と ORIGIN が CloudFront を入口にしている', async () => {
		const { readFileSync } = await import('node:fs');
		const yml = readFileSync('.github/workflows/deploy-aws-staging.yml', 'utf8');
		expect(yml).toContain('DistributionDomainName');
		expect(yml).toContain('/auth/login?/login');
		// status code では判定しない (ログイン失敗も 400 を返すため)。
		expect(yml).toContain('x-frame-options');
	});
});
