import { describe, expect, it } from 'vitest';

import {
	SCREENSHOT_QUERY,
	SCREENSHOT_QUERY_NOISE_ONLY,
	withScreenshotParam,
} from '../../../scripts/lib/screenshot-helpers.mjs';

describe('scripts/lib/screenshot-helpers — #1206 SSOT (#1893 で screenshot=all 化)', () => {
	// #1893: default を `screenshot=all` (本番一致演出強制 ON) に変更。`screenshot=1` は後方互換のみ。
	it('SCREENSHOT_QUERY は "screenshot=all" (default、本番一致演出 ON)', () => {
		expect(SCREENSHOT_QUERY).toBe('screenshot=all');
	});

	it('SCREENSHOT_QUERY_NOISE_ONLY は "screenshot=1" (後方互換)', () => {
		expect(SCREENSHOT_QUERY_NOISE_ONLY).toBe('screenshot=1');
	});

	describe('withScreenshotParam — default (screenshot=all)', () => {
		it('クエリなしパスには ? を付ける', () => {
			expect(withScreenshotParam('/demo/lower/home')).toBe('/demo/lower/home?screenshot=all');
		});

		it('既存クエリがあれば & を付ける', () => {
			expect(withScreenshotParam('/demo/checklist?childId=904')).toBe(
				'/demo/checklist?childId=904&screenshot=all',
			);
		});

		it('複数クエリがあっても & でつなぐ', () => {
			expect(withScreenshotParam('/a?b=1&c=2')).toBe('/a?b=1&c=2&screenshot=all');
		});

		it('ルートパス "/" も処理できる', () => {
			expect(withScreenshotParam('/')).toBe('/?screenshot=all');
		});
	});

	describe('withScreenshotParam — mode option (#1893)', () => {
		it('mode="noise-only" で "screenshot=1" (後方互換)', () => {
			expect(withScreenshotParam('/demo/lower/home', { mode: 'noise-only' })).toBe(
				'/demo/lower/home?screenshot=1',
			);
		});

		it('mode="all" で "screenshot=all" (default 同等)', () => {
			expect(withScreenshotParam('/demo/lower/home', { mode: 'all' })).toBe(
				'/demo/lower/home?screenshot=all',
			);
		});
	});
});
