// tests/unit/server/orphan-child-reference.test.ts
//
// #4556 ③ — 「children 一覧に無い childId」が発生したことを運用が後から数えられること。
//
// #4543 で表示は「不明なお子さま」に潰れた。潰したまま無音だと、孤立が増えても誰も
// 気づかない。ここでは「潰したときに必ず warn が 1 行出る」ことを固定する。

import { beforeEach, describe, expect, it, vi } from 'vitest';

const warn = vi.fn();
vi.mock('$lib/server/logger', () => ({
	logger: { debug: vi.fn(), info: vi.fn(), warn, error: vi.fn(), critical: vi.fn() },
}));

const { warnOrphanChildReferences } = await import(
	'../../../src/lib/server/orphan-child-reference'
);

describe('#4556 ③ warnOrphanChildReferences', () => {
	beforeEach(() => warn.mockClear());

	it('孤立が無ければ何も出さない (正常系は無音)', () => {
		const orphans = warnOrphanChildReferences({
			tenantId: 't1',
			referencedChildIds: ['c1', 'c2'],
			knownChildIds: ['c1', 'c2', 'c3'],
			source: 'admin/checklists:load',
		});

		expect(orphans).toEqual([]);
		expect(warn).not.toHaveBeenCalled();
	});

	it('孤立があれば tenantId / childId / 発生箇所つきで warn する', () => {
		const orphans = warnOrphanChildReferences({
			tenantId: 't1',
			referencedChildIds: ['c1', 'ghost-1'],
			knownChildIds: ['c1'],
			source: 'admin/challenges:load',
		});

		expect(orphans).toEqual(['ghost-1']);
		expect(warn).toHaveBeenCalledTimes(1);
		const [, meta] = warn.mock.calls[0] as [string, Record<string, unknown>];
		expect(meta.tenantId).toBe('t1');
		expect(meta.context).toMatchObject({
			source: 'admin/challenges:load',
			orphanChildIds: ['ghost-1'],
			orphanCount: 1,
		});
	});

	it('同じ childId が何度参照されても warn は 1 行 (ログを埋めない)', () => {
		const orphans = warnOrphanChildReferences({
			tenantId: 't1',
			referencedChildIds: ['ghost-1', 'ghost-1', 'ghost-2', 'ghost-1'],
			knownChildIds: [],
			source: 'admin/checklists:load',
		});

		expect(orphans).toEqual(['ghost-1', 'ghost-2']);
		expect(warn).toHaveBeenCalledTimes(1);
		const [, meta] = warn.mock.calls[0] as [string, Record<string, unknown>];
		expect((meta.context as Record<string, unknown>).orphanCount).toBe(2);
	});
});

describe('#4556 ③ 孤立を潰す load が観測を通している', () => {
	// 表示を潰す画面 (#4543 で fallback を入れた server load) が、潰すだけで無音にならないこと。
	// 呼び出しを消すと落ちる。
	const LOADS = [
		'src/routes/(parent)/admin/challenges/+page.server.ts',
		'src/routes/(parent)/admin/checklists/+page.server.ts',
	];

	it.each(LOADS)('%s が warnOrphanChildReferences を呼んでいる', async (rel) => {
		const { readFileSync } = await import('node:fs');
		const { resolve } = await import('node:path');
		const source = readFileSync(resolve(__dirname, '../../..', rel), 'utf-8');
		expect(source).toContain('warnOrphanChildReferences({');
	});
});
