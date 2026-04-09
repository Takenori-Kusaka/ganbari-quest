/**
 * #578: LEGACY_URL_MAP のユニットテスト
 *
 * テーブル駆動で各エントリのリダイレクト挙動を検証する。
 * 新しいエントリを追加した場合はこのテストの EXPECTED_REDIRECTS にも
 * 追記すること。
 */

import { describe, expect, it } from 'vitest';
import {
	findLegacyRedirect,
	LEGACY_URL_MAP,
	rewriteLegacyPath,
} from '../../../src/lib/server/routing/legacy-url-map';

describe('legacy-url-map', () => {
	describe('LEGACY_URL_MAP エントリの整合性', () => {
		it('全エントリが必須フィールドを持つ', () => {
			for (const entry of LEGACY_URL_MAP) {
				expect(entry.from).toMatch(/^\//);
				expect(entry.to).toMatch(/^\//);
				expect(entry.deletedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
				expect(entry.issue).toMatch(/^#\d+$/);
				expect(entry.reason.length).toBeGreaterThan(0);
			}
		});

		it('from と to が異なる', () => {
			for (const entry of LEGACY_URL_MAP) {
				expect(entry.from).not.toBe(entry.to);
			}
		});

		it('from プレフィックスに重複がない', () => {
			const froms = LEGACY_URL_MAP.map((e) => e.from);
			expect(new Set(froms).size).toBe(froms.length);
		});
	});

	describe('findLegacyRedirect()', () => {
		// テーブル駆動: [入力パス, マッチ期待エントリの from]
		const cases: Array<[string, string | null]> = [
			// 年齢区分リネーム（#571）— 完全一致
			['/kinder', '/kinder'],
			['/lower', '/lower'],
			['/upper', '/upper'],
			['/teen', '/teen'],
			// プレフィックスマッチ（サブパス）
			['/kinder/home', '/kinder'],
			['/kinder/status', '/kinder'],
			['/lower/home', '/lower'],
			['/upper/home', '/upper'],
			['/teen/home', '/teen'],
			// デモ（より長いプレフィックスが優先されること）
			['/demo/kinder', '/demo/kinder'],
			['/demo/kinder/home', '/demo/kinder'],
			// 新 URL はマッチしない
			['/preschool/home', null],
			['/elementary/home', null],
			['/junior/home', null],
			['/senior/home', null],
			['/demo/preschool/home', null],
			// 部分文字列のみ一致する偽陽性はマッチしない
			['/kindergarten', null], // /kinder で始まるが境界が違う
			['/lowercase', null],
			// ルート・空パス
			['/', null],
			['/admin', null],
		];

		for (const [path, expectedFrom] of cases) {
			it(`"${path}" → ${expectedFrom ?? 'null'}`, () => {
				const result = findLegacyRedirect(path);
				if (expectedFrom === null) {
					expect(result).toBeNull();
				} else {
					expect(result).not.toBeNull();
					expect(result?.from).toBe(expectedFrom);
				}
			});
		}
	});

	describe('rewriteLegacyPath()', () => {
		const cases: Array<[string, string]> = [
			// 完全一致 — to プレフィックスそのまま
			['/kinder', '/preschool'],
			['/lower', '/elementary'],
			['/upper', '/junior'],
			['/teen', '/senior'],
			// サブパス保持
			['/kinder/home', '/preschool/home'],
			['/kinder/status/detail', '/preschool/status/detail'],
			['/lower/home', '/elementary/home'],
			['/upper/home', '/junior/home'],
			['/teen/home', '/senior/home'],
			// デモ（長いプレフィックス優先）
			['/demo/kinder', '/demo/preschool'],
			['/demo/kinder/home', '/demo/preschool/home'],
		];

		for (const [input, expected] of cases) {
			it(`"${input}" → "${expected}"`, () => {
				const entry = findLegacyRedirect(input);
				expect(entry).not.toBeNull();
				if (entry) {
					expect(rewriteLegacyPath(input, entry)).toBe(expected);
				}
			});
		}
	});

	describe('優先順位（長いプレフィックスが先に評価される）', () => {
		it('/demo/kinder は /demo/preschool に書き換えられる（/kinder にマッチしない）', () => {
			const entry = findLegacyRedirect('/demo/kinder/home');
			expect(entry?.from).toBe('/demo/kinder');
			if (entry) {
				expect(rewriteLegacyPath('/demo/kinder/home', entry)).toBe('/demo/preschool/home');
			}
		});
	});
});
