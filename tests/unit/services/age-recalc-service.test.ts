// tests/unit/services/age-recalc-service.test.ts
// #1381: 子供の年齢自動インクリメントサービスのユニットテスト
//
// age-recalc-service は getRepos() 経由でリポジトリを叩くため、
// ファクトリをモックして各リポジトリの戻り値を制御する。

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/server/logger', () => ({
	logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// リポジトリのモック実装
const mockListAllTenants = vi.fn();
const mockFindAllChildren = vi.fn();
const mockUpdateChild = vi.fn();

vi.mock('$lib/server/db/factory', () => ({
	getRepos: () => ({
		auth: {
			listAllTenants: mockListAllTenants,
		},
		child: {
			findAllChildren: mockFindAllChildren,
			updateChild: mockUpdateChild,
		},
	}),
}));

// date-utils モック — 今日の日付を固定
vi.mock('$lib/domain/date-utils', () => ({
	todayDateJST: () => '2026-04-25',
}));

import { recalcAllChildrenAges } from '../../../src/lib/server/services/age-recalc-service';

// ============================================================
// Helpers
// ============================================================

function makeTenant(tenantId = 't-1') {
	return {
		tenantId,
		name: 'Test Tenant',
		ownerId: 'u-1',
		status: 'active',
	};
}

type ChildOverride = {
	id?: number;
	nickname?: string;
	age?: number;
	birthDate?: string | null;
	uiMode?: string;
	uiModeManuallySet?: number;
	isArchived?: number;
};

function makeChild(overrides: ChildOverride = {}) {
	return {
		id: overrides.id ?? 1,
		nickname: overrides.nickname ?? 'テスト',
		age: overrides.age ?? 5,
		birthDate: overrides.birthDate !== undefined ? overrides.birthDate : '2020-04-25',
		theme: 'pink',
		uiMode: overrides.uiMode ?? 'preschool',
		uiModeManuallySet: overrides.uiModeManuallySet ?? 0,
		avatarUrl: null,
		displayConfig: null,
		userId: null,
		birthdayBonusMultiplier: 1.0,
		lastBirthdayBonusYear: null,
		isArchived: overrides.isArchived ?? 0,
		archivedReason: null,
		createdAt: '2026-01-01',
		updatedAt: '2026-01-01',
	};
}

// ============================================================
// Tests
// ============================================================

beforeEach(() => {
	vi.clearAllMocks();
	mockUpdateChild.mockResolvedValue(undefined);
});

