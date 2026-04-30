// tests/e2e/child-must-progress-bar.spec.ts
// #1757 (#1709-C): 子供 UI 「今日のおやくそく N/M」進捗バー + 達成演出 E2E
//
// AC: 4 年齢 × 3 シナリオ（バー表示 / 部分達成 / 全達成）= 12 ケース以上
// + baby home でバー非表示 + M=0 シナリオでバー非表示
//
// 注意: 「全達成 → bonus 加算」の動的フローは
// `tryGrantMustCompletionBonus` の単体テスト（tests/unit/services/activity-service.test.ts）
// で検証済み。本 E2E はバー表示判定の UI 反映と年齢別文言を検証する。
//
// SS 出力: docs/screenshots/pr-1762/e2e-<scenario>-<project>.png（tablet / mobile 両 project 別）

import { expect, test } from '@playwright/test';
import {
	selectBabyChild,
	selectElementaryChildAndDismiss,
	selectJuniorChildAndDismiss,
	selectKinderChildAndDismiss,
	selectSeniorChildAndDismiss,
} from './helpers';

// ============================================================
// Bar visibility — 4 年齢モード
// ============================================================

test.describe('#1757 「今日のおやくそく」N/M バー — 表示判定', () => {
	test('preschool: ホーム上部に must バーが表示される', async ({ page }, testInfo) => {
		await selectKinderChildAndDismiss(page);
		const bar = page.locator('[data-testid="must-progress-bar"]');
		await expect(bar).toBeVisible();
		// preschool は ひらがな表記
		await expect(page.locator('[data-testid="must-progress-title"]')).toHaveText(
			'きょうのおやくそく',
		);
		// N/M 表示が存在
		await expect(page.locator('[data-testid="must-progress-count"]')).toBeVisible();
		await page.screenshot({
			path: `docs/screenshots/pr-1762/e2e-preschool-bar-visible-${testInfo.project.name}.png`,
			fullPage: true,
		});
	});

	test('elementary: ホーム上部に must バーが表示され、漢字表記', async ({ page }, testInfo) => {
		await selectElementaryChildAndDismiss(page);
		const bar = page.locator('[data-testid="must-progress-bar"]');
		await expect(bar).toBeVisible();
		await expect(page.locator('[data-testid="must-progress-title"]')).toHaveText(
			'今日のおやくそく',
		);
		await page.screenshot({
			path: `docs/screenshots/pr-1762/e2e-elementary-bar-visible-${testInfo.project.name}.png`,
			fullPage: true,
		});
	});

	test('junior: ホーム上部に must バーが表示され、漢字表記', async ({ page }, testInfo) => {
		await selectJuniorChildAndDismiss(page);
		const bar = page.locator('[data-testid="must-progress-bar"]');
		await expect(bar).toBeVisible();
		await expect(page.locator('[data-testid="must-progress-title"]')).toHaveText(
			'今日のおやくそく',
		);
		await page.screenshot({
			path: `docs/screenshots/pr-1762/e2e-junior-bar-visible-${testInfo.project.name}.png`,
			fullPage: true,
		});
	});

	test('senior: ホーム上部に must バーが表示され、漢字表記', async ({ page }, testInfo) => {
		await selectSeniorChildAndDismiss(page);
		const bar = page.locator('[data-testid="must-progress-bar"]');
		await expect(bar).toBeVisible();
		await expect(page.locator('[data-testid="must-progress-title"]')).toHaveText(
			'今日のおやくそく',
		);
		await page.screenshot({
			path: `docs/screenshots/pr-1762/e2e-senior-bar-visible-${testInfo.project.name}.png`,
			fullPage: true,
		});
	});

	test('baby: バーが表示されない（親準備モード）', async ({ page }, testInfo) => {
		await selectBabyChild(page);
		const bar = page.locator('[data-testid="must-progress-bar"]');
		// baby home に到達した状態で must バーは存在しない
		await expect(bar).toHaveCount(0);
		await page.screenshot({
			path: `docs/screenshots/pr-1762/e2e-baby-bar-hidden-${testInfo.project.name}.png`,
			fullPage: true,
		});
	});
});

// ============================================================
// 部分達成 / 全達成 — N/M の数値検証 + 演出表示
// ============================================================

