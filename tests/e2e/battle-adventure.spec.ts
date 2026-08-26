// tests/e2e/battle-adventure.spec.ts
// #605 バトルアドベンチャー E2E テスト / #1323 baby・preschool 404 確認
// #4681: 導線 (BottomNav つよさ → CharacterTabs バトル) 経由で到達し、
//        act (バトル開始) → outcome (+N ポイント表示) → persistence (point_ledger type=battle 行 +
//        reload 後のヘッダー残高 = 事前残高 + N) を assert する。
//
// バトルは1日1回の制約があるため、テストは直列実行する（UI表示→API実行の順序が重要）

import { expect, test } from './fixtures';
import {
	selectBabyChild,
	selectElementaryChildAndDismiss,
	selectJuniorChildAndDismiss,
	selectKinderChild,
	selectSeniorChildAndDismiss,
} from './helpers';

const ELEMENTARY_NICKNAME = 'けんたくん';

/** worker DB の子供 id を nickname から引く。 */
async function getChildId(workerDbPath: string, nickname: string): Promise<number> {
	const { default: Database } = await import('better-sqlite3');
	const db = new Database(workerDbPath);
	try {
		const row = db.prepare('SELECT id FROM children WHERE nickname = ? LIMIT 1').get(nickname) as
			| { id: number }
			| undefined;
		if (!row) throw new Error(`${nickname} not found in worker DB`);
		return row.id;
	} finally {
		db.close();
	}
}

/**
 * 今日のバトルを pending に戻す (mobile/tablet project が同一 worker DB を共有し、先行 project が
 * 実行済みのことがあるため)。先行バトルの ledger 行も除去して「事前残高 + N」を厳密に assert する。
 */
async function resetTodayBattle(workerDbPath: string, childId: number): Promise<void> {
	const { default: Database } = await import('better-sqlite3');
	const db = new Database(workerDbPath);
	try {
		const rows = db
			.prepare('SELECT id FROM daily_battles WHERE child_id = ?')
			.all(childId) as Array<{ id: number }>;
		for (const { id } of rows) {
			db.prepare(
				"DELETE FROM point_ledger WHERE child_id = ? AND type = 'battle' AND reference_id = ?",
			).run(childId, id);
		}
		db.prepare('DELETE FROM daily_battles WHERE child_id = ?').run(childId);
	} finally {
		db.close();
	}
}

/** point_ledger の battle 行 (amount) を返す。 */
async function getBattleLedger(
	workerDbPath: string,
	childId: number,
): Promise<Array<{ amount: number }>> {
	const { default: Database } = await import('better-sqlite3');
	const db = new Database(workerDbPath);
	try {
		return db
			.prepare("SELECT amount FROM point_ledger WHERE child_id = ? AND type = 'battle'")
			.all(childId) as Array<{ amount: number }>;
	} finally {
		db.close();
	}
}

/** ヘッダー残高 "88P" / "¥880" 等から数値部分を取り出す。 */
function parseBalance(text: string | null): number {
	const digits = (text ?? '').replace(/[^\d]/g, '');
	return Number(digits || '0');
}

test.describe('#1323: baby/preschool はバトルが 404', () => {
	test('baby モードのバトルページは 404 を返す', async ({ page }) => {
		await selectBabyChild(page);
		const res = await page.goto('/baby/battle');
		expect(res?.status()).toBe(404);
	});

	test('preschool モードのバトルページは 404 を返す', async ({ page }) => {
		await selectKinderChild(page);
		const res = await page.goto('/preschool/battle');
		expect(res?.status()).toBe(404);
	});

	test('preschool の CharacterTabs にはバトル入口が無い', async ({ page }) => {
		await selectKinderChild(page);
		await page.goto('/preschool/status');
		await expect(page.getByTestId('character-tabs')).toBeVisible();
		await expect(page.getByTestId('character-tab-battle')).toHaveCount(0);
	});
});

test.describe('#4681: 子供画面からバトルへの導線 (junior / senior)', () => {
	test('junior: つよさ → バトル タブで到達できる', async ({ page }) => {
		await selectJuniorChildAndDismiss(page);
		await page.getByTestId('nav-status').click();
		await page.getByTestId('character-tab-battle').click();
		await expect(page).toHaveURL(/\/junior\/battle$/);
		await expect(page.getByTestId('battle-page')).toBeVisible();
	});

	test('senior: つよさ → バトル タブで到達できる', async ({ page }) => {
		await selectSeniorChildAndDismiss(page);
		await page.getByTestId('nav-status').click();
		await page.getByTestId('character-tab-battle').click();
		await expect(page).toHaveURL(/\/senior\/battle$/);
		await expect(page.getByTestId('battle-page')).toBeVisible();
	});
});

