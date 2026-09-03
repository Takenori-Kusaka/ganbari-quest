/**
 * scripts/capture-specs/flows/irreversible-warning-alert-4545.mjs (#4545)
 *
 * 不可逆操作の直前に出る最重要警告の **提示形式と縦位置** を撮る。
 * 文言 (#4517 / #4529 / #4531) は既に正しく、本 PR が変えるのは「届き方」なので、
 * 撮るべきは「素の viewport で読めるか」「色文字か枠付き Alert か」である。
 *
 * `CAPTURE_TARGET` で 2 つの対象を切り替える (1 起動 = 1 対象):
 *
 *   account   … /admin/settings/account の退会 Danger Zone。
 *               AUTH_MODE=cognito (npm run dev:cognito、#1026) が必要。
 *               `CAPTURE_PLAN` (free | standard | family) でログインする DEV_USER を変え、
 *               猶予 0 日 (無料 = 取り消し不可) と猶予ありの見た目の差を撮り分ける。
 *
 *   downgrade … ダウングレード確認ダイアログの保持期間短縮警告。
 *               **アプリ route では撮れない** — local backend (sqlite) は `tenants` を持たず
 *               `getLicenseInfo()` が必ず null を返すため、ダイアログを開く条件
 *               (`stripeSubscriptionId` を持つ契約) を作れない (docs/CLAUDE.md
 *               §「local 検証不可」と同型)。よって Storybook の story を実ブラウザで描画する。
 *               既存の downgrade-retention-warning-4528.mjs は警告を viewport 内へ
 *               **スクロールしてから**撮るが、本フローは **スクロールせずに**撮る。
 *               「素の viewport で読めるか」が本 PR の争点だからである。
 *
 * 使用例:
 *   # 退会 Danger Zone (無料プラン = 猶予 0 日)
 *   CAPTURE_PLAN=free node scripts/capture.mjs --pr <N> \
 *     --flow irreversible-warning-alert-4545 --url /admin/settings/account \
 *     --actions scripts/capture-specs/flows/irreversible-warning-alert-4545.mjs \
 *     --server-mode cognito --presets desktop,mobile
 *
 *   # ダウングレードダイアログ (Storybook。port は他クローンとの衝突を避けて明示指定)
 *   npx storybook dev -p 6031 --no-open
 *   CAPTURE_TARGET=downgrade CAPTURE_NAME=after-downgrade-viewport node scripts/capture.mjs \
 *     --base-url http://localhost:6031 --flow irreversible-warning-alert-4545 \
 *     --url "/iframe.html?id=<story id>&viewMode=story" \
 *     --actions scripts/capture-specs/flows/irreversible-warning-alert-4545.mjs --presets desktop
 */

const BASE_URL = process.env.BASE_URL || 'http://localhost:5174';
const TARGET = process.env.CAPTURE_TARGET ?? 'account';
const PLAN = process.env.CAPTURE_PLAN ?? 'free';
const CAPTURE_NAME = process.env.CAPTURE_NAME ?? `irreversible-warning-${TARGET}`;

/** DEV_USERS (src/lib/server/auth/providers/cognito-dev.ts) の owner 3 プラン。 */
const DEV_OWNERS = {
	free: { email: 'free@example.com', password: 'Gq!Dev#Free2026xy' },
	standard: { email: 'standard@example.com', password: 'Gq!Dev#Std2026xyz' },
	family: { email: 'family@example.com', password: 'Gq!Dev#Fam2026xyz' },
};

/** cognito-dev のログインフォームを通す (cancel-vs-deletion-4496.mjs と同型) */
async function loginAs(page, { email, password }) {
	await page.goto(`${BASE_URL}/auth/login`);
	await page.getByLabel('メールアドレス').waitFor({ state: 'visible', timeout: 15_000 });
	await page.waitForFunction(
		() => document.querySelector('input[name="email"]')?.getAttribute('type') === 'email',
		{ timeout: 15_000 },
	);

	await page.getByLabel('メールアドレス').click();
	await page.keyboard.type(email, { delay: 20 });
	await page.getByLabel('パスワード', { exact: true }).click();
	await page.keyboard.type(password, { delay: 20 });

	await page
		.locator('button[type="submit"]:not([disabled])')
		.first()
		.waitFor({ state: 'visible', timeout: 30_000 });
	await page.getByRole('button', { name: 'ログイン' }).click();
	await page.waitForURL(/\/(admin|ops|setup|billing|switch|child)/, { timeout: 30_000 });
}

