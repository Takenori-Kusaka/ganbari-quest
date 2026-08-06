// tests/unit/infra/ops-static-assets-alarm.test.ts
// #3402-1: 静的アセット S3 origin 専用 4xx/5xx CloudWatch alarm の CDK 構造検証。
//
// staticAssetsS3Offload=true (= NetworkStack が static-assets bucket を生成) のときのみ、
// OpsStack が S3 request metrics (AWS/S3 4xxErrors/5xxErrors) を監視する alarm を作る。
// offload OFF (bucket undefined) では alarm を作らない = 監視 cost も発生しない (ADR-0010)。
//
// context stub パターンは tests/unit/infra/static-assets-s3-offload.test.ts を踏襲。

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as cdk from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ComputeStack } from '../../../infra/lib/compute-stack';
import { NetworkStack } from '../../../infra/lib/network-stack';
import { OpsStack } from '../../../infra/lib/ops-stack';
import { StorageStack } from '../../../infra/lib/storage-stack';

// cspell:ignore TESTPOOL

const env: cdk.Environment = { account: '000000000000', region: 'us-east-1' };

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
			parentGateCookieSecret: 'test-parent-gate-secret-do-not-use-do-not-use',
		},
	});
}

function buildOpsTemplate(opts: { offload: boolean; sourceDir?: string }): Template {
	const app = makeApp();
	const storage = new StorageStack(app, 'TestStorage', { env });
	const compute = new ComputeStack(app, 'TestCompute', {
		env,
		assetsBucket: storage.assetsBucket,
		repository: storage.repository,
	});
	const network = new NetworkStack(app, 'TestNetwork', {
		env,
		functionUrl: compute.functionUrl,
		// #4280: front door shared secret (NetworkStackProps 必須)。テスト用ダミー値。
		originVerifySecret: 'test-origin-verify-secret-0000000000000000',
		domainName: 'ganbari-quest.com',
		certificateArn: 'arn:aws:acm:us-east-1:000000000000:certificate/test',
		demoFunctionUrl: compute.demoFunctionUrl,
		staticAssetsS3Offload: opts.offload,
		staticAssetsSourceDir: opts.sourceDir,
	});
	const ops = new OpsStack(app, 'TestOps', {
		env,
		lambdaFn: compute.fn,
		distribution: network.distribution,
		functionUrl: compute.functionUrl,
		cronDispatcherFn: compute.cronDispatcherFn,
		staticAssetsBucket: network.staticAssetsBucket,
	});
	return Template.fromStack(ops as unknown as cdk.Stack);
}

let fixtureDir: string;
let onTemplate: Template;
let offTemplate: Template;

beforeAll(() => {
	fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gq-ops-static-'));
	const immutable = path.join(fixtureDir, '_app', 'immutable', 'chunks');
	fs.mkdirSync(immutable, { recursive: true });
	fs.writeFileSync(path.join(immutable, 'app.abc123.js'), 'export const x = 1;\n');

	onTemplate = buildOpsTemplate({ offload: true, sourceDir: fixtureDir });
	offTemplate = buildOpsTemplate({ offload: false });
}, 60_000);

afterAll(() => {
	if (fixtureDir) fs.rmSync(fixtureDir, { recursive: true, force: true });
});

describe('#3402-1 静的アセット S3 origin 4xx/5xx alarm', () => {
	it('offload ON: S3 origin 4xx alarm (AWS/S3 4xxErrors) を作る', () => {
		onTemplate.hasResourceProperties('AWS::CloudWatch::Alarm', {
			AlarmName: 'ganbari-quest-static-assets-s3-4xx',
			Namespace: 'AWS/S3',
			MetricName: '4xxErrors',
			Dimensions: Match.arrayWith([{ Name: 'FilterId', Value: 'EntireBucket' }]),
		});
	});

	it('offload ON: S3 origin 5xx alarm (AWS/S3 5xxErrors) を作る', () => {
		onTemplate.hasResourceProperties('AWS::CloudWatch::Alarm', {
			AlarmName: 'ganbari-quest-static-assets-s3-5xx',
			Namespace: 'AWS/S3',
			MetricName: '5xxErrors',
		});
	});

	it('offload OFF (bucket undefined): S3 origin alarm を作らない (監視 cost ゼロ)', () => {
		const alarms = offTemplate.findResources('AWS::CloudWatch::Alarm');
		const names = Object.values(alarms).map(
			(a) => (a as { Properties?: { AlarmName?: string } }).Properties?.AlarmName,
		);
		expect(names).not.toContain('ganbari-quest-static-assets-s3-4xx');
		expect(names).not.toContain('ganbari-quest-static-assets-s3-5xx');
	});
});
