// tests/unit/services/birthday-bonus-service.test.ts
// 誕生日ボーナスサービスのユニットテスト

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Child } from '../../../src/lib/server/db/types';

// --- child-repo モック（#580: claimBirthdayBonus のテスト用） ---
const mockFindChildById = vi.fn();
const mockUpdateChild = vi.fn();
vi.mock('$lib/server/db/child-repo', () => ({
	findChildById: (...args: unknown[]) => mockFindChildById(...args),
	updateChild: (...args: unknown[]) => mockUpdateChild(...args),
}));

// --- point-repo モック ---
const mockInsertPointEntry = vi.fn();
vi.mock('$lib/server/db/point-repo', () => ({
	insertPointEntry: (...args: unknown[]) => mockInsertPointEntry(...args),
}));

// --- date-utils モック — 誕生日計算を固定日付で制御 ---
let _mockedToday = '2026-04-01';
vi.mock('$lib/domain/date-utils', () => ({
	todayDateJST: () => _mockedToday,
}));

import {
	calcBirthdayBonus,
	calculateAge,
	checkBirthdayStatus,
	claimBirthdayBonus,
	isBirthdayWindow,
} from '../../../src/lib/server/services/birthday-bonus-service';

// ============================================================
// Pure function tests (no DB)
// ============================================================

describe('calculateAge', () => {
	it('誕生日前なら前年の年齢', () => {
		expect(calculateAge('2020-08-15', '2026-04-01')).toBe(5);
	});

	it('誕生日当日なら新しい年齢', () => {
		expect(calculateAge('2020-04-01', '2026-04-01')).toBe(6);
	});

	it('誕生日の翌日', () => {
		expect(calculateAge('2020-04-01', '2026-04-02')).toBe(6);
	});

	it('0歳の場合', () => {
		expect(calculateAge('2026-03-01', '2026-04-01')).toBe(0);
	});

	it('誕生日が同じ月の後日', () => {
		expect(calculateAge('2020-04-15', '2026-04-01')).toBe(5);
	});
});

describe('isBirthdayWindow', () => {
	it('誕生日当日はtrue', () => {
		expect(isBirthdayWindow('2020-04-01', '2026-04-01')).toBe(true);
	});

	it('誕生日翌日はtrue（3日ウィンドウ）', () => {
		expect(isBirthdayWindow('2020-04-01', '2026-04-02')).toBe(true);
	});

	it('誕生日2日後はtrue（3日ウィンドウ）', () => {
		expect(isBirthdayWindow('2020-04-01', '2026-04-03')).toBe(true);
	});

	it('誕生日3日後はfalse（ウィンドウ外）', () => {
		expect(isBirthdayWindow('2020-04-01', '2026-04-04')).toBe(false);
	});

	it('誕生日前日はfalse', () => {
		expect(isBirthdayWindow('2020-04-01', '2026-03-31')).toBe(false);
	});

	it('全く関係ない日はfalse', () => {
		expect(isBirthdayWindow('2020-08-15', '2026-04-01')).toBe(false);
	});
});

describe('calcBirthdayBonus', () => {
	it('年齢 × 100 × 倍率', () => {
		expect(calcBirthdayBonus(7, 1.0)).toBe(700);
	});

	it('倍率0.5', () => {
		expect(calcBirthdayBonus(7, 0.5)).toBe(350);
	});

	it('倍率2.0', () => {
		expect(calcBirthdayBonus(7, 2.0)).toBe(1400);
	});

	it('倍率3.0 × 10歳', () => {
		expect(calcBirthdayBonus(10, 3.0)).toBe(3000);
	});

	it('0歳は0ポイント', () => {
		expect(calcBirthdayBonus(0, 1.0)).toBe(0);
	});

	it('1歳で倍率1.0 = 100pt', () => {
		expect(calcBirthdayBonus(1, 1.0)).toBe(100);
	});
});

