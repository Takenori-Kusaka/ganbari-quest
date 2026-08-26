// tests/e2e/page-guide-layout-invariant.spec.ts
// #2926 (EPIC #2925 Sub-1): PageGuide の手動 positioning を driver.js に委譲した後の
// レンダリング不変条件を機械固定する layout invariant suite。
//
// PO 実機指摘 (2026-06-05 /admin/activities step 2/3) の 3 不具合を機械検出する:
//   (a) 説明 card (バブル) が対象要素を覆い隠す  → バブルと対象要素の bounding box 非重複
//   (b) card が viewport 下に見切れて読めない     → バブルが viewport 内に完全収容
//   (c) フォーカス先が分からない (spotlight 不全) → spotlight overlay + active ring 表示
//
// 全登録 11 ページ × 各 step × desktop + mobile viewport でループ検証する。
// driver.js は collision-aware positioning / viewport 自動調整 / spotlight cutout を内蔵するため、
// 本 suite が緑であることが「手動 positioning 撤去後も 3 不具合が再発しない」ことの担保になる。
//
// 認証 / プラン: AUTH_MODE=local は plan=family を返すため全ページでガイド起動可能。
//
// 実行: npx playwright test tests/e2e/page-guide-layout-invariant.spec.ts

import { expect, type Locator, type Page, test } from '@playwright/test';

// page-guide-registry.ts の GUIDE_LOADERS と 1:1 同期 (admin-page-guide-presence.spec.ts と同集合)。
const ADMIN_GUIDE_PAGES = [
	'/admin',
	'/admin/activities',
	'/admin/rewards',
	'/admin/checklists',
	'/admin/challenges',
	'/admin/children',
	'/admin/settings',
	'/admin/status',
	'/admin/points',
	'/admin/reports',
	'/admin/cheer',
	// #3266 (EPIC #3260 C2): 設定サブ 6 ページ（個別ガイド）
	'/admin/settings/account',
	'/admin/settings/activities',
	'/admin/settings/notifications',
	'/admin/settings/data',
	'/admin/settings/rules',
	'/admin/settings/support',
	// #3267 (EPIC #3260 C3): プラン・課金 (#4139 で /admin/billing を統合)
	'/admin/subscription',
	// #3268 (EPIC #3260 C4): 家族メンバー (#4691: /admin/packs はページごと撤去)
	'/admin/members',
	// #3271 (EPIC #3260 C7): 低頻度顧客接点ページ
	'/admin/certificates',
	'/admin/growth-book',
	'/admin/rewards/requests',
	// #4677 (EPIC #4650): みんなのテンプレート一覧 (AdminLayout 非使用だが同じ engine / 静的パス)。
	// 条件付き step (optional) の step 列・「selector step は必ず光る」は marketplace-page-guide.spec.ts 側。
	'/marketplace',
] as const;

const VIEWPORTS = [
	{ label: 'desktop', width: 1280, height: 800 },
	{ label: 'mobile', width: 390, height: 844 },
] as const;

/**
 * #4651 (EPIC #4650 判断 4 / 6): **selector を持つ step は必ず実要素に spotlight する**。
 *
 * 判定は DOM から行う (spec 側で step 一覧を二重管理しない):
 *   `.guide-bubble[data-has-target="true"]` = ガイド定義が selector を持つ step。
 *   その step では driver.js の `.driver-active-element` が 1 件・可視・非 0 サイズで存在すること。
 *
 * ### accepted-residual allowlist (ADR-0061)
 * 「対象が画面に無い step」は本来 0 件であるべきだが、同一 EPIC の各画面 PR が develop に
 * merge されるまでの間だけ残る。下表に **対応 PR 番号付きで** 明示列挙し、それ以外は hard-fail する。
 * - 追加は必ずレビューを通る (定数の diff として見える) = allowlist が増える方向は PR で止まる
 * - 列挙した組み合わせが **通ってしまった場合も fail** させる (merge 済なのに残置 = 記録の腐り)。
 *   → allowlist は縮む方向にしか動かない
 */
const ACCEPTED_RESIDUAL_SPOTLIGHT: readonly {
	path: string;
	viewport: 'desktop' | 'mobile';
	stepId: string;
	pr: string;
}[] = [
	// 各行は「対象 PR が develop に入れば解消する」ものだけ。解消したら行ごと削除する。
	{
		// /admin step 3 (home-nav) は `[data-tutorial="nav-primary"]` = AdminLayout の mobile nav を
		// 指しており、desktop では `md:hidden` で非表示。#4651 で「非可視候補は採用しない」ようにしたため
		// 0×0 spotlight は消え中央 modal になるが、**実要素に光る**状態にするには step の再アンカーが要る。
		// 再アンカーは /admin ガイド担当 PR #4732 (Issue #4653) が行う。
		path: '/admin',
		viewport: 'desktop',
		stepId: 'home-nav',
		pr: '#4732 (Issue #4653)',
	},
];

