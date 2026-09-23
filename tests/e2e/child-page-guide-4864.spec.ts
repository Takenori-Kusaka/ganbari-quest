// tests/e2e/child-page-guide-4864.spec.ts
//
// #4864 (PO 決裁 2026-09-23 案 1): 子供の ❓ は **押した画面について説明する**。
//
// 旧実装は、どの子供画面で ❓ を押しても固定 5 step のホームのツアーを開いた
// (実測: /checklist で ❓ → 1/5、step 1 = 活動カード / spotlightRing 0、5 step のどれも
// チェックリストを説明しない)。本 spec は実ブラウザで次を固定する:
//
//   [P] チェックリスト / ショップ / つよさ(ステータス) の ❓ は、その画面の章 (1〜3 step) を開く。
//       ホームの step (活動カード / スタンプ / 下ナビ) は 1 つも出ない
//   [T] selector を持つ step は実要素に spotlight する (中央 fallback で成立させない、#4652 と同じ基準)
//   [M] 文言は年齢帯 variant (preschool / elementary = ひらがな、junior / senior = 漢字)
//   [N] 説明を持たない画面 (きろく / チャレンジ / バトル) では ❓ を出さない
//   [W] 画面を移ると ❓ の中身も移る (クライアント遷移でも、ガイドを開いたままの「戻る」でも)
//
// tablet (1280×800) と mobile (Pixel 7) の両 project で走る (レイアウトが違うため)。
//
// 実行: npx playwright test tests/e2e/child-page-guide-4864.spec.ts

import { expect, type Locator, type Page, test } from '@playwright/test';
import { getChildPageGuideLabels } from '../../src/lib/domain/labels';

type Mode = 'preschool' | 'elementary' | 'junior' | 'senior';

/** E2E seed (`tests/e2e/global-setup.ts`) の子供のニックネーム。 */
const NICKNAME: Record<Mode, string> = {
	preschool: 'たろうくん',
	elementary: 'けんたくん',
	junior: 'ゆうこちゃん',
	senior: 'まさとくん',
};

/** ホームのツアーの step (ホーム以外の ❓ で出たら #4864 の退行)。 */
const HOME_STEP_IDS = [
	'child-record-card',
	'child-record-cancel',
	'child-daily-stamp',
	'child-nav-status',
	'child-nav-shop',
];

const KANJI = /[一-鿿]/;

const helpBtn = (page: Page) => page.locator('[data-testid="header-help-btn"]');

/** /switch からニックネームで子供を選び、その子のホームに着く。 */
async function selectChild(page: Page, mode: Mode) {
	let lastError: unknown;
	for (let attempt = 0; attempt < 3; attempt++) {
		try {
			await page.goto('/switch', { waitUntil: 'domcontentloaded' });
			const button = page
				.locator('[data-testid^="child-select-"]', { hasText: NICKNAME[mode] })
				.first();
			await button.waitFor({ state: 'visible', timeout: 20_000 });
			await button.click({ timeout: 20_000 });
			await page.waitForURL(new RegExp(`/${mode}(/|$)`), { timeout: 20_000 });
			return;
		} catch (err) {
			lastError = err;
		}
	}
	throw lastError instanceof Error ? lastError : new Error(`selectChild(${mode}) failed`);
}

/**
 * 子供画面に自動で開く dialog (保護者向けおやカギ案内等) がガイドの操作を遮らないようにする。
 * ガイド自身の dialog (再開 / 終了確認) は遮らない。
 */
async function neutralizeAutoDialogs(page: Page) {
	const pinGate = page.getByTestId('pin-gate-onboarding-close');
	if (await pinGate.isVisible({ timeout: 500 }).catch(() => false)) {
		await pinGate.click({ force: true, timeout: 2_000 }).catch(() => {});
	}
	await page.addStyleTag({
		content: `
			[data-scope="dialog"][data-part="positioner"],
			[data-scope="dialog"][data-part="backdrop"],
			[data-scope="dialog"][data-part="content"],
			.parent-message-overlay {
				pointer-events: none !important;
			}
			[data-testid="tutorial-resume-dialog"],
			[data-testid="tutorial-resume-dialog"] *,
			[data-testid="tutorial-exit-confirm-dialog"],
			[data-testid="tutorial-exit-confirm-dialog"] * {
				pointer-events: auto !important;
			}
		`,
	});
}