describe('recalcAllChildrenAges — 基本動作', () => {
	it('テナントも child も存在しない場合: scanned=0, updated=0', async () => {
		mockListAllTenants.mockResolvedValue([]);

		const result = await recalcAllChildrenAges();

		expect(result).toMatchObject({
			scanned: 0,
			skipped: 0,
			updated: 0,
			failures: 0,
			dryRun: false,
		});
		expect(mockUpdateChild).not.toHaveBeenCalled();
	});

	it('birthDate なし → skipped にカウントされ updateChild は呼ばれない', async () => {
		mockListAllTenants.mockResolvedValue([makeTenant('t-1')]);
		mockFindAllChildren.mockResolvedValue([makeChild({ birthDate: null })]);

		const result = await recalcAllChildrenAges();

		expect(result.scanned).toBe(1);
		expect(result.skipped).toBe(1);
		expect(result.updated).toBe(0);
		expect(mockUpdateChild).not.toHaveBeenCalled();
	});

	it('birthDate あり、年齢変化なし → updated=0, updateChild は呼ばれない', async () => {
		// 今日 2026-04-25 に誕生日 2020-04-25 → age=6、child.age も 6
		mockListAllTenants.mockResolvedValue([makeTenant('t-1')]);
		mockFindAllChildren.mockResolvedValue([
			makeChild({ age: 6, birthDate: '2020-04-25', uiMode: 'elementary' }),
		]);

		const result = await recalcAllChildrenAges();

		expect(result.scanned).toBe(1);
		expect(result.skipped).toBe(0);
		expect(result.updated).toBe(0);
		expect(mockUpdateChild).not.toHaveBeenCalled();
	});

	it('birthDate あり、年齢変化あり、uiModeManuallySet=false → age + uiMode 更新', async () => {
		// 今日 2026-04-25 に誕生日 2020-04-25 → age=6、preschool → elementary
		mockListAllTenants.mockResolvedValue([makeTenant('t-1')]);
		mockFindAllChildren.mockResolvedValue([
			makeChild({ age: 5, birthDate: '2020-04-25', uiMode: 'preschool', uiModeManuallySet: 0 }),
		]);

		const result = await recalcAllChildrenAges();

		expect(result.scanned).toBe(1);
		expect(result.updated).toBe(1);
		expect(mockUpdateChild).toHaveBeenCalledWith(1, { age: 6, uiMode: 'elementary' }, 't-1');
	});

	it('birthDate あり、年齢変化あり、uiModeManuallySet=true → age のみ更新し uiMode は変化しない', async () => {
		// 今日 2026-04-25 に誕生日 2020-04-25 → age=6 だが uiModeManuallySet=1 のため preschool 維持
		mockListAllTenants.mockResolvedValue([makeTenant('t-1')]);
		mockFindAllChildren.mockResolvedValue([
			makeChild({ age: 5, birthDate: '2020-04-25', uiMode: 'preschool', uiModeManuallySet: 1 }),
		]);

		const result = await recalcAllChildrenAges();

		expect(result.scanned).toBe(1);
		expect(result.updated).toBe(1);
		expect(mockUpdateChild).toHaveBeenCalledWith(
			1,
			{ age: 6, uiMode: 'preschool' }, // uiMode は変化しない
			't-1',
		);
	});

	it('dryRun=true → updateChild は呼ばれず updated はカウントされる', async () => {
		mockListAllTenants.mockResolvedValue([makeTenant('t-1')]);
		mockFindAllChildren.mockResolvedValue([
			makeChild({ age: 5, birthDate: '2020-04-25', uiMode: 'preschool' }),
		]);

		const result = await recalcAllChildrenAges({ dryRun: true });

		expect(result.dryRun).toBe(true);
		expect(result.updated).toBe(1);
		expect(mockUpdateChild).not.toHaveBeenCalled();
	});
});

describe('recalcAllChildrenAges — 冪等性', () => {
	it('同日 2 回実行すると 2 回目は updated=0（age が既に更新済み）', async () => {
		mockListAllTenants.mockResolvedValue([makeTenant('t-1')]);

		// 1 回目: age=5 → age=6 に更新
		mockFindAllChildren.mockResolvedValueOnce([makeChild({ age: 5, birthDate: '2020-04-25' })]);
		const first = await recalcAllChildrenAges({ today: '2026-04-25' });
		expect(first.updated).toBe(1);

		// 2 回目: age=6 に更新済み → 変化なし
		mockFindAllChildren.mockResolvedValueOnce([
			makeChild({ age: 6, birthDate: '2020-04-25', uiMode: 'elementary' }),
		]);
		const second = await recalcAllChildrenAges({ today: '2026-04-25' });
		expect(second.updated).toBe(0);
	});
});

