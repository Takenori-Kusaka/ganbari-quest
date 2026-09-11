/**
 * scripts/__tests__/check-cdk-replacement.test.mjs
 *
 * check-cdk-replacement.mjs のユニットテスト (Node.js 22 組み込みテストランナー)
 *
 * 実行: node --test scripts/__tests__/check-cdk-replacement.test.mjs
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
	findExemption,
	parseApprovedIds,
	parseDiff,
	stripAnsi,
} from '../check-cdk-replacement.mjs';

// ---------------------------------------------------------------------------
// ADR-0018 相当 fixture: Cognito User Pool 論理 ID 変更による Replacement
// (UserPool6BA7E5F2 → UserPoolV2XXXXXXXX の re-create)
// ---------------------------------------------------------------------------
const ADR_0018_DIFF = `
Stack GanbariQuestAuth
Resources
[+] AWS::Cognito::UserPool UserPool UserPoolV2XXXXXXXX
[+] AWS::Cognito::UserPoolClient UserPool/PublicClient UserPoolV2PublicClientABCD
[+] AWS::Route53::RecordSet AuthDomainAlias AuthDomainAliasNew1234
[-] AWS::Cognito::UserPool UserPool UserPool6BA7E5F2
[-] AWS::Cognito::UserPoolClient UserPool/PublicClient UserPoolPublicClient1A2B3C
[-] AWS::Route53::RecordSet AuthDomainAlias AuthDomainAliasOld5678
`
	.trim()
	.split('\n');

// ---------------------------------------------------------------------------
// プロパティレベル置き換え fixture: RDS インスタンスクラス変更
// ---------------------------------------------------------------------------
const PROPERTY_REPLACE_DIFF = `
Stack GanbariQuestStorage
Resources
[~] AWS::RDS::DBInstance Database DatabaseABCDEF
 └─ [~] DBInstanceClass: "db.t3.micro" -> "db.t3.small" (may cause replacement)
`
	.trim()
	.split('\n');

// ---------------------------------------------------------------------------
// 変更なし fixture
// ---------------------------------------------------------------------------
const NO_CHANGE_DIFF = `
Stack GanbariQuestCompute
Resources
[~] AWS::Lambda::Function Handler HandlerXXXXXX
 └─ [~] Description: "old" -> "new"
`
	.trim()
	.split('\n');

// ---------------------------------------------------------------------------
// ANSI カラーコード付き fixture
// ---------------------------------------------------------------------------
const ANSI_DIFF = [
	'\x1b[1m\x1b[31m[-]\x1b[0m AWS::Cognito::UserPool UserPool UserPool6BA7E5F2',
	'\x1b[1m\x1b[32m[+]\x1b[0m AWS::Cognito::UserPool UserPool UserPoolV2XXXXXXXX',
];

describe('parseDiff', () => {
	it('ADR-0018: [-] lines are detected as destroy (by CDK construct ID)', () => {
		const result = parseDiff(ADR_0018_DIFF).replacements;
		// CDK diff format: [marker] ResourceType CDK_ID CF_HASH
		// parseDiff uses CDK_ID (token[2]) as the identifier
		assert.equal(result.has('UserPool'), true);
		assert.equal(result.get('UserPool'), 'destroy');
		assert.equal(result.has('UserPool/PublicClient'), true);
		assert.equal(result.get('UserPool/PublicClient'), 'destroy');
		assert.equal(result.has('AuthDomainAlias'), true);
	});

	it('ADR-0018: [+] lines are NOT flagged as replacement', () => {
		const result = parseDiff(ADR_0018_DIFF).replacements;
		// [+] lines (new resources being created) should not be flagged
		assert.equal(result.has('UserPoolV2'), false);
	});

	it('property-level (may cause replacement) is detected via parent resource CDK ID', () => {
		const result = parseDiff(PROPERTY_REPLACE_DIFF).replacements;
		assert.equal(result.has('Database'), true);
		assert.equal(result.get('Database'), 'may-cause-replacement');
	});

	it('ordinary modifications without replacement are not flagged', () => {
		const result = parseDiff(NO_CHANGE_DIFF).replacements;
		assert.equal(result.size, 0);
	});

	it('ANSI escape codes are stripped before parsing', () => {
		const result = parseDiff(ANSI_DIFF).replacements;
		assert.equal(result.has('UserPool'), true);
		assert.equal(result.get('UserPool'), 'destroy');
		assert.equal(result.has('UserPoolV2'), false);
	});

	it('empty input produces no results', () => {
		const result = parseDiff([]).replacements;
		assert.equal(result.size, 0);
	});
});

describe('parseApprovedIds', () => {
	it('parses single id from PR body', () => {
		const approved = parseApprovedIds('replacement-approved: UserPool6BA7E5F2', '');
		assert.equal(approved.has('UserPool6BA7E5F2'), true);
	});

	it('parses comma-separated ids', () => {
		const approved = parseApprovedIds(
			'replacement-approved: UserPool6BA7E5F2,UserPoolPublicClient1A2B3C',
			'',
		);
		assert.equal(approved.has('UserPool6BA7E5F2'), true);
		assert.equal(approved.has('UserPoolPublicClient1A2B3C'), true);
	});

	it('parses ids from commit message', () => {
		const approved = parseApprovedIds('', 'replacement-approved: AuthDomainAliasOld5678');
		assert.equal(approved.has('AuthDomainAliasOld5678'), true);
	});

	it('returns empty set when no marker present', () => {
		const approved = parseApprovedIds('normal PR body', 'feat: some commit');
		assert.equal(approved.size, 0);
	});

	it('is case-insensitive for the marker keyword', () => {
		const approved = parseApprovedIds('Replacement-Approved: UserPool6BA7E5F2', '');
		assert.equal(approved.has('UserPool6BA7E5F2'), true);
	});
});

describe('stripAnsi', () => {
	it('removes ANSI color codes', () => {
		assert.equal(stripAnsi('\x1b[31mred\x1b[0m'), 'red');
		assert.equal(stripAnsi('\x1b[1m\x1b[32m[+]\x1b[0m normal text'), '[+] normal text');
	});
});

// ---------------------------------------------------------------------------
// #4904: CDK 生成 AwsCliLayer の除外 / 実際の CLI 出力に合わせた impact 検出
//
// 行形式は aws-cdk の実装 (formatImpact / formatTreeDiff) を実測して合わせている:
//   リソース行   : [~] <Type> <ConstructPath> <PhysicalId> <impact>   ← 括弧なし
//   プロパティ行 : └─ [~] Prop: a -> b (requires replacement)         ← 括弧あり
// ---------------------------------------------------------------------------
const AWS_CLI_LAYER_DIFF = `
Stack GanbariQuestNetwork
Resources
[~] AWS::Lambda::LayerVersion ErrorPagesDeploy/AwsCliLayer ErrorPagesDeployAwsCliLayer32E8E823 replace
 └─ [~] Content: {"S3Key":"old.zip"} -> {"S3Key":"new.zip"} (requires replacement)
[~] AWS::Lambda::LayerVersion StaticAssetsDeploy/AwsCliLayer StaticAssetsDeployAwsCliLayerD3913478 replace
 └─ [~] Content: {"S3Key":"old.zip"} -> {"S3Key":"new.zip"} (requires replacement)
`
	.trim()
	.split('\n');

describe('#4904 CDK 生成 AwsCliLayer の除外', () => {
	it('AwsCliLayer は承認不要リストに入らず exempt として分離される', () => {
		const { replacements, exempted } = parseDiff(AWS_CLI_LAYER_DIFF);
		assert.equal(replacements.size, 0, '承認を要求してはいけない');
		assert.equal(exempted.size, 2, '握り潰さず exempt として数える');
		assert.equal(exempted.has('ErrorPagesDeploy/AwsCliLayer'), true);
		assert.equal(exempted.has('StaticAssetsDeploy/AwsCliLayer'), true);
	});

	it('型が違えば除外しない (path だけ一致しても素通ししない)', () => {
		assert.equal(findExemption('AWS::S3::Bucket', 'Foo/AwsCliLayer'), null);
	});

	it('path が違えば除外しない (LayerVersion 全部を素通ししない)', () => {
		assert.equal(findExemption('AWS::Lambda::LayerVersion', 'MyOwn/PowertoolsLayer'), null);
	});

	it('自前の LayerVersion は従来どおり承認対象のまま', () => {
		const diff = [
			'[~] AWS::Lambda::LayerVersion MyOwn/PowertoolsLayer MyOwnPowertoolsLayerAB12 replace',
		];
		const { replacements, exempted } = parseDiff(diff);
		assert.equal(replacements.get('MyOwn/PowertoolsLayer'), 'replace');
		assert.equal(exempted.size, 0);
	});
});

describe('#4904 impact の reason を実文言どおりに出す', () => {
	it('(requires replacement) を may-cause-replacement に丸めない', () => {
		const diff = [
			'[~] AWS::RDS::DBInstance Database DatabaseABCDEF',
			' └─ [~] DBInstanceClass: "a" -> "b" (requires replacement)',
		];
		assert.equal(parseDiff(diff).replacements.get('Database'), 'requires-replacement');
	});

	it('(may cause replacement) は may-cause-replacement のまま', () => {
		const diff = [
			'[~] AWS::RDS::DBInstance Database DatabaseABCDEF',
			' └─ [~] DBInstanceClass: "a" -> "b" (may cause replacement)',
		];
		assert.equal(parseDiff(diff).replacements.get('Database'), 'may-cause-replacement');
	});
});

describe('#4904 リソース行の impact 語 (括弧なし) を検出する', () => {
	it('replace', () => {
		const diff = ['[~] AWS::Cognito::UserPool UserPool UserPoolABC replace'];
		assert.equal(parseDiff(diff).replacements.get('UserPool'), 'replace');
	});

	it('destroy', () => {
		const diff = ['[~] AWS::Cognito::UserPool UserPool UserPoolABC destroy'];
		assert.equal(parseDiff(diff).replacements.get('UserPool'), 'destroy');
	});

	it('may be replaced', () => {
		const diff = ['[~] AWS::Cognito::UserPool UserPool UserPoolABC may be replaced'];
		assert.equal(parseDiff(diff).replacements.get('UserPool'), 'may-be-replaced');
	});

	it('orphan は破壊ではないので flag しない', () => {
		const diff = ['[~] AWS::Cognito::UserPool UserPool UserPoolABC orphan'];
		assert.equal(parseDiff(diff).replacements.size, 0);
	});
});
