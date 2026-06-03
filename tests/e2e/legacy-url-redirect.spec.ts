// tests/e2e/legacy-url-redirect.spec.ts
// #578: 旧 URL の中央リダイレクト E2E テスト
//
// `src/lib/server/routing/legacy-url-map.ts` に集約された全エントリについて、
// hooks.server.ts で 308 リダイレクトが返されることを検証する。
//
// 注意: page.goto() だと最終到達 URL（更にリダイレクトされた先）を見てしまうため、
// request fixture を使って maxRedirects: 0 で初回レスポンスのみを検査する。
// これにより「/preschool/home が別の理由（未認証等）で /switch にリダイレクトされる」
// という下流の挙動と無関係に、中央リダイレクト層だけをテストできる。

import { expect, test } from '@playwright/test';

async function expectRedirect(
	request: import('@playwright/test').APIRequestContext,
	from: string,
	expectedLocation: string,
	expectedStatus = 308,
) {
	const response = await request.get(from, { maxRedirects: 0 });
	expect(response.status(), `${from} should redirect`).toBe(expectedStatus);
	expect(response.headers().location, `${from} should redirect to ${expectedLocation}`).toBe(
		expectedLocation,
	);
}

test.describe('#578 旧 URL の中央リダイレクト', () => {
	// ============================================================
	// 年齢区分リネーム（#571）— 完全一致・サブパス
	// ============================================================
	test('/kinder → /preschool (308)', async ({ request }) => {
		await expectRedirect(request, '/kinder', '/preschool');
	});

	test('/kinder/home → /preschool/home (308)', async ({ request }) => {
		await expectRedirect(request, '/kinder/home', '/preschool/home');
	});

	test('/lower/home → /elementary/home (308)', async ({ request }) => {
		await expectRedirect(request, '/lower/home', '/elementary/home');
	});

	test('/upper/home → /junior/home (308)', async ({ request }) => {
		await expectRedirect(request, '/upper/home', '/junior/home');
	});

	test('/teen/home → /senior/home (308)', async ({ request }) => {
		await expectRedirect(request, '/teen/home', '/senior/home');
	});

	// ============================================================
	// デモページ（長いプレフィックス優先）
	// #2097 PR-B2 (#2187): /demo/(child)/* を撤去し、本番 (child) routes に直接 redirect。
	//   旧 #571 で `/demo/kinder → /demo/preschool` だった 2 段 redirect を 1 段化。
	// ============================================================
	test('/demo/kinder → /preschool (308) — 1 段 redirect 化 (#2187)', async ({ request }) => {
		await expectRedirect(request, '/demo/kinder', '/preschool');
	});

	test('/demo/kinder/home → /preschool/home (308)', async ({ request }) => {
		await expectRedirect(request, '/demo/kinder/home', '/preschool/home');
	});

	test('/demo/lower/home → /elementary/home (308)', async ({ request }) => {
		await expectRedirect(request, '/demo/lower/home', '/elementary/home');
	});

	test('/demo/upper/home → /junior/home (308)', async ({ request }) => {
		await expectRedirect(request, '/demo/upper/home', '/junior/home');
	});

	test('/demo/teen/home → /senior/home (308)', async ({ request }) => {
		await expectRedirect(request, '/demo/teen/home', '/senior/home');
	});

	// #2097 PR-B2 (#2187): demo new-naming も本番 (child) routes に redirect
	test('/demo/preschool/home → /preschool/home (308)', async ({ request }) => {
		await expectRedirect(request, '/demo/preschool/home', '/preschool/home');
	});

	test('/demo/elementary/status → /elementary/status (308)', async ({ request }) => {
		await expectRedirect(request, '/demo/elementary/status', '/elementary/status');
	});

	test('/demo/junior/battle → /junior/battle (308)', async ({ request }) => {
		await expectRedirect(request, '/demo/junior/battle', '/junior/battle');
	});

	// 注: 第 2 段 (`/senior/achievements → /senior/challenges`、#2175) は本 test で検証せず、
	// 上の「#2175 子供画面 achievements → challenges rename」section で個別に検証する。
	test('/demo/senior/achievements → /senior/achievements (308, 第 1 段)', async ({ request }) => {
		await expectRedirect(request, '/demo/senior/achievements', '/senior/achievements');
	});

	test('/demo/baby/home → /baby/home (308)', async ({ request }) => {
		await expectRedirect(request, '/demo/baby/home', '/baby/home');
	});

	test('/demo/checklist → /checklist (308)', async ({ request }) => {
		await expectRedirect(request, '/demo/checklist', '/checklist');
	});

	test('/demo/checklist?childId=902 → /checklist?childId=902 (308 + クエリ保持)', async ({
		request,
	}) => {
		await expectRedirect(request, '/demo/checklist?childId=902', '/checklist?childId=902');
	});

	// ============================================================
	// クエリ文字列・ハッシュの保持
	// ============================================================
	test('クエリ文字列が保持される', async ({ request }) => {
		await expectRedirect(request, '/kinder/home?childId=1', '/preschool/home?childId=1');
	});

	test('複数のクエリパラメータが保持される', async ({ request }) => {
		await expectRedirect(
			request,
			'/lower/status?tab=history&sort=desc',
			'/elementary/status?tab=history&sort=desc',
		);
	});

	// #2097 PR-B2 (#2187): demo (child) からのクエリ保持
	test('/demo/preschool/home?childId=902 → /preschool/home?childId=902 (クエリ保持)', async ({
		request,
	}) => {
		await expectRedirect(
			request,
			'/demo/preschool/home?childId=902',
			'/preschool/home?childId=902',
		);
	});

	// ============================================================
	// 新 URL はリダイレクトされない（無限ループ防止）
	// ============================================================
	test('/preschool 自体は 308 にならない（自己リダイレクトしない）', async ({ request }) => {
		const response = await request.get('/preschool/home', { maxRedirects: 0 });
		// 未認証で /switch に飛ぶ可能性はあるが、/preschool には戻らない
		expect(response.status()).not.toBe(308);
		if (response.status() === 302) {
			expect(response.headers().location).not.toMatch(/^\/preschool/);
			expect(response.headers().location).not.toMatch(/^\/kinder/);
		}
	});

	// ============================================================
	// #1167: 活動パック → マーケットプレイス集約（301）
	// ============================================================
	test('/activity-packs/baby-first → /marketplace?type=activity-pack (301, #1301 削除)', async ({
		request,
	}) => {
		await expectRedirect(
			request,
			'/activity-packs/baby-first',
			'/marketplace?type=activity-pack',
			301,
		);
	});

	// #1212-A: otetsudai-master は年齢プリセット (kinder-starter / elementary-challenge) に吸収廃止
	// 旧 URL はマーケット一覧 (activity-pack フィルタ) にフォールバック
	test('/activity-packs/otetsudai-master → /marketplace?type=activity-pack (301, 廃止パック)', async ({
		request,
	}) => {
		await expectRedirect(
			request,
			'/activity-packs/otetsudai-master',
			'/marketplace?type=activity-pack',
			301,
		);
	});

	// #1301: baby-boy/girl はマーケットから削除 → 一覧へフォールバック
	test('/activity-packs/baby-boy → /marketplace?type=activity-pack (301, #1301 削除)', async ({
		request,
	}) => {
		await expectRedirect(
			request,
			'/activity-packs/baby-boy',
			'/marketplace?type=activity-pack',
			301,
		);
	});

	// #1212-A: /activity-packs 一覧も廃止 → マーケット一覧へ集約
	test('/activity-packs → /marketplace?type=activity-pack (301, 一覧廃止)', async ({ request }) => {
		await expectRedirect(request, '/activity-packs', '/marketplace?type=activity-pack', 301);
	});

	// ============================================================
	// 偽陽性の防止
	// ============================================================
	test('/kindergarten は /kinder と誤マッチしない', async ({ request }) => {
		const response = await request.get('/kindergarten', { maxRedirects: 0 });
		// 308 リダイレクトはされない（404 or 別のリダイレクト）
		if (response.status() === 308) {
			expect(response.headers().location).not.toMatch(/^\/preschool/);
		}
	});

	// ============================================================
	// #1782: 実績機能廃止 → チャレンジ機能 308 redirect
	// ADR-0012 §6 整合 + #404 廃止合意の revert 復活への対応
	// ============================================================
	test('/admin/achievements → /admin/challenges (308, #1782)', async ({ request }) => {
		await expectRedirect(request, '/admin/achievements', '/admin/challenges');
	});

	test('/admin/achievements/sub → /admin/challenges/sub (308, #1782 サブパス)', async ({
		request,
	}) => {
		await expectRedirect(request, '/admin/achievements/sub', '/admin/challenges/sub');
	});

	// #2097 PR-B3 (#2188): /demo/admin/achievements は 1 段 redirect で /admin/challenges に直行
	// (旧 #1782 で /demo/admin/achievements → /demo/admin/challenges だったが、PR-B3 で
	// /demo/admin/* 全削除のため /demo/admin/challenges 経由を回避し本番 path に統合)
	test('/demo/admin/achievements → /admin/challenges (308, #2188 で 1 段化)', async ({
		request,
	}) => {
		await expectRedirect(request, '/demo/admin/achievements', '/admin/challenges');
	});

	test('/admin/achievements?childId=1 (クエリ保持) → /admin/challenges?childId=1', async ({
		request,
	}) => {
		await expectRedirect(request, '/admin/achievements?childId=1', '/admin/challenges?childId=1');
	});

	// ============================================================
	// #2270 / #2275 (EPIC #2266): /admin/messages 廃止 → /admin/cheer 308 redirect
	// PO 報告 (2026-05-19) 「メッセージだけ送る機能は意味なし、応援は任意理由 + 直接 P 付与が核」
	// 旧 messages は P 付与なし = 子供から見て価値が薄いため廃止、応援機能 /admin/cheer に統合。
	// ============================================================
	test('/admin/messages → /admin/cheer (308, #2275)', async ({ request }) => {
		await expectRedirect(request, '/admin/messages', '/admin/cheer');
	});

	test('/admin/messages/sub → /admin/cheer/sub (308, サブパス保持 #2275)', async ({ request }) => {
		await expectRedirect(request, '/admin/messages/sub', '/admin/cheer/sub');
	});

	test('/admin/messages?childId=1 → /admin/cheer?childId=1 (クエリ保持 #2275)', async ({
		request,
	}) => {
		await expectRedirect(request, '/admin/messages?childId=1', '/admin/cheer?childId=1');
	});

	// ============================================================
	// #2175: 子供画面 achievements → challenges rename (5 年齢モード)
	// 廃止済「実績システム」命名残存を解消するためルートを rename。
	// 旧 URL は bookmark / 内部リンク救済で 308 redirect (永久保持)。
	// ============================================================
	test('/baby/achievements → /baby/challenges (308, #2175)', async ({ request }) => {
		await expectRedirect(request, '/baby/achievements', '/baby/challenges');
	});

	test('/preschool/achievements → /preschool/challenges (308, #2175)', async ({ request }) => {
		await expectRedirect(request, '/preschool/achievements', '/preschool/challenges');
	});

	test('/elementary/achievements → /elementary/challenges (308, #2175)', async ({ request }) => {
		await expectRedirect(request, '/elementary/achievements', '/elementary/challenges');
	});

	test('/junior/achievements → /junior/challenges (308, #2175)', async ({ request }) => {
		await expectRedirect(request, '/junior/achievements', '/junior/challenges');
	});

	test('/senior/achievements → /senior/challenges (308, #2175)', async ({ request }) => {
		await expectRedirect(request, '/senior/achievements', '/senior/challenges');
	});

	test('/elementary/achievements?childId=903 → /elementary/challenges?childId=903 (#2175 クエリ保持)', async ({
		request,
	}) => {
		await expectRedirect(
			request,
			'/elementary/achievements?childId=903',
			'/elementary/challenges?childId=903',
		);
	});

	// ============================================================
	// #2097 PR-B3 (#2188): /demo/admin/* + /demo/+layout + /demo/+page + /demo/signup 全撤去 → 本番 path 直接 redirect
	// ============================================================
	test('/demo/admin → /admin (308) — 親 fallback', async ({ request }) => {
		await expectRedirect(request, '/demo/admin', '/admin');
	});

	test('/demo/admin/activities → /admin/activities (308)', async ({ request }) => {
		await expectRedirect(request, '/demo/admin/activities', '/admin/activities');
	});

	test('/demo/admin/challenges → /admin/challenges (308)', async ({ request }) => {
		await expectRedirect(request, '/demo/admin/challenges', '/admin/challenges');
	});

	test('/demo/admin/checklists → /admin/checklists (308)', async ({ request }) => {
		await expectRedirect(request, '/demo/admin/checklists', '/admin/checklists');
	});

	test('/demo/admin/children → /admin/children (308)', async ({ request }) => {
		await expectRedirect(request, '/demo/admin/children', '/admin/children');
	});

	// #2295 (EPIC #2294 ①): /admin/events 撤去 → /admin/challenges 救済に変更
	test('/demo/admin/events → /admin/challenges (308, #2295 で 1 段化)', async ({ request }) => {
		await expectRedirect(request, '/demo/admin/events', '/admin/challenges');
	});

	test('/admin/events → /admin/challenges (308, シーズンイベント機構廃止)', async ({ request }) => {
		await expectRedirect(request, '/admin/events', '/admin/challenges');
	});

	// ============================================================
	// #2525 Phase 7 PR-L3 (#2818): /admin/license 廃止 → /admin/subscription 308 redirect
	// ライセンスキー販売モデル撤廃 → サブスクリプションモデル統一 rename (Epic #2525)。
	// ============================================================
	test('/admin/license → /admin/subscription (308, #2818)', async ({ request }) => {
		await expectRedirect(request, '/admin/license', '/admin/subscription');
	});

	test('/admin/license/key → /admin/subscription/key (308, サブパス保持 #2818)', async ({
		request,
	}) => {
		await expectRedirect(request, '/admin/license/key', '/admin/subscription/key');
	});

	test('/admin/license?reason=expired → /admin/subscription?reason=expired (クエリ保持 #2818)', async ({
		request,
	}) => {
		await expectRedirect(
			request,
			'/admin/license?reason=expired',
			'/admin/subscription?reason=expired',
		);
	});

	// #2818 Phase 7 PR-L3: /admin/license 撤去 → /admin/subscription 救済 (1 段化)
	test('/demo/admin/license → /admin/subscription (308, #2818 で 1 段化)', async ({ request }) => {
		await expectRedirect(request, '/demo/admin/license', '/admin/subscription');
	});

	test('/demo/admin/members → /admin/members (308)', async ({ request }) => {
		await expectRedirect(request, '/demo/admin/members', '/admin/members');
	});

	// #2270 / #2275 (EPIC #2266): /admin/messages 廃止 → /admin/cheer に 1 段化
	test('/demo/admin/messages → /admin/cheer (308, #2270 で 1 段化)', async ({ request }) => {
		await expectRedirect(request, '/demo/admin/messages', '/admin/cheer');
	});

	test('/demo/admin/points → /admin/points (308)', async ({ request }) => {
		await expectRedirect(request, '/demo/admin/points', '/admin/points');
	});

	test('/demo/admin/reports → /admin/reports (308)', async ({ request }) => {
		await expectRedirect(request, '/demo/admin/reports', '/admin/reports');
	});

	test('/demo/admin/rewards → /admin/rewards (308)', async ({ request }) => {
		await expectRedirect(request, '/demo/admin/rewards', '/admin/rewards');
	});

	test('/demo/admin/settings → /admin/settings (308)', async ({ request }) => {
		await expectRedirect(request, '/demo/admin/settings', '/admin/settings');
	});

	test('/demo/admin/status → /admin/status (308)', async ({ request }) => {
		await expectRedirect(request, '/demo/admin/status', '/admin/status');
	});

	test('/demo/signup → /auth/signup (308)', async ({ request }) => {
		await expectRedirect(request, '/demo/signup', '/auth/signup');
	});

	test('/demo/exit → / (308)', async ({ request }) => {
		await expectRedirect(request, '/demo/exit', '/');
	});

	test('/demo → / (308) — landing 撤去', async ({ request }) => {
		await expectRedirect(request, '/demo', '/');
	});

	// /demo/admin/* + クエリ保持
	test('/demo/admin/license?plan=family → /admin/license?plan=family (308 + クエリ保持)', async ({
		request,
	}) => {
		await expectRedirect(request, '/demo/admin/license?plan=family', '/admin/license?plan=family');
	});

	// 親 fallback: 未登録 sub path も /admin に救済
	test('/demo/admin/billing → /admin/billing (308) — 親 fallback (未登録 sub path)', async ({
		request,
	}) => {
		await expectRedirect(request, '/demo/admin/billing', '/admin/billing');
	});
});
