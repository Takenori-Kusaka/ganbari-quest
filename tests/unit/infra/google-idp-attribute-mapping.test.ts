// tests/unit/infra/google-idp-attribute-mapping.test.ts
// #4643: Google IdP の属性マッピングに `email_verified` が含まれることを固定する。
//
// email しか写していないと、Google 連携ユーザーの Cognito 側 `email_verified` は false のまま
// 固定される。アプリは宛先 email 束縛招待の受諾を `email_verified === false` で fail-closed 拒否
// する (#3555 ③) ため、Google でサインアップした招待者は 100% 受諾に失敗し、招待が無視される
// (#4636 前は無音で別の家族グループが作られていた)。マッピングが消えた瞬間に落ちる guard。

import * as cdk from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { beforeAll, describe, expect, it } from 'vitest';
import { AuthStack } from '../../../infra/lib/auth-stack';

const env: cdk.Environment = { account: '000000000000', region: 'us-east-1' };

// CDK synth は重い (staging-cdk.test.ts と同じ理由で beforeAll + 明示 timeout)
let googleTemplate: Template;
let noGoogleTemplate: Template;

beforeAll(() => {
	// App は stack ごとに分ける (同一 App を 2 回 synth すると ConstructTreeModifiedAfterSynth)
	googleTemplate = Template.fromStack(
		new AuthStack(new cdk.App(), 'TestAuthGoogle', {
			env,
			googleClientId: 'test-google-client-id',
			googleClientSecret: 'test-google-client-secret',
		}),
	);
	noGoogleTemplate = Template.fromStack(new AuthStack(new cdk.App(), 'TestAuthNoGoogle', { env }));
}, 120_000);

describe('#4643 Google IdP の属性マッピング', () => {
	it('email に加えて email_verified を写す', () => {
		googleTemplate.hasResourceProperties(
			'AWS::Cognito::UserPoolIdentityProvider',
			Match.objectLike({
				ProviderName: 'Google',
				AttributeMapping: Match.objectLike({
					email: 'email',
					email_verified: 'email_verified',
				}),
			}),
		);
	});

	it('Google IdP を有効にしないスタックでは IdP 自体を作らない (prod 不変条件)', () => {
		expect(
			Object.keys(noGoogleTemplate.findResources('AWS::Cognito::UserPoolIdentityProvider')),
		).toEqual([]);
	});
});
