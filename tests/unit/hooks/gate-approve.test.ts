/**
 * tests/unit/hooks/gate-approve.test.ts (ADR-0056)
 *
 * .claude/hooks/gate-approve.mjs の純粋関数を unit test する。
 *
 * 検証スコープ:
 *   - isApproveAction: Bash command が approve 系か判定する regex
 *   - extractPrNumber: command から PR 番号を抽出する regex
 *   - verifyEvidence: tmp/adversarial-evidence/<pr>.json の schema 検証
 *   - fail-closed: 判定 SSOT の import 解決失敗時に exit 2 (block) で終了する (#3999)
 *
 * 関連:
 *   - ADR-0056 (本テストの設計根拠 SSOT)
 *   - docs/research/qm-drift-prevention-2026-05-28.md
 *   - Issue #3999 (fail-open の fail-closed 化) / Issue #3969 / PR #3979
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
import { bashPayload, runHookInIsolatedTree } from '../helpers/hook-tree-probe';

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

// ---------------------------------------------------------------------------
// fail-closed (#3999 AC1 / AC2)
// ---------------------------------------------------------------------------

/**
 * 判定 SSOT (`scripts/lib/is-main.mjs`) の import 解決に失敗したとき、hook が
 * **exit 2 (block)** で終了することを固定する。
 *
 * ## 何を守っているか
 *
 * Claude Code の PreToolUse hook は **exit 2 のみ**を block として扱い、それ以外の非 0 は
 * non-blocking error として tool 実行を継続する。static import の解決失敗は
 * `ERR_MODULE_NOT_FOUND` = **exit 1** なので、`scripts/` を含まない checkout では
 * **evidence 無しで approve / merge が通っていた** (QM が PR #3979 のレビューで実測)。
 *
 * ## 陽性対照を必ず併置する
 *
 * 「exit 2 が返った」だけでは、fail-closed が効いたのか hook が常に落ちているだけなのかを
 * 区別できない。`withIsMain: true` の tree で (a) 非 approve コマンドが exit 0 無出力になり
 * (b) approve コマンドが *evidence 不在* を理由に exit 2 になることを併せて assert する。
 * 陽性対照が無い guard は「規則違反を検出できないことを検出できない」(dev-session.md 台帳 3)。
 */
describe('fail-closed — 判定 SSOT の import 解決失敗 (#3999)', () => {
	const HOOK = '.claude/hooks/gate-approve.mjs';
	const APPROVE_CMD = 'gh pr merge 3999 --squash';
	const HARMLESS_CMD = 'git status --short';

	it('陽性対照: is-main.mjs のある tree では非 approve コマンドを素通しする (exit 0 / 無出力)', () => {
		const res = runHookInIsolatedTree({
			hookRelPath: HOOK,
			withIsMain: true,
			stdin: bashPayload(HARMLESS_CMD),
		});
		expect(res.status, `出力:\n${res.combined}`).toBe(0);
		expect(res.combined.trim()).toBe('');
	}, 30_000);

	it('陽性対照: is-main.mjs のある tree では evidence 不在の approve を exit 2 で block する', () => {
		const res = runHookInIsolatedTree({
			hookRelPath: HOOK,
			withIsMain: true,
			stdin: bashPayload(APPROVE_CMD),
		});
		expect(res.status, `出力:\n${res.combined}`).toBe(2);
		expect(res.stderr).toContain('evidence file 不在');
	}, 30_000);

	it('is-main.mjs が無い tree で approve コマンド → exit 2 (exit 1 = 素通しに倒れない)', () => {
		const res = runHookInIsolatedTree({
			hookRelPath: HOOK,
			withIsMain: false,
			stdin: bashPayload(APPROVE_CMD),
		});
		expect(
			res.status,
			`exit 1 は Claude Code では non-blocking error として tool 実行が継続する (= approve 素通し)。出力:\n${res.combined}`,
		).toBe(2);
		expect(res.stderr).toContain('scripts/lib/is-main.mjs');
		expect(res.stderr).toContain('fail-closed');
	}, 30_000);

	/**
	 * 判定不能時は approve 系以外も block する、という設計判断そのものを固定する。
	 * 「approve のときだけ block」へ後から緩めると、SSOT を読めない = CLI 起動か import かを
	 * 判定できない状態で main() を走らせるかどうかを推測することになり、別の silent failure を作る。
	 *
	 * **surgical 案 (approve 系だけ block) は技術的に可能だが、採らない。** approve 判定の regex は
	 * gate-approve.mjs 内に閉じており is-main.mjs に依存しないので、import 解決に失敗しても
	 * コマンド分類はできる。この test が固定しているのは能力の欠如ではなく**設計上の選択**。
	 * 緩める提案をするときは「判定不能状態で main() を走らせる根拠」を先に示すこと。
	 */
	it('is-main.mjs が無い tree では非 approve コマンドも block する (判定不能時は大きく止まる)', () => {
		const res = runHookInIsolatedTree({
			hookRelPath: HOOK,
			withIsMain: false,
			stdin: bashPayload(HARMLESS_CMD),
		});
		expect(res.status, `出力:\n${res.combined}`).toBe(2);
	}, 30_000);
});
