// tests/unit/infra/cloudwatch-retention.test.ts
//
// Issue #2735 / QA Adversarial security 軸 推奨: CloudWatch Logs retention 30+ SSOT 検証。
//
// 課金 path 系統 (Stripe webhook / checkout / getPriceId fallback alert) の structured log を受ける
// `/aws/lambda/ganbari-quest-app` LogGroup の retention が 30 日以上に保持されていることを assert する
// regression test。本 retention は `docs/operations/stripe-post-mortem-runbook.md` §4 SSOT 整合、
// post-mortem triage に必要な期間 (Pre-PMF Bucket A、ADR-0010 課金別格慎重対処整合)。
//
// CDK で retention を 30 日未満に下げる PR は本 test で fail する (load-bearing regression):
//   - QA Adversarial security 軸 BLOCK 対象 (#2735 SSOT 違反)
//   - Pre-PMF Bucket A 課金別格違反 (feedback_billing_critical_extra_caution)
//
// 設計 SSOT:
//   - infra/lib/compute-stack.ts AppLogGroup 定義 (`RetentionDays.ONE_MONTH`)
//   - docs/design/billing-redesign/phase6-rollback-and-kill-switches.md §5.7-a
//   - docs/operations/stripe-post-mortem-runbook.md §4

import * as cdk from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { beforeAll, describe, expect, it } from 'vitest';
import { ComputeStack } from '../../../infra/lib/compute-stack';
import { StorageStack } from '../../../infra/lib/storage-stack';

function makeApp(): cdk.App {
	return new cdk.App({
		context: {
			'hosted-zone:account=000000000000:domainName=ganbari-quest.com:region=us-east-1': {
				Id: '/hostedzone/Z00000000000000000000',
				Name: 'ganbari-quest.com.',
			},
			'ssm:account=000000000000:parameterName=/ganbari-quest/cognito/user-pool-id:region=us-east-1':
				'us-east-1_TESTPOOL',
			'ssm:account=000000000000:parameterName=/ganbari-quest/cognito/client-id:region=us-east-1':
				'test-client-id',
			'ssm:account=000000000000:parameterName=/ganbari-quest/cognito/domain:region=us-east-1':
				'auth.ganbari-quest.com',
			'ssm:account=000000000000:parameterName=/ganbari-quest/context-token-secret:region=us-east-1':
				'test-context-token-secret',
			awsLicenseSecret: 'test-license-secret',
			opsSecretKey: 'test-ops-secret-key',
			parentGateCookieSecret: 'test-parent-gate-secret-do-not-use-do-not-use',
		},
	});
}

const env: cdk.Environment = { account: '000000000000', region: 'us-east-1' };

let computeTemplate: Template;

beforeAll(() => {
	const app = makeApp();
	const storage = new StorageStack(app, 'TestStorage', { env });
	const compute = new ComputeStack(app, 'TestCompute', {
		env,
		table: storage.table,
		assetsBucket: storage.assetsBucket,
		repository: storage.repository,
	});
	computeTemplate = Template.fromStack(compute as unknown as cdk.Stack);
}, 60_000);

describe('CloudWatch Logs retention (#2735 / QA Adversarial security 軸)', () => {
	it('AppLogGroup (本番課金 path) の retention は 30 日以上 (load-bearing regression)', () => {
		// AppLogGroup は `/aws/lambda/ganbari-quest-app` で本番 Stripe webhook / checkout /
		// getPriceId fallback alert の structured log を受ける。
		// post-mortem triage (docs/operations/stripe-post-mortem-runbook.md §2 query) に必要な
		// 期間として 30 日以上を SSOT として固定する。
		const logGroups = computeTemplate.findResources('AWS::Logs::LogGroup', {
			Properties: { LogGroupName: '/aws/lambda/ganbari-quest-app' },
		});
		expect(Object.keys(logGroups).length).toBe(1);
		const logGroup = Object.values(logGroups)[0] as {
			Properties: { RetentionInDays?: number };
		};
		// 30 日以上であることを assert (30 / 60 / 90 / 365 等は OK、未満は fail)
		const retention = logGroup.Properties.RetentionInDays;
		expect(retention).toBeGreaterThanOrEqual(30);
	});

	it('CronDispatcher LogGroup は 3 日 retention 維持 (Stripe API call せず、AppLogGroup に集約)', () => {
		// cron-dispatcher は HTTP POST で SvelteKit /api/cron/:job を呼ぶだけで Stripe API call せず、
		// Stripe 関連 log は呼び出し先 (SvelteKit Lambda = AppLogGroup) 側に集約される。
		// よって本 LogGroup は 3 日維持で十分 (Pre-PMF cost 最適化、ADR-0010 整合)。
		const logGroups = computeTemplate.findResources('AWS::Logs::LogGroup', {
			Properties: { LogGroupName: '/aws/lambda/ganbari-quest-cron-dispatcher' },
		});
		expect(Object.keys(logGroups).length).toBe(1);
		const logGroup = Object.values(logGroups)[0] as {
			Properties: { RetentionInDays?: number };
		};
		expect(logGroup.Properties.RetentionInDays).toBe(3);
	});

	it('Demo LogGroup は 3 日 retention 維持 (demo Lambda は課金 path 到達不可、IAM isolation 整合)', () => {
		// demo Lambda は IAM isolation で本番 DynamoDB / Cognito / Secrets Manager / SES に到達不可
		// (tests/unit/infra/multi-lambda-cdk.test.ts C-1)、課金 path に到達できないため
		// 3 日 retention で十分。
		const logGroups = computeTemplate.findResources('AWS::Logs::LogGroup', {
			Properties: { LogGroupName: '/aws/lambda/ganbari-quest-app-demo' },
		});
		expect(Object.keys(logGroups).length).toBe(1);
		const logGroup = Object.values(logGroups)[0] as {
			Properties: { RetentionInDays?: number };
		};
		expect(logGroup.Properties.RetentionInDays).toBe(3);
	});
});