describe('recalcAllChildrenAges — 年齢境界', () => {
	it('2→3歳境界: baby → preschool に uiMode 遷移', async () => {
		mockListAllTenants.mockResolvedValue([makeTenant('t-1')]);
		mockFindAllChildren.mockResolvedValue([
			makeChild({ age: 2, birthDate: '2023-04-25', uiMode: 'baby' }),
		]);

		const result = await recalcAllChildrenAges({ today: '2026-04-25' });

		expect(result.updated).toBe(1);
		expect(mockUpdateChild).toHaveBeenCalledWith(1, { age: 3, uiMode: 'preschool' }, 't-1');
	});

	it('5→6歳境界: preschool → elementary に uiMode 遷移', async () => {
		mockListAllTenants.mockResolvedValue([makeTenant('t-1')]);
		mockFindAllChildren.mockResolvedValue([
			makeChild({ age: 5, birthDate: '2020-04-25', uiMode: 'preschool' }),
		]);

		const result = await recalcAllChildrenAges({ today: '2026-04-25' });

		expect(result.updated).toBe(1);
		expect(mockUpdateChild).toHaveBeenCalledWith(1, { age: 6, uiMode: 'elementary' }, 't-1');
	});

	it('12→13歳境界: elementary → junior に uiMode 遷移', async () => {
		mockListAllTenants.mockResolvedValue([makeTenant('t-1')]);
		mockFindAllChildren.mockResolvedValue([
			makeChild({ age: 12, birthDate: '2013-04-25', uiMode: 'elementary' }),
		]);

		const result = await recalcAllChildrenAges({ today: '2026-04-25' });

		expect(result.updated).toBe(1);
		expect(mockUpdateChild).toHaveBeenCalledWith(1, { age: 13, uiMode: 'junior' }, 't-1');
	});

	it('15→16歳境界: junior → senior に uiMode 遷移', async () => {
		mockListAllTenants.mockResolvedValue([makeTenant('t-1')]);
		mockFindAllChildren.mockResolvedValue([
			makeChild({ age: 15, birthDate: '2010-04-25', uiMode: 'junior' }),
		]);

		const result = await recalcAllChildrenAges({ today: '2026-04-25' });

		expect(result.updated).toBe(1);
		expect(mockUpdateChild).toHaveBeenCalledWith(1, { age: 16, uiMode: 'senior' }, 't-1');
	});

	it('境界でない場合: 7→8歳で uiMode は elementary のまま変化しない', async () => {
		mockListAllTenants.mockResolvedValue([makeTenant('t-1')]);
		mockFindAllChildren.mockResolvedValue([
			makeChild({ age: 7, birthDate: '2018-04-25', uiMode: 'elementary' }),
		]);

		const result = await recalcAllChildrenAges({ today: '2026-04-25' });

		expect(result.updated).toBe(1);
		expect(mockUpdateChild).toHaveBeenCalledWith(1, { age: 8, uiMode: 'elementary' }, 't-1');
	});
});

describe('recalcAllChildrenAges — エラーハンドリング', () => {
	it('updateChild が例外を投げても failures にカウントされ処理は継続する', async () => {
		mockListAllTenants.mockResolvedValue([makeTenant('t-1')]);
		// child 1: 更新失敗、child 2: 更新成功
		mockFindAllChildren.mockResolvedValue([
			makeChild({ id: 1, age: 5, birthDate: '2020-04-25' }),
			makeChild({ id: 2, age: 5, birthDate: '2020-04-25' }),
		]);
		mockUpdateChild
			.mockRejectedValueOnce(new Error('DB connection lost'))
			.mockResolvedValueOnce(undefined);

		const result = await recalcAllChildrenAges({ today: '2026-04-25' });

		expect(result.scanned).toBe(2);
		expect(result.updated).toBe(1);
		expect(result.failures).toBe(1);
	});
});

describe('recalcAllChildrenAges — 複数テナント', () => {
	it('複数テナントにまたがる child を正しく処理する', async () => {
		mockListAllTenants.mockResolvedValue([makeTenant('t-1'), makeTenant('t-2')]);
		// t-1: age 更新あり
		mockFindAllChildren.mockResolvedValueOnce([
			makeChild({ id: 1, age: 5, birthDate: '2020-04-25' }),
		]);
		// t-2: birthDate なし
		mockFindAllChildren.mockResolvedValueOnce([makeChild({ id: 2, birthDate: null })]);

		const result = await recalcAllChildrenAges({ today: '2026-04-25' });

		expect(result.scanned).toBe(2);
		expect(result.skipped).toBe(1);
		expect(result.updated).toBe(1);
		expect(mockUpdateChild).toHaveBeenCalledWith(1, { age: 6, uiMode: 'elementary' }, 't-1');
		expect(mockUpdateChild).not.toHaveBeenCalledWith(2, expect.anything(), expect.anything());
	});
});
