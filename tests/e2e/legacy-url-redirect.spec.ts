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
	// ============================================================
	// ADR-0039 Phase 2 (#2097): /demo/** 全削除済のため、legacy URL map の
	// /demo/kinder → /demo/preschool redirect は両側存在しない URL となり意味を失った。
	// 旧 /demo/kinder にアクセスしたユーザは 404 となる。LP リンクは /switch?mode=demo
	// に統一されたため、外部リンク経由の遭遇確率は低い。
	test.skip('/demo/kinder → /demo/preschool (308) — ADR-0039 Phase 2 廃止', async () => {});
	test.skip('/demo/kinder/home → /demo/preschool/home (308) — ADR-0039 Phase 2 廃止', async () => {});

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

	// ADR-0039 Phase 2 (#2097): /demo/** 全削除済 — 旧 /demo/admin/achievements redirect は意味を失った。
	test.skip('/demo/admin/achievements → /demo/admin/challenges (308) — ADR-0039 Phase 2 廃止', async () => {});

	test('/admin/achievements?childId=1 (クエリ保持) → /admin/challenges?childId=1', async ({
		request,
	}) => {
		await expectRedirect(request, '/admin/achievements?childId=1', '/admin/challenges?childId=1');
	});
});
