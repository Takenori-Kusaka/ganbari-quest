// Issue #3879: hotfix back-merge PR body 生成 SSOT (scripts/back-merge-pr-body.mjs) の unit test。
//
// 検証の核心: 自動発行 back-merge PR の body が「生成時点で」PR body gate 群
// (check-pr-body / Verify AC map / pr-template-gate 6 job / PR チェックリスト完了確認) を
// pass すること。gate ロジックは再実装せず、CI と同一の SSOT 関数 (実 template /
// 実 PR_TEMPLATE_SECTIONS.json 入力) を import して assert する — 実例 #3876 の
// 「必須 13 セクション + AC マップ 4 列欠落 → QM 手作業 remediation」の構造的再発防止。
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
	BACK_MERGE_LABELS,
	parseArgs,
	renderBackMergePrBody,
	SECTIONS_SSOT_PATH,
	TEMPLATE_PATH,
	validateBackMergePrBody,
} from '../../../scripts/back-merge-pr-body.mjs';
import { checkAcVerification } from '../../../scripts/check-ac-verification-map.mjs';
import { checkMergeGateChecklist } from '../../../scripts/check-merge-gate-checklist.mjs';
import {
	extractRequiredSections,
	findMissingSections,
	findUncheckedReadyChecklist,
	scanForbiddenTerms,
} from '../../../scripts/check-pr-body.mjs';
import {
	checkChangeType,
	checkClosingKeyword,
	checkCustomerValue,
	checkIssueReference,
	checkSectionPresence,
	checkTestResults,
} from '../../../scripts/pr-template-gate-checks.mjs';

const template = readFileSync(TEMPLATE_PATH, 'utf-8');
const ssotSections: string[] = JSON.parse(readFileSync(SECTIONS_SSOT_PATH, 'utf-8')).sections;

const cleanInput = {
	hotfixPr: 3872,
	hotfixHead: 'fix/3870-iam-description-ascii',
	mergeSha: '318e43a5deadbeef00112233445566778899aabb',
	branch: 'back-merge/3872',
	isConflict: false,
};
const conflictInput = { ...cleanInput, isConflict: true };

const cleanBody = renderBackMergePrBody(cleanInput);
const conflictBody = renderBackMergePrBody(conflictInput);
const labels = [...BACK_MERGE_LABELS];

describe('renderBackMergePrBody (#3879 AC1: template gate 準拠 body の生成)', () => {
	it.each([
		['clean', cleanBody],
		['conflict', conflictBody],
	])('%s: 必須セクション見出しが完全一致で全て存在する (check-pr-body SSOT)', (_kind, body) => {
		const required = extractRequiredSections(template);
		// 件数はマジックナンバーで固定しない (#4097 で 13 → 11 になった際にここが stale hard-fail した)。
		// template と SSOT JSON の一致を assert すれば、件数変更に追従しつつ drift は検出できる。
		expect(required).toEqual(ssotSections);
		expect(findMissingSections(body, required)).toEqual([]);
	});

	it.each([
		['clean', cleanBody],
		['conflict', conflictBody],
	])('%s: 禁止語 0 件 (check-pr-body FORBIDDEN_TERMS)', (_kind, body) => {
		expect(scanForbiddenTerms(body)).toEqual([]);
	});

	it.each([
		['clean', cleanBody],
		['conflict', conflictBody],
	])('%s: Ready checklist に未チェック残置なし', (_kind, body) => {
		expect(findUncheckedReadyChecklist(body)).toEqual([]);
	});

	it('clean: 元 hotfix PR / merge SHA / branch を参照する (silent-revert 防止の出典明示)', () => {
		expect(cleanBody).toContain('#3872');
		expect(cleanBody).toContain('318e43a'); // sha7
		expect(cleanBody).toContain('back-merge/3872');
		expect(cleanBody).toContain('fix/3870-iam-description-ascii');
	});

	it('conflict: 手動解決手順 + status:blocked + 自動 force resolve なしを明示する (#2951 AC3)', () => {
		expect(conflictBody).toContain('CONFLICT — 手動解決が必要');
		expect(conflictBody).toContain('status:blocked');
		expect(conflictBody).toContain('自動 force resolve は行っていません');
		expect(conflictBody).toContain('git switch back-merge/3872');
	});

	it('clean: conflict 文言を含まない (variant 分岐の相互排他)', () => {
		expect(cleanBody).not.toContain('CONFLICT — 手動解決が必要');
		expect(cleanBody).toContain('conflict なく develop に取り込めました');
	});
});