test.describe
	.serial('#605 / #4681: バトルアドベンチャー (act → outcome → persistence)', () => {
		test.slow();

		test('導線経由で到達し、バトル結果の +N ポイントが台帳と reload 後の残高に反映される', async ({
			page,
			workerDbPath,
		}) => {
			const childId = await getChildId(workerDbPath, ELEMENTARY_NICKNAME);
			await resetTodayBattle(workerDbPath, childId);

			// 導線: BottomNav つよさ → CharacterTabs バトル (URL 直打ちをしない)
			await selectElementaryChildAndDismiss(page);
			await page.getByTestId('nav-status').click();
			const battleTab = page.getByTestId('character-tab-battle');
			await expect(battleTab).toBeVisible();
			await battleTab.click();
			await expect(page).toHaveURL(/\/elementary\/battle$/);

			const battlePage = page.getByTestId('battle-page');
			await expect(battlePage).toBeVisible();
			await expect(page.locator('.page-title')).toContainText('きょうの バトル');
			await expect(page.getByTestId('battle-field')).toBeVisible();

			const enemyName = page.getByTestId('enemy-name');
			await expect(enemyName).toBeVisible();
			expect((await enemyName.textContent()) ?? '').not.toBe('');

			// 未実行状態: ステータスパネル + 開始ボタン
			const statsPanel = page.getByTestId('stats-panel');
			await expect(statsPanel).toBeVisible();
			await expect(statsPanel).toContainText('きみのステータス');
			const startButton = page.getByTestId('battle-start-button');
			await expect(startButton).toBeVisible();
			await expect(startButton).toContainText('バトル かいし');

			const before = parseBalance(await page.getByTestId('header-balance').textContent());
			expect(await getBattleLedger(workerDbPath, childId)).toHaveLength(0);

			// act: バトル開始 (form action executeBattle)
			await Promise.all([
				page.waitForResponse(
					(res) => res.url().includes('executeBattle') && res.request().method() === 'POST',
				),
				startButton.click(),
			]);

			// outcome: 結果バナーに +N ポイント
			const rewardText = page.getByTestId('reward-text');
			await expect(rewardText).toBeVisible({ timeout: 30_000 });
			const reward = Number(((await rewardText.textContent()) ?? '').match(/\+(\d+)/)?.[1]);
			expect(reward).toBeGreaterThan(0);

			// persistence ①: point_ledger に type=battle 行がちょうど 1 件、額は表示どおり
			await expect
				.poll(async () => await getBattleLedger(workerDbPath, childId))
				.toEqual([{ amount: reward }]);

			// persistence ②: reload してもヘッダー残高が表示額ぶん増えている
			await page.reload();
			await expect
				.poll(async () => parseBalance(await page.getByTestId('header-balance').textContent()))
				.toBe(before + reward);

			// 1 日 1 回制限: reload 後は「おわったよ」、開始ボタンは出ない
			const alreadyDone = page.getByTestId('battle-already-done');
			await expect(alreadyDone).toBeVisible();
			await expect(alreadyDone).toContainText('きょうの バトルは おわったよ');
			await expect(page.getByTestId('battle-start-button')).not.toBeVisible();
		});

		// API テスト: GET で情報取得
		// child_id=3 = けんたくん（elementary）— UI テストと同じ子供を使用
		test('バトルAPI: GETで今日のバトル情報を取得できる', async ({ request }) => {
			const res = await request.get('/api/v1/battle/3');
			expect(res.status()).toBe(200);

			const data = await res.json();
			expect(data).toHaveProperty('battleId');
			expect(data).toHaveProperty('enemy');
			expect(data).toHaveProperty('playerStats');
			expect(data).toHaveProperty('scaledEnemyMaxHp');
			expect(data).toHaveProperty('completed');

			// 敵の基本情報
			expect(data.enemy).toHaveProperty('name');
			expect(data.enemy).toHaveProperty('icon');
			expect(data.enemy).toHaveProperty('stats');

			// プレイヤーステータス
			expect(data.playerStats).toHaveProperty('hp');
			expect(data.playerStats).toHaveProperty('atk');
			expect(data.playerStats).toHaveProperty('def');
			expect(data.playerStats).toHaveProperty('spd');
			expect(data.playerStats).toHaveProperty('rec');

			// スケーリング後HP > 0
			expect(data.scaledEnemyMaxHp).toBeGreaterThan(0);
		});

		// API テスト: POST でバトル実行 (既に完了済みなら 400)
		test('バトルAPI: POSTでバトルを実行し結果を取得できる', async ({ request }) => {
			const getRes = await request.get('/api/v1/battle/3');
			const getData = await getRes.json();

			if (getData.completed) {
				// 既にバトル済みの場合はPOSTがエラーになることを確認
				const postRes = await request.post('/api/v1/battle/3');
				expect(postRes.status()).toBe(400);
				return;
			}

			// バトル実行
			const postRes = await request.post('/api/v1/battle/3');
			expect(postRes.status()).toBe(200);

			const postData = await postRes.json();
			expect(postData).toHaveProperty('battleResult');
			expect(postData).toHaveProperty('rewardPoints');
			expect(postData).toHaveProperty('enemy');

			// バトル結果
			const result = postData.battleResult;
			expect(result).toHaveProperty('outcome');
			expect(['win', 'lose']).toContain(result.outcome);
			expect(result).toHaveProperty('turns');
			expect(Array.isArray(result.turns)).toBe(true);
			expect(result.turns.length).toBeGreaterThan(0);
			expect(result).toHaveProperty('rewardPoints');
			expect(result.rewardPoints).toBeGreaterThanOrEqual(0);
		});

		test('バトルAPI: 不正なchildIdでエラーを返す', async ({ request }) => {
			const res = await request.get('/api/v1/battle/abc');
			expect(res.status()).toBe(400);
		});

		// child_id=2（はなこちゃん）でバトル二重実行テスト: 2 回目は 400 + ledger は 1 行のまま
		test('バトルAPI: 二重実行でエラーを返し、台帳も 2 重計上しない', async ({
			request,
			workerDbPath,
		}) => {
			await resetTodayBattle(workerDbPath, 2);
			// まずGETでバトル生成
			await request.get('/api/v1/battle/2');

			// 1回目のバトル実行
			const firstRes = await request.post('/api/v1/battle/2');
			expect(firstRes.status()).toBe(200);
			const first = await firstRes.json();

			// 2回目はエラー
			const secondRes = await request.post('/api/v1/battle/2');
			expect(secondRes.status()).toBe(400);

			const ledger = await getBattleLedger(workerDbPath, 2);
			expect(ledger).toEqual(first.rewardPoints > 0 ? [{ amount: first.rewardPoints }] : []);
		});
	});
