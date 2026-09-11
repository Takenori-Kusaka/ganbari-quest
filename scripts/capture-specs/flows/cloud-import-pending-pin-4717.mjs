/**
 * scripts/capture-specs/flows/cloud-import-pending-pin-4717.mjs
 *
 * #4717: 発行直後（生成待ち）のクラウド共有 PIN を取り込んだときの案内を撮る。
 *
 * クラウド共有セクションは SaaS モード (authMode='cognito') でのみ描画されるため、
 * `--server-mode cognito` (npm run dev:cognito) で起動したサーバに対して実行する。
 *
 * 使用例:
 *   MSYS_NO_PATHCONV=1 node scripts/capture.mjs \
 *     --flow cloud-import-pending-pin-4717 \
 *     --url /admin/settings/data \
 *     --actions scripts/capture-specs/flows/cloud-import-pending-pin-4717.mjs \
 *     --presets desktop,mobile --pr <PR番号>
 */

const BASE_URL = process.env.BASE_URL || 'http://localhost:5174';

/**
 * @param {import('playwright').Page} page
 * @param {(label: string) => Promise<string>} capture
 */
export default async (page, capture) => {
	await page.goto(`${BASE_URL}/admin/settings/data`, { waitUntil: 'domcontentloaded' });

	// 1) クラウド共有を発行する (非同期 build のため status=pending で起票される)。
	//    UI 操作だと種別選択ダイアログを跨ぐため、発行そのものは API で行い、
	//    本 flow は「受け取り側が PIN を入れたときに何が見えるか」に集中する。
	const pinCode = await page.evaluate(async () => {
		const res = await fetch('/api/v1/export/cloud', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ exportType: 'template', label: 'SS-4717' }),
		});
		if (!res.ok) return '';
		const body = await res.json();
		return body?.pinCode ?? '';
	});

	if (!pinCode) {
		// 発行できない環境 (プラン gate 等) では入力前の状態だけ残す
		await capture('cloud-import-pin-input');
		return;
	}

	// 2) 生成完了を待たずに PIN を入力して確認する = 顧客が実際に踏む窓
	const pinInput = page.locator('input[placeholder*="PIN"]').first();
	await pinInput.waitFor({ state: 'visible', timeout: 15_000 });
	await pinInput.fill(pinCode);

	const confirmBtn = page.getByRole('button', { name: '確認' }).first();
	await confirmBtn.click();

	// 3) 案内 (role=alert) が出るまで待ってから撮る
	await page.locator('[role="alert"]').first().waitFor({ state: 'visible', timeout: 15_000 });
	await capture('cloud-import-pending-pin');
};