/** 子供画面を開いて、❓ を押せる状態にする (前回の途中進捗は消す)。 */
async function openChildPage(page: Page, path: string) {
	await page.goto(path, { waitUntil: 'domcontentloaded' });
	await page
		.locator('[data-testid="header-balance"]')
		.waitFor({ state: 'visible', timeout: 20_000 });
	await neutralizeAutoDialogs(page);
	await page.evaluate(() => {
		for (const key of Object.keys(localStorage)) {
			if (key.startsWith('tutorial-progress')) localStorage.removeItem(key);
		}
	});
}

/**
 * ❓ を押してガイドを開く。hydration 直後の click 取りこぼしに備えて 3 回まで押し直す
 * (child-tutorial-verification.spec.ts と同じ理由で dispatchEvent を使う)。
 */
async function openGuide(page: Page) {
	await expect(helpBtn(page)).toBeVisible({ timeout: 10_000 });
	for (let attempt = 0; attempt < 3; attempt++) {
		await helpBtn(page).dispatchEvent('click');
		try {
			await page.waitForFunction(
				() => document.documentElement.hasAttribute('data-tutorial-active'),
				null,
				{ timeout: 3_000 },
			);
			break;
		} catch {
			// 押し直す
		}
	}
	await expect(page.locator('.tutorial-bubble')).toBeVisible({ timeout: 10_000 });
}

async function waitForBubbleAnimations(bubble: Locator) {
	await bubble.evaluate((el) =>
		Promise.all(
			(el as HTMLElement).getAnimations({ subtree: true }).map((a) => a.finished.catch(() => {})),
		),
	);
}

interface VisitedStep {
	id: string;
	title: string;
	description: string;
	hasTarget: boolean;
}

/**
 * 開いているガイドを最後まで進め、訪れた step を返す。
 * selector を持つ step は実要素に spotlight していること (中央 fallback でない) も確かめる。
 */
async function walkGuide(page: Page, ctx: string): Promise<VisitedStep[]> {
	const visited: VisitedStep[] = [];
	for (let i = 0; i < 6; i++) {
		const bubble = page.locator('.tutorial-bubble');
		await bubble.waitFor({ state: 'visible', timeout: 10_000 });
		await waitForBubbleAnimations(bubble);
		await expect(page.locator('.tutorial-bubble'), `${ctx}: bubble は 1 つだけ`).toHaveCount(1);

		const step: VisitedStep = {
			id: (await bubble.getAttribute('data-step-id')) ?? '',
			title: ((await bubble.locator('.tutorial-title').textContent()) ?? '').trim(),
			description: ((await bubble.locator('.tutorial-description').textContent()) ?? '').trim(),
			hasTarget: (await bubble.getAttribute('data-has-target')) === 'true',
		};
		visited.push(step);

		if (step.hasTarget) {
			await expect(
				page.locator('.tutorial-overlay'),
				`${ctx} / ${step.id}: 対象要素に spotlight する (中央 fallback でない)`,
			).toHaveAttribute('data-tutorial-target', 'resolved', { timeout: 10_000 });
			const ring = await page.locator('.tutorial-spotlight-ring').boundingBox();
			expect(ring, `${ctx} / ${step.id}: spotlight ring が描かれる`).not.toBeNull();
			expect(ring?.width ?? 0, `${ctx} / ${step.id}: spotlight 幅 > 0`).toBeGreaterThan(0);
			expect(ring?.height ?? 0, `${ctx} / ${step.id}: spotlight 高 > 0`).toBeGreaterThan(0);
		}

		// バブルが画面の横幅に収まる
		const box = await bubble.boundingBox();
		const viewport = page.viewportSize();
		expect(box, `${ctx} / ${step.id}: バブルが描画される`).not.toBeNull();
		if (box && viewport) {
			expect(box.x, `${ctx} / ${step.id}: バブル左端`).toBeGreaterThanOrEqual(0);
			expect(box.x + box.width, `${ctx} / ${step.id}: バブル右端`).toBeLessThanOrEqual(
				viewport.width,
			);
		}

		const progress = ((await bubble.locator('.tutorial-progress-text').textContent()) ?? '').trim();
		const [current, total] = progress.split('/').map((s) => Number.parseInt(s.trim(), 10));
		await bubble.locator('.tutorial-nav-next').click();
		if (current === total) {
			await expect(page.locator('.tutorial-overlay'), `${ctx}: 最後の step で閉じる`).toBeHidden({
				timeout: 5_000,
			});
			return visited;
		}
	}
	throw new Error(`${ctx}: 6 step を超えても終わらない (1 画面 1〜3 step のはず)`);
}

