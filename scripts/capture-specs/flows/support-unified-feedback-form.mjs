/**
 * scripts/capture-specs/flows/support-unified-feedback-form.mjs
 *
 * #support-unify: /admin/settings/support を単一フォームへ統合した SS。
 * 旧「開発者に直接相談」CTA カードと「フィードバック」フォームの 2 セクション分離を解消し、
 * 「ご用件」(intent) ラジオ + 段階表示 (progressive disclosure) の単一フォームに統合した状態を撮る。
 *
 * recorder が --url を事前 navigate 済のため flow 内で goto しない (二重 goto = ERR_ABORTED 回避)。
 *
 * 使用例:
 *   MSYS_NO_PATHCONV=1 node scripts/capture.mjs \
 *     --flow support-unified-feedback-form \
 *     --url /admin/settings/support \
 *     --actions scripts/capture-specs/flows/support-unified-feedback-form.mjs \
 *     --presets desktop,mobile --pr <N>
 */

/**
 * @param {import('playwright').Page} page
 * @param {(label: string) => Promise<string>} capture
 */
export default async (page, capture) => {
	// PremiumWelcome dialog が出ることがあるので閉じる
	const welcomeBtn = page.getByRole('button', { name: /さっそく始める/ });
	if (await welcomeBtn.isVisible().catch(() => false)) {
		await welcomeBtn.click();
	}

	// --- 1) 既定 (感想・要望、返信不要) — 種類セレクトが表示される ---
	await page.locator('[data-tutorial="feedback-section"]').waitFor({
		state: 'visible',
		timeout: 15_000,
	});
	await page.locator('#feedbackCategory').waitFor({ state: 'visible', timeout: 5_000 });
	await capture('support-unify-feedback-intent');

	// --- 2) 相談・困りごと (返信希望) に切替 — 種類が消えお子さま年齢 + 返信先が出る (段階表示) ---
	// label テキストを click して radio をトグル (input 直 check より Svelte bind:group が確実に発火)
	await page.getByText('相談・困りごと（返信を希望）').click();
	await page.locator('#feedbackChildAge').waitFor({ state: 'visible', timeout: 10_000 });
	await page.evaluate(
		() =>
			new Promise((resolve) =>
				requestAnimationFrame(() => requestAnimationFrame(() => resolve(undefined))),
			),
	);
	await capture('support-unify-consult-intent');
};
