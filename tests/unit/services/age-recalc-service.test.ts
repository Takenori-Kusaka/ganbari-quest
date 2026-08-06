import { asChildId, type ChildId } from '$lib/domain/ids';
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

// #4313: uiMode 切替の告知記録サービスをモック（本 service の責務境界の外）
const mockRecordUiModeChangeNotice = vi.fn();
vi.mock('$lib/server/services/ui-mode-change-notice-service', () => ({
	recordUiModeChangeNotice: (...args: unknown[]) => mockRecordUiModeChangeNotice(...args),
}));

// date-utils モック — 今日の日付を固定
vi.mock('$lib/domain/date-utils', async (importOriginal) => ({
	// 部分 mock。今日だけを固定し、他の JST ヘルパは実装をそのまま使う (#4127)
	...(await importOriginal<typeof import('$lib/domain/date-utils')>()),
	todayDateJST: () => '2026-04-25',
}));

import { logger } from '$lib/server/logger';
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
	id?: ChildId | number | string;
	nickname?: string;
	age?: number;
	birthDate?: string | null;
	uiMode?: string;
	uiModeManuallySet?: number;
	isArchived?: number;
};

function makeChild(overrides: ChildOverride = {}) {
	return {
		id: asChildId(overrides.id ?? 1),
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
		expect(mockUpdateChild).toHaveBeenCalledWith('1', { age: 6, uiMode: 'elementary' }, 't-1');
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
			asChildId(1),
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
		expect(mockUpdateChild).toHaveBeenCalledWith('1', { age: 3, uiMode: 'preschool' }, 't-1');
	});

	it('5→6歳境界: preschool → elementary に uiMode 遷移', async () => {
		mockListAllTenants.mockResolvedValue([makeTenant('t-1')]);
		mockFindAllChildren.mockResolvedValue([
			makeChild({ age: 5, birthDate: '2020-04-25', uiMode: 'preschool' }),
		]);

		const result = await recalcAllChildrenAges({ today: '2026-04-25' });

		expect(result.updated).toBe(1);
		expect(mockUpdateChild).toHaveBeenCalledWith('1', { age: 6, uiMode: 'elementary' }, 't-1');
	});

	it('12→13歳境界: elementary → junior に uiMode 遷移', async () => {
		mockListAllTenants.mockResolvedValue([makeTenant('t-1')]);
		mockFindAllChildren.mockResolvedValue([
			makeChild({ age: 12, birthDate: '2013-04-25', uiMode: 'elementary' }),
		]);

		const result = await recalcAllChildrenAges({ today: '2026-04-25' });

		expect(result.updated).toBe(1);
		expect(mockUpdateChild).toHaveBeenCalledWith('1', { age: 13, uiMode: 'junior' }, 't-1');
	});

	it('15→16歳境界: junior → senior に uiMode 遷移', async () => {
		mockListAllTenants.mockResolvedValue([makeTenant('t-1')]);
		mockFindAllChildren.mockResolvedValue([
			makeChild({ age: 15, birthDate: '2010-04-25', uiMode: 'junior' }),
		]);

		const result = await recalcAllChildrenAges({ today: '2026-04-25' });

		expect(result.updated).toBe(1);
		expect(mockUpdateChild).toHaveBeenCalledWith('1', { age: 16, uiMode: 'senior' }, 't-1');
	});

	it('境界でない場合: 7→8歳で uiMode は elementary のまま変化しない', async () => {
		mockListAllTenants.mockResolvedValue([makeTenant('t-1')]);
		mockFindAllChildren.mockResolvedValue([
			makeChild({ age: 7, birthDate: '2018-04-25', uiMode: 'elementary' }),
		]);

		const result = await recalcAllChildrenAges({ today: '2026-04-25' });

		expect(result.updated).toBe(1);
		expect(mockUpdateChild).toHaveBeenCalledWith('1', { age: 8, uiMode: 'elementary' }, 't-1');
	});
});

