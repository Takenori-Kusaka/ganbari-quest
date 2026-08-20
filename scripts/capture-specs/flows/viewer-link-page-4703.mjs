/**
 * scripts/capture-specs/flows/viewer-link-page-4703.mjs
 *
 * Issue #4703: プレミアムの閲覧リンク `/view/<token>` の before / after SS。
 *
 * 撮影する 2 コマ (どちらの build でも同じ操作列):
 *   1. family でログインした状態で閲覧リンクを発行 → 未ログイン相当で `/view/<token>` を開く
 *        - 修正前: 子供全員のポイントが「[object Object] ポイント」
 *        - 修正後: 数値 (3 桁区切り)
 *   2. 無効な token で `/view/<存在しない token>` を開く
 *        - 修正前: 汎用 404「ページが みつかりません」
 *        - 修正後: 「このリンクは無効か、期限切れです」+ 共有元への依頼文
 *
 * 前提: `AUTH_MODE=cognito COGNITO_DEV_MODE=true` で起動したサーバーと、
 *       `playwright/.auth/family.json` (auth.setup.ts が生成) を `--storage-state` で渡すこと。
 *
 * 使用例:
 *   MSYS_NO_PATHCONV=1 SS_PHASE=after BASE_URL=http://localhost:5242 \
 *     node scripts/capture.mjs \
 *     --flow view-token \
 *     --url /admin/members \
 *     --actions scripts/capture-specs/flows/viewer-link-page-4703.mjs \
 *     --storage-state playwright/.auth/family.json \
 *     --presets desktop --pr 4801
 */

const BASE_URL = process.env.BASE_URL || 'http://localhost:5173';
const PHASE = process.env.SS_PHASE || 'after';
const VIEWPORT = process.env.SS_VIEWPORT || 'desktop';

/** 存在しない token。demo / dev いずれでも解決されない固定値 */
const BOGUS_TOKEN = 'this-token-does-not-exist-4703';

/**
 * @param {import('playwright').Page} page
 * @param {(label: string) => Promise<string>} capture
 */
export default async (page, capture) => {
	// 閲覧リンクの発行は family 限定。認証済み cookie を持つ page から API を叩く。
	await page.goto(`${BASE_URL}/admin/members`, { waitUntil: 'domcontentloaded' });
	const token = await page.evaluate(async () => {
		const res = await fetch('/api/v1/admin/viewer-tokens', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ label: 'SS おばあちゃん用', duration: '30d' }),
		});
		if (!res.ok) throw new Error(`viewer-token 発行に失敗: ${res.status}`);
		const body = await res.json();
		return body.token.token;
	});
	if (!token) throw new Error('[flow] viewer token を取得できなかった');

	// --- 1 コマ目: 有効な閲覧リンク ---
	await page.goto(`${BASE_URL}/view/${token}`, { waitUntil: 'domcontentloaded' });
	await page.locator('.child-card').first().waitFor({ state: 'visible', timeout: 30_000 });
	const bodyText = await page.locator('body').innerText();

	// 修正後 build なのに壊れた表示が残っているなら、それを「修正後」として貼ることになる。
	// 握りつぶさず throw して撮影自体を失敗させる (SS 捏造の構造的防止)。
	if (PHASE.startsWith('after') && bodyText.includes('[object')) {
		throw new Error('[flow] 修正後 build なのに "[object Object]" が残っている。撮影を中止する。');
	}
	if (PHASE.startsWith('before') && !bodyText.includes('[object')) {
		throw new Error('[flow] 修正前 build のはずが "[object Object]" が出ていない。撮影を中止する。');
	}
	await capture(`${PHASE}-view-token-points-${VIEWPORT}`);

	// --- 2 コマ目: 無効な閲覧リンク ---
	await page.goto(`${BASE_URL}/view/${BOGUS_TOKEN}`, { waitUntil: 'domcontentloaded' });
	const invalidTitle = page.getByTestId('viewer-token-invalid-title');
	await page
		.locator('h1')
		.first()
		.waitFor({ state: 'visible', timeout: 30_000 });

	if (PHASE.startsWith('after') && (await invalidTitle.count()) === 0) {
		throw new Error(
			'[flow] 修正後 build なのに viewer-token-invalid-title が無い。撮影を中止する。',
		);
	}
	await capture(`${PHASE}-view-token-invalid-${VIEWPORT}`);
};
