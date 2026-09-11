// tests/e2e/child-tutorial-target-resolution-race-4923.spec.ts
// #4923: 本番の子供 ❓ ガイドが 5 step すべて中央 fallback (data-tutorial-target=fallback) になる。
//
// ## 実機再現で特定した root cause
//
// `(child)/+layout.svelte` の 60 秒ごとの自動リロード (`invalidateAll()`) はガイド表示中も
// 止まらない (`TutorialOverlay` は autoReload の `[data-scope="dialog"]` ガードに引っかからない
// 素の div のため)。home `+page.svelte` の `$effect` が `data.activities.length` を**直接**読んで
// `setChildActivityPresence()` を呼んでいたため、`invalidateAll()` のたびに `data` 参照が丸ごと
// 差し替わり、真偽値が変わっていなくても effect が cleanup→再実行され `hasActivitiesKnown` が
// 書き直される。`activeChapters` ($derived) は `chapterBuilder(hasActivitiesKnown)` の
// **新しい配列**を返すため、`getCurrentStep()` は同じ id の step でも毎回**新しい object 参照**
// を返し、対象解決の `$effect` (`setupStepTracking`) が対象解決の途中で abort → やり直しを
// 繰り返す。対象要素は実在し可視なのに `data-tutorial-target` が `resolved` へ安定しない。
//
// 実機再現 (`tmp/repro-4923-churn.mjs`、60 秒間隔を 400ms へ短縮したエミュレーション) で
// `resolved` ⇄ `fallback` の継続的フリッカーを確認し、修正 (#4923) 後は同条件で安定して
// `resolved` に留まることを確認済み。本 spec はこの実機検証を CI 回帰として固定する。
//
// ## 本 spec がやること
//
// 60 秒を実際に待つのは E2E として非現実的なため、`addInitScript` で `window.setInterval` を
// 横取りし、`autoReloadTimer` (60_000ms 以上の間隔) だけを短縮して自動リロードの連打を
// エミュレートする (本番が「長いガイド閲覧セッション中に 60 秒境界を跨ぐ」のを圧縮再現)。
//
// 実行: npx playwright test tests/e2e/child-tutorial-target-resolution-race-4923.spec.ts

import { expect, type Page, test } from '@playwright/test';

/** `(child)/+layout.svelte` の 60 秒 autoReload interval を短縮し、invalidateAll() 連打を再現する。 */
async function shrinkAutoReloadInterval(page: Page, ms: number) {
	await page.addInitScript((shrinkTo) => {
		const origSetInterval = window.setInterval;
		// biome-ignore lint/suspicious/noExplicitAny: harness monkeypatch (test only)
		(window as any).setInterval = (fn: TimerHandler, delay?: number, ...args: unknown[]) => {
			const shrunk = delay != null && delay >= 30000 ? shrinkTo : delay;
			return origSetInterval(fn as TimerHandler, shrunk, ...args);
		};
	}, ms);
}

/** E2E seed (`tests/e2e/global-setup.ts`) の elementary 子供のニックネーム。 */
const ELEMENTARY_CHILD_NICKNAME = 'けんたくん';

/**
 * #4923: 本 spec は自動リロード連打エミュレーションを目的とした負荷テストのため、共有マシンの
 * 混雑時は Vite cold-compile が既定 actionTimeout (10s、playwright.config.ts `use.actionTimeout`)
 * を超えることがある。既存 child-tutorial-verification.spec.ts の index 総当たりヘルパーだと、
 * 目的の elementary に辿り着くまでに他モードの初回コンパイルを複数回踏んで待たされるため、
 * ニックネームで直接 elementary の子供を選ぶ。加えて、単発の cold-compile 遅延で
 * click→navigation が既定 timeout を超えることがあるため、
 * `startTutorialWithRetry` と同じ寛容度で 3 回まで再試行する (無回帰の確認は
 * unit test `tests/unit/tutorial/tutorial-target-resolution-race-4923.test.ts` が担保する
 * ため、本 E2E は「実機での実際の描画」を確認する層であり、cold-start 由来の遅延で
 * 本題と無関係に flake させない)。
 */
async function gotoElementaryChildHome(page: Page) {
	let lastError: unknown;
	for (let attempt = 0; attempt < 3; attempt++) {
		try {
			await page.goto('/switch', { waitUntil: 'domcontentloaded' });
			const targetButton = page.locator('[data-testid^="child-select-"]', {
				hasText: ELEMENTARY_CHILD_NICKNAME,
			});
			await targetButton.first().waitFor({ state: 'visible', timeout: 20_000 });
			await targetButton.first().click({ timeout: 20_000 });
			await page.waitForURL(/\/elementary(\/|$)/, { timeout: 20_000 });
			await page.locator('[data-testid="header-help-btn"]').waitFor({
				state: 'visible',
				timeout: 20_000,
			});
			return;
		} catch (err) {
			lastError = err;
		}
	}
	throw lastError instanceof Error ? lastError : new Error('gotoElementaryChildHome failed');
}

