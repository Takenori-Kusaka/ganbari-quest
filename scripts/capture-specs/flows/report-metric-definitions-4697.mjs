/**
 * scripts/capture-specs/flows/report-metric-definitions-4697.mjs
 *
 * Issue #4697: 親向けレポートの数値定義を揃えた before / after SS。
 *
 * 撮影する 3 コマ (どちらの build でも同じ操作列):
 *   1. `/admin/reports` 月次タブ — 「ポイント」と「つよさ (XP)」
 *        - 修正前: 「ポイント」に XP 累計が出る (どの月でも同値 = 先月比が常に ±0)
 *        - 修正後: 「ポイント」= その月の台帳獲得 / 「つよさ (XP)」= 累計 を別に出す
 *   2. `/admin/growth-book` — 月別の記録
 *        - 修正前: 12 ヶ月すべてに同じ累計値 (未来月にも数値)
 *        - 修正後: 未来月は「—」+「これからの月」
 *   3. `/admin/status` — ベンチマーク入力ガイド
 *        - 修正前: 画面内の独自式で「4歳の目安: 平均 128〜240 XP」(seed 値は 18〜38)
 *        - 修正後: 既定値 SSOT の実値をそのまま出す
 *
 * 前提: `AUTH_MODE=cognito COGNITO_DEV_MODE=true` のサーバーと
 *       `playwright/.auth/family.json` を `--storage-state` で渡すこと。
 *
 * 使用例:
 *   MSYS_NO_PATHCONV=1 SS_PHASE=after BASE_URL=http://localhost:5242 \
 *     node scripts/capture.mjs \
 *     --flow report-metrics \
 *     --url /admin/reports \
 *     --actions scripts/capture-specs/flows/report-metric-definitions-4697.mjs \
 *     --storage-state playwright/.auth/family.json \
 *     --presets desktop --pr <PR番号>
 */

const BASE_URL = process.env.BASE_URL || 'http://localhost:5173';
const PHASE = process.env.SS_PHASE || 'after';
const VIEWPORT = process.env.SS_VIEWPORT || 'desktop';
/**
 * 撮影対象。`parent` = 月次レポート + 成長記録ブック (family の storageState)、
 * `benchmark` = `/admin/status` のベンチマーク入力ガイド。
 * ベンチマーク編集 UI は全テナント共有 master の書込境界に合わせて ops 限定なので
 * (#3824)、ops の storageState で別途撮る。
 */
const TARGET = process.env.SS_TARGET || 'parent';

/**
 * @param {import('playwright').Page} page
 * @param {(label: string) => Promise<string>} capture
 */
export default async (page, capture) => {
	const rafSettle = () =>
		page.evaluate(
			() =>
				new Promise((resolve) =>
					requestAnimationFrame(() => requestAnimationFrame(() => resolve(undefined))),
				),
		);

	if (TARGET === 'benchmark') {
		// --- ベンチマーク入力ガイド (ops 限定 UI、#3824) ---
		await page.goto(`${BASE_URL}/admin/status`, { waitUntil: 'domcontentloaded' });
		const guideText = page.getByText('歳の目安:').first();
		await guideText.waitFor({ state: 'visible', timeout: 90_000 });
		await guideText.scrollIntoViewIfNeeded();
		await rafSettle();
		await capture(`${PHASE}-status-benchmark-guide-${VIEWPORT}`);
		return;
	}

	// --- 1 コマ目: 月次レポート ---
	await page.goto(`${BASE_URL}/admin/reports`, { waitUntil: 'domcontentloaded' });
	// 月次タブは既定表示。カードが出るまで待つ (dev server の初回コンパイルは十数秒)
	await page.getByText('がんばりレポート').first().waitFor({ state: 'visible', timeout: 90_000 });
	await rafSettle();

	// 修正後 build なのに XP タイルが無いなら、旧表示を「修正後」として貼ることになる。
	// 握りつぶさず throw して撮影自体を失敗させる (SS 捏造の構造的防止)。
	if (PHASE.startsWith('after') && (await page.getByTestId('monthly-xp').count()) === 0) {
		throw new Error('[flow] 修正後 build なのに monthly-xp タイルが無い。撮影を中止する。');
	}
	await capture(`${PHASE}-report-monthly-${VIEWPORT}`);

	// --- 2 コマ目: 成長記録ブック ---
	await page.goto(`${BASE_URL}/admin/growth-book`, { waitUntil: 'domcontentloaded' });
	await page.getByText('月別の記録').first().waitFor({ state: 'visible', timeout: 60_000 });
	await rafSettle();
	await capture(`${PHASE}-growth-book-${VIEWPORT}`);
};
