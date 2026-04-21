// tests/e2e/helpers.ts
// E2E テスト共通ヘルパー — data-testid ベースの堅牢なセレクタ

import { expect } from '@playwright/test';

type Page = import('@playwright/test').Page;

// ============================================================
// 環境判定
// ============================================================

/** AWS 環境で実行中かどうか（playwright.aws.config.ts 経由）
 *
 * #1386: `.includes()` による部分一致は URL の位置を検証せず、
 * `https://evil.com/ganbari-quest.com/` や `https://ganbari-quest.com.attacker.com/`
 * のような suffix / path 攻撃を誤って true と判定してしまう
 * (CodeQL js/incomplete-url-substring-sanitization, severity:high)。
 * `new URL()` で hostname を取り出し、完全一致 / サブドメイン一致で判定する。
 */
export function isAwsEnv(): boolean {
	const baseUrl = process.env.E2E_BASE_URL ?? '';
	if (!baseUrl) return false;
	try {
		const host = new URL(baseUrl).hostname.toLowerCase();
		return (
			host === 'ganbari-quest.com' ||
			host.endsWith('.ganbari-quest.com') ||
			host.endsWith('.amazonaws.com')
		);
	} catch {
		return false;
	}
}

/** ローカル環境で実行中かどうか */
export function isLocalEnv(): boolean {
	return !isAwsEnv();
}

// ============================================================
// cron エンドポイント
// ============================================================

/** cron エンドポイント用ヘッダーを返す（CRON_SECRET 設定時のみ x-cron-secret を含む） */
export function getCronHeaders(): Record<string, string> {
	const cronSecret = process.env.CRON_SECRET;
	return cronSecret ? { 'x-cron-secret': cronSecret } : {};
}

/** cron 認証がスキップされる環境か判定（CRON_SECRET 未設定 + AUTH_MODE=local） */
export function isCronAuthSkipped(): boolean {
	return !process.env.CRON_SECRET && (process.env.AUTH_MODE === 'local' || !process.env.AUTH_MODE);
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
	await page.waitForURL(/\/(baby|preschool|elementary|junior|senior)\/home/);
}

/** 指定の子供を名前で選択してホーム画面に遷移 */
export async function selectChildByName(page: Page, name: string) {
	await page.goto('/switch');
	const childButton = page.locator('[data-testid^="child-select-"]').filter({ hasText: name });
	await expect(childButton).toBeVisible();
	await childButton.click();
	await page.waitForURL(/\/(baby|preschool|elementary|junior|senior)\/home/);
}

/** たろうくん(preschool)を選択 */
export async function selectKinderChild(page: Page) {
	await selectChildByName(page, 'たろうくん');
}

/** はなこちゃん(baby)を選択 */
export async function selectBabyChild(page: Page) {
	await selectChildByName(page, 'はなこちゃん');
}

/** けんたくん(elementary)を選択 */
export async function selectElementaryChild(page: Page) {
	await selectChildByName(page, 'けんたくん');
}

/** ゆうこちゃん(junior)を選択 */
export async function selectJuniorChild(page: Page) {
	await selectChildByName(page, 'ゆうこちゃん');
}

/** まさとくん(senior)を選択 */
export async function selectSeniorChild(page: Page) {
	await selectChildByName(page, 'まさとくん');
}

// ============================================================
// オーバーレイ dismiss
// ============================================================

