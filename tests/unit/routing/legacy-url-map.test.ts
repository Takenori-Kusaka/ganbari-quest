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

		it('/auth/forgot-pin → /auth/reset-pin (#2993) エントリが存在する', () => {
			const entry = LEGACY_URL_MAP.find((e) => e.from === '/auth/forgot-pin');
			expect(entry).toBeDefined();
			expect(entry?.to).toBe('/auth/reset-pin');
			expect(entry?.issue).toBe('#2993');
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

		// #2270 / #2275 (EPIC #2266): /admin/messages 廃止 → /admin/cheer redirect
		it('/admin/messages → /admin/cheer (308) エントリが存在する', () => {
			const entry = LEGACY_URL_MAP.find((e) => e.from === '/admin/messages');
			expect(entry).toBeDefined();
			expect(entry?.to).toBe('/admin/cheer');
			// status 省略 = 308 Permanent Redirect (規約デフォルト)
			expect(entry?.status).toBeUndefined();
			expect(entry?.issue).toBe('#2275');
		});

		it('/demo/admin/messages も最終 hop は /admin/cheer に直接 redirect (#2270 1 段化)', () => {
			const entry = LEGACY_URL_MAP.find((e) => e.from === '/demo/admin/messages');
			expect(entry).toBeDefined();
			expect(entry?.to).toBe('/admin/cheer');
		});

		// #2295 (EPIC #2294 ①): /admin/events 撤去 + /admin/challenges 救済 redirect
		it('/admin/events → /admin/challenges (308) エントリが存在する', () => {
			const entry = LEGACY_URL_MAP.find((e) => e.from === '/admin/events');
			expect(entry).toBeDefined();
			expect(entry?.to).toBe('/admin/challenges');
			expect(entry?.status).toBeUndefined();
			expect(entry?.issue).toBe('#2295');
		});

		it('/demo/admin/events も最終 hop は /admin/challenges に直接 redirect (#2295 1 段化)', () => {
			const entry = LEGACY_URL_MAP.find((e) => e.from === '/demo/admin/events');
			expect(entry).toBeDefined();
			expect(entry?.to).toBe('/admin/challenges');
		});

		// #2525 Phase 4 (#2620) / Phase 7 PR-L3 (#2818): /admin/license → /admin/subscription rename
		it('/admin/license → /admin/subscription (308) エントリが存在する', () => {
			const entry = LEGACY_URL_MAP.find((e) => e.from === '/admin/license');
			expect(entry).toBeDefined();
			expect(entry?.to).toBe('/admin/subscription');
			// status 省略 = 308 Permanent Redirect (規約デフォルト、CLAUDE.md `#578`)
			expect(entry?.status).toBeUndefined();
			expect(entry?.issue).toBe('#2525');
		});

		it('/demo/admin/license も最終 hop は /admin/subscription に直接 redirect (#2818 1 段化)', () => {
			const entry = LEGACY_URL_MAP.find((e) => e.from === '/demo/admin/license');
			expect(entry).toBeDefined();
			expect(entry?.to).toBe('/admin/subscription');
		});

		it('/admin/license は前方一致で sub path (将来追加分) も救済する', () => {
			const result = findLegacyRedirect('/admin/license/key');
			expect(result?.to).toBe('/admin/subscription');
			expect(rewriteLegacyPath('/admin/license/key', result!)).toBe('/admin/subscription/key');
		});

		// #2525 Phase 7 PR-L4 (#2836): /help/license-key → /admin/subscription (301、help ページ完全削除)
		it('/help/license-key → /admin/subscription (301) エントリが存在する', () => {
			const entry = LEGACY_URL_MAP.find((e) => e.from === '/help/license-key');
			expect(entry).toBeDefined();
			expect(entry?.to).toBe('/admin/subscription');
			// help ページ完全削除 (OQ-3) に伴う恒久移動、GET 専用のため 301 Moved Permanently
			expect(entry?.status).toBe(301);
			expect(entry?.issue).toBe('#2525');
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
			// #2097 PR-B2 (#2187): /demo/(child)/* 撤去に伴う本番ルート直接 redirect
			['/demo/preschool', '/demo/preschool'],
			['/demo/preschool/home', '/demo/preschool'],
			['/demo/elementary/status', '/demo/elementary'],
			['/demo/junior/battle', '/demo/junior'],
			['/demo/senior/achievements', '/demo/senior'],
			['/demo/baby/home', '/demo/baby'],
			['/demo/checklist', '/demo/checklist'],
			['/demo/lower/home', '/demo/lower'],
			['/demo/upper/home', '/demo/upper'],
			['/demo/teen/home', '/demo/teen'],
			// #2097 PR-B3 (#2188): /demo/admin/* + /demo/signup + /demo + /demo/exit 撤去 → 本番 path redirect
			// 明示 14 admin entries
			['/demo/admin/activities', '/demo/admin/activities'],
			['/demo/admin/challenges', '/demo/admin/challenges'],
			['/demo/admin/checklists', '/demo/admin/checklists'],
			['/demo/admin/children', '/demo/admin/children'],
			['/demo/admin/events', '/demo/admin/events'],
			['/demo/admin/license', '/demo/admin/license'],
			['/demo/admin/members', '/demo/admin/members'],
			['/demo/admin/messages', '/demo/admin/messages'],
			// #2270 / #2275 (EPIC #2266): /admin/messages 廃止 → /admin/cheer redirect
			['/admin/messages', '/admin/messages'],
			['/admin/messages/sub', '/admin/messages'],
			['/admin/cheer', null],
			// #2295 (EPIC #2294 ①): /admin/events 廃止 → /admin/challenges redirect
			['/admin/events', '/admin/events'],
			['/admin/events/new', '/admin/events'],
			['/admin/challenges', null],
			// #2525 Phase 7 PR-L3 (#2818): /admin/license 廃止 → /admin/subscription redirect
			['/admin/license', '/admin/license'],
			['/admin/license/key', '/admin/license'],
			['/admin/subscription', null],
			// #2525 Phase 7 PR-L4 (#2836): /help/license-key 廃止 → /admin/subscription 301
			['/help/license-key', '/help/license-key'],
			['/demo/admin/points', '/demo/admin/points'],
			['/demo/admin/reports', '/demo/admin/reports'],
			['/demo/admin/rewards', '/demo/admin/rewards'],
			['/demo/admin/settings', '/demo/admin/settings'],
			['/demo/admin/status', '/demo/admin/status'],
			// #2188 で 1 段化された achievements entry
			['/demo/admin/achievements', '/demo/admin/achievements'],
			// 親 fallback (`/demo/admin`) — 未登録 sub path も救済
			['/demo/admin', '/demo/admin'],
			['/demo/admin/billing', '/demo/admin'], // 未登録 sub path は親 fallback にマッチ
			['/demo/admin/some-future-page', '/demo/admin'],
			// /demo, /demo/exit, /demo/signup
			['/demo', '/demo'],
			['/demo/exit', '/demo/exit'],
			['/demo/signup', '/demo/signup'],
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
			// #2175: 子供画面 achievements → challenges rename (5 年齢モード)
			['/baby/achievements', '/baby/achievements'],
			['/preschool/achievements', '/preschool/achievements'],
			['/elementary/achievements', '/elementary/achievements'],
			['/junior/achievements', '/junior/achievements'],
			['/senior/achievements', '/senior/achievements'],
			// 新 URL はマッチしない
			['/preschool/home', null],
			['/elementary/home', null],
			['/junior/home', null],
			['/senior/home', null],
			// #2175: 新 URL (challenges) も自己 redirect しない
			['/preschool/challenges', null],
			['/elementary/challenges', null],
			['/junior/challenges', null],
			['/senior/challenges', null],
			// 注: #2097 PR-B2 (#2187) で /demo/preschool/home は本番 /preschool/home へ
			//   redirect されるようになったため null 期待ではなくなる (上の「デモ」ブロックでテスト済)。
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
			// 注: #2097 PR-B2 (#2187) で `/demo/kinder` は `/demo/preschool` ではなく `/preschool` 直行に変更済
			['/demo/kinder', '/preschool'],
			['/demo/kinder/home', '/preschool/home'],
			// #2097 PR-B2 (#2187): /demo/(child)/* 撤去に伴う本番ルート直接 redirect
			['/demo/preschool', '/preschool'],
			['/demo/preschool/home', '/preschool/home'],
			['/demo/elementary', '/elementary'],
			['/demo/elementary/status', '/elementary/status'],
			['/demo/junior', '/junior'],
			['/demo/junior/battle', '/junior/battle'],
			['/demo/senior', '/senior'],
			['/demo/senior/achievements', '/senior/achievements'],
			['/demo/baby', '/baby'],
			['/demo/baby/home', '/baby/home'],
			['/demo/checklist', '/checklist'],
			['/demo/lower/home', '/elementary/home'],
			['/demo/upper/home', '/junior/home'],
			['/demo/teen/home', '/senior/home'],
			// #2097 PR-B3 (#2188): /demo/admin/* + /demo/signup + /demo + /demo/exit 撤去 → 本番 path
			['/demo/admin/activities', '/admin/activities'],
			['/demo/admin/activities/sub', '/admin/activities/sub'],
			['/demo/admin/challenges', '/admin/challenges'],
			['/demo/admin/checklists', '/admin/checklists'],
			['/demo/admin/children', '/admin/children'],
			// #2295 (EPIC #2294 ①): /demo/admin/events も最終 hop を /admin/challenges に更新
			['/demo/admin/events', '/admin/challenges'],
			// #2818 Phase 7 PR-L3: /demo/admin/license も最終 hop を /admin/subscription に 1 段化
			['/demo/admin/license', '/admin/subscription'],
			['/demo/admin/members', '/admin/members'],
			// #2270 / #2275 (EPIC #2266): 1 段化済 (/demo/admin/messages → 直接 /admin/cheer)
			['/demo/admin/messages', '/admin/cheer'],
			['/demo/admin/points', '/admin/points'],
			['/demo/admin/reports', '/admin/reports'],
			['/demo/admin/rewards', '/admin/rewards'],
			['/demo/admin/settings', '/admin/settings'],
			['/demo/admin/status', '/admin/status'],
			// #2188 で 1 段化 (旧 #1782 の /demo/admin/achievements → /demo/admin/challenges 経由を回避)
			['/demo/admin/achievements', '/admin/challenges'],
			// 親 fallback: 明示 entry に無い sub path も /admin/* に救済
			['/demo/admin', '/admin'],
			['/demo/admin/billing', '/admin/billing'],
			['/demo/admin/some-future-page', '/admin/some-future-page'],
			// landing / exit / signup
			['/demo', '/'],
			['/demo/exit', '/'],
			['/demo/signup', '/auth/signup'],
			// #2270 / #2275 (EPIC #2266): /admin/messages → /admin/cheer (308)
			['/admin/messages', '/admin/cheer'],
			['/admin/messages/sub', '/admin/cheer/sub'],
			// #2295 (EPIC #2294 ①): /admin/events → /admin/challenges (308)
			['/admin/events', '/admin/challenges'],
			['/admin/events/new', '/admin/challenges/new'],
			// #2818 Phase 7 PR-L3: /admin/license → /admin/subscription (308)
			['/admin/license', '/admin/subscription'],
			['/admin/license/key', '/admin/subscription/key'],
			// #2836 Phase 7 PR-L4: /help/license-key → /admin/subscription (301)
			['/help/license-key', '/admin/subscription'],
			// #2175: 子供画面 achievements → challenges (5 年齢モード)
			['/baby/achievements', '/baby/challenges'],
			['/preschool/achievements', '/preschool/challenges'],
			['/elementary/achievements', '/elementary/challenges'],
			['/junior/achievements', '/junior/challenges'],
			['/senior/achievements', '/senior/challenges'],
			// #2175 + #2188 連鎖: /demo/senior → /senior 第 1 段 (本 test) で /senior/achievements に到達。
			// 第 2 段 redirect (`/senior/achievements → /senior/challenges`) は別 entry なので
			// rewriteLegacyPath() 単発呼び出しでは 1 段目のみ評価される。
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
		it('/demo/kinder は /preschool に書き換えられる（/kinder にマッチしない、#2187 で 1 段 redirect 化）', () => {
			const entry = findLegacyRedirect('/demo/kinder/home');
			expect(entry?.from).toBe('/demo/kinder');
			if (entry) {
				expect(rewriteLegacyPath('/demo/kinder/home', entry)).toBe('/preschool/home');
			}
		});

		// #2097 PR-B2 (#2187): /demo/preschool/home は新規 entry にマッチし /preschool/home に飛ぶ。
		// `/preschool` 自体は legacy ではないため自己再帰 redirect は起きない。
		it('/demo/preschool/home は /preschool/home に書き換えられる', () => {
			const entry = findLegacyRedirect('/demo/preschool/home');
			expect(entry?.from).toBe('/demo/preschool');
			if (entry) {
				expect(rewriteLegacyPath('/demo/preschool/home', entry)).toBe('/preschool/home');
			}
		});
	});
});
