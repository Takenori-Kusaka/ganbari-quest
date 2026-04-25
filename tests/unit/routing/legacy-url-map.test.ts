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

		it('活動パック → マーケットプレイス redirect は 16 エントリすべて 301', () => {
			// #1167: 4 neutral 詳細 (kinder-starter/elementary-challenge/junior-high/senior-high)
			// #1212: otetsudai-master 廃止 + 10 性別バリアント詳細
			// #1301: baby-first/baby-boy/baby-girl → マーケット一覧フォールバック
			const activityPackDetails = LEGACY_URL_MAP.filter((e) =>
				e.from.startsWith('/activity-packs/'),
			);
			expect(activityPackDetails).toHaveLength(16);
			for (const entry of activityPackDetails) {
				expect(entry.status).toBe(301);
				expect(['#1167', '#1212', '#1301']).toContain(entry.issue);
			}
		});

		it('/activity-packs 一覧ページも 301 で /marketplace に redirect する', () => {
			const listEntry = LEGACY_URL_MAP.find((e) => e.from === '/activity-packs');
			expect(listEntry).toBeDefined();
			expect(listEntry?.status).toBe(301);
			expect(listEntry?.to).toBe('/marketplace?type=activity-pack');
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
			// #1167 / #1212: 活動パック → マーケットプレイス 301 — 完全一致（15 詳細 + 廃止 1）
			['/activity-packs/baby-first', '/activity-packs/baby-first'],
			['/activity-packs/baby-boy', '/activity-packs/baby-boy'],
			['/activity-packs/baby-girl', '/activity-packs/baby-girl'],
			['/activity-packs/kinder-starter', '/activity-packs/kinder-starter'],
			['/activity-packs/kinder-boy', '/activity-packs/kinder-boy'],
			['/activity-packs/kinder-girl', '/activity-packs/kinder-girl'],
			['/activity-packs/elementary-challenge', '/activity-packs/elementary-challenge'],
			['/activity-packs/elementary-boy', '/activity-packs/elementary-boy'],
			['/activity-packs/elementary-girl', '/activity-packs/elementary-girl'],
			['/activity-packs/otetsudai-master', '/activity-packs/otetsudai-master'],
			['/activity-packs/junior-high-challenge', '/activity-packs/junior-high-challenge'],
			['/activity-packs/junior-boy', '/activity-packs/junior-boy'],
			['/activity-packs/junior-girl', '/activity-packs/junior-girl'],
			['/activity-packs/senior-high-challenge', '/activity-packs/senior-high-challenge'],
			['/activity-packs/senior-boy', '/activity-packs/senior-boy'],
			['/activity-packs/senior-girl', '/activity-packs/senior-girl'],
			// #1212: 一覧ページも redirect
			['/activity-packs', '/activity-packs'],
			// 新 URL はマッチしない
			['/preschool/home', null],
			['/elementary/home', null],
			['/junior/home', null],
			['/senior/home', null],
			['/demo/preschool/home', null],
			['/marketplace/activity-pack/baby-first', null],
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
			// #1167 / #1212: 活動パック → マーケットプレイス 301
			// #1301: baby 系は削除されマーケット一覧へフォールバック
			['/activity-packs/baby-first', '/marketplace?type=activity-pack'],
			['/activity-packs/baby-boy', '/marketplace?type=activity-pack'],
			['/activity-packs/baby-girl', '/marketplace?type=activity-pack'],
			['/activity-packs/kinder-starter', '/marketplace/activity-pack/kinder-starter'],
			['/activity-packs/kinder-boy', '/marketplace/activity-pack/kinder-boy'],
			['/activity-packs/kinder-girl', '/marketplace/activity-pack/kinder-girl'],
			['/activity-packs/elementary-challenge', '/marketplace/activity-pack/elementary-challenge'],
			['/activity-packs/elementary-boy', '/marketplace/activity-pack/elementary-boy'],
			['/activity-packs/elementary-girl', '/marketplace/activity-pack/elementary-girl'],
			['/activity-packs/junior-high-challenge', '/marketplace/activity-pack/junior-high-challenge'],
			['/activity-packs/junior-boy', '/marketplace/activity-pack/junior-boy'],
			['/activity-packs/junior-girl', '/marketplace/activity-pack/junior-girl'],
			['/activity-packs/senior-high-challenge', '/marketplace/activity-pack/senior-high-challenge'],
			['/activity-packs/senior-boy', '/marketplace/activity-pack/senior-boy'],
			['/activity-packs/senior-girl', '/marketplace/activity-pack/senior-girl'],
			// #1212: otetsudai-master 廃止 → マーケット一覧
			['/activity-packs/otetsudai-master', '/marketplace?type=activity-pack'],
			// #1212: 一覧ページ廃止 → マーケット一覧
			['/activity-packs', '/marketplace?type=activity-pack'],
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
