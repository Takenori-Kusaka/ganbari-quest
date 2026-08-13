// tests/unit/domain/child-checklist-labels.test.ts
// #4509 ④/⑥: チェックリスト文言の年齢帯 variant を 5 モード分固定する。
//
// 旧実装はひらがな 1 セットのみで、13-18 歳がナビの「持ち物チェック」(漢字) から遷移すると
// 「にちようび」「おやにおねがいしてね」という幼児文体に着地していた。
// 曜日名 / 時間帯ラベルも画面側の直書きだったため、ここ (labels SSOT) に集約する。

import { describe, expect, it } from 'vitest';
import {
	CHILD_CHECKLIST_TIME_SLOT_ICONS,
	getChildChecklistLabels,
} from '../../../src/lib/domain/labels';
import { UI_MODES } from '../../../src/lib/domain/validation/age-tier';

const HIRAGANA_MODES = ['baby', 'preschool'] as const;
const KANJI_MODES = ['elementary', 'junior', 'senior'] as const;

describe('#4509 ④ getChildChecklistLabels — 年齢帯 variant', () => {
	it('5 モードすべてで文言が解決する (未定義モードを残さない)', () => {
		for (const mode of UI_MODES) {
			const t = getChildChecklistLabels({ ageTier: mode });
			expect(t.todayPrefix.length, mode).toBeGreaterThan(0);
			expect(t.dayNames, mode).toHaveLength(7);
			expect(Object.keys(t.timeSlotLabels).sort(), mode).toEqual([
				'afternoon',
				'anytime',
				'evening',
				'morning',
			]);
		}
	});

	it('baby / preschool はひらがな文体を維持する', () => {
		for (const mode of HIRAGANA_MODES) {
			const t = getChildChecklistLabels({ ageTier: mode });
			expect(t.dayNames[0], mode).toBe('にちようび');
			expect(t.emptyDesc, mode).toBe('おやにおねがいしてね');
			expect(t.nowSuffix, mode).toBe('のじかん');
		}
	});

	it('elementary 以上は幼児文体に着地しない (漢字文体)', () => {
		for (const mode of KANJI_MODES) {
			const t = getChildChecklistLabels({ ageTier: mode });
			expect(t.dayNames[0], mode).toBe('日曜日');
			expect(
				t.dayNames.some((d) => d.includes('ようび')),
				mode,
			).toBe(false);
			expect(t.emptyDesc, mode).not.toBe('おやにおねがいしてね');
			expect(t.nowSuffix, mode).toBe('の時間');
			expect(t.timeSlotLabels.morning, mode).toBe('朝');
		}
	});

	it('ナビが漢字 (「持ち物チェック」) の年齢帯で本文がひらがな固定にならない', () => {
		const junior = getChildChecklistLabels({ ageTier: 'junior' });
		const preschool = getChildChecklistLabels({ ageTier: 'preschool' });
		expect(junior.dayNames).not.toEqual(preschool.dayNames);
		expect(junior.todayPrefix).not.toBe(preschool.todayPrefix);
	});

	it('未知 / 未指定の年齢帯でも落ちず、安全側 (ひらがな) に倒れる', () => {
		for (const input of [undefined, null, '', 'unknown-mode']) {
			const t = getChildChecklistLabels({ ageTier: input });
			expect(t.dayNames[0]).toBe('にちようび');
		}
	});

	it('時間帯アイコンは年齢帯によらず 4 種そろっている', () => {
		expect(Object.keys(CHILD_CHECKLIST_TIME_SLOT_ICONS).sort()).toEqual([
			'afternoon',
			'anytime',
			'evening',
			'morning',
		]);
	});
});
