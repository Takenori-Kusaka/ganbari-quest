// tests/e2e/child-point-delta-flight.spec.ts
// #4448: 記録 / 交換で動いたポイントが、ヘッダー残高につながることの回帰テスト。
//
// 事象 (Issue #4448): 記録すると結果ダイアログに獲得ポイントが出るが、閉じたあと
// invalidateAll() でヘッダー残高が **無言で** 書き換わるため、「いま出た +10P」と
// 「右上の数字」が結びつかない。消費 (ごほうび交換) も同様。
//
// 本 spec が固定するのは「演出が出る」ことではなく、
// **ghost に出た増減量が、実際の残高の変化量と一致する** こと (= 2 つの数字がつながっている)。
//
// AC マッピング:
//   AC1 / AC6: 4 モード (preschool / elementary / junior / senior) で記録 → `+N` (緑) → 残高が加算後の値
//   AC2: ごほうび即時交換 → `-N` (赤) → 残高が減算後の値
//   AC6: 演出中も操作できる (ghost layer が pointer-events: none)
//   AC7: 再読込では再生されない

import { expect, type Page, test } from './fixtures';
import { dismissOverlays, expandAllCategories, selectChildByName } from './helpers';

const GHOST = '[data-testid="point-flight-ghost"]';

/** ヘッダー残高の表示値 ("1,250P" 等) を数値にする */
async function readBalance(page: Page): Promise<number> {
	const text = (await page.getByTestId('header-balance').textContent()) ?? '';
	const digits = text.replace(/[^\d]/g, '');
	expect(digits, `ヘッダー残高が数値として読めること (実際: "${text}")`).not.toBe('');
	return Number(digits);
}

/**
 * ghost が現れた瞬間のラベル文字列を捕まえる。
 *
 * ghost は 380ms で消えるため、**click 前に** 待機を仕掛けてから click する
 * (locator 経由で後から読むと detach 済みで取りこぼす)。
 */
function captureGhostLabel(page: Page): Promise<string | null> {
	return page
		.waitForFunction(
			(sel: string) => document.querySelector(sel)?.textContent?.trim() || null,
			GHOST,
			{ timeout: 15000 },
		)
		.then((handle) => handle.jsonValue() as Promise<string>)
		.catch(() => null);
}

/** ghost の増減量 ("+12P" / "-50P" → 12 / -50) */
function parseGhostAmount(label: string): number {
	const m = label.match(/([+-])[^\d]*([\d,]+)/);
	expect(m, `ghost ラベルが符号付きであること (実際: "${label}")`).not.toBeNull();
	const sign = m?.[1] === '-' ? -1 : 1;
	return sign * Number((m?.[2] ?? '').replace(/,/g, ''));
}

/**
 * レベルアップが挟まると残高の取り込みはレベルアップを閉じるまで待たされる (仕様)。
 * 実ユーザーと同じ順序で閉じてから先へ進む。
 */
async function closeLevelUpIfShown(page: Page): Promise<void> {
	const btn = page.locator('.levelup-btn');
	if (await btn.isVisible({ timeout: 1500 }).catch(() => false)) {
		await btn.click();
	}
}

const RECORD_MODES = [
	{ nickname: 'たろうくん', uiMode: 'preschool' },
	{ nickname: 'けんたくん', uiMode: 'elementary' },
	{ nickname: 'ゆうこちゃん', uiMode: 'junior' },
	{ nickname: 'まさとくん', uiMode: 'senior' },
] as const;

test.describe('#4448: ポイントの増減がヘッダー残高につながる', () => {
	// point_ledger を動かすため直列実行
	test.describe.configure({ mode: 'serial' });

	for (const { nickname, uiMode } of RECORD_MODES) {
		test(`AC1 / AC6 (${uiMode}): 記録 → +N が出て、残高がその分だけ増える`, async ({ page }) => {
			await selectChildByName(page, nickname);
			await dismissOverlays(page);
			await expect(page).toHaveURL(new RegExp(`/${uiMode}/home`));
			await expandAllCategories(page);

			const before = await readBalance(page);

			// 記録する
			const card = page.locator('[data-testid^="activity-card-"]').first();
			await expect(card).toBeVisible();
			await card.click();
			const recordBtn = page.getByTestId('confirm-record-btn');
			await expect(recordBtn).toBeVisible({ timeout: 10000 });
			await recordBtn.click();

			// 結果ダイアログ = 出発点
			const resultPoint = page.getByTestId('result-point-value');
			await expect(resultPoint).toBeVisible({ timeout: 15000 });

			// 閉じる前に ghost の待機を仕掛ける (380ms しか存在しない)
			const ghostLabel = captureGhostLabel(page);
			await page.getByTestId('activity-confirm-btn').click();
			await closeLevelUpIfShown(page);

			const label = await ghostLabel;
			expect(label, '獲得ぶんが `+N` として出ること (色だけに頼らない)').not.toBeNull();
			expect(label?.startsWith('+'), `獲得は + 符号 (実際: "${label}")`).toBe(true);

			// 残高は「変化前 + ghost に出した増減量」ちょうどに着地する
			// (カウントアップ途中の値を掴まないよう poll で着地を待つ)
			const expected = before + parseGhostAmount(label ?? '');
			expect(expected, '獲得なので残高は増える').toBeGreaterThan(before);
			await expect.poll(() => readBalance(page), { timeout: 15000 }).toBe(expected);
		});
	}

	test('AC6: 演出中も操作できる (ghost は pointer-events を奪わない)', async ({ page }) => {
		await selectChildByName(page, 'けんたくん');
		await dismissOverlays(page);
		await expandAllCategories(page);

		const card = page.locator('[data-testid^="activity-card-"]').first();
		await card.click();
		await page.getByTestId('confirm-record-btn').click();
		await expect(page.getByTestId('result-point-value')).toBeVisible({ timeout: 15000 });

		const appeared = page.waitForSelector(GHOST, { timeout: 15000 }).catch(() => null);
		await page.getByTestId('activity-confirm-btn').click();
		await closeLevelUpIfShown(page);
		const handle = await appeared;
		expect(handle, 'ghost が出ること').not.toBeNull();

		const pointerEvents = await page
			.locator(GHOST)
			.evaluate((el) => getComputedStyle(el).pointerEvents)
			.catch(() => 'none'); // 既に消えていれば操作を妨げていないので合格
		expect(pointerEvents, '演出レイヤーがクリックを吸ってはいけない').toBe('none');

		// 演出直後でも別画面へ移動できる (待たされない)
		await page.getByTestId('bottom-nav').getByRole('link').first().click();
		await expect(page).not.toHaveURL(/\/elementary\/home$/, { timeout: 15000 });
	});

	test('AC7: 再読込 / 画面復帰では再生されない', async ({ page }) => {
		await selectChildByName(page, 'ゆうこちゃん');
		await dismissOverlays(page);

		await page.reload();
		await dismissOverlays(page);
		// hydration + データ取り込みが終わった時点 (演出が起きるなら起きているタイミング) で見る
		await expect(page.getByTestId('junior-home-page')).toBeVisible();
		await expect(page.getByTestId('header-balance')).toBeVisible();

		// 残高が動いていないので演出は出ない (#4410 と同型の「毎回出る」を作らない)
		await expect(page.locator(GHOST)).toHaveCount(0);

		// 画面遷移で戻ってきても同じ
		await page.goto('/junior/shop');
		await expect(page.getByTestId('shop-page')).toBeVisible();
		await page.goto('/junior/home');
		await expect(page.getByTestId('junior-home-page')).toBeVisible();
		await expect(page.locator(GHOST)).toHaveCount(0);
	});
});

