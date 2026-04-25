// tests/e2e/battle-adventure.spec.ts
// #605 バトルアドベンチャー E2E テスト / #1323 baby・preschool 404 確認
// バトルページの表示・API実行・結果検証
//
// バトルは1日1回の制約があるため、テストは直列実行する（UI表示→API実行の順序が重要）

import { expect, test } from '@playwright/test';
import { selectBabyChild, selectElementaryChild, selectKinderChild } from './helpers';

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
});

test.describe
	.serial('#605: バトルアドベンチャー', () => {
		// UI テスト: バトルページの表示確認
		// mobile/tablet ワーカーが同一DBを共有するため、先にバトル実行済みの場合がある
		test('バトルページが正しく表示される（敵・ステータス・開始ボタン）', async ({ page }) => {
			await selectElementaryChild(page);
			await page.goto('/elementary/battle');

			// バトルページが表示される
			const battlePage = page.getByTestId('battle-page');
			await expect(battlePage).toBeVisible();

			// ページタイトル
			await expect(page.locator('.page-title')).toContainText('きょうの バトル');

			// バトルフィールド（敵・プレイヤー）
			const battleField = page.getByTestId('battle-field');
			await expect(battleField).toBeVisible();

			// 敵名が表示される
			const enemyName = page.getByTestId('enemy-name');
			await expect(enemyName).toBeVisible();
			const name = await enemyName.textContent();
			expect(typeof name).toBe('string');
			expect(name).not.toBe('');

			// バトル未実行 or 完了済みのいずれかの状態を検証
			const startButton = page.getByTestId('battle-start-button');
			const alreadyDone = page.getByTestId('battle-already-done');
			await expect(startButton.or(alreadyDone)).toBeVisible();

			// 未実行の場合: ステータスパネルと開始ボタンが表示される
			if (await startButton.isVisible().catch(() => false)) {
				const statsPanel = page.getByTestId('stats-panel');
				await expect(statsPanel).toBeVisible();
				await expect(statsPanel).toContainText('きみのステータス');
				await expect(startButton).toContainText('バトル かいし');
			}
		});

		// API テスト: GET で情報取得（バトルがまだ pending のはず）
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

		// API テスト: POST でバトル実行
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

		// child_id=2（はなこちゃん）でバトル二重実行テスト
		test('バトルAPI: 二重実行でエラーを返す', async ({ request }) => {
			// まずGETでバトル生成
			await request.get('/api/v1/battle/2');

			// 1回目のバトル実行
			const firstRes = await request.post('/api/v1/battle/2');
			if (firstRes.status() === 200) {
				// 2回目はエラー
				const secondRes = await request.post('/api/v1/battle/2');
				expect(secondRes.status()).toBe(400);
			}
		});

		// UI テスト: バトル完了後の表示確認
		test('バトル完了後は「おわったよ」メッセージが表示される', async ({ page }) => {
			await selectElementaryChild(page);
			await page.goto('/elementary/battle');

			// バトルは既に完了済み（前のテストで実行済み）
			const alreadyDone = page.getByTestId('battle-already-done');
			await expect(alreadyDone).toBeVisible();
			await expect(alreadyDone).toContainText('きょうの バトルは おわったよ');

			// 開始ボタンは非表示
			const startButton = page.getByTestId('battle-start-button');
			await expect(startButton).not.toBeVisible();
		});
	});
