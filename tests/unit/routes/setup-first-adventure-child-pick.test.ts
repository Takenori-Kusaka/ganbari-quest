// tests/unit/routes/setup-first-adventure-child-pick.test.ts
//
// **はじめてのがんばりを「だれと一緒にやるか」選ばせる** (PO 決裁 2026-09-10 決定 8)。
//
// ## なぜ要るか
//
// 旧実装は `children[0]` に固定していた。きょうだいがいる家庭では、2 人目以降の
// 保護者が「この子は無視されるのか」と受け取れる。活動は per-child なので、
// 選んだ子が変われば**表示する活動一覧も入れ替わらなければならない**。
//
// ## 固定する不変条件
//
//   [F1] `?childId=` で選んだ子が対象になる
//   [F2] 指定が無い / 不正なときは先頭の子に落ちる (壊れない)
//   [F3] 活動一覧は**選んだ子のもの**を取りに行く (選択と表示がずれない)
//   [F4] 選択 UI を出すために、children 一覧を画面へ渡している

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockGetAllChildren = vi.fn();
const mockGetChildActivities = vi.fn();

vi.mock('$lib/server/services/child-service', () => ({
	getAllChildren: (...args: unknown[]) => mockGetAllChildren(...args),
}));
vi.mock('$lib/server/services/activity-service', () => ({
	getChildActivities: (...args: unknown[]) => mockGetChildActivities(...args),
}));
vi.mock('$lib/server/services/activity-log-service', () => ({
	recordActivity: vi.fn(),
}));
vi.mock('$lib/server/services/setup-funnel-service', () => ({
	trackSetupFunnel: vi.fn(),
}));
vi.mock('$lib/server/auth/factory', () => ({
	requireTenantId: () => 't-1',
}));
vi.mock('$lib/server/logger', () => ({
	logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

const { load } = await import('../../../src/routes/setup/first-adventure/+page.server');

const CHILDREN = [
	{ id: 'c-1', nickname: 'まさと' },
	{ id: 'c-2', nickname: 'ゆい' },
];

/**
 * `load` の返り値は `void | PageData` (redirect すると値を返さない)。
 * **redirect したのか data を返したのか**を test 側で取り違えないよう、ここで潰す。
 */
async function loadData(childId?: string) {
	const data = await load(makeEvent(childId));
	if (!data) throw new Error('load が data を返さなかった (redirect した)');
	return data as unknown as {
		child?: { id: string };
		children: { id: string; nickname: string }[];
	};
}

function makeEvent(childId?: string) {
	const url = new URL('https://x/setup/first-adventure');
	if (childId !== undefined) url.searchParams.set('childId', childId);
	return {
		url,
		locals: { context: { tenantId: 't-1', role: 'owner' } },
		// biome-ignore lint/suspicious/noExplicitAny: minimal LoadEvent stub for load unit test
	} as any;
}

beforeEach(() => {
	vi.clearAllMocks();
	mockGetAllChildren.mockResolvedValue(CHILDREN);
	mockGetChildActivities.mockResolvedValue([
		{ id: 'a-1', name: 'はみがき', isVisible: true, basePoints: 10, icon: '🦷' },
	]);
});

describe('[F1] ?childId= で選んだ子が対象になる', () => {
	it('2 人目を指定するとその子が返る', async () => {
		const data = await loadData('c-2');
		expect(data.child?.id).toBe('c-2');
	});
});

describe('[F2] 指定が無い / 不正なら先頭の子に落ちる', () => {
	it('指定なし → 先頭', async () => {
		const data = await loadData();
		expect(data.child?.id).toBe('c-1');
	});

	it('他テナントの id を打たれても先頭に落ちる (存在しない子を掴まない)', async () => {
		const data = await loadData('c-999');
		expect(
			data.child?.id,
			'一覧に無い id をそのまま採用すると、他テナントの子を指せる余地が残る',
		).toBe('c-1');
	});
});

describe('[F3] 活動一覧は選んだ子のものを取りに行く', () => {
	it('c-2 を選んだら getChildActivities も c-2 で呼ばれる', async () => {
		await loadData('c-2');
		expect(
			mockGetChildActivities,
			'選択と表示がずれると、別の子の活動を「この子のがんばり」として記録させる',
		).toHaveBeenCalledWith('c-2', 't-1');
	});
});

describe('[F4] 選択 UI に必要な children を渡している', () => {
	it('children (id + nickname) を返す', async () => {
		const data = await loadData();
		expect(data.children).toEqual([
			{ id: 'c-1', nickname: 'まさと' },
			{ id: 'c-2', nickname: 'ゆい' },
		]);
	});
});
