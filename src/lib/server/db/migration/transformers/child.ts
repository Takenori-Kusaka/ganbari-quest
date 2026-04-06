// src/lib/server/db/migration/transformers/child.ts
// Child エンティティのスキーマ変換器
//
// V1: _sv なし（既存の全レコード）
// V2: displayConfig, birthdayBonusMultiplier, lastBirthdayBonusYear のデフォルト保証
// V3: UiMode コード名変更 + 年齢ベース再割り当て (#537)

import { SCHEMA_VERSION_FIELD, type SchemaTransformer } from '../types';

/**
 * V1→V2: オプショナルフィールドにデフォルト値を保証
 */
export const childV1toV2: SchemaTransformer = {
	entityType: 'child',
	fromVersion: 1,
	toVersion: 2,
	transform(raw) {
		return {
			...raw,
			[SCHEMA_VERSION_FIELD]: 2,
			displayConfig: raw.displayConfig ?? null,
			birthdayBonusMultiplier:
				typeof raw.birthdayBonusMultiplier === 'number' ? raw.birthdayBonusMultiplier : 1.0,
			lastBirthdayBonusYear:
				typeof raw.lastBirthdayBonusYear === 'number' ? raw.lastBirthdayBonusYear : null,
			birthDate: raw.birthDate ?? null,
			avatarUrl: raw.avatarUrl ?? null,
			userId: raw.userId ?? null,
		};
	},
};

/**
 * 生年月日から年齢を算出（マイグレーション時点の年齢）
 */
function calculateAge(birthDate: string | null | undefined): number | null {
	if (!birthDate || typeof birthDate !== 'string') return null;
	const birth = new Date(birthDate);
	if (Number.isNaN(birth.getTime())) return null;
	const now = new Date();
	let age = now.getFullYear() - birth.getFullYear();
	const monthDiff = now.getMonth() - birth.getMonth();
	if (monthDiff < 0 || (monthDiff === 0 && now.getDate() < birth.getDate())) {
		age--;
	}
	return age;
}

/**
 * 年齢から新UiModeを決定
 */
function getNewUiModeByAge(age: number): string {
	if (age <= 2) return 'baby';
	if (age <= 5) return 'preschool';
	if (age <= 12) return 'elementary';
	if (age <= 15) return 'junior';
	return 'senior';
}

/** 旧コード → 新コード の機械的マッピング（年齢が不明な場合のフォールバック） */
const LEGACY_MODE_MAP: Record<string, string> = {
	kinder: 'preschool',
	lower: 'elementary',
	upper: 'junior',
	teen: 'senior',
};

/**
 * V2→V3: UiMode コード名変更 + 年齢ベース再割り当て (#537)
 *
 * 戦略:
 * 1. birthDate から年齢を算出できる場合 → 年齢ベースで新コードを決定
 * 2. birthDate が不明な場合 → 旧コード名の機械的マッピングで変換
 * 3. 既に新コード名（baby/preschool/elementary/junior/senior）の場合 → そのまま
 */
export const childV2toV3: SchemaTransformer = {
	entityType: 'child',
	fromVersion: 2,
	toVersion: 3,
	transform(raw) {
		const oldMode = raw.uiMode as string;
		const newModes = ['baby', 'preschool', 'elementary', 'junior', 'senior'];

		let newMode: string;
		if (newModes.includes(oldMode)) {
			// 既に新コード → そのまま
			newMode = oldMode;
		} else {
			// 年齢ベース再割り当てを試行
			const age = calculateAge(raw.birthDate as string | null | undefined);
			if (age !== null && age >= 0) {
				newMode = getNewUiModeByAge(age);
			} else {
				// 年齢不明 → 機械的マッピング
				newMode = LEGACY_MODE_MAP[oldMode] ?? oldMode;
			}
		}

		return {
			...raw,
			[SCHEMA_VERSION_FIELD]: 3,
			uiMode: newMode,
		};
	},
};

export const childTransformers: SchemaTransformer[] = [childV1toV2, childV2toV3];