describe('checkBirthdayStatus', () => {
	function makeChild(overrides: Partial<Child> = {}): Child {
		return {
			id: 1,
			nickname: 'テスト',
			age: 6,
			birthDate: '2020-04-01',
			theme: 'pink',
			uiMode: 'preschool',
			uiModeManuallySet: 0,
			avatarUrl: null,
			displayConfig: null,
			userId: null,
			birthdayBonusMultiplier: 1.0,
			lastBirthdayBonusYear: null,
			isArchived: 0,
			archivedReason: null,
			createdAt: '2026-01-01',
			updatedAt: '2026-01-01',
			...overrides,
		};
	}

	it('誕生日当日で未受領ならeligible', () => {
		const child = makeChild({ birthDate: '2020-04-01' });
		const status = checkBirthdayStatus(child, '2026-04-01');
		expect(status.eligible).toBe(true);
		expect(status.alreadyClaimed).toBe(false);
		expect(status.newAge).toBe(6);
		expect(status.totalPoints).toBe(600);
	});

	it('今年すでに受領済みなら eligible=false, alreadyClaimed=true', () => {
		const child = makeChild({
			birthDate: '2020-04-01',
			lastBirthdayBonusYear: 2026,
		});
		const status = checkBirthdayStatus(child, '2026-04-01');
		expect(status.eligible).toBe(false);
		expect(status.alreadyClaimed).toBe(true);
	});

	it('誕生日ウィンドウ外ならeligible=false', () => {
		const child = makeChild({ birthDate: '2020-08-15' });
		const status = checkBirthdayStatus(child, '2026-04-01');
		expect(status.eligible).toBe(false);
		expect(status.expired).toBe(true);
	});

	it('birthDateがnullの場合はeligible=false', () => {
		const child = makeChild({ birthDate: null });
		const status = checkBirthdayStatus(child, '2026-04-01');
		expect(status.eligible).toBe(false);
	});

	it('倍率カスタマイズが反映される', () => {
		const child = makeChild({
			birthDate: '2020-04-01',
			birthdayBonusMultiplier: 2.0,
		});
		const status = checkBirthdayStatus(child, '2026-04-01');
		expect(status.totalPoints).toBe(1200);
	});

	it('ウィンドウ2日目でもeligible', () => {
		const child = makeChild({ birthDate: '2020-04-01' });
		const status = checkBirthdayStatus(child, '2026-04-02');
		expect(status.eligible).toBe(true);
		expect(status.newAge).toBe(6);
	});

	it('ウィンドウ3日目（最終日）でもeligible', () => {
		const child = makeChild({ birthDate: '2020-04-01' });
		const status = checkBirthdayStatus(child, '2026-04-03');
		expect(status.eligible).toBe(true);
	});
});

