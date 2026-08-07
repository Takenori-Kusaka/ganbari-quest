// tests/unit/services/child-service-default-ui-mode.test.ts
// #4419: addChild (service 層) が uiMode を **repo に渡す前に** 年齢から解決することを固定する。
//
// repo 側にも同じ既定値 (getDefaultUiMode) があるため、repo 実装を使うテストでは
// 「service が解決している」ことを区別できない。ここでは既定値を持たない fake repo を
// 差して、service 単体の責務として表明する。
//
// なぜ service 層が主で repo 側が防御かというと:
//   - 「新規登録した子供にどの UI を出すか」は保存形式ではなく製品ルールで、登録経路
//     (`/setup/children` と `/admin/children`) の両方が addChild を通る
//   - repo 側の既定値は addChild を経由しない直接呼び出し (import-service の
//     バックアップ復元は insertChild を直接呼ぶ) に対する防御線として残す

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getDefaultUiMode } from '$lib/domain/validation/age-tier';

const insertChildSpy = vi.fn(async (input: Record<string, unknown>, _tenantId: string) => ({
	id: 1,
	...input,
	uiModeManuallySet: 0,
}));

vi.mock('$lib/server/db/child-repo', () => ({
	// fake repo: 既定値を一切持たない (渡された値をそのまま返す)
	insertChild: (input: Record<string, unknown>, tenantId: string) =>
		insertChildSpy(input, tenantId),
	findAllChildren: vi.fn(),
	findArchivedChildren: vi.fn(),
	findChildById: vi.fn(),
	findChildByUserId: vi.fn(),
	updateChild: vi.fn(),
	deleteChild: vi.fn(),
}));
vi.mock('$lib/server/storage', () => ({
	deleteByPrefix: vi.fn(),
	deleteFile: vi.fn(),
	listFiles: vi.fn().mockResolvedValue([]),
}));
vi.mock('$lib/server/logger', () => ({
	logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const { addChild } = await import('$lib/server/services/child-service');

describe('#4419 addChild は uiMode を repo に渡す前に解決する', () => {
	beforeEach(() => insertChildSpy.mockClear());

	it.each([0, 2, 3, 5, 6, 12, 13, 15, 16, 18])('age=%i を SSOT 値で渡す', async (age) => {
		await addChild({ nickname: `c${age}`, age }, 't-1');
		expect(insertChildSpy).toHaveBeenCalledWith(
			expect.objectContaining({ uiMode: getDefaultUiMode(age) }),
			't-1',
		);
	});

	it('保護者が明示指定した uiMode は上書きしない', async () => {
		await addChild({ nickname: 'manual', age: 15, uiMode: 'preschool' }, 't-1');
		expect(insertChildSpy).toHaveBeenCalledWith(
			expect.objectContaining({ uiMode: 'preschool' }),
			't-1',
		);
	});
});
