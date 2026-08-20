/**
 * scripts/capture-specs/flows/consent-cross-border-4497.mjs (#4497)
 *
 * 再同意画面 `/consent` を撮る。本 PR の視覚的な変更はすべてこの画面にある:
 *
 *   - 越境移転同意 (個人情報保護法 §28) セクションの新設
 *     — Google OAuth 経由の登録は signup フォームを通らないため、この画面が唯一の取得点
 *   - 「前回同意 → 最新」表示の文書ごとの個別化
 *     — 旧実装は利用規約の version 固定で、privacy だけを改定すると
 *       「2026-04-28 → 2026-04-28」という矛盾表示になっていた
 *   - 「同意せずログアウト」の出口
 *     — `/auth/logout` は実在するが画面から到達できなかった
 *
 * before / after は同一 URL・同一アカウントで、ブランチを切り替えて 2 回撮る:
 *   before … origin/develop を checkout した状態
 *   after  … 本 PR (fix/4497-consent-cross-border-privacy-version)
 *
 * AUTH_MODE=cognito (npm run dev:cognito、#1026) で動作させる。
 * ローカルの sqlite auth-repo は consent を stub 実装 (findLatestConsent が常に undefined) しており、
 * `checkConsent` が「未同意」を返すため、この画面が素直に描画される。
 *
 * 使用例 (起動済みサーバーに向ける):
 *   SS_PHASE=after BASE_URL=http://localhost:5174 node scripts/capture.mjs --pr 4516 \
 *     --flow consent-cross-border \
 *     --url /consent \
 *     --actions scripts/capture-specs/flows/consent-cross-border-4497.mjs \
 *     --presets desktop,mobile
 */

const BASE_URL = process.env.BASE_URL || 'http://localhost:5174';
const PHASE = process.env.SS_PHASE === 'before' ? 'before' : 'after';

/** cognito-dev のログインフォームを通す (ops-mfa-not-required-4363.mjs と同型) */
async function login(page, email, password) {
	await page.goto(`${BASE_URL}/auth/logout`).catch(() => {});
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
	await page.waitForURL(/\/(admin|ops|setup|billing|switch|child|consent)/, { timeout: 30_000 });
}

/**
 * @param {import('playwright').Page} page
 * @param {(label: string) => Promise<string>} capture
 */
export default async (page, capture) => {
	await login(page, 'owner@example.com', 'Gq!Dev#Owner2026x');

	await page.goto(`${BASE_URL}/consent`);
	await page.waitForLoadState('domcontentloaded');
	await page.getByTestId('consent-page').waitFor({ state: 'visible', timeout: 30_000 });

	// 初期状態 (全項目 未チェック = 同意ボタンが押せない)
	await capture(`${PHASE}-consent-initial`);

	// 表示されているチェックボックスを全て入れた状態 (同意ボタンが押せる)
	//
	// **hydration 前の click は握り潰される。** native checkbox は click した瞬間にブラウザ側で
	// 視覚状態が変わる一方、hydration 前だと Svelte の `bind:checked` がイベントを受け取れず
	// `$state` は false のまま。`check()` は DOM の `.checked` しか見ないので成功扱いになり、
	// 「全部チェック済みなのにボタンが disabled で『利用規約への同意が必要です』が出ている」
	// という**実装と食い違う SS** が残る (#4609 と同じ class)。
	//
	// 握り潰しは DOM 側から見分けられないので、**derived 側 (送信ボタンの活性) が追いつくまで
	// 入れ直す**。押せるようになったことが「全部チェックした」の唯一の確かな証拠になる。
	const boxes = [
		'consent-terms-checkbox',
		'consent-privacy-checkbox',
		'consent-cross-border-checkbox',
	];
	const submit = page.getByTestId('consent-submit');
	await submit.waitFor({ state: 'visible', timeout: 15_000 });

	let enabled = false;
	for (let attempt = 0; attempt < 5 && !enabled; attempt++) {
		for (const testid of boxes) {
			const box = page.getByTestId(testid);
			// before ブランチには越境移転セクションが無いので、在るものだけ入れる
			if ((await box.count()) === 0) continue;
			// 2 回目以降は「DOM は checked だが state は false」を解くため一度外してから入れ直す
			if (attempt > 0) await box.uncheck();
			await box.check();
		}
		enabled = await submit.isEnabled();
		if (!enabled) await page.waitForTimeout(500);
	}

	// 押せないまま撮ると SS が実装と食い違うので、ここで落とす (握り潰しを黙って通さない)
	await submit.waitFor({ state: 'visible', timeout: 5_000 });
	if (!(await submit.isEnabled())) {
		throw new Error(
			'[consent-cross-border-4497] 全項目チェック後も 同意して続ける が disabled のままです。' +
				'hydration 待ちで解消しない場合は実装側の回帰を疑ってください (#4497)。',
		);
	}

	await capture(`${PHASE}-consent-checked`);
};
