/**
 * scripts/capture-specs/flows/downgrade-retention-warning-4528.mjs (#4528)
 *
 * ダウングレード確認ダイアログ (`DowngradeResourceSelector`) の保持期間短縮警告を撮る。
 *
 * **アプリ route (`/admin/subscription`) では撮れない**: このダイアログは
 * `SaasLicensePanel.requestPortal()` が ①`STRIPE_SECRET_KEY` 設定済 ②tenant に有効な契約
 * (`stripeSubscriptionId`) ③free 上限を超えるリソース の 3 条件を満たしたときだけ開く。
 * local backend (sqlite) は `tenants` を持たず `getLicenseInfo()` が必ず null を返すため、
 * ②を作れない (docs/CLAUDE.md §「local 検証不可」と同型)。よって Storybook の story
 * (`DowngradeResourceSelector.stories.svelte`) を実ブラウザで描画して撮る。
 *
 * 警告文はダイアログ内のスクロール領域の末尾にあるため、素の viewport 撮影では写らない。
 * 本フローは警告を viewport 内へスクロールしてから撮る。
 *
 * 使用例 (Storybook の port は他クローンとの衝突を避けて明示指定する):
 *   npx storybook dev -p 6031 --no-open
 *   # story id は http://localhost:6031/index.json で引く (title 'Admin/DowngradeResourceSelector'
 *   # の RetentionShortenedFromStandard / RetentionShortenedFromUnlimited の 2 本)
 *   CAPTURE_NAME=after-downgrade-retention-standard node scripts/capture.mjs \
 *     --base-url http://localhost:6031 --flow downgrade-retention-warning-4528 \
 *     --url "/iframe.html?id=<story id>&viewMode=story" \
 *     --actions scripts/capture-specs/flows/downgrade-retention-warning-4528.mjs --presets desktop
 *
 * `CAPTURE_NAME` で出力名 (before-… / after-…) を指定する。story ごとに 1 回起動する。
 */

/**
 * 出力名。story ごとに 1 回ずつ本フローを起動する
 * (Storybook の iframe は同一 page 内での story 再 navigate が ERR_ABORTED になるため、
 *  1 起動 = 1 story = 1 撮影に固定する)。
 */
const CAPTURE_NAME = process.env.CAPTURE_NAME ?? 'downgrade-retention';

async function settle(page) {
	await page.evaluate(
		() =>
			new Promise((resolve) =>
				requestAnimationFrame(() => requestAnimationFrame(() => resolve(undefined))),
			),
	);
}

/**
 * @param {import('playwright').Page} page
 * @param {(label: string) => Promise<string>} capture
 */
export default async (page, capture) => {
	// capture recorder が --url (story の iframe) へ navigate 済のため二重 goto しない。
	const dialog = page.getByTestId('downgrade-preview-content');
	await dialog.waitFor({ state: 'visible', timeout: 20_000 });

	// 警告文はダイアログ内スクロール領域の末尾にある。見えるところまで送ってから撮る。
	const warning = dialog.getByText('データ保持期間が', { exact: false }).first();
	await warning.waitFor({ state: 'attached', timeout: 20_000 });
	await warning.scrollIntoViewIfNeeded();
	await settle(page);

	await capture(CAPTURE_NAME);
};