// ============================================================
// AC2: 消費 (ごほうび即時交換)
// ============================================================
// 親承認待ちの申請では残高が動かないため、即時交換 (settings.reward_auto_approve=true)
// を ON にして「実際に減る」経路を通す。共有 worker DB は afterEach で必ず戻す。

async function setAutoApprove(workerDbPath: string, value: 'true' | null): Promise<void> {
	const { default: Database } = await import('better-sqlite3');
	const db = new Database(workerDbPath);
	try {
		if (value === null) {
			db.prepare("DELETE FROM settings WHERE key = 'reward_auto_approve'").run();
		} else {
			db.prepare(
				`INSERT INTO settings (key, value, updated_at) VALUES ('reward_auto_approve', ?, CURRENT_TIMESTAMP)
				 ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
			).run(value);
		}
	} finally {
		db.close();
	}
}

async function cleanupKinderExchange(workerDbPath: string): Promise<void> {
	const { default: Database } = await import('better-sqlite3');
	const db = new Database(workerDbPath);
	try {
		const child = db
			.prepare('SELECT id FROM children WHERE nickname = ? LIMIT 1')
			.get('たろうくん') as { id: number } | undefined;
		if (!child) return;
		db.prepare('DELETE FROM reward_redemption_requests WHERE child_id = ?').run(child.id);
		db.prepare("DELETE FROM point_ledger WHERE child_id = ? AND type = 'flight_test_seed'").run(
			child.id,
		);
		const { total } = db
			.prepare('SELECT COALESCE(SUM(amount), 0) as total FROM point_ledger WHERE child_id = ?')
			.get(child.id) as { total: number };
		db.prepare(
			"INSERT INTO point_ledger (child_id, amount, type, description) VALUES (?, ?, 'flight_test_seed', '#4448 E2E 残高調整')",
		).run(child.id, 300 - total);
	} finally {
		db.close();
	}
}

test.describe('#4448: 消費ぶんもヘッダー残高につながる', () => {
	test.describe.configure({ mode: 'serial' });

	test.beforeEach(async ({ workerDbPath }) => {
		await cleanupKinderExchange(workerDbPath);
		await setAutoApprove(workerDbPath, 'true');
	});

	test.afterEach(async ({ workerDbPath }) => {
		await setAutoApprove(workerDbPath, null);
		await cleanupKinderExchange(workerDbPath);
	});

	test('AC2: 即時交換 → -N が出て、残高がその分だけ減る', async ({ page }) => {
		await selectChildByName(page, 'たろうくん');
		await dismissOverlays(page);
		await page.goto('/preschool/shop');
		await expect(page.getByTestId('shop-page')).toBeVisible();

		const before = await readBalance(page);

		const card = page
			.locator('[data-testid^="reward-card-"]')
			.filter({ hasText: 'E2Eテスト用ごほうび（交換可）' });
		await expect(card).toHaveCount(1);
		await card.locator('button[data-testid^="exchange-btn-"]').click();

		const confirmYes = page.getByTestId('confirm-exchange-yes');
		await expect(confirmYes).toBeVisible({ timeout: 10000 });

		const ghostLabel = captureGhostLabel(page);
		await confirmYes.click();

		const label = await ghostLabel;
		expect(label, '消費ぶんが `-N` として出ること').not.toBeNull();
		expect(label?.startsWith('-'), `消費は - 符号 (実際: "${label}")`).toBe(true);

		const expected = before + parseGhostAmount(label ?? '');
		expect(expected, '消費なので残高は減る').toBeLessThan(before);
		await expect.poll(() => readBalance(page), { timeout: 15000 }).toBe(expected);
	});
});