describe('CI gate 個別 pass (#3879 AC: 無手作業で body-gate green)', () => {
	it.each([
		['clean', cleanBody],
		['conflict', conflictBody],
	])('%s: `Verify AC map in PR body` (feature lane) が PASS する', (_kind, body) => {
		const result = checkAcVerification({ body, labels, lane: 'feature' });
		expect(result.ok).toBe(true);
	});

	it.each([
		['clean', cleanBody],
		['conflict', conflictBody],
	])('%s: `必須セクションの存在確認` (実 PR_TEMPLATE_SECTIONS.json) が PASS する', (_kind, body) => {
		const result = checkSectionPresence({
			body,
			labels,
			template,
			ssotSections,
			integrationSsotSections: null,
			lane: 'feature',
		});
		expect(result.ok).toBe(true);
	});

	it.each([
		['clean', cleanBody],
		['conflict', conflictBody],
	])('%s: pr-template-gate 残り 4 check (issue-reference / change-type / customer-value / test-results) が PASS する', (_kind, body) => {
		const input = {
			body,
			labels,
			template,
			ssotSections,
			integrationSsotSections: null,
			lane: 'feature' as const,
		};
		expect(checkIssueReference(input).ok, 'issue-reference').toBe(true);
		expect(checkChangeType(input).ok, 'change-type').toBe(true);
		expect(checkCustomerValue(input).ok, 'customer-value').toBe(true);
		expect(checkTestResults(input).ok, 'test-results').toBe(true);
	});

	it('closing-keyword check は back-merge label で skip される (#3458 機械生成 exempt)', () => {
		const result = checkClosingKeyword({
			body: cleanBody,
			labels,
			template,
			ssotSections,
			integrationSsotSections: null,
			lane: 'feature',
		});
		expect(result.ok).toBe(true);
		expect(result.skipped).toBe(true);
	});

	it.each([
		['clean', cleanBody],
		['conflict', conflictBody],
	])('%s: `PR チェックリスト完了確認` (feature lane) が PASS する', (_kind, body) => {
		const result = checkMergeGateChecklist({ body, labels, lane: 'feature' });
		expect(result.ok).toBe(true);
	});
});

describe('validateBackMergePrBody (#3879: 生成時自己検証 = 生成→検証→fail)', () => {
	it('clean body は違反 0 件', () => {
		expect(validateBackMergePrBody(cleanBody)).toEqual([]);
	});

	it('conflict body は違反 0 件', () => {
		expect(validateBackMergePrBody(conflictBody)).toEqual([]);
	});

	it('必須セクションを 1 つ削ると違反を検出する (自己検証が空洞でないこと、ADR-0006)', () => {
		const tampered = cleanBody.replace('## AC 検証マップ (ADR-0004)', '## AC マップ');
		const violations = validateBackMergePrBody(tampered);
		expect(violations.length).toBeGreaterThan(0);
		expect(violations.map((v) => v.gate).join(' ')).toContain('missing-required-sections');
	});

	it('禁止語 (未完遂マーカー) が混入すると違反を検出する', () => {
		const tampered = cleanBody.replace(
			'**影響を受ける画面・機能**: hotfix #3872 と同一。',
			'**影響を受ける画面・機能**: あとで対応TODO',
		);
		const violations = validateBackMergePrBody(tampered);
		expect(violations.map((v) => v.gate).join(' ')).toContain('forbidden-terms');
	});

	it('AC マップのデータ行を空にすると AC map gate 違反を検出する', () => {
		const tampered = cleanBody
			.split('\n')
			.filter((l) => !/^\| AC\d /.test(l))
			.join('\n');
		const violations = validateBackMergePrBody(tampered);
		expect(violations.map((v) => v.gate).join(' ')).toMatch(/ac-map|ac-verification/);
	});

	it('Ready checklist を未チェック化すると merge-gate 違反を検出する', () => {
		const tampered = cleanBody.replace(
			'- [x] clean merge を確認済 (conflict なし)',
			'- [ ] clean merge を確認済 (conflict なし)',
		);
		const violations = validateBackMergePrBody(tampered);
		expect(violations.map((v) => v.gate).join(' ')).toContain('check-merge-gate-checklist');
	});
});

describe('parseArgs (CLI 引数)', () => {
	it('--key value / --key=value / flag (--conflict) を解釈する', () => {
		expect(
			parseArgs([
				'--hotfix-pr',
				'3872',
				'--merge-sha=abc123',
				'--branch',
				'back-merge/3872',
				'--conflict',
			]),
		).toEqual({
			'hotfix-pr': '3872',
			'merge-sha': 'abc123',
			branch: 'back-merge/3872',
			conflict: true,
		});
	});
});
