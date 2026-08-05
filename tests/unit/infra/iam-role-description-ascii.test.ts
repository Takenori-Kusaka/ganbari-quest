// tests/unit/infra/iam-role-description-ascii.test.ts
// #3870 — 全 stack の AWS::IAM::Role の Description は AWS IAM 制約 (ASCII / Latin-1、U+00FF 以下)
// のみ許容されるため、日本語等の U+0100 以上を含めると deploy 時に InvalidRequest → CREATE_FAILED
// → stack rollback になる (第16回リリースで DsqlBackupRole の日本語 description が本番 deploy を
// rollback させた回帰。CfnOutput / Alarm / SSM description には ASCII 制約が無く、IAM Role /
// ManagedPolicy の description のみが対象)。
//
// AWS IAM description の許容文字集合 (AWS 公式 regex 相当):
//   - tab (U+0009) / line feed (U+000A) / carriage return (U+000D)
//   - printable ASCII (U+0020-U+007E)
//   - Latin-1 Supplement の印字可能文字 (U+00A1-U+00FF)
// 日本語 (U+3000 以上) はこの集合外なので必ず fail する。
//
// このテストは fitness function (Architecture Fitness Function、ADR-0061 same-class→guard) として、
// DSQL に限らず**全 stack の全 IAM Role** を対象にし、将来どの stack で IAM Role/ManagedPolicy に
// 日本語 description を書いても CI で落ちるようにする (本番 deploy 前の synth-time 捕捉)。
//
// 参考: infra/lib/dsql-stack.ts (DsqlBackupRole) / infra/CLAUDE.md §IAM description ASCII 制約 /
//        docs/design/13-AWSサーバレスアーキテクチャ設計書.md

import * as cdk from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { describe, expect, it } from 'vitest';
import { AuthStack } from '../../../infra/lib/auth-stack';
import { ComputeStack } from '../../../infra/lib/compute-stack';
import { DsqlStack } from '../../../infra/lib/dsql-stack';
import { STAGING_ENV_CONFIG } from '../../../infra/lib/env-config';
import { NetworkStack } from '../../../infra/lib/network-stack';
import { OpsStack } from '../../../infra/lib/ops-stack';
import { SesStack } from '../../../infra/lib/ses-stack';
import { StorageStack } from '../../../infra/lib/storage-stack';

const env: cdk.Environment = { account: '000000000000', region: 'us-east-1' };

// AWS IAM description 許容文字集合 (U+00FF 以下、AWS 公式制約相当)。
const IAM_DESCRIPTION_ALLOWED = /^[\t\n\r\x20-\x7E\xA1-\xFF]*$/;

// cspell:ignore hostedzone TESTPOOL
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
			opsSecretKey: 'test-ops-secret-key',
			// #4266: admin IP allowlist の宣言なしに NetworkStack は synth できない (RFC 5737 TEST-NET-3)。
			adminAllowedIps: '203.0.113.1',
			parentGateCookieSecret: 'test-parent-gate-secret-do-not-use-do-not-use',
			dsqlEndpoint: 'testcluster1234.dsql.us-east-1.on.aws',
			dsqlClusterArn: 'arn:aws:dsql:us-east-1:000000000000:cluster/testcluster1234',
		},
	});
}

/**
 * bin/app.ts が instantiate し得る全 stack (prod 6 stack + Dsql + Dsql staging + AWS staging 3 stack)
 * の Template を [stack 名, Template] のペアで返す。IAM Role の網羅性を最大化するため、context gate
 * を要する stack も明示 instantiate する。
 */
