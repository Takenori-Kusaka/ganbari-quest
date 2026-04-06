// tests/unit/migration/child-transformers.test.ts
// Child エンティティの Transformer テスト

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { childV1toV2, childV2toV3 } from '../../../src/lib/server/db/migration/transformers/child';
import { SCHEMA_VERSION_FIELD } from '../../../src/lib/server/db/migration/types';

describe('Child Transformer: V1→V2', () => {
	it('_sv を 2 に設定する', () => {
		const result = childV1toV2.transform({ nickname: '太郎', age: 5 });
		expect(result[SCHEMA_VERSION_FIELD]).toBe(2);
	});

	it('欠落フィールドにデフォルト値を設定する', () => {
		const result = childV1toV2.transform({
			nickname: '太郎',
			age: 5,
			theme: 'blue',
			uiMode: 'preschool',
		});
		expect(result.displayConfig).toBeNull();
		expect(result.birthdayBonusMultiplier).toBe(1.0);
		expect(result.lastBirthdayBonusYear).toBeNull();
		expect(result.birthDate).toBeNull();
		expect(result.avatarUrl).toBeNull();
		expect(result.userId).toBeNull();
	});

	it('既存の値は保持する', () => {
		const result = childV1toV2.transform({
			nickname: '太郎',
			age: 5,
			displayConfig: '{"compact":true}',
			birthdayBonusMultiplier: 2.0,
			lastBirthdayBonusYear: 2026,
			birthDate: '2021-03-15',
			avatarUrl: '/avatars/taro.png',
			userId: 'user-abc',
		});
		expect(result.displayConfig).toBe('{"compact":true}');
		expect(result.birthdayBonusMultiplier).toBe(2.0);
		expect(result.lastBirthdayBonusYear).toBe(2026);
		expect(result.birthDate).toBe('2021-03-15');
		expect(result.avatarUrl).toBe('/avatars/taro.png');
		expect(result.userId).toBe('user-abc');
	});

	it('birthdayBonusMultiplier が非数値なら 1.0 にフォールバック', () => {
		const result = childV1toV2.transform({
			nickname: '太郎',
			age: 5,
			birthdayBonusMultiplier: 'invalid',
		});
		expect(result.birthdayBonusMultiplier).toBe(1.0);
	});

	it('元レコードを変更しない', () => {
		const original = { nickname: '太郎', age: 5 };
		childV1toV2.transform(original);
		expect(original).toEqual({ nickname: '太郎', age: 5 });
	});
});

describe('Child Transformer: V2→V3', () => {
	beforeEach(() => {
		// 2026-04-06T12:00:00Z に固定
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2026-04-06T12:00:00Z'));
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it('_sv を 3 に設定する', () => {
		const result = childV2toV3.transform({
			[SCHEMA_VERSION_FIELD]: 2,
			uiMode: 'preschool',
		});
		expect(result[SCHEMA_VERSION_FIELD]).toBe(3);
	});

	it('既に新コード名の場合はそのまま保持する', () => {
		for (const mode of ['baby', 'preschool', 'elementary', 'junior', 'senior']) {
			const result = childV2toV3.transform({
				[SCHEMA_VERSION_FIELD]: 2,
				uiMode: mode,
			});
			expect(result.uiMode).toBe(mode);
		}
	});

	it('旧コード名を年齢ベースで再割り当てする', () => {
		const result = childV2toV3.transform({
			[SCHEMA_VERSION_FIELD]: 2,
			uiMode: 'kinder',
			birthDate: '2021-01-01', // 5歳 → preschool
		});
		expect(result.uiMode).toBe('preschool');
	});

	it('年齢不明の場合は機械的マッピングで変換する', () => {
		const cases: [string, string][] = [
			['kinder', 'preschool'],
			['lower', 'elementary'],
			['upper', 'junior'],
			['teen', 'senior'],
		];
		for (const [oldMode, expected] of cases) {
			const result = childV2toV3.transform({
				[SCHEMA_VERSION_FIELD]: 2,
				uiMode: oldMode,
				birthDate: null,
			});
			expect(result.uiMode).toBe(expected);
		}
	});

	it('calculateAge が UTC ベースで正しく算出される（TZ境界テスト）', () => {
		// 2026-04-06 に 2020-04-06 生まれ → ちょうど6歳 → elementary
		const result = childV2toV3.transform({
			[SCHEMA_VERSION_FIELD]: 2,
			uiMode: 'kinder',
			birthDate: '2020-04-06',
		});
		expect(result.uiMode).toBe('elementary');
	});

	it('誕生日前日の場合はまだ加齢しない', () => {
		// 2026-04-06 に 2020-04-07 生まれ → まだ5歳 → preschool
		const result = childV2toV3.transform({
			[SCHEMA_VERSION_FIELD]: 2,
			uiMode: 'kinder',
			birthDate: '2020-04-07',
		});
		expect(result.uiMode).toBe('preschool');
	});

	it('不正な birthDate は null 扱い（機械的マッピングフォールバック）', () => {
		const result = childV2toV3.transform({
			[SCHEMA_VERSION_FIELD]: 2,
			uiMode: 'lower',
			birthDate: 'invalid-date',
		});
		expect(result.uiMode).toBe('elementary');
	});
});
