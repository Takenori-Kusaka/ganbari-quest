import { describe, expect, it } from 'vitest';

// @ts-expect-error — JS module, no types
import { SCREENSHOT_QUERY, withScreenshotParam } from '../../../scripts/lib/screenshot-helpers.mjs';

describe('scripts/lib/screenshot-helpers — #1206 SSOT', () => {
	it('SCREENSHOT_QUERY は "screenshot=1"', () => {
		expect(SCREENSHOT_QUERY).toBe('screenshot=1');
	});

	describe('withScreenshotParam', () => {
		it('クエリなしパスには ? を付ける', () => {
			expect(withScreenshotParam('/demo/lower/home')).toBe('/demo/lower/home?screenshot=1');
		});

		it('既存クエリがあれば & を付ける', () => {
			expect(withScreenshotParam('/demo/checklist?childId=904')).toBe(
				'/demo/checklist?childId=904&screenshot=1',
			);
		});

		it('複数クエリがあっても & でつなぐ', () => {
			expect(withScreenshotParam('/a?b=1&c=2')).toBe('/a?b=1&c=2&screenshot=1');
		});

		it('ルートパス "/" も処理できる', () => {
			expect(withScreenshotParam('/')).toBe('/?screenshot=1');
		});
	});
});