describe('recalcAllChildrenAges — エラーハンドリング', () => {
	it('updateChild が例外を投げても failures にカウントされ処理は継続する', async () => {
		mockListAllTenants.mockResolvedValue([makeTenant('t-1')]);
		// child 1: 更新失敗、child 2: 更新成功
		mockFindAllChildren.mockResolvedValue([
			makeChild({ id: asChildId(1), age: 5, birthDate: '2020-04-25' }),
			makeChild({ id: asChildId(2), age: 5, birthDate: '2020-04-25' }),
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
			makeChild({ id: asChildId(1), age: 5, birthDate: '2020-04-25' }),
		]);
		// t-2: birthDate なし
		mockFindAllChildren.mockResolvedValueOnce([makeChild({ id: asChildId(2), birthDate: null })]);

		const result = await recalcAllChildrenAges({ today: '2026-04-25' });

		expect(result.scanned).toBe(2);
		expect(result.skipped).toBe(1);
		expect(result.updated).toBe(1);
		expect(mockUpdateChild).toHaveBeenCalledWith('1', { age: 6, uiMode: 'elementary' }, 't-1');
		expect(mockUpdateChild).not.toHaveBeenCalledWith('2', expect.anything(), expect.anything());
	});
});

// ============================================================
// #4313: uiMode 切替の pending notice 記録
// ============================================================

describe('recalcAllChildrenAges — uiMode 切替の告知記録 (#4313)', () => {
	const boundaries: Array<{ age: number; birthDate: string; from: string; to: string }> = [
		{ age: 2, birthDate: '2023-04-25', from: 'baby', to: 'preschool' },
		{ age: 5, birthDate: '2020-04-25', from: 'preschool', to: 'elementary' },
		{ age: 12, birthDate: '2013-04-25', from: 'elementary', to: 'junior' },
		{ age: 15, birthDate: '2010-04-25', from: 'junior', to: 'senior' },
	];

	for (const b of boundaries) {
		it(`${b.from} → ${b.to} 境界で notice を記録する`, async () => {
			mockListAllTenants.mockResolvedValue([makeTenant('t-1')]);
			mockFindAllChildren.mockResolvedValue([
				makeChild({ age: b.age, birthDate: b.birthDate, uiMode: b.from }),
			]);

			await recalcAllChildrenAges({ today: '2026-04-25' });

			expect(mockRecordUiModeChangeNotice).toHaveBeenCalledWith(
				expect.objectContaining({ from: b.from, to: b.to, changedOn: '2026-04-25' }),
				't-1',
			);
		});
	}

	it('同一モード内の年齢変化 (7→8 歳) では notice を記録しない', async () => {
		mockListAllTenants.mockResolvedValue([makeTenant('t-1')]);
		mockFindAllChildren.mockResolvedValue([
			makeChild({ age: 7, birthDate: '2018-04-25', uiMode: 'elementary' }),
		]);

		await recalcAllChildrenAges({ today: '2026-04-25' });

		expect(mockRecordUiModeChangeNotice).not.toHaveBeenCalled();
	});

	it('uiModeManuallySet=1 なら uiMode が変わらないので notice も記録しない', async () => {
		mockListAllTenants.mockResolvedValue([makeTenant('t-1')]);
		mockFindAllChildren.mockResolvedValue([
			makeChild({ age: 5, birthDate: '2020-04-25', uiMode: 'preschool', uiModeManuallySet: 1 }),
		]);

		await recalcAllChildrenAges({ today: '2026-04-25' });

		expect(mockRecordUiModeChangeNotice).not.toHaveBeenCalled();
	});

	it('dryRun=true では notice を記録しない', async () => {
		mockListAllTenants.mockResolvedValue([makeTenant('t-1')]);
		mockFindAllChildren.mockResolvedValue([
			makeChild({ age: 5, birthDate: '2020-04-25', uiMode: 'preschool' }),
		]);

		await recalcAllChildrenAges({ today: '2026-04-25', dryRun: true });

		expect(mockRecordUiModeChangeNotice).not.toHaveBeenCalled();
	});

	it('updateChild が失敗したら notice を記録しない (DB 未反映で告知だけ出さない)', async () => {
		mockListAllTenants.mockResolvedValue([makeTenant('t-1')]);
		mockFindAllChildren.mockResolvedValue([
			makeChild({ age: 5, birthDate: '2020-04-25', uiMode: 'preschool' }),
		]);
		mockUpdateChild.mockRejectedValueOnce(new Error('DB connection lost'));

		await recalcAllChildrenAges({ today: '2026-04-25' });

		expect(mockRecordUiModeChangeNotice).not.toHaveBeenCalled();
	});
});