/** 初回訪問で前面に出るチュートリアル / 販促オーバーレイを閉じる (出ていなければ no-op)。 */
async function dismissOverlays(page) {
	for (const label of ['終了する', 'あとで']) {
		const btn = page.getByRole('button', { name: label }).first();
		if (await btn.isVisible().catch(() => false)) {
			await btn.click().catch(() => {});
			await btn.waitFor({ state: 'hidden', timeout: 10_000 }).catch(() => {});
		}
	}
}

async function settle(page) {
	await page.evaluate(
		() =>
			new Promise((resolve) =>
				requestAnimationFrame(() => requestAnimationFrame(() => resolve(undefined))),
			),
	);
}

/**
 * @param {import('playwright').Page} page
 * @param {(label: string) => Promise<string>} capture
 */
export default async (page, capture) => {
	if (TARGET === 'downgrade') {
		// capture recorder が --url (story の iframe) へ navigate 済のため二重 goto しない。
		await page
			.getByTestId('downgrade-preview-content')
			.waitFor({ state: 'visible', timeout: 20_000 });
		// **スクロールしない**。素の viewport で警告が読めるかどうかが本 PR の争点。
		await settle(page);
		await capture(CAPTURE_NAME);
		return;
	}

	const owner = DEV_OWNERS[PLAN] ?? DEV_OWNERS.free;
	await loginAs(page, owner);

	if (TARGET === 'child-delete') {
		// 子供カードの削除確認 (ChildProfileCard)。編集モード → 「このお子さまを削除」で確認文が出る。
		await page.goto(`${BASE_URL}/admin/children`, { waitUntil: 'domcontentloaded' });
		// ChildProfileCard は「選択中の子供」でのみ描画される (`?id=<childId>`)。
		// 一覧カード (ChildListCard) の link が出るまで待ち、チュートリアル /
		// 販促オーバーレイ (初回訪問で前面に出て click を横取りする) を閉じてから操作する。
		const listLink = page.locator('a[href^="/admin/children?id="]').first();
		await listLink.waitFor({ state: 'visible', timeout: 30_000 });
		await dismissOverlays(page);
		await listLink.click();

		// 各 click は「押した結果 (次の状態) が見えるまで」待ってから次へ進む。
		// 待たずに押すと hydrate 前 / オーバーレイ下の node を押して状態が変わらない。
		const editBtn = page.getByRole('button', { name: '✏️ 編集' }).first();
		await editBtn.waitFor({ state: 'visible', timeout: 30_000 });
		await dismissOverlays(page);
		await editBtn.click();
		await dismissOverlays(page);
		// #4716: 「この子供を削除」→「このお子さまを削除」(CHILD_TERMS.honorific)。
		//   .mjs から labels.ts (TS) は import できないので、呼称部分だけ許容する正規表現で照合する。
		const deleteBtn = page.getByRole('button', { name: /^🗑 この.+を削除$/ }).first();
		await deleteBtn.waitFor({ state: 'visible', timeout: 30_000 });
		await deleteBtn.click();
		await page
			.getByRole('button', { name: '本当に削除' })
			.first()
			.waitFor({ state: 'visible', timeout: 20_000 });
		await settle(page);
		await capture(CAPTURE_NAME);
		return;
	}

	await page.goto(`${BASE_URL}/admin/settings/account`, { waitUntil: 'domcontentloaded' });
	const dangerZone = page.getByTestId('account-danger-zone');
	await dangerZone.waitFor({ state: 'visible', timeout: 30_000 }).catch(() => {});
	await dangerZone.scrollIntoViewIfNeeded().catch(() => {});
	await settle(page);
	await capture(CAPTURE_NAME);
};
