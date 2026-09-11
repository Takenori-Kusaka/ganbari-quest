// tests/unit/services/child-ui-mode-manual-flag-roundtrip-4718.test.ts (#4718 QM)
//
// 年齢帯を「手動で選んだか」は保護者の意思なので、復元側で推測してはいけない。
// 復元は uiMode を常に明示で渡すため、`isExplicitUiModeOverride(age, uiMode)` は
// 「保存時の uiMode ≠ 復元時の年齢から導く既定」を手動指定と誤認する。
// 推定誕生日は 1/1 に +1 されるので、年をまたいだ復元で普通に起きる。
// 誤認すると recalcUiMode が固定され、年齢帯の自動遷移 (docs/DESIGN.md §8) が二度と働かない。

import { describe, expect, it } from 'vitest';
import {
	getDefaultUiMode,
	isExplicitUiModeOverride,
	recalcUiMode,
} from '../../../src/lib/domain/validation/age-tier';

/** repo の insertChild が行う手動フラグ決定と同じ規則 (復元値があればそれを優先)。 */
function resolveManualFlag(input: { age: number; uiMode?: string; uiModeManuallySet?: number }) {
	return input.uiModeManuallySet ?? (isExplicitUiModeOverride(input.age, input.uiMode) ? 1 : 0);
}

describe('#4718 復元時の uiModeManuallySet は round-trip 値を優先する', () => {
	it('復元値 0 を渡せば、保存時と復元時で帯がずれても自動のまま', () => {
		// 5 歳で保存 (preschool) → 復元時は 6 歳 (elementary) に繰り上がった、という状況。
		const exportedUiMode = getDefaultUiMode(5);
		const restoredAge = 6;
		expect(exportedUiMode).not.toBe(getDefaultUiMode(restoredAge));

		// 導出だけだと「手動指定」と誤認する
		expect(isExplicitUiModeOverride(restoredAge, exportedUiMode)).toBe(true);

		// round-trip 値 (0 = 自動) を渡せば自動のまま
		const manual = resolveManualFlag({
			age: restoredAge,
			uiMode: exportedUiMode,
			uiModeManuallySet: 0,
		});
		expect(manual).toBe(0);

		// 自動なので、以後の年齢変化で帯が追従する
		expect(recalcUiMode({ uiMode: exportedUiMode as never, uiModeManuallySet: manual }, 13)).toBe(
			getDefaultUiMode(13),
		);
	});

	it('復元値 1 を渡せば、保護者が選んだ帯が保たれる', () => {
		const manual = resolveManualFlag({ age: 16, uiMode: 'preschool', uiModeManuallySet: 1 });
		expect(manual).toBe(1);
		expect(recalcUiMode({ uiMode: 'preschool', uiModeManuallySet: manual }, 17)).toBe('preschool');
	});

	it('旧 backup (field 無し) は従来どおり導出に落ちる (後方互換)', () => {
		expect(resolveManualFlag({ age: 8, uiMode: getDefaultUiMode(8) })).toBe(0);
		expect(resolveManualFlag({ age: 8, uiMode: 'senior' })).toBe(1);
	});
});
