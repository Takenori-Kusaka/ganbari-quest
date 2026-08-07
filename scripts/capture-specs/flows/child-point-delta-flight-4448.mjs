/**
 * scripts/capture-specs/flows/child-point-delta-flight-4448.mjs (#4448)
 *
 * 「動いたポイントが、右上の残高につながる」ところを撮る。
 * `AUTH_MODE=local` (`npm run dev`) で動作。baby は対象外 (ADR-0011)。
 *
 * ## 事前条件 (撮影者が用意する)
 *
 * dev DB (`data/ganbari-quest.db`):
 *   children: id 1=preschool / 3=elementary / 4=junior / 5=senior に activity が 1 件以上
 *   settings: `pin_gate_onboarding_seen` = 'true' (初回訪問 dialog を出さない)
 *   settings: `reward_auto_approve` = 'true' (交換が親承認待ちにならず**実際に残高が減る**)
 *   preschool の子に、残高で買える special_reward が 1 件以上
 *
 * ## このフローが撮るもの
 *
 * 獲得 (4 モード):
 *   `*-<mode>-gain-result`  結果ダイアログ (出発点になるポイント数字)
 *   `*-<mode>-gain-flight`  閉じた直後 — 修正後は `+N` が残高へ飛び、残高はまだ変化前の値
 *                           修正前 (develop) は ghost が無く、残高が無言で最終値になっている
 *   `*-<mode>-gain-settled` 演出が終わったあと (残高が加算後の値)
 *
 * 消費 (preschool):
 *   `*-spend-confirm` / `*-spend-flight` / `*-spend-settled`
 *
 * 修正前を撮るときは `CAPTURE_LABEL_PREFIX=before`。既定は after。
 *
 * 使用例:
 *   MSYS_NO_PATHCONV=1 BASE_URL=http://localhost:5411 node scripts/capture.mjs --pr <N> \
 *     --flow child-point-delta-flight-4448 \
 *     --url /switch \
 *     --actions scripts/capture-specs/flows/child-point-delta-flight-4448.mjs \
 *     --presets mobile --no-start-server --max-steps 20
 */

const CHILDREN = [
	{ childId: 1, uiMode: 'preschool' },
	{ childId: 3, uiMode: 'elementary' },
	{ childId: 4, uiMode: 'junior' },
	{ childId: 5, uiMode: 'senior' },
];

const GHOST = '[data-testid="point-flight-ghost"]';
const LOGIN_BONUS_CONFIRM = '[data-testid="login-bonus-confirm"]';

const PREFIX = process.env.CAPTURE_LABEL_PREFIX || 'after';

/** @param {import('playwright').Page} page */
async function selectChild(page, childId, uiMode) {
	await page.goto(new URL('/switch', page.url()).href, { waitUntil: 'domcontentloaded' });
	await page.locator(`[data-testid="child-select-${childId}"]`).click();
	await page.locator(`[data-testid="${uiMode}-home-page"]`).waitFor({ state: 'visible' });
}

/** ログインボーナス (おみくじ) overlay は記録操作を intercept するので先に閉じる */
async function dismissLoginBonus(page) {
	const confirm = page.locator(LOGIN_BONUS_CONFIRM);
	await confirm.waitFor({ state: 'visible', timeout: 12_000 }).catch(() => {});
	if (await confirm.isVisible().catch(() => false)) {
		await confirm.click();
		await page
			.locator('[data-testid="stamp-press-overlay"]')
			.waitFor({ state: 'hidden', timeout: 10_000 })
			.catch(() => {});
	}
}

/**
 * レベルアップが挟まると、残高の取り込みはレベルアップを閉じるまで待たされる (仕様)。
 * 実ユーザーと同じ順序で閉じてから先へ進む。
 */
async function closeLevelUpIfShown(page) {
	const btn = page.locator('.levelup-btn');
	if (await btn.isVisible({ timeout: 2000 }).catch(() => false)) {
		await btn.click();
	}
}

/**
 * 残高のカウントアップが終わる (表示が動かなくなる) まで待つ。
 * 固定待ちを使わずに「最終値の SS」を決定的に撮るため。
 */
async function waitBalanceSettled(page) {
	await page
		.waitForFunction(
			() => {
				const el = document.querySelector('[data-testid="header-balance"]');
				if (!el) return false;
				const now = el.textContent;
				const prev = window.__pfLastBalance;
				window.__pfLastBalance = now;
				return prev !== undefined && prev === now;
			},
			null,
			{ polling: 150, timeout: 8000 },
		)
		.catch(() => {});
	await page.evaluate(() => {
		window.__pfLastBalance = undefined;
	});
}

