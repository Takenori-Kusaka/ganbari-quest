// tests/e2e/page-guide-screenshots.spec.ts
// #2926 / #2930 QM Re-BLOCK fix: PageGuide (driver.js 委譲) の "settled 状態" SS 撮影専用 spec。
//
// 通常 CI には含めず (SS_LABEL 未設定なら BASE_TEST_IGNORE で除外)、
//   SS_LABEL=after  npx playwright test tests/e2e/page-guide-screenshots.spec.ts --project=tablet
//   SS_LABEL=before npx playwright test tests/e2e/page-guide-screenshots.spec.ts --project=tablet
// で手動実行する。After = PR HEAD で撮影、Before = origin/main build で撮影 (別 worktree)。
//
// QM Re-BLOCK 1 (settled でない SS) の根治:
//   driver.js の popover は `animate:true` で `.driver-fade .driver-popover { animation: animate-fade-in .2s }`
//   (opacity 0→1)、加えて Svelte 側 `.guide-bubble { animation: guide-bubble-appear .3s }` (opacity 0→1)、
//   さらに spotlight ring は `page-guide-ring-pulse 1.8s infinite` で常時 pulse する。
//   rAF×2 (~32ms) で撮ると bubble が半透明 (混濁) + ring が任意 pulse 位相で写る。
//   本 spec は以下の二重防御で "完全描画 / 不透明 / 静止" の settled 状態のみを撮影する:
//     1. test-only stylesheet を inject し popover / overlay / bubble / active-element の
//        animation・transition を無効化 + opacity:1 を強制 (production code は不変)。
//     2. waitForFunction で bubble の computed opacity===1 + box 安定を待ち、screenshot は
//        `animations:'disabled'` で撮る。撮影前に DOM/style を assert (不透明・viewport 内・非重複)。

import * as fs from 'node:fs';
import * as path from 'node:path';
import { expect, type Page, test } from '@playwright/test';

const PR = process.env.SS_PR ?? '2930';
const OUT_DIR = path.join(process.cwd(), 'tmp', 'screenshots', `pr-${PR}`);
const LABEL = process.env.SS_LABEL === 'before' ? 'before' : 'after';

const GUIDE_BTN = '[data-tutorial="page-guide-btn"]';
const GUIDE_BUBBLE = '.guide-bubble';
const GUIDE_NEXT = '.guide-nav-next';

// QM 指摘の 2 代表ページ: activities = PO 実機指摘の起点 / status = 大 target step を含む。
const PAGES = [
	{ path: '/admin/activities', slug: 'admin-activities', steps: 3 },
	{ path: '/admin/status', slug: 'admin-status', steps: 2 },
] as const;

const VIEWPORTS = [
	{ label: 'desktop', width: 1280, height: 800 },
	{ label: 'mobile', width: 390, height: 844 },
] as const;

test.beforeAll(() => {
	fs.mkdirSync(OUT_DIR, { recursive: true });
});

/** admin home 初回訪問時の PremiumWelcome overlay が ❓ click を遮るため閉じる。 */
async function dismissWelcome(page: Page): Promise<void> {
	const welcome = page.locator('.welcome-overlay');
	if (await welcome.isVisible({ timeout: 1500 }).catch(() => false)) {
		const cta = welcome.locator('.welcome-cta');
		if (await cta.isVisible().catch(() => false)) {
			await cta.click();
			await welcome.waitFor({ state: 'hidden', timeout: 3000 }).catch(() => {});
		}
	}
}

/**
 * test-only stylesheet を注入し、driver.js / Svelte bubble の fade-in / pulse / transition を
 * 無効化して opacity を 1 に固定する。production component は触らず、撮影時の "settled" 状態を
 * 決定的に作る (QM Re-BLOCK 1 の根治)。`addStyleTag` は navigation で消えるため goto 後に呼ぶ。
 */
async function freezeGuideAnimations(page: Page): Promise<void> {
	await page.addStyleTag({
		content: `
			.driver-popover, .driver-popover *,
			.driver-overlay,
			.guide-bubble, .guide-bubble *,
			.driver-active-element {
				animation: none !important;
				transition: none !important;
			}
			.driver-popover, .guide-bubble, .driver-overlay { opacity: 1 !important; }
		`,
	});
}

/**
 * bubble が "settled" (computed opacity===1、box が 2 連続不変) になるまで待つ。
 * waitForTimeout は使わない (ESLint 禁止)。
 */
async function waitForBubbleSettled(page: Page): Promise<void> {
	const bubble = page.locator(GUIDE_BUBBLE);
	await bubble.waitFor({ state: 'visible', timeout: 5_000 });
	// computed opacity が 1 (fade-in 完了) になるまで poll。
	await page.waitForFunction(
		(sel) => {
			const el = document.querySelector(sel);
			if (!el) return false;
			const cs = getComputedStyle(el);
			const op = Number.parseFloat(cs.opacity || '1');
			const pop = el.closest('.driver-popover');
			const popOp = pop ? Number.parseFloat(getComputedStyle(pop).opacity || '1') : 1;
			return op >= 0.999 && popOp >= 0.999;
		},
		GUIDE_BUBBLE,
		{ timeout: 5_000 },
	);
	// box が静止するまで rAF poll (driver.js 再配置 + scroll-into-view の収束待ち)。
	let prev = '';
	let stable = 0;
	for (let i = 0; i < 60 && stable < 3; i++) {
		await page.evaluate(
			() =>
				new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(undefined)))),
		);
		const box = await bubble.boundingBox();
		const key = box
			? `${Math.round(box.x)},${Math.round(box.y)},${Math.round(box.width)},${Math.round(box.height)}`
			: '';
		if (box && key === prev) stable++;
		else stable = 0;
		prev = key;
	}
}