/** allowlist 判定 (path × viewport × stepId 完全一致)。 */
function residualEntry(path: string, viewport: string, stepId: string) {
	return ACCEPTED_RESIDUAL_SPOTLIGHT.find(
		(e) => e.path === path && e.viewport === viewport && e.stepId === stepId,
	);
}

const GUIDE_BTN = '[data-tutorial="page-guide-btn"]';
const GUIDE_BUBBLE = '.guide-bubble';
const GUIDE_NEXT = '.guide-nav-next';
// driver.js が highlight 中に描く backdrop (cutout 付き SVG)。spotlight の存在証跡。
const DRIVER_OVERLAY = '.driver-overlay';
// driver.js が highlight 対象要素に付与する class (ring + glow + pulse が乗る)。
const DRIVER_ACTIVE_ELEMENT = '.driver-active-element';

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

interface Box {
	x: number;
	y: number;
	width: number;
	height: number;
}

/** 2 つの矩形が重なっているか (端で接するのみは非重複とみなす)。 */
function overlaps(a: Box, b: Box): boolean {
	return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

/** (b) バブルが viewport (margin 許容 1px) に完全収容されているか検証する。 */
async function assertBubbleWithinViewport(page: Page, bubble: Locator, ctx: string): Promise<void> {
	const box = await bubble.boundingBox();
	expect(box, `${ctx}: バブルの bounding box が取得できる`).not.toBeNull();
	if (!box) return;
	// #2971 round6: project device emulation 下では setViewportSize がページ layout に
	// 反映されないことがあり、viewportSize() との比較は座標空間不一致になる。
	// boundingBox() は実 CSS px 空間 (例: Pixel 7 emulation = 412px) を返すが、
	// page.viewportSize() は要求値 (390px) を返すため比較が誤る。
	// window.innerWidth を使うことで rect と同一座標空間を参照する。
	const vp = await page.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight }));
	expect(vp, `${ctx}: viewport size`).not.toBeNull();
	if (!vp) return;
	const tol = 1; // sub-pixel 丸め許容
	expect(box.x, `${ctx}: (b) バブル左端が viewport 内`).toBeGreaterThanOrEqual(-tol);
	expect(box.y, `${ctx}: (b) バブル上端が viewport 内`).toBeGreaterThanOrEqual(-tol);
	expect(box.x + box.width, `${ctx}: (b) バブル右端が viewport 内`).toBeLessThanOrEqual(
		vp.width + tol,
	);
	expect(
		box.y + box.height,
		`${ctx}: (b) バブル下端が viewport 内 (見切れない)`,
	).toBeLessThanOrEqual(vp.height + tol);
}

/**
 * (a) バブルと現在 highlight 中の対象要素が重ならないことを検証する (target が存在する step のみ)。
 *
 * PO 指摘 (a) の本質は「小さな対象 (追加ボタン等) をバブルが覆い隠す」こと。driver.js は collision
 * 回避でこれを防ぐ。一方、対象が viewport の大半を占める要素 (例: 一覧 section 全体 / radar / 残高グリッド)
 * や、viewport 下端近くにある薄い要素の場合、バブルを置く余地が幾何学的に存在しない (target 高 + バブル高
 * + gap > viewport 高)。これは positioning の不具合ではなく「要素の幾何配置」の制約であり、driver.js の
 * collision 回避でも解けない。よって幾何学的に回避可能な (= バブルを clear して置ける余地がある) ケースに
 * 限り厳密非重複を要求する。
 *
 * #2927 (EPIC #2925 Sub-2) の効果: 旧 narrative は ①概要 step に巨大コンテナ (活動一覧全体 = 864×2705 等)
 * を target にしていたため本 exempt が常時発動していたが、全 11 ページを「①概要 (selector 省略 = 中央 modal)
 * → ②画面の見方 → ③最頻操作」に統一し、target を持つ step は小〜中要素のみを指すよう書き直した。これにより
 * 「viewport を大半覆う巨大 target」は登録 guide から消滅し、本 exempt が幾何回避不能で発動するのは
 * radar (830×400) / 残高グリッド / 下端付近の薄い要素など、driver.js positioning でも回避できない正当な
 * 幾何制約ケースに限られる。
 *
 * 例外 (skip): driver.js が element 省略 step (①概要 = 中央 modal) で挿入する `#driver-dummy-element`
 * は width=0 height=0 の placeholder で実 target ではないため検証対象外 (これを overlap 判定に通すと
 * 0×0 矩形との非重複を誤検証してしまう)。
 */