/** ログインボーナスのおみくじ・誕生日レビュー・各種オーバーレイを閉じる */
export async function dismissOverlays(page: Page) {
	// AWS 環境ではログインボーナス API（Lambda cold start）に時間がかかるため、
	// おみくじオーバーレイが遅延表示される。クライアント JS がハイドレーション完了し
	// $effect が発火するまで待機（activity-card / bottom-nav / omikuji-overlay のいずれか）
	if (isAwsEnv()) {
		await page
			.locator(
				'[data-testid^="activity-card-"], [data-testid="bottom-nav"], [data-testid="omikuji-stamp-overlay"]',
			)
			.first()
			.waitFor({ state: 'visible', timeout: 10000 })
			.catch(() => {});
	}

	// おみくじ統合スタンプオーバーレイを閉じる（AWS: 遅延表示対策で長めに待機）
	const overlayTimeout = isAwsEnv() ? 8000 : 3000;
	try {
		const stampOverlay = page.getByTestId('omikuji-stamp-overlay');
		const closeBtn = page.getByTestId('login-bonus-confirm');

		// オーバーレイが表示されるのを待つ
		await stampOverlay.waitFor({ timeout: overlayTimeout });

		// フェーズが進むまで「やったね！」ボタンの出現を待つ（shake → result → stamp）
		// 旧: waitForTimeout(3500) → ボタンの実際の出現を検知
		await closeBtn.waitFor({ state: 'visible', timeout: 8000 }).catch(() => {});

		// 「やったね！」ボタンで閉じる
		if (await closeBtn.isVisible().catch(() => false)) {
			await closeBtn.click();
			// ダイアログが閉じるのを待つ
			await stampOverlay.waitFor({ state: 'hidden', timeout: 3000 }).catch(() => {});
		}
	} catch {
		// オーバーレイが表示されなかった場合（既に受領済み or 未対応）
	}

	// 特別報酬や汎用オーバーレイを閉じる
	// ダイアログ内のボタンのみ対象にし、ページ上の別ボタンを誤クリックしない
	for (let i = 0; i < 3; i++) {
		try {
			const openDialog = page.locator('[data-scope="dialog"][data-state="open"]');
			// ダイアログが存在するか短いタイムアウトで確認
			const dialogExists = await openDialog
				.first()
				.isVisible()
				.catch(() => false);
			if (!dialogExists) break;

			const closeBtn = openDialog.getByRole('button', {
				name: /とじる|閉じる|OK|やったー/,
			});
			if (await closeBtn.isVisible().catch(() => false)) {
				await closeBtn.click();
				// ダイアログが閉じるのを待つ
				await openDialog
					.first()
					.waitFor({ state: 'hidden', timeout: 2000 })
					.catch(() => {});
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
		// Escape 後のダイアログ状態変化を待つ
		await page
			.locator('[data-scope="dialog"][data-part="backdrop"][data-state="open"]')
			.first()
			.waitFor({ state: 'hidden', timeout: 1000 })
			.catch(() => {});

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
			// ボタンクリック後のダイアログ状態変化を待つ
			await page
				.locator('[data-scope="dialog"][data-part="backdrop"][data-state="open"]')
				.first()
				.waitFor({ state: 'hidden', timeout: 1000 })
				.catch(() => {});
		}
	}

	// 月替わりプレゼントオーバーレイを閉じる（Ark UI Dialog ではないため最後に処理）
	const giftBtn = page.locator('.reward-gift__open-btn');
	if (await giftBtn.isVisible().catch(() => false)) {
		await giftBtn.click();
		const claimBtn = page.locator('.reward-reveal__btn');
		await claimBtn.waitFor({ timeout: 2000 }).catch(() => {});
		if (await claimBtn.isVisible().catch(() => false)) {
			await claimBtn.click();
		}
		await page
			.locator('.reward-overlay')
			.waitFor({ state: 'hidden', timeout: 3000 })
			.catch(() => {});
	}
}

/** 子供を選択してオーバーレイを閉じた状態にする */
export async function selectChildAndDismiss(page: Page) {
	await selectChild(page);
	await dismissOverlays(page);
}

/** たろうくん(preschool)を選択してオーバーレイを閉じた状態にする */
export async function selectKinderChildAndDismiss(page: Page) {
	await selectKinderChild(page);
	await dismissOverlays(page);
}

/** けんたくん(elementary)を選択してオーバーレイを閉じた状態にする */
export async function selectElementaryChildAndDismiss(page: Page) {
	await selectElementaryChild(page);
	await dismissOverlays(page);
}

/** ゆうこちゃん(junior)を選択してオーバーレイを閉じた状態にする */
export async function selectJuniorChildAndDismiss(page: Page) {
	await selectJuniorChild(page);
	await dismissOverlays(page);
}

/** まさとくん(senior)を選択してオーバーレイを閉じた状態にする */
export async function selectSeniorChildAndDismiss(page: Page) {
	await selectSeniorChild(page);
	await dismissOverlays(page);
}

// ============================================================
// カテゴリ展開（compactMode 対応）
// ============================================================

/** compactMode で折りたたまれた最初のカテゴリを展開する */
export async function expandFirstCategory(page: Page) {
	const header = page.locator('[data-testid^="category-header-"]').first();
	if (await header.isVisible().catch(() => false)) {
		const cards = page.locator('[data-testid^="activity-card-"]');
		const cardVisible = await cards
			.first()
			.isVisible()
			.catch(() => false);
		if (!cardVisible) {
			// JS evaluate で直接クリック（ダイアログゴースト/BottomNav の干渉を回避）
			await header.evaluate((el) => (el as HTMLElement).click());
			// カードが表示されるのを待つ
			await cards
				.first()
				.waitFor({ state: 'visible', timeout: 2000 })
				.catch(() => {});
		}
	}
}

/** 折りたたまれたカテゴリを全て展開する（冪等 — 既に展開済みなら何もしない） */
export async function expandAllCategories(page: Page) {
	const headers = page.locator('[data-testid^="category-header-"]');
	const count = await headers.count();
	for (let i = 0; i < count; i++) {
		const header = headers.nth(i);
		// 親 <section> 内に activity-card があれば既に展開済み → スキップ
		const section = header.locator('..');
		const hasCards = await section
			.locator('[data-testid^="activity-card-"]')
			.first()
			.isVisible()
			.catch(() => false);
		if (!hasCards) {
			await header.evaluate((el) => (el as HTMLElement).click());
			// 展開アニメーション後にカードが表示されるのを待つ
			await section
				.locator('[data-testid^="activity-card-"]')
				.first()
				.waitFor({ state: 'visible', timeout: 2000 })
				.catch(() => {});
		}
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
	// 月替わりプレゼントなどのモーダルオーバーレイが表示されている場合は閉じる
	await dismissOverlays(page);

	// compactMode でカテゴリが折りたたまれている場合は展開する
	await expandFirstCategory(page);

	const activities = getAvailableActivities(page);
	const count = await activities.count();

	for (let i = 0; i < Math.min(count, 10); i++) {
		await dismissOverlays(page);
		await activities
			.nth(i)
			.waitFor({ state: 'visible', timeout: 3000 })
			.catch(() => {});
		await activities.nth(i).click();

		// 確認ダイアログが出るのを待つ
		try {
			const dialog = page.locator('[data-testid="confirm-dialog"]');
			await dialog.waitFor({ timeout: 2000 });
		} catch {
			continue;
		}

		await page.locator('[data-testid="confirm-record-btn"]').click();

		// 記録成功の結果ダイアログを待つ（テキスト + ボタンの両方が揃うまで）
		try {
			await page.getByText(/きろくしたよ！/).waitFor({ timeout: 3000 });
			// 結果ダイアログ内のボタンが完全にレンダリングされるまで待機
			await page
				.getByTestId('activity-confirm-btn')
				.or(page.getByTestId('login-bonus-confirm'))
				.first()
				.waitFor({ timeout: 3000 });
			return true;
		} catch {
			// ALREADY_RECORDED or ダイアログ未表示 — 次の活動へ
			await page
				.locator('[data-testid="confirm-dialog"]')
				.waitFor({ state: 'hidden', timeout: 1000 })
				.catch(() => {});
			// 結果ダイアログが中途半端に開いていれば閉じる
			const confirmBtn = page.getByTestId('activity-confirm-btn');
			if (await confirmBtn.isVisible({ timeout: 500 }).catch(() => false)) {
				await confirmBtn.click();
				// ダイアログが閉じるのを待つ
				await page
					.locator('[data-testid="confirm-dialog"]')
					.waitFor({ state: 'hidden', timeout: 1000 })
					.catch(() => {});
			}
		}
	}
	return false;
}
