import { describe, expect, it } from 'vitest';

import {
	countAcCheckboxes,
	judgeSkipAcGate,
} from '../../../scripts/issue-close-gate-skip-judge.mjs';

/**
 * issue-close-gate skip 判定 純粋関数の単体テスト (#2351)
 *
 * `.github/workflows/issue-close-gate.yml` の AC 検証 gate が
 * PR/Commit 経由 auto-close でも reopen する構造的ループを解消するため、
 * `scripts/issue-close-gate-skip-judge.mjs` の判定ロジックを検証する。
 *
 * 検証パターン:
 * 1. PR closer → skip = true (PR auto-close、AC gate skip)
 * 2. Commit closer → skip = true (squash merge commit、AC gate skip)
 * 3. null closer → skip = false (手動 close、AC gate 通す)
 * 4. wontfix / duplicate ラベル → skip = true (従来通り)
 * 5. ClosedEvent 履歴なし → skip = false (安全側で gate 通す)
 * 6. 複数 ClosedEvent → 直近 (配列末尾) を判定対象とする
 */
describe('judgeSkipAcGate', () => {
	it('PR closer (PullRequest) を検出したら skip = true', () => {
		const result = judgeSkipAcGate({
			issueNumber: 1234,
			labels: [],
			closedEvents: [
				{
					createdAt: '2026-05-21T00:00:00Z',
					actor: { login: 'github-actions[bot]' },
					closer: { __typename: 'PullRequest', number: 999 },
				},
			],
		});
		expect(result.skip).toBe(true);
		expect(result.reason).toContain('PR #999');
		expect(result.reason).toContain('AC gate skip');
	});

	it('Commit closer (squash merge) を検出したら skip = true', () => {
		const result = judgeSkipAcGate({
			issueNumber: 5678,
			labels: [],
			closedEvents: [
				{
					createdAt: '2026-05-21T00:00:00Z',
					actor: { login: 'ganbariquestsupport-lab' },
					closer: { __typename: 'Commit', oid: 'c62581c31c18c4c1aae2c034bcab8c945bb6af4d' },
				},
			],
		});
		expect(result.skip).toBe(true);
		expect(result.reason).toContain('Commit c62581c3');
		expect(result.reason).toContain('AC gate skip');
	});

	it('closer === null (手動 close) は skip = false で AC gate を通す', () => {
		const result = judgeSkipAcGate({
			issueNumber: 999,
			labels: [],
			closedEvents: [
				{
					createdAt: '2026-05-21T00:00:00Z',
					actor: { login: 'Takenori-Kusaka' },
					closer: null,
				},
			],
		});
		expect(result.skip).toBe(false);
		expect(result.reason).toContain('手動 close');
		expect(result.reason).toContain('AC 検証 gate 通す');
	});

	it('wontfix ラベル付きは従来通り skip = true', () => {
		const result = judgeSkipAcGate({
			issueNumber: 100,
			labels: ['wontfix', 'priority:low'],
			closedEvents: [
				// closer 種別に関わらず wontfix label が優先される
				{ closer: null },
			],
		});
		expect(result.skip).toBe(true);
		expect(result.reason).toContain('wontfix');
	});

	it('duplicate ラベル付きは従来通り skip = true', () => {
		const result = judgeSkipAcGate({
			issueNumber: 101,
			labels: ['duplicate'],
			closedEvents: [{ closer: null }],
		});
		expect(result.skip).toBe(true);
		expect(result.reason).toContain('duplicate');
	});

	it('ClosedEvent 履歴が空配列なら安全側で skip = false', () => {
		const result = judgeSkipAcGate({
			issueNumber: 200,
			labels: [],
			closedEvents: [],
		});
		expect(result.skip).toBe(false);
		expect(result.reason).toContain('ClosedEvent 履歴');
	});

	it('複数 ClosedEvent では配列末尾 (直近) を判定対象とする', () => {
		// 過去に PR 経由 close → reopen → 現在は手動 close で再 close した想定
		const result = judgeSkipAcGate({
			issueNumber: 300,
			labels: [],
			closedEvents: [
				{ closer: { __typename: 'Commit', oid: 'abcdef1234567890' } }, // 過去
				{ closer: null }, // 直近 (手動 close)
			],
		});
		expect(result.skip).toBe(false);
		expect(result.reason).toContain('手動 close');
	});

	it('複数 ClosedEvent で直近が PR closer なら skip = true', () => {
		const result = judgeSkipAcGate({
			issueNumber: 301,
			labels: [],
			closedEvents: [
				{ closer: null }, // 過去 (手動 close)
				{ closer: { __typename: 'PullRequest', number: 42 } }, // 直近 (PR 経由)
			],
		});
		expect(result.skip).toBe(true);
		expect(result.reason).toContain('PR #42');
	});
});

describe('countAcCheckboxes', () => {
	it('未チェック / チェック済みの両方をカウントする', () => {
		const body = [
			'## 完了チェックリスト',
			'',
			'- [ ] AC 全項目に [x] が入っている',
			'- [x] pre-ready PASS',
			'- [ ] Ready 化',
			'- [X] 設計書同期',
		].join('\n');
		const { unchecked, checked } = countAcCheckboxes(body);
		expect(unchecked).toBe(2);
		expect(checked).toBe(2);
	});

	it('空文字列・null body でも例外を投げない', () => {
		expect(countAcCheckboxes('')).toEqual({ unchecked: 0, checked: 0 });
		// @ts-expect-error 意図的に null を渡してデフォルト値を確認
		expect(countAcCheckboxes(null)).toEqual({ unchecked: 0, checked: 0 });
	});

	it('インデント付き checkbox も検出する', () => {
		const body = '  - [ ] indented unchecked\n    - [x] deeply indented checked';
		expect(countAcCheckboxes(body)).toEqual({ unchecked: 1, checked: 1 });
	});
});
