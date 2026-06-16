import { describe, expect, it } from 'vitest';
import {
	buildContainedPrRecords,
	buildReleasePredicate,
	evaluateNgZero,
	RELEASE_PREDICATE_TYPE,
	STATEMENT_TYPE,
	summarizeJobResults,
} from '../../../scripts/audit/generate-release-predicate.mjs';

const SHA = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678';

describe('buildContainedPrRecords', () => {
	it('feature/fix PR を含有とし number 昇順で正規化する', () => {
		const out = buildContainedPrRecords([
			{ number: 30, title: 'fix: B', headRefName: 'fix/b', labels: ['type:fix'] },
			{ number: 10, title: 'feat: A', headRefName: 'feat/a', labels: [{ name: 'type:feat' }] },
		]);
		expect(out.map((p) => p.number)).toEqual([10, 30]);
		expect(out[0].title).toBe('feat: A');
		expect(out[0].labels).toEqual(['type:feat']);
	});

	it('back-merge PR / 統合 PR 自身 (head=develop) は含有から除外する', () => {
		const out = buildContainedPrRecords([
			{ number: 1, title: 'feat', headRefName: 'feat/x' },
			{ number: 2, title: 'back-merge', headRefName: 'back-merge/main-to-develop' },
			{ number: 3, title: 'integration', headRefName: 'develop' },
		]);
		expect(out.map((p) => p.number)).toEqual([1]);
	});

	it('空 / undefined 入力は空配列', () => {
		expect(buildContainedPrRecords([])).toEqual([]);
		// @ts-expect-error 防御確認
		expect(buildContainedPrRecords(undefined)).toEqual([]);
	});
});

describe('summarizeJobResults', () => {
	it('全 job success なら allGreen=true', () => {
		const s = summarizeJobResults([
			{ job: 'unit', result: 'success' },
			{ job: 'e2e', result: 'success' },
		]);
		expect(s).toEqual({
			total: 2,
			passed: 2,
			failed: 0,
			failedJobs: [],
			allGreen: true,
		});
	});

	it('failure / cancelled を failedJobs に集計し allGreen=false', () => {
		const s = summarizeJobResults([
			{ job: 'unit', result: 'success' },
			{ job: 'e2e', result: 'failure' },
			{ job: 'lint', result: 'cancelled' },
		]);
		expect(s.failed).toBe(2);
		expect(s.failedJobs).toEqual(['e2e', 'lint']);
		expect(s.allGreen).toBe(false);
	});

	it('空入力は allGreen=false (証跡未取得を緑扱いしない)', () => {
		expect(summarizeJobResults([]).allGreen).toBe(false);
	});
});

describe('evaluateNgZero', () => {
	it('remainingNg=0 + coverageRatchetOk=true で ngZero=true', () => {
		expect(evaluateNgZero({ remainingNg: 0, coverageRatchetOk: true })).toEqual({
			remainingNg: 0,
			coverageRatchetOk: true,
			ngZero: true,
		});
	});

	it('NG 残存があれば ngZero=false', () => {
		expect(evaluateNgZero({ remainingNg: 2, coverageRatchetOk: true }).ngZero).toBe(false);
	});

	it('coverage ratchet 割れがあれば ngZero=false', () => {
		expect(evaluateNgZero({ remainingNg: 0, coverageRatchetOk: false }).ngZero).toBe(false);
	});

	it('remainingNg 未指定 (不明) は -1 + ngZero=false', () => {
		const r = evaluateNgZero({ coverageRatchetOk: true });
		expect(r.remainingNg).toBe(-1);
		expect(r.ngZero).toBe(false);
	});
});

describe('buildReleasePredicate', () => {
	it('必須 field を満たす in-toto Release statement を返す', () => {
		const stmt = buildReleasePredicate({
			mergeCommitSha: SHA,
			containedPrs: [{ number: 5, title: 'feat: x', headRefName: 'feat/x' }],
			jobResults: [{ job: 'unit', result: 'success' }],
			coverage: { lines: 80 },
			remainingNg: 0,
			coverageRatchetOk: true,
			integrationPrNumber: 9999,
			generatedAt: '2026-06-17T00:00:00.000Z',
		});
		expect(stmt._type).toBe(STATEMENT_TYPE);
		expect(stmt.predicateType).toBe(RELEASE_PREDICATE_TYPE);
		expect(stmt.predicate.purl).toBe(`pkg:github/Takenori-Kusaka/ganbari-quest@${SHA}`);
		expect(stmt.predicate.version).toBe(SHA);
		expect(stmt.predicate.integrationPr).toBe('9999');
		expect(stmt.predicate.containedPrCount).toBe(1);
		expect(stmt.predicate.coverage).toEqual({ lines: 80 });
	});

	it('subject digest に merge commit SHA が入る (gh attestation verify の検証対象)', () => {
		const stmt = buildReleasePredicate({ mergeCommitSha: SHA });
		expect(stmt.subject).toHaveLength(1);
		expect(stmt.subject[0].digest.sha1).toBe(SHA);
		expect(stmt.subject[0].name).toBe('Takenori-Kusaka/ganbari-quest');
	});

	it('NG-0 宣言が rules-based で真になる (NG 0 + coverage OK + 全 job 緑)', () => {
		const stmt = buildReleasePredicate({
			mergeCommitSha: SHA,
			jobResults: [{ job: 'unit', result: 'success' }],
			remainingNg: 0,
			coverageRatchetOk: true,
		});
		expect(stmt.predicate.ngZeroDeclaration.ngZero).toBe(true);
		expect(stmt.predicate.testResults.allGreen).toBe(true);
	});

	it('NG 残存時は ngZero=false (gate が attestation を発行させない根拠)', () => {
		const stmt = buildReleasePredicate({
			mergeCommitSha: SHA,
			remainingNg: 3,
			coverageRatchetOk: true,
		});
		expect(stmt.predicate.ngZeroDeclaration.ngZero).toBe(false);
	});

	it('含有 PR 空でも valid statement (containedPrCount=0)', () => {
		const stmt = buildReleasePredicate({ mergeCommitSha: SHA });
		expect(stmt.predicate.containedPrCount).toBe(0);
		expect(stmt.predicate.containedPrs).toEqual([]);
	});

	it('mergeCommitSha 欠落は例外 (subject digest 必須)', () => {
		// @ts-expect-error 不正入力
		expect(() => buildReleasePredicate({})).toThrow(/mergeCommitSha/);
		expect(() => buildReleasePredicate({ mergeCommitSha: '   ' })).toThrow(/mergeCommitSha/);
	});

	it('GITHUB_REPOSITORY 相当の repository override が purl/subject に反映される', () => {
		const stmt = buildReleasePredicate({ mergeCommitSha: SHA, repository: 'acme/widget' });
		expect(stmt.predicate.purl).toBe(`pkg:github/acme/widget@${SHA}`);
		expect(stmt.subject[0].name).toBe('acme/widget');
	});
});