// ============================================================
// #580: claimBirthdayBonus — uiMode 更新テスト（age 更新は age-recalc cron に移譲 #1522）
// ============================================================
describe('claimBirthdayBonus — uiMode 自動再計算（#580）', () => {
	function makeChildForClaim(overrides: Partial<Child> = {}): Child {
		return {
			id: 1,
			nickname: 'テスト',
			age: 5,
			birthDate: '2020-04-01',
			theme: 'pink',
			uiMode: 'preschool',
			uiModeManuallySet: 0,
			avatarUrl: null,
			displayConfig: null,
			userId: null,
			birthdayBonusMultiplier: 1.0,
			lastBirthdayBonusYear: null,
			isArchived: 0,
			archivedReason: null,
			createdAt: '2026-01-01',
			updatedAt: '2026-01-01',
			...overrides,
		};
	}

	beforeEach(() => {
		mockFindChildById.mockReset();
		mockUpdateChild.mockReset();
		mockInsertPointEntry.mockReset();
		mockInsertPointEntry.mockResolvedValue(undefined);
		mockUpdateChild.mockResolvedValue(undefined);
		_mockedToday = '2026-04-01';
	});

	it('2→3歳境界: baby → preschool に uiMode が遷移する', async () => {
		mockFindChildById.mockResolvedValue(
			makeChildForClaim({ age: 2, uiMode: 'baby', birthDate: '2023-04-01' }),
		);

		const result = await claimBirthdayBonus(1, 'tenant-1');

		expect('error' in result).toBe(false);
		if ('error' in result) return;
		expect(result.newAge).toBe(3);
		// age 更新は age-recalc cron に移譲（#1522）。updateChild には uiMode + lastBirthdayBonusYear のみ渡す
		expect(mockUpdateChild).toHaveBeenCalledWith(
			1,
			expect.objectContaining({
				uiMode: 'preschool',
				lastBirthdayBonusYear: 2026,
			}),
			'tenant-1',
		);
		expect(mockUpdateChild).toHaveBeenCalledWith(
			1,
			expect.not.objectContaining({ age: expect.anything() }),
			'tenant-1',
		);
	});

	it('5→6歳境界: preschool → elementary に uiMode が遷移する', async () => {
		mockFindChildById.mockResolvedValue(
			makeChildForClaim({ age: 5, uiMode: 'preschool', birthDate: '2020-04-01' }),
		);

		const result = await claimBirthdayBonus(1, 'tenant-1');

		expect('error' in result).toBe(false);
		if ('error' in result) return;
		expect(result.newAge).toBe(6);
		// age 更新は age-recalc cron に移譲（#1522）。updateChild には uiMode のみ渡す
		expect(mockUpdateChild).toHaveBeenCalledWith(
			1,
			expect.objectContaining({ uiMode: 'elementary' }),
			'tenant-1',
		);
		expect(mockUpdateChild).toHaveBeenCalledWith(
			1,
			expect.not.objectContaining({ age: expect.anything() }),
			'tenant-1',
		);
	});

	it('12→13歳境界: elementary → junior に uiMode が遷移する', async () => {
		mockFindChildById.mockResolvedValue(
			makeChildForClaim({ age: 12, uiMode: 'elementary', birthDate: '2013-04-01' }),
		);

		const result = await claimBirthdayBonus(1, 'tenant-1');

		expect('error' in result).toBe(false);
		if ('error' in result) return;
		expect(result.newAge).toBe(13);
		// age 更新は age-recalc cron に移譲（#1522）。updateChild には uiMode のみ渡す
		expect(mockUpdateChild).toHaveBeenCalledWith(
			1,
			expect.objectContaining({ uiMode: 'junior' }),
			'tenant-1',
		);
		expect(mockUpdateChild).toHaveBeenCalledWith(
			1,
			expect.not.objectContaining({ age: expect.anything() }),
			'tenant-1',
		);
	});

	it('15→16歳境界: junior → senior に uiMode が遷移する', async () => {
		mockFindChildById.mockResolvedValue(
			makeChildForClaim({ age: 15, uiMode: 'junior', birthDate: '2010-04-01' }),
		);

		const result = await claimBirthdayBonus(1, 'tenant-1');

		expect('error' in result).toBe(false);
		if ('error' in result) return;
		expect(result.newAge).toBe(16);
		// age 更新は age-recalc cron に移譲（#1522）。updateChild には uiMode のみ渡す
		expect(mockUpdateChild).toHaveBeenCalledWith(
			1,
			expect.objectContaining({ uiMode: 'senior' }),
			'tenant-1',
		);
		expect(mockUpdateChild).toHaveBeenCalledWith(
			1,
			expect.not.objectContaining({ age: expect.anything() }),
			'tenant-1',
		);
	});

	it('境界でない場合: 6→7歳で uiMode は elementary のまま変化しない', async () => {
		mockFindChildById.mockResolvedValue(
			makeChildForClaim({ age: 6, uiMode: 'elementary', birthDate: '2019-04-01' }),
		);

		const result = await claimBirthdayBonus(1, 'tenant-1');

		expect('error' in result).toBe(false);
		if ('error' in result) return;
		expect(result.newAge).toBe(7);
		// age 更新は age-recalc cron に移譲（#1522）。updateChild には uiMode のみ渡す
		expect(mockUpdateChild).toHaveBeenCalledWith(
			1,
			expect.objectContaining({ uiMode: 'elementary' }),
			'tenant-1',
		);
		expect(mockUpdateChild).toHaveBeenCalledWith(
			1,
			expect.not.objectContaining({ age: expect.anything() }),
			'tenant-1',
		);
	});

	it('NOT_ELIGIBLE (ウィンドウ外): updateChild は呼ばれない', async () => {
		mockFindChildById.mockResolvedValue(
			makeChildForClaim({ age: 5, uiMode: 'preschool', birthDate: '2020-08-15' }),
		);

		const result = await claimBirthdayBonus(1, 'tenant-1');

		expect('error' in result).toBe(true);
		if ('error' in result) expect(result.error).toBe('NOT_ELIGIBLE');
		expect(mockUpdateChild).not.toHaveBeenCalled();
	});
});
