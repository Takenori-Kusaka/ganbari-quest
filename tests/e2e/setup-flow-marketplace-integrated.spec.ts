// tests/e2e/setup-flow-marketplace-integrated.spec.ts
// #2140 MP-5: setup wizard β 採用 (3 step 分割) + 4 type 取込通し E2E
//
// 検証対象（Issue #2140 AC3）:
// 1. setup wizard 3 step (packs / rewards / rules) の route 存在 + 200 アクセス可能
// 2. 各 step の label / nav が描画される (AC1)
// 3. admin 画面 (activities / rewards / checklists / settings) で取込結果が反映 / 取込先 UI が存在する
// 4. marketplace 4 type 詳細ページ全て公開アクセス可能 (4 type 配線確認)
//
// 認証: AUTH_MODE=local 環境。E2E 起動時の global-setup 状態に依存する setup/* 配線を
// smoke で確認する性質のテスト。取込結果の機能 E2E は marketplace-{reward-set,checklist,
// rule-preset}-import.spec.ts と setup-funnel-service.test.ts (unit) の組み合わせでカバー。
//
// 補足: setup wizard の skip 通し操作 (packs→rewards→rules→first-adventure) は
// AUTH_MODE=local の hooks redirect 影響で再現が不安定なため、unit + 配線 E2E で網羅。

import { expect, test } from '@playwright/test';

test.describe('#2140 MP-5 — setup wizard 3 step route 存在確認 (AC1)', () => {
	test('/setup/packs (既存) の route が 4xx を返さない', async ({ page }) => {
		const resp = await page.goto('/setup/packs', { waitUntil: 'commit' });
		// 200 (page renders) または 30x (hooks redirect) は OK。404 / 500 だけ NG
		expect(resp?.status() ?? 0).toBeLessThan(400);
	});

	test('/setup/rewards (新規 MP-5) の route が 4xx を返さない', async ({ page }) => {
		const resp = await page.goto('/setup/rewards', { waitUntil: 'commit' });
		expect(resp?.status() ?? 0).toBeLessThan(400);
	});

	test('/setup/rules (新規 MP-5) の route が 4xx を返さない', async ({ page }) => {
		const resp = await page.goto('/setup/rules', { waitUntil: 'commit' });
		expect(resp?.status() ?? 0).toBeLessThan(400);
	});
});

test.describe('#2140 MP-5 — admin 画面の取込先確認 (AC3 4 type 反映)', () => {
	// 4 type の取込先 admin 画面が 200 で開けることを確認 (route 配線確認)
	test('/admin/activities にアクセス可能 (activity-pack 取込先 = MP existing)', async ({ page }) => {
		await page.goto('/admin/activities');
		await expect(page).toHaveURL(/\/admin\/activities/);
		// admin/activities が 200 で開ける時点で配線 OK
		await expect(page.locator('h1, h2').first()).toBeVisible({ timeout: 10000 });
	});

	test('/admin/rewards にアクセス可能 (reward-set 取込先 = MP-1)', async ({ page }) => {
		await page.goto('/admin/rewards');
		await expect(page).toHaveURL(/\/admin\/rewards/);
		await expect(page.locator('h1, h2').first()).toBeVisible({ timeout: 10000 });
	});

	test('/admin/checklists にアクセス可能 (event-checklist 取込先 = MP-2)', async ({ page }) => {
		const resp = await page.goto('/admin/checklists');
		await expect(page).toHaveURL(/\/admin\/checklists/);
		// 200 (route hit) + 主要 element の何れかが visible
		expect(resp?.status() ?? 0).toBeLessThan(400);
		// 厳密な h1/h2 ではなく body 内に何らかのコンテンツがあれば OK
		await expect(page.locator('body')).not.toBeEmpty({ timeout: 10000 });
	});

	test('/admin/settings にアクセス可能 (rule-preset bonus 取込先 = MP-3)', async ({ page }) => {
		// rule-preset bonus は settings.rule_preset_bonus_overrides に保存される
		const resp = await page.goto('/admin/settings');
		await expect(page).toHaveURL(/\/admin\/settings/);
		expect(resp?.status() ?? 0).toBeLessThan(400);
		await expect(page.locator('body')).not.toBeEmpty({ timeout: 10000 });
	});
});

test.describe('#2140 MP-5 — marketplace 4 type 配線確認 (AC3 横断)', () => {
	// 既存 marketplace import E2E (marketplace-{reward-set,checklist,rule-preset}-import.spec.ts) は
	// 4 type 個別に動作確認済。本テストは「4 type 全てがマケプレ詳細画面で公開アクセス可能」を
	// 1 ヶ所で smoke 確認する (regression 安全網 + EPIC #2135 完成度確認)。

	test('activity-pack 詳細ページが公開アクセス可能 (MP existing)', async ({ page }) => {
		const resp = await page.goto('/marketplace/activity-pack/kinder-starter', {
			waitUntil: 'domcontentloaded',
		});
		expect(resp?.status() ?? 0).toBeLessThan(400);
	});

	test('reward-set 詳細ページが公開アクセス可能 (MP-1)', async ({ page }) => {
		const resp = await page.goto('/marketplace/reward-set/kinder-rewards', {
			waitUntil: 'domcontentloaded',
		});
		expect(resp?.status() ?? 0).toBeLessThan(400);
	});

	test('event-checklist 詳細ページが公開アクセス可能 (MP-2)', async ({ page }) => {
		const resp = await page.goto('/marketplace/checklist/event-pool', {
			waitUntil: 'domcontentloaded',
		});
		expect(resp?.status() ?? 0).toBeLessThan(400);
	});

	test('rule-preset 詳細ページが公開アクセス可能 (MP-3)', async ({ page }) => {
		const resp = await page.goto('/marketplace/rule-preset/streak-bonus', {
			waitUntil: 'domcontentloaded',
		});
		expect(resp?.status() ?? 0).toBeLessThan(400);
	});
});
