// tests/unit/infra/multi-lambda-cdk.test.ts
// #2097 ADR-0048 week 4 — Multi-Lambda Demo Deployment の CDK 構造検証。
//
// このテストは「IAM isolation regression test」として load-bearing。
// demo Lambda は本番 DynamoDB / Cognito User Pool / Secrets Manager / SES へのアクセス権限を
// 一切持たないことを synth-time に assertion する。
// 将来「demo に DynamoDB アクセスを追加した方が楽」と誤って grant した瞬間に CI が落ちる。
//
// 検証項目 (Issue #2097 week 4 AC):
//   C-1. demo IAM role の Policy.PolicyDocument に DynamoDB / Secrets Manager / Cognito / SES
//        の ARN が一切含まれない (IAM isolation regression test)
//   C-2. NetworkStack に CloudFront Distribution が 2 本ある (本番 + demo)
//        - 1 本は alias `ganbari-quest.com` を含む
//        - 1 本は alias `demo.ganbari-quest.com` を含む
//   C-3. demo Fn の環境変数に DATA_SOURCE='demo' と AUTH_MODE='anonymous' が含まれる
//
// 参考: docs/decisions/ ADR-0048 (Multi-Lambda Demo Deployment)
//        infra/lib/compute-stack.ts (demo Fn / DemoLambdaRole / DemoAlias)
//        infra/lib/network-stack.ts (demoDistribution)

import * as cdk from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { beforeAll, describe, expect, it } from 'vitest';
import { ComputeStack } from '../../../infra/lib/compute-stack';
import { NetworkStack } from '../../../infra/lib/network-stack';
import { StorageStack } from '../../../infra/lib/storage-stack';

// CDK synth は重い (1 stack あたり ~1.5s)。テストごとに synth すると 5s タイムアウト超過するため、
// suite 全体で 1 回のみ synth してテンプレートを共有する。
// テストは Template (read-only) の assertion のみなので相互干渉しない。

// cspell:ignore hostedzone TESTPOOL
// Pre-populated cdk context: route53 + acm の fromLookup が credentials を要求するため、
// CDK_DEFAULT_ACCOUNT と 本番と同じ hosted-zone lookup の cache を test の app に直接注入する。
// 値は CDK synth が CFN を生成するためだけに使われ、AWS API は呼ばない。
function makeApp(): cdk.App {
	const app = new cdk.App({
		context: {
			'hosted-zone:account=000000000000:domainName=ganbari-quest.com:region=us-east-1': {
				Id: '/hostedzone/Z00000000000000000000',
				Name: 'ganbari-quest.com.',
			},
			// SSM パラメータ stub (compute-stack.ts が ssm.StringParameter.valueForStringParameter で参照)
			'ssm:account=000000000000:parameterName=/ganbari-quest/cognito/user-pool-id:region=us-east-1':
				'us-east-1_TESTPOOL',
			'ssm:account=000000000000:parameterName=/ganbari-quest/cognito/client-id:region=us-east-1':
				'test-client-id',
			'ssm:account=000000000000:parameterName=/ganbari-quest/cognito/domain:region=us-east-1':
				'auth.ganbari-quest.com',
			'ssm:account=000000000000:parameterName=/ganbari-quest/context-token-secret:region=us-east-1':
				'test-context-token-secret',
			// compute-stack.ts が tryGetContext で読む context
			awsLicenseSecret: 'test-license-secret',
			opsSecretKey: 'test-ops-secret-key',
		},
	});
	return app;
}

const env: cdk.Environment = { account: '000000000000', region: 'us-east-1' };

function buildStacks(): {
	storage: StorageStack;
	compute: ComputeStack;
	network: NetworkStack;
} {
	const app = makeApp();
	const storage = new StorageStack(app, 'TestStorage', { env });
	const compute = new ComputeStack(app, 'TestCompute', {
		env,
		table: storage.table,
		assetsBucket: storage.assetsBucket,
		repository: storage.repository,
	});
	const network = new NetworkStack(app, 'TestNetwork', {
		env,
		functionUrl: compute.functionUrl,
		domainName: 'ganbari-quest.com',
		certificateArn: 'arn:aws:acm:us-east-1:000000000000:certificate/test',
		demoFunctionUrl: compute.demoFunctionUrl,
	});
	return { storage, compute, network };
}

// Helper: 1 つの IAM Policy 資源が DemoLambdaRole に attach されているか判定する。
function isPolicyAttachedToDemoRole(props: Record<string, unknown>): boolean {
	const roles = (props.Roles as Array<Record<string, unknown>> | undefined) ?? [];
	return roles.some((roleRef) => {
		const ref = roleRef.Ref as string | undefined;
		return typeof ref === 'string' && ref.startsWith('DemoLambdaRole');
	});
}

// Helper: IAM Policy 内の Statement[].Action 配列を平坦化する。
function extractActions(props: Record<string, unknown>): string[] {
	const doc = props.PolicyDocument as { Statement?: Array<Record<string, unknown>> } | undefined;
	const statements = doc?.Statement ?? [];
	const actions: string[] = [];
	for (const stmt of statements) {
		const a = stmt.Action;
		if (Array.isArray(a)) {
			for (const v of a) if (typeof v === 'string') actions.push(v);
		} else if (typeof a === 'string') {
			actions.push(a);
		}
	}
	return actions;
}

