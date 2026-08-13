/**
 * scripts/capture-specs/flows/admin-activities-guide-categories-4512.mjs
 *
 * #4512 finding 1: `/admin/activities` のページガイドが **実在しないカテゴリ「おてつだい」**を
 * 列挙し「こうりゅう」が欠落していた。該当文言はガイドの 1 step 目ではなく
 * 「画面の見方（カテゴリで絞り込み）」step にあるため、既存の `openPageGuide`
 * (1 step 目 settled) では撮れない。ガイドを開いてから当該 step まで進めて撮る。
 *
 * 使用例 (BASE_URL は AUTH_MODE=anonymous DATA_SOURCE=demo で起動した dev server):
 *   MSYS_NO_PATHCONV=1 BASE_URL=http://localhost:5399 SS_PREFIX=after- node scripts/capture.mjs \
 *     --flow admin-activities-guide-categories-4512 \
 *     --url /admin/activities \
 *     --actions scripts/capture-specs/flows/admin-activities-guide-categories-4512.mjs \
 *     --presets desktop \
 *     --out tmp/ss-4512-after
 */

import { openPageGuide } from '../../lib/ci/page-guide-capture.mjs';

const PREFIX = process.env.SS_PREFIX || '';
/**
 * 「つぎへ」ボタン。driver.js 既定の `.driver-popover-next-btn` ではなく、
 * popover に mount した独自バブル UI 側のボタンなので文言で取る
 * (PageGuideOverlay が driver.js popover の wrapper に既存 UI を差し込む構造)。
 */
const NEXT_LABEL = 'つぎへ';
/** 撮りたい step を一意に決める文言 (ガイド本文の見出し)。 */
const TARGET_TITLE = 'カテゴリで絞り込み';
/** ガイドの step 数を超えて押し続けないための上限。 */
const MAX_ADVANCE = 12;

export default async (page, capture) => {
	// welcome 抑止 / animation freeze / ガイド open + 1 step 目 settled まで既存 helper に任せる
	await openPageGuide(page);

	const popover = page.locator('.driver-popover');
	await popover.waitFor({ state: 'visible', timeout: 15_000 });

	// 目的の step が出るまで「次へ」を押す。step 構成が変わっても文言で止まるため、
	// index 決め打ちより壊れにくい。
	for (let i = 0; i < MAX_ADVANCE; i++) {
		if ((await popover.textContent())?.includes(TARGET_TITLE)) break;
		const next = page.locator('.driver-popover').getByRole('button', { name: NEXT_LABEL });
		if (!(await next.isVisible().catch(() => false))) break;
		await next.click({ force: true });
		await page
			.waitForFunction(
				(title) =>
					document.querySelector('.driver-popover')?.textContent?.includes(title) ?? false,
				TARGET_TITLE,
				{ timeout: 2_000 },
			)
			.catch(() => {
				/* この step ではない。次のループで再度押す */
			});
	}

	const text = (await popover.textContent()) ?? '';
	if (!text.includes(TARGET_TITLE)) {
		throw new Error(
			`[4512] ガイドの「${TARGET_TITLE}」step に到達できませんでした。実際の内容: ${text.slice(0, 200)}`,
		);
	}

	await capture(`${PREFIX}admin-activities-guide-categories`);
};