async function assertBubbleNotOverlapTarget(
	page: Page,
	bubble: Locator,
	ctx: string,
): Promise<void> {
	const target = page.locator(DRIVER_ACTIVE_ELEMENT).first();
	// element 省略 step (中央 modal = ①概要) は active-element が無い → overlap 検証対象外。
	if ((await target.count()) === 0) return;
	if (!(await target.isVisible().catch(() => false))) return;

	const bubbleBox = await bubble.boundingBox();
	const targetBox = await target.boundingBox();
	if (!bubbleBox || !targetBox) return;
	// #2982 (#2971 cleanup): assertBubbleWithinViewport と同じく window.innerWidth/innerHeight を
	// 参照し、boundingBox() と同一座標空間で fits 判定する。page.viewportSize() は device emulation
	// 下で要求値を返し実 CSS px 空間 (例: Pixel 7 = 412px) と乖離するため使わない (#2971 round6 同件)。
	const vp = await page.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight }));
	if (!vp) return;

	// driver.js が element 省略 step で center 配置のために挿入する 0×0 placeholder (#driver-dummy-element)
	// は実 target ではないため検証対象外 (#2927: ①概要 step を中央 modal 化した全ページで該当)。
	if (targetBox.width === 0 && targetBox.height === 0) return;

	// driver.js の popoverOffset (既定 10px) + stagePadding (8px) 相当の最小 gap。
	const minGap = 18;
	// 縦に clear できる余地 (target の上 or 下にバブル全高が入る) があるか。
	const fitsVertically =
		targetBox.y - minGap >= bubbleBox.height ||
		vp.height - (targetBox.y + targetBox.height) - minGap >= bubbleBox.height;
	// 横に clear できる余地 (target の左 or 右にバブル全幅が入る) があるか。
	const fitsHorizontally =
		targetBox.x - minGap >= bubbleBox.width ||
		vp.width - (targetBox.x + targetBox.width) - minGap >= bubbleBox.width;

	if (!fitsVertically && !fitsHorizontally) {
		// 幾何学的に回避不能 (radar / グリッド / 下端付近の薄い要素など driver.js positioning でも
		// 回避できない正当な制約)。#2927 で巨大コンテナ target は撤廃済 — 本 exempt はもはや
		// 「巨大 narrative target」では発動しない (上記 docstring 参照)。本 step は overlap 検証を skip。
		return;
	}

	expect(
		overlaps(bubbleBox, targetBox),
		`${ctx}: (a) バブルが対象要素を覆い隠さない (非重複、target=${Math.round(targetBox.width)}x${Math.round(targetBox.height)})`,
	).toBe(false);
}

/** (c) spotlight (driver.js backdrop overlay) が表示中であることを検証する。 */
async function assertSpotlightVisible(page: Page, ctx: string): Promise<void> {
	const overlay = page.locator(DRIVER_OVERLAY);
	await expect(overlay, `${ctx}: (c) spotlight overlay が表示される`).toBeVisible({
		timeout: 5_000,
	});
}

/**
 * driver.js の smoothScroll + fade animation + 再配置が完了し、バブルの位置が安定するまで待つ。
 * 計測を animation 途中で行うと transient な overlap / 見切れを誤検出するため、box が 2 連続で
 * 不変になる (= 静止) まで rAF ベースで poll する。waitForTimeout は使わない (ESLint 禁止)。
 */
async function waitForBubbleStable(page: Page, bubble: Locator): Promise<void> {
	await bubble.waitFor({ state: 'visible', timeout: 5_000 });
	let prev = '';
	let stableCount = 0;
	for (let i = 0; i < 60 && stableCount < 2; i++) {
		await page.evaluate(
			() =>
				new Promise((resolve) =>
					requestAnimationFrame(() => requestAnimationFrame(() => resolve(undefined))),
				),
		);
		const box = await bubble.boundingBox();
		const key = box
			? `${Math.round(box.x)},${Math.round(box.y)},${Math.round(box.width)},${Math.round(box.height)}`
			: '';
		if (box && key === prev) stableCount++;
		else stableCount = 0;
		prev = key;
	}
}

/**
 * (d) #4651: selector を持つ step が実要素に spotlight したことを検証する。
 * 戻り値は「実要素に spotlight したか」。allowlist 判定のため boolean を返す。
 */