let computeTemplate: Template;
let networkTemplate: Template;

beforeAll(() => {
	const { compute, network } = buildStacks();
	computeTemplate = Template.fromStack(compute as unknown as cdk.Stack);
	networkTemplate = Template.fromStack(network as unknown as cdk.Stack);
}, 60_000); // CDK synth は重い (Compute + Network で 3-5s)

describe('ADR-0048 Multi-Lambda Demo Deployment (#2097 week 4)', () => {
	describe('C-1: demo IAM role isolation (load-bearing security control)', () => {
		it('demo Lambda role の ManagedPolicy は AWSLambdaBasicExecutionRole のみ', () => {
			const template = computeTemplate;

			// IAM Role リソースから ManagedPolicyArns を取り出して文字列化検証する。
			// (Match.anyValue() は arrayWith 内では使えない CDK assertions 制約のため、findResources で直接確認する)
			const roles = template.findResources('AWS::IAM::Role', {
				Properties: { RoleName: 'ganbari-quest-app-demo-role' },
			});
			expect(Object.keys(roles).length).toBe(1);
			const role = Object.values(roles)[0] as {
				Properties: { ManagedPolicyArns?: unknown[] };
			};
			const managedPolicies = role.Properties.ManagedPolicyArns ?? [];
			expect(managedPolicies.length).toBe(1);

			// ManagedPolicyArn は CFN intrinsic ({ 'Fn::Join': ['', [...]] }) で表現される。
			// JSON シリアライズ後に AWSLambdaBasicExecutionRole を含むかを文字列レベルで確認する。
			const serialized = JSON.stringify(managedPolicies[0]);
			expect(serialized).toContain(':iam::aws:policy/service-role/AWSLambdaBasicExecutionRole');
		});

		it('demo IAM role に DynamoDB / Cognito / Secrets Manager / SES への inline policy が無い', () => {
			const template = computeTemplate;

			// demo Fn が利用する Role の論理 ID は DemoLambdaRole<hash>
			// すべての AWS::IAM::Policy 資源を走査し、demo Role に attach されていないことを確認する。
			const policies = template.findResources('AWS::IAM::Policy');
			const forbiddenActionPrefixes = [
				'dynamodb:',
				'secretsmanager:',
				'cognito-idp:',
				'cognito-identity:',
				'ses:',
			];

			for (const [policyLogicalId, policyDef] of Object.entries(policies)) {
				const props = (policyDef as { Properties?: Record<string, unknown> }).Properties ?? {};
				if (!isPolicyAttachedToDemoRole(props)) continue;

				const actions = extractActions(props);
				for (const action of actions) {
					const violatedPrefix = forbiddenActionPrefixes.find((p) => action.startsWith(p));
					expect(
						violatedPrefix,
						`demo IAM role (policy ${policyLogicalId}) MUST NOT grant ${violatedPrefix ?? '<n/a>'}* but found ${action}`,
					).toBeUndefined();
				}
			}
		});

		it('demo Lambda の Role property は DemoLambdaRole を参照する (prod Role を共有しない)', () => {
			const template = computeTemplate;

			template.hasResourceProperties('AWS::Lambda::Function', {
				FunctionName: 'ganbari-quest-app-demo',
				Role: {
					'Fn::GetAtt': Match.arrayWith([Match.stringLikeRegexp('^DemoLambdaRole'), 'Arn']),
				},
			});
		});
	});

	describe('C-2: CloudFront distribution count (prod + demo)', () => {
		it('NetworkStack に CloudFront Distribution が 2 本ある', () => {
			const template = networkTemplate;
			template.resourceCountIs('AWS::CloudFront::Distribution', 2);
		});

		it('1 本は alias ganbari-quest.com を含む (本番)', () => {
			const template = networkTemplate;

			const distributions = template.findResources('AWS::CloudFront::Distribution');
			const aliases = Object.values(distributions).flatMap((d) => {
				const cfg =
					(d as { Properties?: { DistributionConfig?: { Aliases?: string[] } } }).Properties
						?.DistributionConfig?.Aliases ?? [];
				return cfg;
			});
			expect(aliases).toContain('ganbari-quest.com');
		});

		it('1 本は alias demo.ganbari-quest.com を含む (demo)', () => {
			const template = networkTemplate;

			const distributions = template.findResources('AWS::CloudFront::Distribution');
			const aliases = Object.values(distributions).flatMap((d) => {
				const cfg =
					(d as { Properties?: { DistributionConfig?: { Aliases?: string[] } } }).Properties
						?.DistributionConfig?.Aliases ?? [];
				return cfg;
			});
			expect(aliases).toContain('demo.ganbari-quest.com');
		});

		it('Route 53 ALIAS A record demo.ganbari-quest.com が demo distribution を指す', () => {
			const template = networkTemplate;

			template.hasResourceProperties('AWS::Route53::RecordSet', {
				Type: 'A',
				Name: 'demo.ganbari-quest.com.',
				AliasTarget: Match.objectLike({
					DNSName: Match.objectLike({
						'Fn::GetAtt': Match.arrayWith([Match.stringLikeRegexp('^DemoCDN'), 'DomainName']),
					}),
				}),
			});
		});
	});

	describe('C-3: demo Fn environment variables', () => {
		it('DATA_SOURCE=demo + AUTH_MODE=anonymous が注入される', () => {
			const template = computeTemplate;

			template.hasResourceProperties('AWS::Lambda::Function', {
				FunctionName: 'ganbari-quest-app-demo',
				Environment: {
					Variables: Match.objectLike({
						DATA_SOURCE: 'demo',
						AUTH_MODE: 'anonymous',
					}),
				},
			});
		});

		it('demo Fn の env に本番 secret (STRIPE / GEMINI / COGNITO / LICENSE / DYNAMODB) が含まれない', () => {
			const template = computeTemplate;

			const functions = template.findResources('AWS::Lambda::Function', {
				Properties: { FunctionName: 'ganbari-quest-app-demo' },
			});
			expect(Object.keys(functions).length).toBe(1);

			const demoFnDef = Object.values(functions)[0] as {
				Properties: { Environment?: { Variables?: Record<string, unknown> } };
			};
			const envVars = demoFnDef.Properties.Environment?.Variables ?? {};

			const forbiddenEnvKeys = [
				'STRIPE_SECRET_KEY',
				'STRIPE_WEBHOOK_SECRET',
				'STRIPE_PRICE_MONTHLY',
				'STRIPE_PRICE_YEARLY',
				'STRIPE_PRICE_FAMILY_MONTHLY',
				'STRIPE_PRICE_FAMILY_YEARLY',
				'GEMINI_API_KEY',
				'COGNITO_USER_POOL_ID',
				'COGNITO_CLIENT_ID',
				'COGNITO_DOMAIN',
				'COGNITO_CALLBACK_URL',
				'CONTEXT_TOKEN_SECRET',
				'AWS_LICENSE_SECRET',
				'DYNAMODB_TABLE',
				'TABLE_NAME',
				'ANALYTICS_TABLE_NAME',
				'ASSETS_BUCKET',
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
					`demo Lambda env MUST NOT contain ${key} (production secret leakage)`,
				).toBeUndefined();
			}
		});

		it('demo Fn は ARM64 + 256MB memory', () => {
			const template = computeTemplate;

			template.hasResourceProperties('AWS::Lambda::Function', {
				FunctionName: 'ganbari-quest-app-demo',
				Architectures: ['arm64'],
				MemorySize: 256,
			});
		});

		it('demo Fn URL は authType=NONE', () => {
			const template = computeTemplate;

			template.hasResourceProperties('AWS::Lambda::Url', {
				AuthType: 'NONE',
				TargetFunctionArn: Match.objectLike({
					'Fn::GetAtt': Match.arrayWith([Match.stringLikeRegexp('^SvelteKitDemoFn'), 'Arn']),
				}),
			});
		});

		it('demo Fn は Provisioned Concurrency を持たない (AWS quota 不足 + 予算制約により未採用、PO 判断 2026-05-15)', () => {
			const template = computeTemplate;

			// Lambda Alias リソース自体が存在しないことを assert
			// (cron-dispatcher 等で Alias を使うようになった場合は filter 条件を限定すること)
			const aliases = template.findResources('AWS::Lambda::Alias');
			const demoLiveAliases = Object.entries(aliases).filter(
				([_, def]) =>
					(def as { Properties?: { Name?: string; FunctionName?: unknown } }).Properties?.Name ===
					'live',
			);
			expect(demoLiveAliases.length).toBe(0);
		});
	});

	describe('production Lambda preservation (zero regression on prod Fn)', () => {
		it('production Fn は DATA_SOURCE=dynamodb + AUTH_MODE=cognito を維持する', () => {
			const template = computeTemplate;

			template.hasResourceProperties('AWS::Lambda::Function', {
				FunctionName: 'ganbari-quest-app',
				Environment: {
					Variables: Match.objectLike({
						DATA_SOURCE: 'dynamodb',
						AUTH_MODE: 'cognito',
					}),
				},
			});
		});

		it('production Fn と demo Fn は別 IAM role を使う', () => {
			const template = computeTemplate;

			const functions = template.findResources('AWS::Lambda::Function');
			let prodRoleRef: unknown;
			let demoRoleRef: unknown;
			for (const fn of Object.values(functions)) {
				const props = (fn as { Properties?: Record<string, unknown> }).Properties ?? {};
				const name = props.FunctionName;
				if (name === 'ganbari-quest-app') {
					prodRoleRef = props.Role;
				} else if (name === 'ganbari-quest-app-demo') {
					demoRoleRef = props.Role;
				}
			}
			expect(prodRoleRef).toBeDefined();
			expect(demoRoleRef).toBeDefined();
			expect(JSON.stringify(prodRoleRef)).not.toEqual(JSON.stringify(demoRoleRef));
		});
	});
});
