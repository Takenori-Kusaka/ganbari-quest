// tests/unit/services/birthday-bonus-service.test.ts
// 誕生日ボーナスサービスのユニットテスト

import { describe, expect, it } from 'vitest';
import type { Child } from '../../../src/lib/server/db/types';
import {
	calcBirthdayBonus,
	calculateAge,
	checkBirthdayStatus,
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
			uiMode: 'kinder',
			avatarUrl: null,
			displayConfig: null,
			userId: null,
			birthdayBonusMultiplier: 1.0,
			lastBirthdayBonusYear: null,
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