async function isSpotlightingRealTarget(page: Page): Promise<boolean> {
	const target = page.locator(DRIVER_ACTIVE_ELEMENT).first();
	if ((await target.count()) !== 1) return false;
	if (!(await target.isVisible().catch(() => false))) return false;
	const box = await target.boundingBox();
	if (!box || box.width <= 0 || box.height <= 0) return false;
	const vp = await page.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight }));
	const tol = 1;
	return (
		box.x + box.width > -tol &&
		box.y + box.height > -tol &&
		box.x < vp.width + tol &&
		box.y < vp.height + tol
	);
}

/**
 * (d) #4651: `data-has-target="true"` の step は実要素に spotlight する。
 * allowlist 記載の組み合わせのみ「まだ光らない」ことを許容し、逆に光っていたら
 * 「allowlist から外せ」と fail する (記録が腐らないようにする)。
 */
async function assertSelectorStepLights(
	page: Page,
	bubble: Locator,
	path: string,
	viewport: string,
	ctx: string,
): Promise<void> {
	if ((await bubble.getAttribute('data-has-target')) !== 'true') return;
	const stepId = (await bubble.getAttribute('data-step-id')) ?? '';
	const lit = await isSpotlightingRealTarget(page);
	const residual = residualEntry(path, viewport, stepId);
	if (residual) {
		expect(
			lit,
			`${ctx}: ${stepId} は allowlist (${residual.pr}) に載っているが実要素に spotlight した。` +
				' 対象 PR が merge 済なら ACCEPTED_RESIDUAL_SPOTLIGHT から当該行を削除すること',
		).toBe(false);
		return;
	}
	expect(
		lit,
		`${ctx}: ${stepId} は selector 指定 step なので実要素に spotlight する必要がある` +
			' (中央 fallback / 0×0 spotlight で成立させない、EPIC #4650 判断 4)',
	).toBe(true);
}

test.describe('#2926 PageGuide layout invariant — driver.js 委譲後の (a)(b)(c) 機械固定', () => {
	test.setTimeout(120_000);

	for (const { label: vpLabel, width, height } of VIEWPORTS) {
		for (const path of ADMIN_GUIDE_PAGES) {
			test(`[${vpLabel}] ${path}: 全 step でバブル非重複 / viewport 収容 / spotlight 表示`, async ({
				page,
			}) => {
				await page.setViewportSize({ width, height });
				// #2971 round6: 診断用 — 要求値と実 window.innerWidth の乖離をログ (assert はしない)
				const actualVp = await page.evaluate(() => ({ w: window.innerWidth })).catch(() => null);
				console.log(`[viewport-diag] requested=${width} actual=${actualVp?.w ?? 'unknown'}`);
				await page.goto(path);
				await page.waitForLoadState('domcontentloaded');
				await dismissWelcome(page);

				const guideBtn = page.locator(GUIDE_BTN);
				await expect(guideBtn).toBeVisible({ timeout: 10_000 });
				await guideBtn.first().click({ force: true });

				const bubble = page.locator(GUIDE_BUBBLE);
				await expect(bubble).toBeVisible({ timeout: 5_000 });

				// 全 step をループ検証 (上限で無限ループを防ぐ。1 ページ最大 step は registry 上 5 以下)。
				const MAX_STEPS = 12;
				for (let i = 0; i < MAX_STEPS; i++) {
					const ctx = `[${vpLabel}] ${path} step#${i + 1}`;

					// driver.js の scroll-into-view + fade + 再配置が静止するまで待ってから計測する。
					await waitForBubbleStable(page, bubble);
					await expect(bubble, `${ctx}: バブル表示`).toBeVisible();

					await assertSpotlightVisible(page, ctx);
					await assertBubbleWithinViewport(page, bubble, ctx);
					await assertBubbleNotOverlapTarget(page, bubble, ctx);
					// #4651: selector 指定 step は実要素に spotlight する (allowlist 以外は hard-fail)
					await assertSelectorStepLights(page, bubble, path, vpLabel, ctx);

					// 次へ。最終 step なら「かんりょう！」になり、押すとガイドが閉じる。
					const nextBtn = bubble.locator(GUIDE_NEXT);
					const nextText = (await nextBtn.textContent().catch(() => '')) ?? '';
					const isLast = nextText.includes('かんりょう');
					if (isLast) break;
					// 現 step の data-step-id を控え、click 後に値が変わる (= 新 step に遷移) のを待つ。
					const prevStepId = await bubble.getAttribute('data-step-id').catch(() => null);
					await nextBtn.click();
					await expect(bubble, `${ctx}: step 遷移で data-step-id が更新`).not.toHaveAttribute(
						'data-step-id',
						prevStepId ?? '',
						{ timeout: 5_000 },
					);
				}
			});
		}
	}
});
