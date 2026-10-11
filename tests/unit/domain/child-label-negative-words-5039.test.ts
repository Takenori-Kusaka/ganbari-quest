// tests/unit/domain/child-label-negative-words-5039.test.ts (#5039)
//
// docs/design/28-エラーハンドリング設計書.md 原則 1「子供を怖がらせない」を機械検証する。
// 子供画面のエラー文言に「エラー」「失敗」「問題」を使わない。
// 値の一致ではなく **禁止語の不在** を assert する (age-tier-tone-4690.test.ts と同型)。

import { describe, expect, it } from 'vitest';
import { getChildErrorPageLabels } from '../../../src/lib/domain/labels';

const NEGATIVE_WORDS = /エラー|失敗|問題/;

/** ひらがな側 (baby / preschool) と漢字側 (elementary 以上) の両方を走査する。 */
const UI_MODES = ['baby', 'preschool', 'elementary', 'junior', 'senior'] as const;

describe('子供向けエラー画面ラベルにネガティブワードが無い (#5039)', () => {
	const entries = UI_MODES.flatMap((mode) =>
		Object.entries(getChildErrorPageLabels(mode)).map(([key, value]) => ({ mode, key, value })),
	);

	it('走査対象が 1 件以上ある (対象が消えて緑で通らない)', () => {
		expect(entries.length).toBeGreaterThan(0);
	});

	it.each(entries)('$mode / $key に禁止語を含まない', ({ value }) => {
		expect(value).not.toMatch(NEGATIVE_WORDS);
	});
});
