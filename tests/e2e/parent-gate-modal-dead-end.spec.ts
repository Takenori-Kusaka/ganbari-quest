// tests/e2e/parent-gate-modal-dead-end.spec.ts
// #4050: おやカギコード modal の dead-end (無限ロックアウト) 回帰。
//
// 事象: 新規オーナーが初回の「おやカギコードをつくってください」modal を外側クリック /
// Esc で閉じると、以降「ご家族の見守り画面」を何度押しても modal が開かず、親管理画面に
// 二度と到達できなくなる。
//
// 真因 (2 段):
//   1. `handleAdminLinkClick` が `data.adminLink !== '/admin'` で早期 return していた。
//      cognito 本番モードは adminLink='/auth/login' 固定のため、ログイン済でも client 側で
//      modal を開かず /auth/login → /admin → /switch?pinRequired=1 の同一 URL 往復に落ちる。
//   2. 同一 URL 往復では component が再マウントされず `prevPinRequired` (#2992) と
//      `data.pinRequired` が共に true のままで、modal 自動 open の $effect が no-op になる。
//
// 対処 (Issue の案 A + 案 B を 1 つの解として実施):
//   - 案 B (回復): サーバが `parentGateInteractive` を返し、ログイン済なら URL 往復せず
//     client 側で modal を再オープンする (解錠 modal 側の dead-end = 本欠陥の本体)。
//   - 案 A (予防): 初回作成 modal は × / 外側クリック / Esc で閉じられない強制オンボーディング
//     にする (Apple Screen Time / Google Family Link 同型)。
//
// 本 spec は実ブラウザで両者を検証する (Esc / backdrop の close 挙動は Ark UI の
// グローバル listener 依存で jsdom では非決定 = tests/CLAUDE.md の方針どおり Playwright 層で担保)。

import Database from 'better-sqlite3';
import { UI_PRIMITIVES_LABELS } from '../../src/lib/domain/labels';
import { expect, test } from './fixtures';
import { isAwsEnv } from './helpers';

const PIN_KEY = 'pin_hash';

function readPinHash(dbPath: string): string | null {
	const db = new Database(dbPath);
	try {
		const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(PIN_KEY) as
			| { value: string }
			| undefined;
		return row ? row.value : null;
	} finally {
		db.close();
	}
}

/** PIN 未設定 tenant (= 初回作成フロー) を worker DB 上で再現する */
function clearPinHash(dbPath: string): void {
	const db = new Database(dbPath);
	try {
		db.prepare('DELETE FROM settings WHERE key = ?').run(PIN_KEY);
	} finally {
		db.close();
	}
}

/** global-setup が seed した pin_hash を元へ完全復元する (tests/CLAUDE.md worker DB 規約) */
function restorePinHash(dbPath: string, snapshot: string | null): void {
	const db = new Database(dbPath);
	try {
		if (snapshot === null) {
			db.prepare('DELETE FROM settings WHERE key = ?').run(PIN_KEY);
		} else {
			db.prepare(
				'INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)',
			).run(PIN_KEY, snapshot);
		}
	} finally {
		db.close();
	}
}

// AWS / cognito 環境では worker DB の直接操作が成立しないため未登録。
if (!isAwsEnv()) {
	test.describe('#4050 おやカギ modal の dead-end 回帰', () => {
		test('AC5: 解錠 modal を閉じた後も「ご家族の見守り画面」で再オープンできる', async ({
			page,
		}) => {
			await page.goto('/switch?pinRequired=1', { waitUntil: 'domcontentloaded' });
			const modal = page.getByTestId('parent-gate-modal');
			await expect(modal, 'pinRequired=1 到達で modal が自動 open する').toBeVisible();

			// 解錠 modal は閉じられる (× と Esc の両方)
			await page.getByLabel(UI_PRIMITIVES_LABELS.closeAriaLabel).click();
			await expect(modal).toBeHidden();

			// act: もう一度「ご家族の見守り画面」を押す
			await page.getByTestId('switch-admin-link').click();

			// outcome: modal が再オープンする (旧実装ではここが永久に開かず dead-end だった)
			await expect(modal, '閉じた後も link から modal を開き直せる').toBeVisible();

			// Esc で閉じてからもう一度開けること (閉じ方によらず回復できる)
			await page.keyboard.press('Escape');
			await expect(modal).toBeHidden();
			await page.getByTestId('switch-admin-link').click();
			await expect(modal).toBeVisible();
		});

		test.describe('初回作成 modal は閉じられない (強制オンボーディング)', () => {
			let seededPin: string | null = null;

			test.beforeAll(({ workerDbPath }) => {
				seededPin = readPinHash(workerDbPath);
			});

			test.beforeEach(({ workerDbPath }) => {
				clearPinHash(workerDbPath);
			});

			// sibling spec (PIN 設定済を前提とする parent-gate 系) への影響を残さない
			test.afterAll(({ workerDbPath }) => {
				restorePinHash(workerDbPath, seededPin);
			});

			test('AC1 / AC2: × ボタンが無く、Esc / 外側クリックでも閉じない', async ({ page }) => {
				await page.goto('/switch?pinRequired=1', { waitUntil: 'domcontentloaded' });
				const createBody = page.getByTestId('parent-gate-create');
				await expect(createBody, 'PIN 未設定なら作成フローが出る').toBeVisible();

				// AC1: × クローズボタンが描画されない
				await expect(page.getByLabel(UI_PRIMITIVES_LABELS.closeAriaLabel)).toHaveCount(0);

				// AC2: Esc では閉じない
				await page.keyboard.press('Escape');
				await expect(createBody, 'Esc でバイパスできない').toBeVisible();

				// AC2: modal 外 (backdrop 左上) をクリックしても閉じない
				await page.mouse.click(5, 5);
				await expect(createBody, '外側クリックでバイパスできない').toBeVisible();
			});

			test('AC3: おやカギを作成し終えて初めて modal が閉じ /admin へ遷移する', async ({ page }) => {
				await page.goto('/switch?pinRequired=1', { waitUntil: 'domcontentloaded' });
				const createBody = page.getByTestId('parent-gate-create');
				await expect(createBody).toBeVisible();
				await expect(createBody).toHaveAttribute('data-step', 'enter');

				// 1 段目: 入力 → 確認ステップへ
				for (const ch of '1357') {
					await page.keyboard.press(ch);
				}
				await expect(createBody).toHaveAttribute('data-step', 'confirm');

				// 2 段目: 同じ値を確認入力 → 作成成功 → modal クローズ + /admin へハードナビ
				for (const ch of '1357') {
					await page.keyboard.press(ch);
				}
				await expect(page.getByTestId('parent-gate-modal')).toBeHidden();
				await page.waitForURL('**/admin**', { timeout: 20_000 });
			});
		});
	});
}
