/**
 * marketplace 取込 partial-failure 表示 E2E — Issue #2955 (#2830 / #2935 follow-up)
 *
 * server (Strategy) 算出の `failed` (実失敗件数) が UI の 2 層 feedback (Toast + banner、
 * DESIGN.md §5) に到達し、「N 件を追加しましたが、M 件は保存できませんでした」と正直に
 * 表示されることを 3 admin page (activities / rewards / checklists) で検証する。
 * 旧実装では activities のみに表示分岐があり、他 page は部分失敗でも成功 toast のみだった。
 *
 * partial-failure fixture 戦略 (Integration 相当、`page.route()` モック):
 *   実 DB で partial failure (persist 途中の例外) を決定的に再現することは
 *   できない (DB fault injection が必要) ため、form action の POST response を
 *   `page.route()` で SvelteKit ActionResult 形式 (devalue stringify) の partial-failure
 *   fixture に差し替え、**UI 層の表示分岐**を決定的に検証する (tests/CLAUDE.md §テスト分類の
 *   Integration 相当。`tests/e2e/integration/upgrade-checkout.spec.ts` の Stripe mock と同パターン)。
 *   server 層の `failed` 算出精度は unit test (#2830:
 *   `tests/unit/services/activity-import-service.test.ts` 等) が担保し、
 *   server → UI の素通し配線は型契約 (ImportResult.failed required 化 + dispatcher 素通し、
 *   svelte-check) が担保する。
 *
 * 対象外: admin/challenges — #2896 で challenge-set は marketplace 陳列対象外となり
 *   valid preset が 0 件のため、`?import=` 経由で ChildSelectionDialog を開く実ユーザー動線が
 *   存在しない (互換 server 経路と UI 分岐は実装済、helper unit test
 *   `tests/unit/marketplace/ui/import-feedback.test.ts` で表示ロジックを回帰固定)。
 */

import { writeFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { stringify } from 'devalue';

/** 期待する partial-failure 文言 (MARKETPLACE_IMPORT_FEEDBACK_LABELS.partialFailure(3, 2)) */
const PARTIAL_FAILURE_RE = /3 件を追加しましたが、2 件は保存できませんでした/;

/**
 * form action POST を SvelteKit ActionResult (success) の partial-failure fixture に差し替える。
 * deserialize() 互換: `{ type, status, data: devalue.stringify(payload) }`。
 */
async function mockPartialFailureAction(
	page: import('@playwright/test').Page,
	actionName: string,
	data: Record<string, unknown>,
) {
	await page.route(
		(url) => url.search.startsWith(`?/${actionName}`),
		async (route) => {
			if (route.request().method() !== 'POST') {
				await route.fallback();
				return;
			}
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({ type: 'success', status: 200, data: stringify(data) }),
			});
		},
	);
}

/** `?import=` auto-open dialog → 確定 → action response 待ち → banner の partial-failure 表示 assert */
async function runPartialFailureFlow(
	page: import('@playwright/test').Page,
	opts: {
		path: string;
		dialogTestid: string;
		actionName: string;
		bannerTestid: string;
		screenshotName: string;
	},
) {
	test.slow(); // Vite dev コールドコンパイル耐性 (CUJ-A3 と同 pattern)

	await page.goto(opts.path, { waitUntil: 'domcontentloaded' });

	// Vite dev 並列 cold compile (別 spec の /marketplace 初回 compile 等) で hydration が
	// 遅延すると auto-open effect の発火も遅れるため 30s 待つ (admin-activities child-tabs と同基準)。
	const dialog = page.getByTestId(opts.dialogTestid);
	await expect(dialog, 'ChildSelectionDialog が auto-open する前提').toBeVisible({
		timeout: 30_000,
	});

	const confirm = page.getByTestId('child-selection-confirm');
	await expect(confirm).toBeEnabled();

	const [resp] = await Promise.all([
		page.waitForResponse((r) => new URL(r.url()).search.startsWith(`?/${opts.actionName}`)),
		confirm.click(),
	]);
	expect(resp.ok(), `${opts.actionName} response not OK (status ${resp.status()})`).toBeTruthy();

	// 2 層 feedback の banner 層 (`role="status"`、同期 set で race フリー) を assert する。
	// Toast (`role="alert"`) は 3 秒自動消滅 + micro-task race があるため banner を正とする
	// (DESIGN.md §5 2 層防御パターンの E2E 検証規約)。
	const banner = page.getByTestId(opts.bannerTestid);
	await expect(banner).toBeVisible({ timeout: 10_000 });

	// SS 証跡 (PR body 添付用、#2955 AC1「SS 添付、表示変化あり」)。
	// 文言 assert より前に撮ることで、修正前 code では「成功表示のまま」の before 証跡が残る。
	// DOM HTML スナップショットも同一 page インスタンスから併保する (#1747 AC4 と同思想)。
	await page.screenshot({ path: `tmp/ss-2955/${opts.screenshotName}.png`, fullPage: false });
	await writeFile(`tmp/ss-2955/${opts.screenshotName}.dom.html`, await page.content(), 'utf-8');

	await expect(
		banner,
		'partial-failure が「N 件を追加しましたが、M 件は保存できませんでした」と表示される',
	).toContainText(PARTIAL_FAILURE_RE, { timeout: 10_000 });
}

