// tests/unit/migration/child-transformers.test.ts
// Child エンティティの Transformer テスト

import { describe, expect, it } from 'vitest';
import { childV1toV2 } from '../../../src/lib/server/db/migration/transformers/child';
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
