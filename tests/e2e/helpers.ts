// tests/e2e/helpers.ts
// E2E テスト共通ヘルパー — data-testid ベースの堅牢なセレクタ

import { expect } from '@playwright/test';

type Page = import('@playwright/test').Page;

// ============================================================
// 環境判定
// ============================================================

/** AWS 環境で実行中かどうか（playwright.aws.config.ts 経由） */
export function isAwsEnv(): boolean {
	const baseUrl = process.env.E2E_BASE_URL ?? '';
	return baseUrl.includes('ganbari-quest.com') || baseUrl.includes('amazonaws.com');
}

/** ローカル環境で実行中かどうか */
export function isLocalEnv(): boolean {
	return !isAwsEnv();
}

// ============================================================
// 子供選択
// ============================================================

/** 最初の子供を選択してホーム画面に遷移 */
export async function selectChild(page: Page) {
	await page.goto('/switch');
	const childButton = page.locator('[data-testid^="child-select-"]').first();
	await expect(childButton).toBeVisible();
	await childButton.click();
	await page.waitForURL(/\/(kinder|baby|lower|upper|teen)\/home/);
}

/** 指定の子供を名前で選択してホーム画面に遷移 */
export async function selectChildByName(page: Page, name: string) {
	await page.goto('/switch');
	const childButton = page.locator('[data-testid^="child-select-"]').filter({ hasText: name });
	await expect(childButton).toBeVisible();
	await childButton.click();
	await page.waitForURL(/\/(kinder|baby|lower|upper|teen)\/home/);
}

/** ゆうきちゃん(kinder)を選択 */
export async function selectKinderChild(page: Page) {
	await selectChildByName(page, 'ゆうきちゃん');
}

/** てすとくん(baby)を選択 */
export async function selectBabyChild(page: Page) {
	await selectChildByName(page, 'てすとくん');
}

// ============================================================
// オーバーレイ dismiss
// ============================================================

/** ログインボーナスのおみくじ・誕生日レビュー・各種オーバーレイを閉じる */
export async function dismissOverlays(page: Page) {
	// AWS 環境ではログインボーナス API（Lambda cold start）に時間がかかるため、
	// おみくじオーバーレイが遅延表示される。networkidle で API 完了を待つ。
	if (isAwsEnv()) {
		await page.waitForLoadState('networkidle').catch(() => {});
		// クライアント JS がハイドレーション完了し $effect が発火するまで追加待機
		await page.waitForTimeout(2000);
	}

	// スタンプ押印オーバーレイ or おみくじオーバーレイを閉じる（AWS: 遅延表示対策で長めに待機）
	const overlayTimeout = isAwsEnv() ? 8000 : 3000;
	try {
		// 新: スタンプ押印オーバーレイ
		const stampOverlay = page.getByTestId('stamp-press-overlay');
		const omikujiText = page.getByText('きょうのうんせい');
		const stampBtn = page.getByRole('button', { name: /やったね/ });
		const omikujiBtn = page.getByRole('button', { name: /タップしてすすむ/ });

		// どちらかが表示されるのを待つ
		await Promise.race([
			stampOverlay.waitFor({ timeout: overlayTimeout }),
			omikujiText.waitFor({ timeout: overlayTimeout }),
		]);

		// スタンプ演出の場合
		if (await stampBtn.isVisible().catch(() => false)) {
			await stampBtn.click();
			await page.waitForTimeout(500);
		}
		// おみくじの場合（レガシー互換）
		else if (await omikujiBtn.isVisible().catch(() => false)) {
			await omikujiBtn.click();
			await page.waitForTimeout(500);
		}
	} catch {
		// オーバーレイが表示されなかった場合（既に受領済み or 未対応）
	}

	// 特別報酬や汎用オーバーレイを閉じる
	// ダイアログ内のボタンのみ対象にし、ページ上の別ボタンを誤クリックしない
	for (let i = 0; i < 3; i++) {
		await page.waitForTimeout(200);
		try {
			const closeBtn = page
				.locator('[data-scope="dialog"][data-state="open"]')
				.getByRole('button', { name: /とじる|閉じる|OK|やったー/ });
			if (await closeBtn.isVisible().catch(() => false)) {
				await closeBtn.click();
				await page.waitForTimeout(200);
			} else {
				break;
			}
		} catch {
			break;
		}
	}

	// 最終クリーンアップ: Ark UI Dialog の残骸を処理する
	// AWS 環境では SSR→ハイドレーション遷移時にダイアログが data-state="open" のまま
	// display: none になり、body に pointer-events: none が残留してクリックが効かなくなる
	for (let i = 0; i < 5; i++) {
		const hasOpenDialog = await page
			.evaluate(() => {
				return !!document.querySelector(
					'[data-scope="dialog"][data-part="backdrop"][data-state="open"]',
				);
			})
			.catch(() => false);

		if (!hasOpenDialog) break;

		// closable=true のダイアログは Escape で閉じる
		await page.keyboard.press('Escape');
		await page.waitForTimeout(300);

		// closable=false のダイアログ（おみくじ等）はボタンクリックで閉じる
		// ダイアログ内のボタンのみ対象
		const dialogBtn = page.locator('[data-scope="dialog"][data-state="open"] button').filter({
			hasText: /タップしてすすむ|やったね！|とじる|閉じる|OK|やったー/,
		});
		if (
			await dialogBtn
				.first()
				.isVisible()
				.catch(() => false)
		) {
			await dialogBtn.first().click();
			await page.waitForTimeout(300);
		}
	}

	// Ark UI Dialog のゴースト要素を強制非表示
	await clearDialogGhosts(page);
}