function buildAllTemplates(): Array<[string, Template]> {
	const templates: Array<[string, Template]> = [];

	// --- prod 6 stack ---
	const app = makeApp();
	const storage = new StorageStack(app, 'GanbariQuestStorage', { env });
	const auth = new AuthStack(app, 'GanbariQuestAuth', {
		env,
		appDomain: 'ganbari-quest.com',
		certificateArn: 'arn:aws:acm:us-east-1:000000000000:certificate/test',
	});
	const compute = new ComputeStack(app, 'GanbariQuestCompute', {
		env,
		assetsBucket: storage.assetsBucket,
		repository: storage.repository,
	});
	const network = new NetworkStack(app, 'GanbariQuestNetwork', {
		env,
		functionUrl: compute.functionUrl,
		domainName: 'ganbari-quest.com',
		certificateArn: 'arn:aws:acm:us-east-1:000000000000:certificate/test',
		demoFunctionUrl: compute.demoFunctionUrl,
	});
	const ses = new SesStack(app, 'GanbariQuestSes', { env, domainName: 'ganbari-quest.com' });
	const ops = new OpsStack(app, 'GanbariQuestOps', {
		env,
		lambdaFn: compute.fn,
		distribution: network.distribution,
		functionUrl: compute.functionUrl,
		cronDispatcherFn: compute.cronDispatcherFn,
		staticAssetsBucket: network.staticAssetsBucket,
		opsEmail: 'ops@example.com',
	});
	for (const [name, stack] of [
		['GanbariQuestStorage', storage],
		['GanbariQuestAuth', auth],
		['GanbariQuestCompute', compute],
		['GanbariQuestNetwork', network],
		['GanbariQuestSes', ses],
		['GanbariQuestOps', ops],
	] as const) {
		templates.push([name, Template.fromStack(stack)]);
	}

	// --- DSQL prod (backup role を含む唯一の stack) + DSQL staging ---
	// Template.fromStack は app 全体を synth するため、同一 app に synth 後 stack を足すと
	// ConstructTreeModifiedAfterSynth になる。DSQL 2 stack は別 app に分離する。
	templates.push([
		'GanbariQuestDsql',
		Template.fromStack(
			new DsqlStack(makeApp(), 'GanbariQuestDsql', { env, opsEmail: 'ops@example.com' }),
		),
	]);
	templates.push([
		'GanbariQuestDsqlStaging',
		Template.fromStack(
			new DsqlStack(makeApp(), 'GanbariQuestDsqlStaging', { env, deletionProtection: false }),
		),
	]);

	// --- AWS staging 3 stack (#2873) ---
	const stagingApp = makeApp();
	const stStorage = new StorageStack(stagingApp, 'GanbariQuestStorageStaging', {
		env,
		envConfig: STAGING_ENV_CONFIG,
	});
	const stAuth = new AuthStack(stagingApp, 'GanbariQuestAuthStaging', {
		env,
		envConfig: STAGING_ENV_CONFIG,
	});
	const stCompute = new ComputeStack(stagingApp, 'GanbariQuestComputeStaging', {
		env,
		assetsBucket: stStorage.assetsBucket,
		repository: stStorage.repository,
		envConfig: STAGING_ENV_CONFIG,
	});
	for (const [name, stack] of [
		['GanbariQuestStorageStaging', stStorage],
		['GanbariQuestAuthStaging', stAuth],
		['GanbariQuestComputeStaging', stCompute],
	] as const) {
		templates.push([name, Template.fromStack(stack)]);
	}

	return templates;
}

describe('全 stack の IAM Role description は AWS IAM 制約 (ASCII/Latin-1) 準拠 (#3870)', () => {
	const templates = buildAllTemplates();

	it('[G1] instantiate 対象 stack を漏れなく synth できる (網羅性の担保)', () => {
		// stack を追加したら本数を増やす。silent に synth 対象が減っていないことの guard。
		expect(templates.length).toBe(11);
	});

	it('[G2] 全 stack の AWS::IAM::Role の Description が U+00FF 以下のみで構成される', () => {
		const violations: string[] = [];
		let inspectedRoleCount = 0;
		let describedRoleCount = 0;

		for (const [stackName, template] of templates) {
			const roles = template.findResources('AWS::IAM::Role');
			for (const [logicalId, role] of Object.entries(roles)) {
				inspectedRoleCount += 1;
				const description = role.Properties?.Description as string | undefined;
				if (typeof description !== 'string') continue;
				describedRoleCount += 1;
				if (!IAM_DESCRIPTION_ALLOWED.test(description)) {
					const offending = [...description].filter((ch) => !IAM_DESCRIPTION_ALLOWED.test(ch));
					violations.push(
						`${stackName}/${logicalId}: 非 ASCII/Latin-1 文字 [${offending.join('')}] を含む Description="${description}"`,
					);
				}
			}
		}

		// synth 対象が空でないこと (テスト自体が空振りしていないことの sanity check)。
		expect(inspectedRoleCount).toBeGreaterThan(0);
		expect(describedRoleCount).toBeGreaterThan(0);
		expect(violations, `IAM Role description に AWS 制約違反:\n${violations.join('\n')}`).toEqual(
			[],
		);
	});

	it('[G3] AWS::IAM::ManagedPolicy の Description も同制約を満たす', () => {
		const violations: string[] = [];
		for (const [stackName, template] of templates) {
			const policies = template.findResources('AWS::IAM::ManagedPolicy');
			for (const [logicalId, policy] of Object.entries(policies)) {
				const description = policy.Properties?.Description as string | undefined;
				if (typeof description !== 'string') continue;
				if (!IAM_DESCRIPTION_ALLOWED.test(description)) {
					violations.push(`${stackName}/${logicalId}: Description="${description}"`);
				}
			}
		}
		expect(
			violations,
			`ManagedPolicy description に AWS 制約違反:\n${violations.join('\n')}`,
		).toEqual([]);
	});
});
