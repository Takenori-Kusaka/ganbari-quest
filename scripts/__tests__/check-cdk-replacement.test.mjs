/**
 * scripts/__tests__/check-cdk-replacement.test.mjs
 *
 * check-cdk-replacement.mjs のユニットテスト (Node.js 22 組み込みテストランナー)
 *
 * 実行: node --test scripts/__tests__/check-cdk-replacement.test.mjs
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { detectReplacements, parseApprovedIds, stripAnsi } from '../check-cdk-replacement.mjs';

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

describe('detectReplacements', () => {
	it('ADR-0018: [-] lines are detected as destroy (by CDK construct ID)', () => {
		const result = detectReplacements(ADR_0018_DIFF);
		// CDK diff format: [marker] ResourceType CDK_ID CF_HASH
		// detectReplacements uses CDK_ID (token[2]) as the identifier
		assert.equal(result.has('UserPool'), true);
		assert.equal(result.get('UserPool'), 'destroy');
		assert.equal(result.has('UserPool/PublicClient'), true);
		assert.equal(result.get('UserPool/PublicClient'), 'destroy');
		assert.equal(result.has('AuthDomainAlias'), true);
	});

	it('ADR-0018: [+] lines are NOT flagged as replacement', () => {
		const result = detectReplacements(ADR_0018_DIFF);
		// [+] lines (new resources being created) should not be flagged
		assert.equal(result.has('UserPoolV2'), false);
	});

	it('property-level (may cause replacement) is detected via parent resource CDK ID', () => {
		const result = detectReplacements(PROPERTY_REPLACE_DIFF);
		assert.equal(result.has('Database'), true);
		assert.equal(result.get('Database'), 'may-cause-replacement');
	});

	it('ordinary modifications without replacement are not flagged', () => {
		const result = detectReplacements(NO_CHANGE_DIFF);
		assert.equal(result.size, 0);
	});

	it('ANSI escape codes are stripped before parsing', () => {
		const result = detectReplacements(ANSI_DIFF);
		assert.equal(result.has('UserPool'), true);
		assert.equal(result.get('UserPool'), 'destroy');
		assert.equal(result.has('UserPoolV2'), false);
	});

	it('empty input produces no results', () => {
		const result = detectReplacements([]);
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