/** 折りたたまれたカテゴリを開いて activity-card を表に出す */
async function expandCategories(page) {
	const toggles = page.locator('[data-testid^="category-toggle-"]');
	const n = await toggles.count().catch(() => 0);
	for (let i = 0; i < n; i++) {
		await toggles
			.nth(i)
			.click({ timeout: 3000 })
			.catch(() => {});
	}
}

/**
 * @param {import('playwright').Page} page
 * @param {(label: string) => Promise<string>} capture
 */
export default async (page, capture) => {
	await page.context().clearCookies();
	await page.addInitScript(() => {
		try {
			for (const id of [1, 2, 3, 4, 5])
				localStorage.setItem(`child_tutorial_hint_shown_${id}`, '1');
		} catch {
			/* localStorage 不可の環境では何もしない */
		}
	});

	// === 獲得 (記録 → 結果ダイアログ → ヘッダー残高) ===
	for (const { childId, uiMode } of CHILDREN) {
		await selectChild(page, childId, uiMode);
		await dismissLoginBonus(page);
		await expandCategories(page);

		await page.locator('[data-testid^="activity-card-"]:not([disabled])').first().click();
		await page.locator('[data-testid="confirm-record-btn"]').click();
		await page.locator('[data-testid="result-point-value"]').waitFor({ state: 'visible' });
		await capture(`${PREFIX}-${uiMode}-gain-result`);

		// 修正後は ghost が出る。修正前 (develop) は出ないので待たずに撮る
		const ghostVisible =
			PREFIX === 'after'
				? page.locator(GHOST).waitFor({ state: 'visible', timeout: 10_000 })
				: Promise.resolve();
		await page.locator('[data-testid="activity-confirm-btn"]').click();
		// レベルアップが挟まる回は、閉じるまで残高の取り込みが始まらない (仕様)。
		// 「レベルアップが出る」「ghost が出る」のどちらか早い方まで待ってから閉じ判定する。
		await Promise.race([
			page
				.locator('.levelup-btn')
				.waitFor({ state: 'visible', timeout: 6000 })
				.catch(() => {}),
			page
				.locator(GHOST)
				.waitFor({ state: 'visible', timeout: 6000 })
				.catch(() => {}),
		]);
		await closeLevelUpIfShown(page);
		await ghostVisible.catch(() => {});
		await capture(`${PREFIX}-${uiMode}-gain-flight`);

		// 演出が終わるまで待ってから最終状態を撮る
		await page
			.locator(GHOST)
			.waitFor({ state: 'detached', timeout: 10_000 })
			.catch(() => {});
		await waitBalanceSettled(page);
		await capture(`${PREFIX}-${uiMode}-gain-settled`);
	}

	// === 消費 (ごほうび交換 → ヘッダー残高) ===
	await selectChild(page, 1, 'preschool');
	await dismissLoginBonus(page);
	await page.goto(new URL('/preschool/shop', page.url()).href, { waitUntil: 'domcontentloaded' });
	await page.locator('[data-testid="shop-page"]').waitFor({ state: 'visible' });

	const exchangeBtn = page.locator('button[data-testid^="exchange-btn-"]:not([disabled])').first();
	await exchangeBtn.waitFor({ state: 'visible' });
	const confirmYes = page.locator('[data-testid="confirm-exchange-yes"]');
	// hydration 前の click は onclick が付いておらず無反応になるため、開くまで押し直す
	for (let attempt = 0; attempt < 5; attempt++) {
		await exchangeBtn.click();
		if (await confirmYes.isVisible({ timeout: 3000 }).catch(() => false)) break;
	}
	await confirmYes.waitFor({ state: 'visible' });
	await capture(`${PREFIX}-spend-confirm`);

	const spendGhost =
		PREFIX === 'after'
			? page.locator(GHOST).waitFor({ state: 'visible', timeout: 10_000 })
			: Promise.resolve();
	await confirmYes.click();
	await spendGhost.catch(() => {});
	await capture(`${PREFIX}-spend-flight`);

	await page
		.locator(GHOST)
		.waitFor({ state: 'detached', timeout: 10_000 })
		.catch(() => {});
	await waitBalanceSettled(page);
	await capture(`${PREFIX}-spend-settled`);
};