// ============================================================
// #4337: 30 秒 self-limiting + 持ち越し (13-AWS設計書 §3.3)
// ============================================================

describe('recalcAllChildrenAges — self-limiting / 持ち越し (#4337)', () => {
	/** tenantLimit / 時間予算の検証用に N テナント (t01..tNN) を仕込む */
	function seedTenants(count: number) {
		const ids = Array.from({ length: count }, (_, i) => `t${String(i + 1).padStart(2, '0')}`);
		mockListAllTenants.mockResolvedValue(ids.map((id) => makeTenant(id)));
		// child は全テナント共通で「更新不要な 1 件」= 走査コストのみを表現する
		mockFindAllChildren.mockResolvedValue([makeChild({ age: 6, birthDate: '2020-04-25' })]);
		return ids;
	}

	/** findAllChildren に渡された tenantId 列 = 実際に走査したテナント */
	function visitedTenants(): string[] {
		return mockFindAllChildren.mock.calls.map((c) => c[0] as string);
	}

	it('テナント数が上限を超える場合、上限までしか処理せず残りを持ち越す', async () => {
		seedTenants(5);

		const result = await recalcAllChildrenAges({ today: '2026-04-25', tenantLimit: 2 });

		expect(result.tenantsProcessed).toBe(2);
		expect(result.tenantsTotal).toBe(5);
		expect(result.tenantsRemaining).toBe(3);
		expect(visitedTenants()).toHaveLength(2);
	});

	it('#4345 follow-up: 予算超過による打ち切りが発生したら log warn + レスポンスで報告する (silent 持ち越し禁止)', async () => {
		seedTenants(3);
		let calls = 0;
		// 1 テナント目の処理中に予算超過に転じる = 「担当スライス内での打ち切り」を再現する
		const budget = { exceeded: () => calls++ >= 1, elapsedMs: () => 20_000 };

		const result = await recalcAllChildrenAges({ today: '2026-04-25', budget });

		expect(result.tenantsSkippedByBudget).toBeGreaterThan(0);
		expect(logger.warn).toHaveBeenCalledWith(
			expect.stringContaining('carried over'),
			expect.objectContaining({
				context: expect.objectContaining({ skippedByBudget: 2 }),
			}),
		);
	});

	it('#4345 follow-up: ローテーションによる担当外（正常）だけなら warn しない (info のみ)', async () => {
		seedTenants(5);

		const result = await recalcAllChildrenAges({ today: '2026-04-25', tenantLimit: 2 });

		// 5 テナント / 上限 2 → sliceCount=3。今日の担当スライスは全件処理しきる
		// (予算超過なし) ので、tenantsRemaining はローテーションによる担当外のみ。
		expect(result.tenantsSkippedByBudget).toBe(0);
		expect(result.tenantsSkippedByRotation).toBeGreaterThan(0);
		expect(result.tenantsRemaining).toBe(result.tenantsSkippedByRotation);
		expect(logger.warn).not.toHaveBeenCalledWith(
			expect.stringContaining('carried over'),
			expect.anything(),
		);
		expect(logger.info).toHaveBeenCalledWith(
			expect.stringContaining('rotation slice skipped'),
			expect.objectContaining({
				context: expect.objectContaining({ skippedByRotation: result.tenantsSkippedByRotation }),
			}),
		);
	});

	it('時間予算を使い切っていたら 1 テナントも処理せず全件持ち越す', async () => {
		seedTenants(3);

		const result = await recalcAllChildrenAges({
			today: '2026-04-25',
			budget: { exceeded: () => true, elapsedMs: () => 20_000 },
		});

		expect(result.tenantsProcessed).toBe(0);
		expect(result.tenantsRemaining).toBe(3);
		expect(result.tenantsSkippedByBudget).toBe(3);
		expect(result.tenantsSkippedByRotation).toBe(0);
		expect(result.budgetExceeded).toBe(true);
		expect(mockFindAllChildren).not.toHaveBeenCalled();
	});

	it('予算超過は item (テナント) 間で判定し、着手したテナントは完走する', async () => {
		seedTenants(3);
		let calls = 0;
		// 1 テナント目の処理中に予算超過に転じる → 2 テナント目以降は処理しない
		const budget = {
			exceeded: () => calls++ >= 1,
			elapsedMs: () => 20_000,
		};

		const result = await recalcAllChildrenAges({ today: '2026-04-25', budget });

		expect(result.tenantsProcessed).toBe(1);
		expect(result.tenantsRemaining).toBe(2);
		expect(result.tenantsSkippedByBudget).toBe(2);
		expect(result.tenantsSkippedByRotation).toBe(0);
		expect(visitedTenants()).toEqual(['t01']);
		// 着手した 1 テナント目の child は最後まで走査されている
		expect(result.scanned).toBe(1);
	});

	it('次回実行は続きから進む — 連続する実行日で同じ先頭 N 件を繰り返さない', async () => {
		const all = seedTenants(5);
		const seen: string[][] = [];

		// 5 テナント / 上限 2 → 3 スライス。3 日連続で全件を重複なく網羅する
		for (const today of ['2026-04-25', '2026-04-26', '2026-04-27']) {
			vi.clearAllMocks();
			mockUpdateChild.mockResolvedValue(undefined);
			seedTenants(5);
			await recalcAllChildrenAges({ today, tenantLimit: 2 });
			seen.push(visitedTenants());
		}

		const flat = seen.flat();
		expect(new Set(flat).size).toBe(flat.length); // 重複なし
		expect([...new Set(flat)].sort()).toEqual([...all].sort()); // 全件網羅
		expect(seen[0]).not.toEqual(seen[1]); // 先頭 N 件の繰り返しではない
	});

	it('同じ実行日なら同じスライスを処理する (順序は日付から決まる決定的関数)', async () => {
		seedTenants(5);
		await recalcAllChildrenAges({ today: '2026-04-25', tenantLimit: 2 });
		const first = visitedTenants();

		vi.clearAllMocks();
		mockUpdateChild.mockResolvedValue(undefined);
		seedTenants(5);
		await recalcAllChildrenAges({ today: '2026-04-25', tenantLimit: 2 });

		expect(visitedTenants()).toEqual(first);
	});

	it('回帰: テナント数が上限未満なら従来どおり全件処理し持ち越し 0', async () => {
		seedTenants(3);

		const result = await recalcAllChildrenAges({ today: '2026-04-25', tenantLimit: 10 });

		expect(result.tenantsProcessed).toBe(3);
		expect(result.tenantsRemaining).toBe(0);
		expect(result.tenantsSkippedByRotation).toBe(0);
		expect(result.tenantsSkippedByBudget).toBe(0);
		expect(result.scanned).toBe(3);
		expect(logger.warn).not.toHaveBeenCalledWith(
			expect.stringContaining('carried over'),
			expect.anything(),
		);
	});
});
