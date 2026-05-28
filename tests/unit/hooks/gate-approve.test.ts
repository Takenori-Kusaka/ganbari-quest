/**
 * tests/unit/hooks/gate-approve.test.ts (ADR-0056)
 *
 * .claude/hooks/gate-approve.mjs の純粋関数を unit test する。
 *
 * 検証スコープ:
 *   - isApproveAction: Bash command が approve 系か判定する regex
 *   - extractPrNumber: command から PR 番号を抽出する regex
 *   - verifyEvidence: tmp/adversarial-evidence/<pr>.json の schema 検証
 *
 * 関連:
 *   - ADR-0056 (本テストの設計根拠 SSOT)
 *   - docs/research/qm-drift-prevention-2026-05-28.md
 */

import { mkdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
	EVIDENCE_TTL_MS,
	extractPrNumber,
	isApproveAction,
	MIN_REASON_LENGTH,
	REQUIRED_AXES,
	REQUIRED_OBJECT_COUNT,
	verifyEvidence,
} from '../../../.claude/hooks/gate-approve.mjs';

describe('isApproveAction', () => {
	it('gh pr merge を含む command → true', () => {
		expect(isApproveAction('gh pr merge 2588 --squash')).toBe(true);
	});

	it('gh pr merge (PR 番号後置) → true', () => {
		expect(isApproveAction('gh pr merge --repo Takenori-Kusaka/ganbari-quest 2588 --squash')).toBe(
			true,
		);
	});

	it('gh pr review --approve → true', () => {
		expect(isApproveAction('gh pr review 2588 --approve --body "LGTM"')).toBe(true);
	});

	it('gh pr review (no --approve) → false (request changes 等は対象外)', () => {
		expect(isApproveAction('gh pr review 2588 --request-changes --body "BLOCK"')).toBe(false);
	});

	it('gh api repos/.../pulls/<N>/merge (REST 直叩き) → true', () => {
		expect(
			isApproveAction('gh api repos/Takenori-Kusaka/ganbari-quest/pulls/2588/merge --method PUT'),
		).toBe(true);
	});

	it('gh api repos/.../pulls/<N>/reviews (REST 直叩き review) → true', () => {
		expect(
			isApproveAction(
				'gh api repos/Takenori-Kusaka/ganbari-quest/pulls/2588/reviews --method POST --field event=APPROVE',
			),
		).toBe(true);
	});

	it('gh pr view (read-only) → false', () => {
		expect(isApproveAction('gh pr view 2588')).toBe(false);
	});

	it('gh pr create → false (本 hook は merge / approve のみ対象、create は別 hook)', () => {
		expect(isApproveAction('gh pr create --draft --title "x"')).toBe(false);
	});

	it('git commit (PR 無関係) → false', () => {
		expect(isApproveAction('git commit -m "feat: x"')).toBe(false);
	});

	it('文字列でない → false', () => {
		expect(isApproveAction(undefined)).toBe(false);
		expect(isApproveAction(null)).toBe(false);
		expect(isApproveAction(42)).toBe(false);
	});

	it('空文字列 → false', () => {
		expect(isApproveAction('')).toBe(false);
	});
});

describe('extractPrNumber', () => {
	it('gh pr merge 2588 → 2588', () => {
		expect(extractPrNumber('gh pr merge 2588 --squash')).toBe(2588);
	});

	it('gh pr merge --repo X 2588 → 2588 (PR 番号後置)', () => {
		expect(extractPrNumber('gh pr merge --repo Takenori-Kusaka/ganbari-quest 2588 --squash')).toBe(
			2588,
		);
	});

	it('gh pr review 2588 --approve → 2588', () => {
		expect(extractPrNumber('gh pr review 2588 --approve')).toBe(2588);
	});

	it('gh api .../pulls/2588/merge → 2588', () => {
		expect(extractPrNumber('gh api repos/Takenori-Kusaka/ganbari-quest/pulls/2588/merge')).toBe(
			2588,
		);
	});

	it('PR 番号なし → null', () => {
		expect(extractPrNumber('gh pr merge --squash')).toBe(null);
	});

	it('PR 番号 6 桁超 → null (suspicious)', () => {
		expect(extractPrNumber('gh pr merge 1234567')).toBe(null);
	});

	it('文字列でない → null', () => {
		expect(extractPrNumber(undefined as unknown as string)).toBe(null);
	});
});

