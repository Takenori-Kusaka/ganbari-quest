/**
 * scripts/capture-specs/flows/parent-gate-2310.mjs (EPIC #2310 / PR #2325)
 *
 * /switch ページの Parent-Gate PIN modal 4 状態を撮影する flow:
 *   1. parent-gate-modal-initial   — modal が開いた直後 (空入力)
 *   2. parent-gate-modal-typing    — 4 桁うち 2 桁入力途中
 *   3. parent-gate-modal-error     — 誤 PIN 入力後の alert
 *   4. parent-gate-modal-lockout   — 連続失敗時の lockout error
 *
 * 動作前提: PARENT_GATE_FORCE_ACTIVE=true npm run dev:cognito (port 5174)
 *
 * 使用例:
 *   MSYS_NO_PATHCONV=1 node scripts/capture.mjs \
 *     --flow parent-gate-2310 \
 *     --url /switch?pinRequired=1 \
 *     --actions scripts/capture-specs/flows/parent-gate-2310.mjs \
 *     --base-url http://localhost:5174 \
 *     --presets mobile,desktop \
 *     --out tmp/screenshots/pr-2325/
 */

const BASE_URL = process.env.BASE_URL || 'http://localhost:5174';

async function loginAs(page, email, password) {
	await page.goto(`${BASE_URL}/auth/login`);
	await page.getByLabel('メールアドレス').waitFor({ state: 'visible', timeout: 15_000 });
	await page.waitForFunction(
		() => {
			const input = document.querySelector('input[name="email"]');
			return input?.getAttribute('type') === 'email';
		},
		{ timeout: 15_000 },
	);

	const emailInput = page.getByLabel('メールアドレス');
	await emailInput.click();
	for (const ch of email) {
		await page.keyboard.type(ch, { delay: 20 });
	}

	const pwdInput = page.getByLabel('パスワード', { exact: true });
	await pwdInput.click();
	for (const ch of password) {
		await page.keyboard.type(ch, { delay: 20 });
	}

	await page.locator('button[type="submit"]:not([disabled])').first().waitFor({
		state: 'visible',
		timeout: 30_000,
	});
	await page.getByRole('button', { name: 'ログイン' }).click();
	await page.waitForURL(/\/(admin|ops|setup|billing|switch|child)/, { timeout: 30_000 });
}

/**
 * @param {import('playwright').Page} page
 * @param {(label: string) => Promise<string>} capture
 */
export default async (page, capture) => {
	// owner@example.com で login
	await loginAs(page, 'owner@example.com', 'Gq!Dev#Owner2026x');

	// /switch?pinRequired=1 を直接訪問 → PIN modal が auto-open する
	await page.goto(`${BASE_URL}/switch?pinRequired=1`);
	const modal = page.getByTestId('parent-gate-modal');
	await modal.waitFor({ state: 'visible', timeout: 15_000 });

	// PIN input の render 完了を deterministic に待つ (#1208 — waitForTimeout 不可)
	const firstPinInput = page.locator('input[inputmode="numeric"]').first();
	await firstPinInput.waitFor({ state: 'visible', timeout: 10_000 });

	// === 状態 1: PIN modal initial (空入力直後) ===
	await capture('parent-gate-modal-initial');

	// === 状態 2: PIN typing (2 桁入力途中) ===
	// PinInput primitive は keypress でフォーカスされた input に文字を input する
	// 1 桁目をクリック → 数字 2 桁を順に入力
	await firstPinInput.click();
	await page.keyboard.type('1', { delay: 100 });
	await page.keyboard.type('2', { delay: 100 });
	// 2 桁目入力後、3 桁目 input が focus 状態になる (PinInput 自動 advance) のを deterministic に待つ
	await page
		.locator('input[inputmode="numeric"]:nth-of-type(3):focus')
		.waitFor({
			state: 'attached',
			timeout: 5_000,
		})
		.catch(() => {});
	await capture('parent-gate-modal-typing');

	// === 状態 3: invalid PIN error (4 桁誤入力後の alert) ===
	// 残り 2 桁 (合計 4 桁) 入力 → onComplete fire → 401 → parent-gate-error 表示
	await page.keyboard.type('3', { delay: 100 });
	await page.keyboard.type('4', { delay: 100 });
	const errorAlert = page.getByTestId('parent-gate-error');
	await errorAlert.waitFor({ state: 'visible', timeout: 10_000 });
	// alert text が render 完了するのを待つ (textContent が non-empty)
	await page.waitForFunction(
		() => {
			const el = document.querySelector('[data-testid="parent-gate-error"]');
			return !!(el?.textContent && el.textContent.trim().length > 0);
		},
		{ timeout: 5_000 },
	);
	await capture('parent-gate-modal-error');

	// === 状態 4: lockout (連続 5 回失敗で lockout) ===
	// verifyPin の lockout threshold = 5 回失敗 (auth-service.test.ts の挙動と一致)
	// 既に 1 回失敗済 (1234)、残り 4 回失敗を投入する
	// 各回: pinInputKey += 1 で PinInput がリセットされるので順次再入力可能
	const invalidPins = ['5678', '9876', '1111', '2222', '3333']; // 5 回追加 (合計 6 回失敗)
	for (const invalidPin of invalidPins) {
		// 失敗後 pinInputKey で remount → 再入力可能
		const inputAfterRemount = page.locator('input[inputmode="numeric"]').first();
		await inputAfterRemount.waitFor({ state: 'visible', timeout: 5_000 }).catch(() => {});
		await inputAfterRemount.click({ timeout: 5_000 }).catch(() => {});
		for (const ch of invalidPin) {
			await page.keyboard.type(ch, { delay: 80 });
		}
		// error alert text が更新されるのを待つ (lockout 文言が含まれていれば break)
		const isLocked = await page
			.waitForFunction(
				() => {
					const el = document.querySelector('[data-testid="parent-gate-error"]');
					const text = el?.textContent ?? '';
					// 「ロック」「待って」が出現したら lockout 到達
					return text.includes('連続') || text.includes('ロック') || text.includes('待って');
				},
				{ timeout: 3_000 },
			)
			.then(() => true)
			.catch(() => false);
		if (isLocked) {
			break;
		}
	}
	// lockout 状態の alert text を deterministic に確定
	await page.waitForFunction(
		() => {
			const el = document.querySelector('[data-testid="parent-gate-error"]');
			return !!(el?.textContent && el.textContent.trim().length > 0);
		},
		{ timeout: 5_000 },
	);
	await capture('parent-gate-modal-lockout');
};