async function dismissChildHomeOverlays(page: Page) {
	const candidates = [
		'login-bonus-confirm',
		'pin-gate-onboarding-close',
		'weekly-redeem-confirm',
		'confirm-cancel-btn',
	];
	for (let pass = 0; pass < 3; pass++) {
		let anyDismissed = false;
		for (const testid of candidates) {
			const c = page.getByTestId(testid);
			if (
				await c
					.first()
					.isVisible({ timeout: 300 })
					.catch(() => false)
			) {
				await c
					.first()
					.click({ force: true, timeout: 2_000 })
					.catch(() => {});
				anyDismissed = true;
			}
		}
		if (!anyDismissed) break;
	}
}

async function startTutorialWithRetry(page: Page) {
	const helpBtn = page.locator('[data-testid="header-help-btn"]');
	await expect(helpBtn).toBeVisible({ timeout: 10_000 });
	for (let attempt = 0; attempt < 3; attempt++) {
		await helpBtn.dispatchEvent('click');
		try {
			await page.waitForFunction(
				() => document.documentElement.hasAttribute('data-tutorial-active'),
				null,
				{ timeout: 3_000 },
			);
			return;
		} catch {
			// fallthrough → re-dispatch
		}
	}
	throw new Error('❓ ボタン押下でガイドが起動しない');
}

test.describe('#4923 子供 ❓ ガイド対象解決レース (自動リロード連打エミュレーション)', () => {
	test.setTimeout(150_000);

	test('elementary: 自動リロードが連打してもガイド対象は resolved に安定する', async ({ page }) => {
		await page.setViewportSize({ width: 1280, height: 800 });
		// autoReloadTimer (60_000ms) を 400ms へ短縮し、60 秒境界を跨ぐ長いガイド閲覧セッションを
		// 圧縮再現する。
		await shrinkAutoReloadInterval(page, 400);

		await gotoElementaryChildHome(page);
		await page.evaluate(() => {
			for (const key of Object.keys(localStorage)) {
				if (key.startsWith('tutorial-progress')) localStorage.removeItem(key);
			}
		});
		await dismissChildHomeOverlays(page);

		await startTutorialWithRetry(page);
		await page.waitForSelector('html[data-tutorial-active]', { timeout: 10_000 });

		// 最初の step (child-record-card、selector あり) が resolved に到達することを確認
		await expect(page.locator('.tutorial-overlay')).toHaveAttribute(
			'data-tutorial-target',
			'resolved',
			{ timeout: 10_000 },
		);

		// #4923 実機再現の核心: resolved に到達した「後」も、自動リロード連打の下で
		// fallback へ揺り戻らず安定していることを継続的にポーリングして確認する。
		// (修正前は 400ms 間隔の連打で resolved⇄fallback を繰り返し続けた)
		const samples: string[] = [];
		for (let i = 0; i < 40; i++) {
			const target = await page.locator('.tutorial-overlay').getAttribute('data-tutorial-target');
			samples.push(target ?? 'null');
			await page.waitForTimeout(100);
		}
		expect(
			samples.every((s) => s === 'resolved'),
			`4 秒間の自動リロード連打下での data-tutorial-target 推移: ${samples.join(',')}`,
		).toBe(true);

		// spotlight ring も安定して非 0 サイズであること
		const ringBox = await page.locator('.tutorial-spotlight-ring').boundingBox();
		expect(ringBox).not.toBeNull();
		if (ringBox) {
			expect(ringBox.width).toBeGreaterThan(0);
			expect(ringBox.height).toBeGreaterThan(0);
		}
	});

	test('elementary: 自動リロード連打下でも 5 step 全てを resolved で通過できる', async ({
		page,
	}) => {
		await page.setViewportSize({ width: 1280, height: 800 });
		await shrinkAutoReloadInterval(page, 500);

		await gotoElementaryChildHome(page);
		await page.evaluate(() => {
			for (const key of Object.keys(localStorage)) {
				if (key.startsWith('tutorial-progress')) localStorage.removeItem(key);
			}
		});
		await dismissChildHomeOverlays(page);

		await startTutorialWithRetry(page);
		await page.waitForSelector('html[data-tutorial-active]', { timeout: 10_000 });

		let stepNum = 0;
		const maxSteps = 15;
		while (stepNum < maxSteps) {
			stepNum++;
			const bubble = page.locator('.tutorial-bubble');
			await bubble.waitFor({ state: 'visible', timeout: 10_000 });

			const hasTarget = (await bubble.getAttribute('data-has-target')) === 'true';
			if (hasTarget) {
				// 連打の影響で一時的に fallback を経由してもよいが、最終的には resolved に落ち着くこと
				await expect(
					page.locator('.tutorial-overlay'),
					`step ${stepNum}: 対象要素に spotlight する (連打下でも中央 fallback に留まらない)`,
				).toHaveAttribute('data-tutorial-target', 'resolved', { timeout: 10_000 });
			}

			const nextBtn = bubble.locator('.tutorial-nav-next');
			await expect(nextBtn).toBeVisible();
			const btnText = (await nextBtn.textContent()) ?? '';
			const isLastStep = btnText.includes('完了') || btnText.includes('おしまい');
			await nextBtn.click();
			if (isLastStep) {
				await expect(page.locator('.tutorial-overlay')).toBeHidden({ timeout: 5_000 });
				break;
			}
		}

		expect(stepNum, '子供チュートリアル全 5 step が再生される').toBe(5);
	});
});
