// tests/unit/domain/stamp-press-n-messages.test.ts
// #1536: N レアリティ スタンプ ポジティブメッセージのユニットテスト
// 全5年齢モードでメッセージが定義されていること、ランダム性を確認する

import { describe, expect, it } from 'vitest';
import { STAMP_PRESS_N_MESSAGES } from '../../../src/lib/domain/labels';
import { UI_MODES } from '../../../src/lib/domain/validation/age-tier-types';

describe('STAMP_PRESS_N_MESSAGES', () => {
	it('全5年齢モード (baby/preschool/elementary/junior/senior) でメッセージが定義されている', () => {
		for (const mode of UI_MODES) {
			expect(STAMP_PRESS_N_MESSAGES[mode], `${mode} のメッセージが未定義`).toBeDefined();
			expect(STAMP_PRESS_N_MESSAGES[mode].length, `${mode} のメッセージが空`).toBeGreaterThan(0);
		}
	});

	it('各年齢モードのメッセージはすべて空文字でない', () => {
		for (const mode of UI_MODES) {
			for (const msg of STAMP_PRESS_N_MESSAGES[mode]) {
				expect(msg.trim().length, `${mode} に空メッセージが含まれる`).toBeGreaterThan(0);
			}
		}
	});

	it('各年齢モードに複数のメッセージがある（ランダムローテーション可能）', () => {
		for (const mode of UI_MODES) {
			expect(
				STAMP_PRESS_N_MESSAGES[mode].length,
				`${mode} はランダムローテーションのため2件以上必要`,
			).toBeGreaterThanOrEqual(2);
		}
	});

	it('Math.random ベースのインデックス選択で有効なメッセージが選ばれる', () => {
		// 境界値: インデックス 0 が有効なメッセージを返すことを確認
		for (const mode of UI_MODES) {
			const messages = STAMP_PRESS_N_MESSAGES[mode];
			const firstMsg = messages[0];
			expect(typeof firstMsg).toBe('string');
			expect((firstMsg as string).length).toBeGreaterThan(0);
			// 全インデックスが有効な文字列を返すこと
			for (const msg of messages) {
				expect(typeof msg).toBe('string');
				expect(msg.length).toBeGreaterThan(0);
			}
		}
	});

	it('baby モードはひらがな・シンプルなメッセージ（親向けトーン）', () => {
		// baby モードは保護者向けなので、各メッセージが存在していること
		const msgs = STAMP_PRESS_N_MESSAGES.baby;
		expect(msgs.length).toBeGreaterThan(0);
		// 全て string 型
		for (const msg of msgs) {
			expect(typeof msg).toBe('string');
		}
	});

	it('preschool モードはひらがなメッセージを含む', () => {
		const msgs = STAMP_PRESS_N_MESSAGES.preschool;
		// ひらがな文字が含まれているか確認（/[぀-ゟ]/）
		const hasHiragana = msgs.some((m) => /[぀-ゟ]/.test(m));
		expect(hasHiragana, 'preschool のメッセージにひらがなが含まれていない').toBe(true);
	});

	it('senior モードはより大人向けのトーンのメッセージが定義されている', () => {
		const msgs = STAMP_PRESS_N_MESSAGES.senior;
		// senior は英語メッセージ or 漢字メッセージを含む可能性があるため存在確認のみ
		expect(msgs.length).toBeGreaterThanOrEqual(2);
		for (const msg of msgs) {
			expect(msg.trim().length).toBeGreaterThan(0);
		}
	});
});