/** 子供を選択してオーバーレイを閉じた状態にする */
export async function selectChildAndDismiss(page: Page) {
	await selectChild(page);
	await dismissOverlays(page);
}

/** ゆうきちゃん(kinder)を選択してオーバーレイを閉じた状態にする */
export async function selectKinderChildAndDismiss(page: Page) {
	await selectKinderChild(page);
	await dismissOverlays(page);
}

// ============================================================
// Dialog ゴースト要素クリーンアップ
// ============================================================

/** Ark UI Dialog のゴースト positioner を強制非表示にする */
export async function clearDialogGhosts(page: Page) {
	await page.evaluate(() => {
		document.body.style.pointerEvents = '';
		document.body.style.overflow = '';
		for (const el of document.querySelectorAll('[data-scope="dialog"][data-part="positioner"]')) {
			const htmlEl = el as HTMLElement;
			// aria-hidden="true" や data-state="closed" なら完全に閉じたダイアログ → 非表示
			const ariaHidden = el.getAttribute('aria-hidden') === 'true';
			const stateClosed = el.getAttribute('data-state') === 'closed';
			const content = el.querySelector('[data-part="content"]');
			const contentHidden = !content || window.getComputedStyle(content).display === 'none';
			if (ariaHidden || stateClosed || contentHidden) {
				htmlEl.style.display = 'none';
			}
		}
	});
}

// ============================================================
// カテゴリ展開（compactMode 対応）
// ============================================================

/** compactMode で折りたたまれた最初のカテゴリを展開する */
export async function expandFirstCategory(page: Page) {
	// Ark UI Dialog のゴースト positioner が残留してクリックをブロックすることがある
	await clearDialogGhosts(page);

	const header = page.locator('[data-testid^="category-header-"]').first();
	if (await header.isVisible().catch(() => false)) {
		const cards = page.locator('[data-testid^="activity-card-"]');
		const cardVisible = await cards
			.first()
			.isVisible()
			.catch(() => false);
		if (!cardVisible) {
			// JS evaluate で直接クリック（ダイアログゴースト/BottomNav の干渉を回避）
			await header.evaluate((el) => el.click());
			await page.waitForTimeout(300);
		}
	}
}

/** compactMode で折りたたまれた全カテゴリを展開する */
export async function expandAllCategories(page: Page) {
	await clearDialogGhosts(page);

	const headers = page.locator('[data-testid^="category-header-"]');
	const count = await headers.count();
	for (let i = 0; i < count; i++) {
		// JS evaluate で直接クリック（ダイアログゴースト/BottomNav の干渉を回避）
		await headers.nth(i).evaluate((el) => el.click());
		// アニメーション完了を待つ（固定waitではなく最小限）
		await page.waitForTimeout(100);
	}
}

// ============================================================
// 活動カード — data-testid ベースのセレクタ
// ============================================================

/** 未記録の活動カードを取得（data-testid="activity-card-*" かつ disabled でないボタン） */
export function getAvailableActivities(page: Page) {
	return page.locator('button[data-testid^="activity-card-"]:not([disabled])');
}

/** 全ての活動カード（完了済み含む） */
export function getAllActivityCards(page: Page) {
	return page.locator('[data-testid^="activity-card-"]');
}

// ============================================================
// 活動記録フロー
// ============================================================

/** 未記録の活動を記録する（並列テストの競合対策で複数リトライ） */
export async function recordAnyActivity(page: Page): Promise<boolean> {
	// compactMode でカテゴリが折りたたまれている場合は展開する
	await expandFirstCategory(page);

	const activities = getAvailableActivities(page);
	const count = await activities.count();

	for (let i = 0; i < Math.min(count, 10); i++) {
		await activities.nth(i).click();

		// 確認ダイアログが出るのを待つ
		try {
			const dialog = page.locator('[data-testid="confirm-dialog"]');
			await dialog.waitFor({ timeout: 2000 });
		} catch {
			continue;
		}

		await page.locator('[data-testid="confirm-record-btn"]').click();

		// 記録成功の結果オーバーレイを待つ
		try {
			await page.getByText(/きろくしたよ！/).waitFor({ timeout: 2000 });
			return true;
		} catch {
			// ALREADY_RECORDED — 次の活動へ
			await page
				.locator('[data-testid="confirm-dialog"]')
				.waitFor({ state: 'hidden', timeout: 1000 })
				.catch(() => {});
		}
	}
	return false;
}