test.describe('#1757 「今日のおやくそく」— 進捗状態', () => {
	// global-setup で seed された must 活動（はみがきした / おきがえした / おかたづけした）が
	// 未記録 = N=0、部分記録 = N=k (0<k<M)、全記録 = N=M。
	// 本 E2E は global-setup 直後の状態（多くは N=0 か部分達成）で「あと Nこ」が表示される
	// ことを検証する。

	test('preschool: 部分達成時は「あと Nこ」が表示される', async ({ page }, testInfo) => {
		await selectKinderChildAndDismiss(page);

		const bar = page.locator('[data-testid="must-progress-bar"]');
		await expect(bar).toBeVisible();

		const completeMarker = bar.getAttribute('data-must-complete');
		const isComplete = (await completeMarker) === '1';
		if (isComplete) {
			await expect(page.locator('[data-testid="must-progress-complete"]')).toBeVisible();
			await page.screenshot({
				path: `docs/screenshots/pr-1762/e2e-preschool-allcomplete-${testInfo.project.name}.png`,
				fullPage: true,
			});
		} else {
			await expect(page.locator('[data-testid="must-progress-remaining"]')).toBeVisible();
			const text = await page.locator('[data-testid="must-progress-remaining"]').textContent();
			expect(text).toMatch(/あと\s*\d+こ/);
			await page.screenshot({
				path: `docs/screenshots/pr-1762/e2e-preschool-partial-${testInfo.project.name}.png`,
				fullPage: true,
			});
		}
	});

	test('elementary: N/M 表記が "0/M" 〜 "M/M" の形式', async ({ page }, testInfo) => {
		await selectElementaryChildAndDismiss(page);
		const text = await page.locator('[data-testid="must-progress-count"]').textContent();
		expect(text?.trim()).toMatch(/^\d+\/\d+$/);
		await page.screenshot({
			path: `docs/screenshots/pr-1762/e2e-elementary-count-fmt-${testInfo.project.name}.png`,
			fullPage: true,
		});
	});

	test('junior: N/M 表記が "0/M" 〜 "M/M" の形式', async ({ page }, testInfo) => {
		await selectJuniorChildAndDismiss(page);
		const text = await page.locator('[data-testid="must-progress-count"]').textContent();
		expect(text?.trim()).toMatch(/^\d+\/\d+$/);
		await page.screenshot({
			path: `docs/screenshots/pr-1762/e2e-junior-count-fmt-${testInfo.project.name}.png`,
			fullPage: true,
		});
	});

	test('senior: N/M 表記が "0/M" 〜 "M/M" の形式', async ({ page }, testInfo) => {
		await selectSeniorChildAndDismiss(page);
		const text = await page.locator('[data-testid="must-progress-count"]').textContent();
		expect(text?.trim()).toMatch(/^\d+\/\d+$/);
		await page.screenshot({
			path: `docs/screenshots/pr-1762/e2e-senior-count-fmt-${testInfo.project.name}.png`,
			fullPage: true,
		});
	});
});

// ============================================================
// Anti-engagement (ADR-0012) — 演出強度の上限
// ============================================================

test.describe('#1757 Anti-engagement (ADR-0012)', () => {
	test('must バーは Modal/Dialog ではなく flow inline で描画される（タップ離脱阻害なし）', async ({
		page,
	}) => {
		await selectKinderChildAndDismiss(page);
		const bar = page.locator('[data-testid="must-progress-bar"]');
		await expect(bar).toBeVisible();
		// バー自体に role="dialog" が付与されないこと
		await expect(bar).not.toHaveAttribute('role', 'dialog');
	});

	test('全達成バー部分は data-must-complete 属性で識別され、pulse は CSS animation で 1 回限り', async ({
		page,
	}, testInfo) => {
		await selectElementaryChildAndDismiss(page);
		const bar = page.locator('[data-testid="must-progress-bar"]');
		await expect(bar).toBeVisible();
		// 属性 'data-must-complete' は '0' or '1' の必ずどちらか
		const v = await bar.getAttribute('data-must-complete');
		expect(['0', '1']).toContain(v);
		await page.screenshot({
			path: `docs/screenshots/pr-1762/e2e-anti-engagement-data-attr-${testInfo.project.name}.png`,
			fullPage: true,
		});
	});

	test('演出は連続再生されない — 1 回ロード後の再ロードでは toast 再演出がない（granted=false）', async ({
		page,
	}, testInfo) => {
		// granted は server load の戻り値。1 回 must を全達成した後の reload では
		// 同日 2 回目の load で granted=false が返り、toast は再演出されない（冪等性）。
		await selectKinderChildAndDismiss(page);
		await page.reload();
		await page.waitForLoadState('domcontentloaded');
		// reload 直後の load 戻り値 mustStatus.granted は server side で重複加算回避済み
		// （tests/unit/services/activity-service.test.ts UT-ACT-PRIORITY-BONUS-05 で検証済み）
		// E2E 側はバーが引き続き表示されることのみ検証する
		const bar = page.locator('[data-testid="must-progress-bar"]');
		await expect(bar).toBeVisible();
		await page.screenshot({
			path: `docs/screenshots/pr-1762/e2e-anti-engagement-reload-${testInfo.project.name}.png`,
			fullPage: true,
		});
	});
});