test.describe('#2955 marketplace 取込 partial-failure 表示 (failed 件数の UI 到達)', () => {
	test('activities: importPackToChildren の failed > 0 で件数付き partial-failure banner (回帰)', async ({
		page,
	}) => {
		await mockPartialFailureAction(page, 'importPackToChildren', {
			perChildImport: true,
			importResult: true,
			packName: 'ようじキッズ',
			imported: 3,
			skipped: 0,
			total: 5,
			errors: ['2 件の活動を保存できませんでした'],
			failed: 2,
			presetId: 'kinder-starter',
		});
		await runPartialFailureFlow(page, {
			path: '/admin/activities?import=kinder-starter',
			dialogTestid: 'import-child-selection-dialog',
			actionName: 'importPackToChildren',
			bannerTestid: 'admin-activities-action-message',
			screenshotName: 'activities-partial-failure',
		});
	});

	test('rewards: importPresetToChildren の failed > 0 で件数付き partial-failure banner (#2955 横展開)', async ({
		page,
	}) => {
		await mockPartialFailureAction(page, 'importPresetToChildren', {
			perChildImport: true,
			packName: 'ようじごほうび',
			imported: 3,
			skipped: 0,
			total: 5,
			errors: ['2 件のごほうびを保存できませんでした'],
			failed: 2,
			presetId: 'kinder-rewards',
		});
		await runPartialFailureFlow(page, {
			path: '/admin/rewards?import=kinder-rewards',
			dialogTestid: 'reward-import-child-selection-dialog',
			actionName: 'importPresetToChildren',
			bannerTestid: 'rewards-action-message',
			screenshotName: 'rewards-partial-failure',
		});
	});

	test('checklists: importPresetToChildren の failed > 0 で件数付き partial-failure banner (#2955 横展開)', async ({
		page,
	}) => {
		await mockPartialFailureAction(page, 'importPresetToChildren', {
			perChildImport: true,
			packName: '入学準備チェック',
			imported: 3,
			skipped: 0,
			total: 5,
			errors: ['2 件の項目を保存できませんでした'],
			failed: 2,
			presetId: 'event-school-start',
			distributedCount: 2,
		});
		await runPartialFailureFlow(page, {
			path: '/admin/checklists?import=event-school-start',
			dialogTestid: 'checklist-import-child-selection-dialog',
			actionName: 'importPresetToChildren',
			bannerTestid: 'checklists-action-message',
			screenshotName: 'checklists-partial-failure',
		});
	});

	test('rewards: failed = 0 (純粋な重複) では partial-failure を出さず重複文言のまま (誤検知防止)', async ({
		page,
	}) => {
		await mockPartialFailureAction(page, 'importPresetToChildren', {
			perChildImport: true,
			packName: 'ようじごほうび',
			imported: 0,
			skipped: 5,
			total: 5,
			// rule-preset 同型の「errors に非失敗メッセージが載る」ケースでも、
			// failed = 0 なら失敗扱いしない (#2955 項目 2: errors.length fallback 撤去)。
			errors: ['既に取込済みです'],
			failed: 0,
			presetId: 'kinder-rewards',
		});
		await page.goto('/admin/rewards?import=kinder-rewards', { waitUntil: 'domcontentloaded' });
		const dialog = page.getByTestId('reward-import-child-selection-dialog');
		await expect(dialog).toBeVisible({ timeout: 10_000 });
		const confirm = page.getByTestId('child-selection-confirm');
		await expect(confirm).toBeEnabled();
		const [resp] = await Promise.all([
			page.waitForResponse((r) => new URL(r.url()).search.startsWith('?/importPresetToChildren')),
			confirm.click(),
		]);
		expect(resp.ok()).toBeTruthy();
		const banner = page.getByTestId('rewards-action-message');
		await expect(banner).toContainText(/既に追加済みです/, { timeout: 10_000 });
		await expect(banner).not.toContainText(/保存できませんでした/);
	});
});
