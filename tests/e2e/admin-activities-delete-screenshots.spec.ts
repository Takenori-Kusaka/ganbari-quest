// tests/e2e/admin-activities-delete-screenshots.spec.ts
// #2754 Fix Round 1 B1: /admin/activities Delete UI の SS 4 スロット撮影専用 spec
//
// 通常 CI に含めず、`npx playwright test tests/e2e/admin-activities-delete-screenshots.spec.ts`
// で手動実行する。
//
// 出力先: tmp/screenshots/pr-2754/
//   - admin-activities-delete-desktop.png  (1280×800)
//   - admin-activities-delete-mobile.png   (Pixel 7 viewport)
//
// 通常実行で「After SS」を撮影、main HEAD を checkout してから実行で「Before SS」を撮影する。
// `screenshots` orphan branch への push は capture.mjs ではなく手動 commit & push で行う。

import * as fs from 'node:fs';
import * as path from 'node:path';
import { expect, test } from '@playwright/test';

const OUT_DIR = path.join(process.cwd(), 'tmp', 'screenshots', 'pr-2754');

test.beforeAll(() => {
	fs.mkdirSync(OUT_DIR, { recursive: true });
});

test.describe('#2754 admin/activities Delete UI スクリーンショット', () => {
	test('admin/activities full SS (viewport は project 既定)', async ({ page }, testInfo) => {
		await page.goto('/admin/activities', { waitUntil: 'domcontentloaded', timeout: 60_000 });
		// 活動 list 描画完了を web-first assertion で待つ (waitForTimeout 不使用)
		await expect(page.locator('h1, h2').first()).toBeVisible({ timeout: 30_000 });

		// 既存 list が >= 1 件ある状態を担保 (delete button 表示の前提条件)
		const editLink = page.getByTestId('activity-edit-link').first();
		if ((await editLink.count()) > 0) {
			await expect(editLink).toBeVisible({ timeout: 10_000 });
		}

		// project 名 (tablet / mobile) を suffix に。git status 由来で current ブランチが
		// main HEAD なら before-、それ以外 (PR HEAD) なら after- prefix を付与する。
		const projectName = testInfo.project.name;
		// 環境変数 SS_LABEL で before / after を明示制御する (撮影手順整合):
		//   PR HEAD で撮影: SS_LABEL=after npx playwright test ...
		//   main HEAD で撮影: SS_LABEL=before npx playwright test ...
		const label = process.env.SS_LABEL ?? 'after';
		const fileName = `${label}-admin-activities-delete-${projectName}.png`;

		await page.screenshot({
			path: path.join(OUT_DIR, fileName),
			fullPage: true,
		});
	});
});