/**
 * 撮影前 settled 検証。
 * - opacity===1 (完全描画) は **両 label で常に hard assert** — 半透明 (混濁) フレームは撮らせない。
 * - viewport 収容 / 非重複は After (修正後) では hard assert (修正の証跡)、Before (origin/main) では
 *   バグ再現フレームをそのまま撮るため soft (= 違反でも撮影し、違反内容を返す)。これにより Before の
 *   「見切れ」バグが settled 状態で SS に写り、After との視覚差分が成立する。
 * @returns label==='before' のとき検出した bug 内容 (空配列なら本構図ではバグ非再現)
 */
async function assertSettled(page: Page, ctx: string): Promise<string[]> {
	const bubble = page.locator(GUIDE_BUBBLE);
	const opacity = await bubble.evaluate((el) => getComputedStyle(el).opacity);
	// 半透明フレーム禁止 (QM Re-BLOCK 1) — 両 label で hard。
	expect(
		Number.parseFloat(opacity),
		`${ctx}: bubble が完全不透明 (settled)`,
	).toBeGreaterThanOrEqual(0.999);

	const box = await bubble.boundingBox();
	expect(box, `${ctx}: bubble box 取得`).not.toBeNull();
	const vp = page.viewportSize();
	const bugs: string[] = [];
	if (box && vp) {
		const tol = 1;
		const withinViewport =
			box.x >= -tol &&
			box.y >= -tol &&
			box.x + box.width <= vp.width + tol &&
			box.y + box.height <= vp.height + tol;
		if (LABEL === 'after') {
			expect(box.x, `${ctx}: bubble 左端 viewport 内`).toBeGreaterThanOrEqual(-tol);
			expect(box.y, `${ctx}: bubble 上端 viewport 内`).toBeGreaterThanOrEqual(-tol);
			expect(box.x + box.width, `${ctx}: bubble 右端 viewport 内`).toBeLessThanOrEqual(
				vp.width + tol,
			);
			expect(box.y + box.height, `${ctx}: bubble 下端 viewport 内 (見切れず)`).toBeLessThanOrEqual(
				vp.height + tol,
			);
		} else if (!withinViewport) {
			// Before: 旧手動 positioning の見切れバグを記録 (hard fail させず、その状態で撮影する)。
			bugs.push(
				`(b) viewport 見切れ: bubble bottom=${Math.round(box.y + box.height)} > vp.height=${vp.height}`,
			);
			console.warn(`[before-bug] ${ctx}: ${bugs[bugs.length - 1]}`);
		}
	}
	return bugs;
}

test.describe('#2930 PageGuide settled-state スクリーンショット (driver.js 委譲)', () => {
	test.setTimeout(180_000);

	for (const { path: pagePath, slug, steps } of PAGES) {
		for (const { label: vpLabel, width, height } of VIEWPORTS) {
			test(`[${vpLabel}] ${pagePath} 全 step settled 撮影`, async ({ page }) => {
				await page.setViewportSize({ width, height });
				await page.goto(pagePath, { waitUntil: 'domcontentloaded', timeout: 60_000 });
				await page.waitForLoadState('domcontentloaded');
				await dismissWelcome(page);
				await freezeGuideAnimations(page);

				const btn = page.locator(GUIDE_BTN);
				await expect(btn).toBeVisible({ timeout: 15_000 });
				await btn.first().click({ force: true });

				const bubble = page.locator(GUIDE_BUBBLE);
				await expect(bubble).toBeVisible({ timeout: 5_000 });

				for (let i = 0; i < steps; i++) {
					const ctx = `[${vpLabel}] ${pagePath} step#${i + 1}`;
					// driver.js 再配置直後に inject style が剥がれることはないが、念のため再注入し直す
					// (popover は body 直下に都度生成されるため style tag は head に常駐し効き続ける)。
					await waitForBubbleSettled(page);
					await assertSettled(page, ctx);

					// settled (opacity===1) を確認したうえで撮影する。Before は見切れバグをそのまま記録。
					const fileName = `${LABEL}-${slug}-${vpLabel}-step-${i + 1}.png`;
					await page.screenshot({
						path: path.join(OUT_DIR, fileName),
						fullPage: false,
						animations: 'disabled',
					});

					const nextBtn = bubble.locator(GUIDE_NEXT);
					const nextText = (await nextBtn.textContent().catch(() => '')) ?? '';
					if (nextText.includes('かんりょう')) break;
					const prevStepId = await bubble.getAttribute('data-step-id').catch(() => null);
					await nextBtn.click();
					await page
						.waitForFunction(
							({ sel, prev }) => document.querySelector(sel)?.getAttribute('data-step-id') !== prev,
							{ sel: GUIDE_BUBBLE, prev: prevStepId },
							{ timeout: 5_000 },
						)
						.catch(() => {});
				}
			});
		}
	}
});
