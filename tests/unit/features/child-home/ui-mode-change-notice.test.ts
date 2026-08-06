// tests/unit/features/child-home/ui-mode-change-notice.test.ts
// #4313: 告知ダイアログの表示判定 + 5 モード文言解決 (純関数)。
//
// - ADR-0012: 1 回で終わる / 誕生日モーダルと同時に 2 枚出さない
// - DESIGN.md §6: 文言は labels.ts SSOT 経由、preschool はひらがなのみ

import { describe, expect, it } from 'vitest';
import { UI_MODES } from '../../../../src/lib/domain/validation/age-tier-types';
import {
	resolveUiModeChangeMessage,
	shouldShowUiModeChangeNotice,
	type UiModeChangeNotice,
} from '../../../../src/lib/features/child-home/ui-mode-change-notice';

const notice: UiModeChangeNotice = { from: 'preschool', to: 'elementary', changedOn: '2026-08-06' };

describe('shouldShowUiModeChangeNotice', () => {
	it('pending notice があれば出す', () => {
		expect(
			shouldShowUiModeChangeNotice({
				notice,
				birthdayPending: false,
				isScreenshotMode: false,
			}),
		).toBe(true);
	});

	it('notice が無ければ出さない', () => {
		expect(
			shouldShowUiModeChangeNotice({
				notice: null,
				birthdayPending: false,
				isScreenshotMode: false,
			}),
		).toBe(false);
	});

	it('誕生日モーダルが出る回では出さない (ADR-0012: 2 枚同時/連続演出の禁止)', () => {
		expect(
			shouldShowUiModeChangeNotice({
				notice,
				birthdayPending: true,
				isScreenshotMode: false,
			}),
		).toBe(false);
	});

	it('screenshot モードでは出さない (LP 配信 SS を汚さない)', () => {
		expect(
			shouldShowUiModeChangeNotice({
				notice,
				birthdayPending: false,
				isScreenshotMode: true,
			}),
		).toBe(false);
	});
});

describe('resolveUiModeChangeMessage — 5 モードすべてで成立する', () => {
	for (const mode of UI_MODES) {
		it(`${mode}: 見出し・本文・閉じるラベル・保護者向け注記が空でない`, () => {
			const msg = resolveUiModeChangeMessage(mode);
			expect(msg.heading.length).toBeGreaterThan(0);
			expect(msg.body.length).toBeGreaterThan(0);
			expect(msg.closeLabel.length).toBeGreaterThan(0);
			expect(msg.parentNote.length).toBeGreaterThan(0);
			expect(msg.settingsLabel.length).toBeGreaterThan(0);
		});
	}

	it('preschool 向けの子供向け文面は漢字を含まない (ひらがな中心)', () => {
		const msg = resolveUiModeChangeMessage('preschool');
		const kanji = /[一-龯]/;
		expect(kanji.test(msg.heading)).toBe(false);
		expect(kanji.test(msg.body)).toBe(false);
		expect(kanji.test(msg.closeLabel)).toBe(false);
	});

	it('junior / senior 向けは漢字を含む (情報密度高め)', () => {
		const kanji = /[一-龯]/;
		expect(kanji.test(resolveUiModeChangeMessage('junior').body)).toBe(true);
		expect(kanji.test(resolveUiModeChangeMessage('senior').body)).toBe(true);
	});

	it('降格ではなく成長の枠組みで書かれている (機能が減ったと読ませない)', () => {
		for (const mode of UI_MODES) {
			const msg = resolveUiModeChangeMessage(mode);
			expect(msg.body).not.toMatch(/使えなく|減り|制限/);
		}
	});
});