describe('verifyEvidence', () => {
	let tmpDir: string;

	beforeEach(() => {
		tmpDir = join(
			tmpdir(),
			`gate-approve-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
		);
		mkdirSync(resolve(tmpDir, 'tmp', 'adversarial-evidence'), { recursive: true });
	});

	afterEach(() => {
		try {
			rmSync(tmpDir, { recursive: true, force: true });
		} catch {
			// ignore
		}
	});

	function writeEvidence(prNumber: number, overrides: Record<string, unknown> = {}) {
		const longReason = 'X'.repeat(MIN_REASON_LENGTH + 10);
		const defaults = {
			pr_number: prNumber,
			my_role: 'adversarial_reviewer (NOT QM, NOT Dev)',
			must_object_count: REQUIRED_OBJECT_COUNT,
			objections: [
				{ axis: 'business', reason: `${longReason} (business)` },
				{ axis: 'UX', reason: `${longReason} (UX)` },
				{ axis: 'security', reason: `${longReason} (security)` },
			],
			if_no_objections: null,
			generated_at: new Date().toISOString(),
			skill_version: '0.1.0',
		};
		const data = { ...defaults, ...overrides };
		const path = resolve(tmpDir, 'tmp', 'adversarial-evidence', `${prNumber}.json`);
		writeFileSync(path, JSON.stringify(data, null, 2), 'utf8');
		return path;
	}

	it('evidence file 不在 → fail', () => {
		const result = verifyEvidence(9999, tmpDir);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.reason).toMatch(/不在/);
		}
	});

	it('正常 schema (3 軸 / 各 reason >= 100 / TTL 内) → ok', () => {
		writeEvidence(2588);
		const result = verifyEvidence(2588, tmpDir);
		expect(result.ok).toBe(true);
	});

	it('pr_number mismatch → fail', () => {
		writeEvidence(2588, { pr_number: 9999 });
		const result = verifyEvidence(2588, tmpDir);
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.reason).toMatch(/pr_number mismatch/);
	});

	it('must_object_count !== 3 → fail (Echoing 抑制が崩れる)', () => {
		writeEvidence(2588, { must_object_count: 2 });
		const result = verifyEvidence(2588, tmpDir);
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.reason).toMatch(/must_object_count/);
	});

	it('objections.length !== 3 → fail', () => {
		const longReason = 'Y'.repeat(MIN_REASON_LENGTH + 10);
		writeEvidence(2588, {
			objections: [
				{ axis: 'business', reason: longReason },
				{ axis: 'UX', reason: longReason },
			],
		});
		const result = verifyEvidence(2588, tmpDir);
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.reason).toMatch(/objections\.length/);
	});

	it('axis が 3 軸全網羅していない (business 2 件) → fail', () => {
		const longReason = 'Z'.repeat(MIN_REASON_LENGTH + 10);
		writeEvidence(2588, {
			objections: [
				{ axis: 'business', reason: `${longReason} A` },
				{ axis: 'business', reason: `${longReason} B` },
				{ axis: 'UX', reason: `${longReason} C` },
			],
		});
		const result = verifyEvidence(2588, tmpDir);
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.reason).toMatch(/3 軸/);
	});

	it('reason が 100 文字未満 → fail (Echoing の symptom)', () => {
		const longReason = 'W'.repeat(MIN_REASON_LENGTH + 10);
		writeEvidence(2588, {
			objections: [
				{ axis: 'business', reason: 'too short' },
				{ axis: 'UX', reason: longReason },
				{ axis: 'security', reason: longReason },
			],
		});
		const result = verifyEvidence(2588, tmpDir);
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.reason).toMatch(/100 文字未満/);
	});

	it('TTL 30 分超え → fail', () => {
		const path = writeEvidence(2588);
		// mtime を 31 分前に設定
		const past = (Date.now() - (EVIDENCE_TTL_MS + 60 * 1000)) / 1000;
		utimesSync(path, past, past);
		const result = verifyEvidence(2588, tmpDir);
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.reason).toMatch(/TTL/);
	});

	it('REQUIRED_AXES の Set 内容を固定 (将来の作為的緩和を防ぐ)', () => {
		expect([...REQUIRED_AXES].sort()).toEqual(['UX', 'business', 'security']);
	});

	it('REQUIRED_OBJECT_COUNT は literal 3 (将来の作為的緩和を防ぐ)', () => {
		expect(REQUIRED_OBJECT_COUNT).toBe(3);
	});

	it('MIN_REASON_LENGTH は literal 100 (将来の作為的緩和を防ぐ)', () => {
		expect(MIN_REASON_LENGTH).toBe(100);
	});
});