/** ホーム以外の画面の章として正しいか (step 数 / ホームの step が混ざらない / 年齢帯の表記)。 */
function expectPageChapter(visited: VisitedStep[], mode: Mode, ctx: string) {
	expect(visited.length, `${ctx}: 1〜3 step`).toBeGreaterThanOrEqual(1);
	expect(visited.length, `${ctx}: 1〜3 step`).toBeLessThanOrEqual(3);
	for (const step of visited) {
		expect(HOME_STEP_IDS, `${ctx}: ホームのツアーの step が出ている`).not.toContain(step.id);
		if (mode === 'preschool' || mode === 'elementary') {
			expect(KANJI.test(step.title + step.description), `${ctx} / ${step.id}: 漢字が混ざる`).toBe(
				false,
			);
		} else {
			expect(KANJI.test(step.description), `${ctx} / ${step.id}: 漢字表記になっていない`).toBe(
				true,
			);
		}
	}
}

const MODES: Mode[] = ['preschool', 'elementary', 'junior', 'senior'];

test.describe('#4864 子供の ❓ は押した画面の説明を開く', () => {
	test.setTimeout(240_000);

	for (const mode of MODES) {
		test(`${mode}: チェックリスト / ショップ / つよさ は自分の章、ほかの画面は ❓ なし`, async ({
			page,
		}) => {
			const L = getChildPageGuideLabels(mode);
			await selectChild(page, mode);

			// ---- チェックリスト ----
			await openChildPage(page, '/checklist');
			const itemCount = await page.locator('[data-tutorial="checklist-item"]').count();
			if (mode === 'preschool') {
				// seed で項目を持つ子。spotlight する経路を必ず 1 度は通す (空振りで緑にしない)
				expect(itemCount, 'preschool にはチェック項目が seed されている').toBeGreaterThan(0);
			}
			await openGuide(page);
			const checklist = await walkGuide(page, `${mode} /checklist`);
			expectPageChapter(checklist, mode, `${mode} /checklist`);
			if (itemCount > 0) {
				expect(checklist.map((s) => s.id)).toEqual([
					'child-checklist-check',
					'child-checklist-points',
				]);
				expect(checklist.every((s) => s.hasTarget)).toBe(true);
				expect(checklist[0]?.title).toBe(L.checklistCheckTitle);
			} else {
				// 項目が無い画面では項目を指さず「まだ ないよ」
				expect(checklist.map((s) => s.id)).toEqual(['child-checklist-empty']);
				expect(checklist[0]?.hasTarget).toBe(false);
				expect(checklist[0]?.description).toBe(L.checklistEmptyDesc);
			}

			// ---- ショップ ----
			await openChildPage(page, `/${mode}/shop`);
			const rewardCount = await page.locator('[data-tutorial="shop-reward-card"]').count();
			if (mode === 'preschool') {
				expect(rewardCount, 'preschool にはごほうびが seed されている').toBeGreaterThan(0);
			}
			await openGuide(page);
			const shop = await walkGuide(page, `${mode} /shop`);
			expectPageChapter(shop, mode, `${mode} /shop`);
			if (rewardCount > 0) {
				expect(shop.map((s) => s.id)).toEqual(['child-shop-exchange', 'child-shop-history']);
				expect(shop.every((s) => s.hasTarget)).toBe(true);
				expect(shop[0]?.description).toBe(L.shopExchangeDesc);
			} else {
				expect(shop.map((s) => s.id)).toEqual(['child-shop-empty', 'child-shop-history']);
				expect(shop[0]?.hasTarget).toBe(false);
				expect(shop[1]?.hasTarget).toBe(true);
			}

			// ---- つよさ / ステータス (全員 seed でステータスを持つ) ----
			await openChildPage(page, `/${mode}/status`);
			await expect(page.locator('[data-tutorial="status-growth"]')).toBeVisible();
			await openGuide(page);
			const status = await walkGuide(page, `${mode} /status`);
			expectPageChapter(status, mode, `${mode} /status`);
			expect(status.map((s) => s.id)).toEqual(['child-status-growth', 'child-status-level']);
			expect(status.every((s) => s.hasTarget)).toBe(true);
			expect(status[0]?.title).toBe(L.statusGrowthTitle);
			expect(status[0]?.description).toBe(L.statusGrowthDesc);

			// ---- 説明を持たない画面では ❓ を出さない ----
			const noGuidePaths = [`/${mode}/history`, `/${mode}/challenges`];
			// バトルは elementary 以上だけ (preschool は route 側で出さない)
			if (mode !== 'preschool') noGuidePaths.push(`/${mode}/battle`);
			for (const path of noGuidePaths) {
				await page.goto(path, { waitUntil: 'domcontentloaded' });
				await page
					.locator('[data-testid="header-balance"]')
					.waitFor({ state: 'visible', timeout: 20_000 });
				await expect(helpBtn(page), `${path}: ❓ を出さない`).toHaveCount(0);
			}
		});
	}

	test('elementary: 画面を移ると ❓ の中身も移る (クライアント遷移 / ガイド中の「戻る」)', async ({
		page,
	}) => {
		await selectChild(page, 'elementary');
		await openChildPage(page, '/elementary/status');

		// つよさ → (タブ) きろく: ❓ が消える
		await expect(helpBtn(page)).toBeVisible();
		await page.getByTestId('character-tab-history').click();
		await page.waitForURL(/\/elementary\/history/);
		await expect(helpBtn(page), 'きろくには ❓ を出さない').toHaveCount(0);

		// (タブ) つよさ に戻ると ❓ が戻り、つよさの章を開く
		await page.getByTestId('character-tab-status').click();
		await page.waitForURL(/\/elementary\/status/);
		await openGuide(page);
		await expect(page.locator('.tutorial-bubble')).toHaveAttribute(
			'data-step-id',
			'child-status-growth',
		);
		await page.locator('.tutorial-bubble .tutorial-nav-end').click();
		await expect(page.locator('.tutorial-overlay')).toBeHidden();

		// 下ナビでチェックリストへ (クライアント遷移)。❓ はホームのツアーではなくチェックリストの章
		await page.getByTestId('bottom-nav').getByTestId('nav-checklist').click();
		await page.waitForURL(/\/checklist/);
		await openGuide(page);
		const firstId = await page.locator('.tutorial-bubble').getAttribute('data-step-id');
		expect(firstId, '/checklist の ❓ がチェックリストの章を開く').toMatch(/^child-checklist-/);

		// ガイドを開いたまま「戻る」: 前の画面の章を別の画面の上に出し続けない
		await page.goBack();
		await page.waitForURL(/\/elementary\/status/);
		await expect(page.locator('.tutorial-overlay'), '画面が変わったらガイドを閉じる').toBeHidden({
			timeout: 5_000,
		});
		// 戻った先の ❓ はその画面 (つよさ) の章
		await openGuide(page);
		await expect(page.locator('.tutorial-bubble')).toHaveAttribute(
			'data-step-id',
			'child-status-growth',
		);
	});
});
