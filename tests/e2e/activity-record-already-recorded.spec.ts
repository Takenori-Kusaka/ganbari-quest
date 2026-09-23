// tests/e2e/activity-record-already-recorded.spec.ts
//
// 子供のホームを開いたあとに、同じ活動が別の場所 (もう 1 台の端末 / 同じ server を叩く別 worker の
// spec) で先に記録されることがある。画面上はまだ押せるので、押すとサーバーは「きょうは記録済み」
// (409) を返す。そのとき画面が記録済みに切り替わり、次の活動は記録できる (行き止まりにならない)
// ことを検証する。
//
// あわせて `recordFirstAvailableActivity` (helpers.ts) の 409 取り直し経路をここで決定的に通す。
// combo-bonus.spec.ts の mobile flake (CI run 35802847074) は、この経路で 409 のトースト
// 「きょうはもうきろくしたよ！」を成功と数えていたことが原因だった。
// 競合は偶然には起きないので、最初の `?/record` を route で捕まえ、同じ活動を先に記録してから通す。

import { expect, test } from './fixtures';
import {
	dismissOverlays,
	expandFirstCategory,
	recordFirstAvailableActivity,
	selectKinderChild,
} from './helpers';

test('画面を開いたあとに別の場所で記録された活動を押しても、記録済みに切り替わり次の活動を記録できる', async ({
	page,
}) => {
	await selectKinderChild(page);
	await dismissOverlays(page);
	await expandFirstCategory(page);

	const postedActivityIds: string[] = [];
	let preemptiveRecordType: unknown;
	await page.route(
		(url) => url.search === '?/record',
		async (route) => {
			const activityId =
				new URLSearchParams(route.request().postData() ?? '').get('activityId') ?? '';
			postedActivityIds.push(activityId);
			try {
				if (postedActivityIds.length === 1) {
					// 画面からの記録より先に、同じ活動を別の場所から記録しておく
					const res = await page.request.post(route.request().url(), {
						headers: { accept: 'application/json', 'x-sveltekit-action': 'true' },
						form: { activityId },
					});
					preemptiveRecordType = ((await res.json()) as { type?: unknown }).type;
				}
			} finally {
				await route.continue();
			}
		},
	);

	expect(await recordFirstAvailableActivity(page), '次の活動で記録できること').toBe(true);

	expect(preemptiveRecordType, '先回りした記録は成功している').toBe('success');
	expect(
		postedActivityIds.length,
		'1 回目は弾かれ、次の活動で取り直している',
	).toBeGreaterThanOrEqual(2);
	const rejectedId = postedActivityIds[0];
	const recordedId = postedActivityIds[postedActivityIds.length - 1];
	expect(rejectedId, '弾かれた活動の id を捕まえている').toBeTruthy();
	expect(recordedId, '記録できたのは弾かれた活動とは別の活動').not.toBe(rejectedId);
	await expect(
		page.getByTestId(`activity-card-${rejectedId}`),
		'弾かれた活動は記録済みに切り替わる',
	).toBeDisabled();
	await expect(
		page.getByTestId('activity-confirm-btn'),
		'記録できた活動の結果が出ている',
	).toBeVisible();
});
