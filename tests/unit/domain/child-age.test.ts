// tests/unit/domain/child-age.test.ts
// #4718: 年齢 / 誕生日の保存・導出規約 (全 backend 共通 SSOT) の単体検証。
import { describe, expect, it } from 'vitest';
import {
	deriveChildAge,
	estimateBirthDateFromAge,
	publicBirthDate,
	representativeAgeForUiMode,
	resolveBirthDateForInsert,
	resolveBirthDateForUpdate,
} from '../../../src/lib/domain/child-age';

const TODAY = '2026-08-19';

describe('child-age (#4718)', () => {
	it('推定誕生日は「今年 − 年齢」年の 1/1 で、導出年齢が入力値と一致する', () => {
		expect(estimateBirthDateFromAge(10, TODAY)).toBe('2016-01-01');
		expect(estimateBirthDateFromAge(0, TODAY)).toBe('2026-01-01');
		expect(deriveChildAge({ birthDate: estimateBirthDateFromAge(10, TODAY) }, TODAY)).toBe(10);
		// 年始 (JST 1/1) でも一致する
		expect(
			deriveChildAge({ birthDate: estimateBirthDateFromAge(7, '2027-01-01') }, '2027-01-01'),
		).toBe(7);
	});

	it('insert: 誕生日入力があれば実値、無ければ推定 (estimated=true)', () => {
		expect(resolveBirthDateForInsert({ age: 8, birthDate: '2018-05-05' }, TODAY)).toEqual({
			birthDate: '2018-05-05',
			birthDateEstimated: false,
		});
		expect(resolveBirthDateForInsert({ age: 8 }, TODAY)).toEqual({
			birthDate: '2018-01-01',
			birthDateEstimated: true,
		});
	});

	it('update: 実誕生日は年齢入力で上書きしない / 推定の子は差し替える', () => {
		const real = { birthDate: '2018-05-05', birthDateEstimated: false };
		const est = { birthDate: '2018-01-01', birthDateEstimated: true };
		expect(resolveBirthDateForUpdate({ age: 3 }, real, TODAY)).toEqual({});
		expect(resolveBirthDateForUpdate({ age: 3 }, est, TODAY)).toEqual({
			birthDate: '2023-01-01',
			birthDateEstimated: true,
		});
		expect(
			resolveBirthDateForUpdate({ age: 3 }, { birthDate: null, birthDateEstimated: false }, TODAY),
		).toEqual({ birthDate: '2023-01-01', birthDateEstimated: true });
		// 誕生日を実値で入れると estimated=false
		expect(resolveBirthDateForUpdate({ birthDate: '2019-02-02' }, est, TODAY)).toEqual({
			birthDate: '2019-02-02',
			birthDateEstimated: false,
		});
		// 誕生日クリア + 年齢 → 推定 / 誕生日クリアのみ → 現在値を推定扱いに降格
		expect(resolveBirthDateForUpdate({ birthDate: null, age: 4 }, real, TODAY)).toEqual({
			birthDate: '2022-01-01',
			birthDateEstimated: true,
		});
		expect(resolveBirthDateForUpdate({ birthDate: null }, real, TODAY)).toEqual({
			birthDateEstimated: true,
		});
		// 何も来なければ触らない
		expect(resolveBirthDateForUpdate({}, real, TODAY)).toEqual({});
	});

	it('読み出し: birth_date が無い旧行は stored age、公開 birthDate は実誕生日のみ', () => {
		expect(deriveChildAge({ birthDate: null, age: 6 }, TODAY)).toBe(6);
		expect(deriveChildAge({ birthDate: null }, TODAY)).toBe(0);
		expect(publicBirthDate({ birthDate: '2018-01-01', birthDateEstimated: true })).toBeNull();
		expect(publicBirthDate({ birthDate: '2018-05-05', birthDateEstimated: false })).toBe(
			'2018-05-05',
		);
		expect(publicBirthDate({ birthDate: null, birthDateEstimated: false })).toBeNull();
	});

	it('backfill: ui_mode 帯の代表年齢 (migration 0008 の CASE と同値)', () => {
		expect(representativeAgeForUiMode('baby')).toBe(1);
		expect(representativeAgeForUiMode('preschool')).toBe(4);
		expect(representativeAgeForUiMode('elementary')).toBe(9);
		expect(representativeAgeForUiMode('junior')).toBe(14);
		expect(representativeAgeForUiMode('senior')).toBe(17);
		expect(representativeAgeForUiMode('unknown')).toBe(9);
	});
});

describe('#4718 誕生日欄を空にしたときの契約 (QM #4729 レビューで明文化)', () => {
	const TODAY_LOCAL = '2026-09-02';

	it('年齢も来ない場合は「推定扱いへの降格」で、保存値は消さない', () => {
		const stored = { birthDate: '2018-05-05', birthDateEstimated: false };
		const next = resolveBirthDateForUpdate({ birthDate: null }, stored, TODAY_LOCAL);

		// birth_date は書き換えない (誤って空にした保護者が復旧できるようにする)
		expect(next.birthDate, '保存値は書き換えない').toBeUndefined();
		expect(next.birthDateEstimated, '推定扱いへ降格する').toBe(true);
	});

	it('降格すると公開値は null になる (画面 / export / 誕生日ボーナスの対象外)', () => {
		const stored = { birthDate: '2018-05-05', birthDateEstimated: false };
		const next = resolveBirthDateForUpdate({ birthDate: null }, stored, TODAY_LOCAL);
		expect(
			publicBirthDate({
				birthDate: stored.birthDate,
				birthDateEstimated: next.birthDateEstimated ?? stored.birthDateEstimated,
			}),
		).toBeNull();
	});

	it('降格しても年齢は保たれる (0 歳に戻らない)', () => {
		const stored = { birthDate: '2018-05-05', birthDateEstimated: false };
		resolveBirthDateForUpdate({ birthDate: null }, stored, TODAY_LOCAL);
		expect(deriveChildAge({ birthDate: stored.birthDate }, TODAY_LOCAL)).toBe(8);
	});

	it('年齢が一緒に来た場合はその年齢の推定誕生日で置き換える', () => {
		const stored = { birthDate: '2018-05-05', birthDateEstimated: false };
		expect(resolveBirthDateForUpdate({ birthDate: null, age: 4 }, stored, TODAY_LOCAL)).toEqual({
			birthDate: '2022-01-01',
			birthDateEstimated: true,
		});
	});

	it('元から誕生日が無い行は何も書かない', () => {
		expect(
			resolveBirthDateForUpdate(
				{ birthDate: null },
				{ birthDate: null, birthDateEstimated: false },
				TODAY_LOCAL,
			),
		).toEqual({});
	});
});
