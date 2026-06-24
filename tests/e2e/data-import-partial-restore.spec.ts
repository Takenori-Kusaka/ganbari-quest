/**
 * tests/e2e/data-import-partial-restore.spec.ts — #3095 part1-floor + part2
 *
 * family データ復元 (/admin/settings/data) の **partial-restore 可視化**を検証する。
 * 旧 UI は import 結果を常に緑「完了」表示し、errors[] / staticFilesSkipped 等を描画しなかったため、
 * 置換 (replace) モードで「既存データクリア後に部分失敗」しても成功扱いになり家族データ半損が
 * silent に隠れていた (#3095 part1)。本 spec は errors を含む結果で「部分復元」警告 + errors 内訳 +
 * skip 件数が surface されることを固定する。
 *
 * fixture 戦略 (Integration 相当、page.route() モック): 実 DB で partial failure (clear 後の
 * persist 途中例外) を決定的に再現できないため、/api/v1/import の preview / replace response を
 * モックし **UI 層の表示分岐**を検証する (admin-import-partial-failure.spec.ts と同パターン)。
 */

import { expect, type Page, test } from '@playwright/test';

/**
 * gotoWarm — vite ^8 dev の SSR module-runner transport timeout を吸収する堅牢 goto。
 *
 * 重い route (例 /admin/settings/data) の **cold な初回 SSR** で vite ^8 が依存を mid-request
 * 再最適化する際 `transport invoke timed out after 60000ms` が起き、goto が
 * `net::ERR_ABORTED; frame detached` / 長時間 hang で ~2/3 失敗する (curl 実測で再現、`server.warmup`
 * config では解消せず)。cold pass が optimization を 1 度通せば server は warm 化し以後安定するため、
 * goto + ready testid visible を maxAttempts 回 retry して cold timeout を吸収する。
 * CI (npm run preview = built) は SSR module-runner が無く発生しないため retry は 1 回目で成立する。
 * (`waitForTimeout` は ESLint 禁止のため sleep は挟まず、goto 自体の所要時間で server warm を待つ)
 */
async function gotoWarm(
	page: Page,
	path: string,
	readyTestId: string,
	maxAttempts = 4,
): Promise<void> {
	let lastErr: unknown;
	for (let attempt = 1; attempt <= maxAttempts; attempt++) {
		try {
			await page.goto(path, { waitUntil: 'commit', timeout: 100_000 });
			await expect(page.getByTestId(readyTestId)).toBeVisible({ timeout: 30_000 });
			return;
		} catch (e) {
			lastErr = e;
		}
	}
	throw lastErr;
}

const PREVIEW = {
	children: 2,
	activityLogs: 10,
	pointLedger: 5,
	statuses: 4,
	achievements: 0,
	loginBonuses: 0,
	checklistTemplates: 1,
};

// errors を含む partial-restore 結果 (replace モード = 既存クリア後の部分失敗)
const PARTIAL_RESULT = {
	childrenImported: 2,
	activitiesCreated: 3,
	activityLogsImported: 8,
	activityLogsSkipped: 2,
	pointLedgerImported: 5,
	pointLedgerSkipped: 0,
	statusesImported: 4,
	achievementsImported: 0,
	titlesImported: 0,
	specialRewardsImported: 1,
	specialRewardsSkipped: 0,
	loginBonusesImported: 0,
	loginBonusesSkipped: 0,
	statusHistoryImported: 0,
	statusHistorySkipped: 0,
	checklistLogsImported: 3,
	checklistLogsSkipped: 1,
	staticFilesRestored: 2,
	staticFilesSkipped: 1,
	skipped: { preset: 0, name: 0, constraint: 0 },
	errors: [
		'ごほうび「特別なごほうび」のインポートに失敗: DB error',
		'静的ファイル「avatars/2/x.png」の復元に失敗',
	],
	warnings: [],
};

test.describe('#3095 family データ復元の partial-restore 可視化', () => {
	test('errors を含む置換復元は「完了」でなく部分復元警告 + errors 内訳 + skip 件数を表示する', async ({
		page,
	}) => {
		test.slow();
		// /admin/settings/data の goto は local dev server で高頻度 (~2/3) に失敗する
		// (`net::ERR_ABORTED; frame detached` / 90s hang)。実測: vite ^8 の SSR module-runner が
		// 重い data route の **cold な初回 SSR** で依存を mid-request 再最適化する際に
		// `transport invoke timed out after 60000ms` (fetchModule の RPC タイムアウト) を起こす。
		// curl 実測でも req1/req2 が 90s timeout・req3 が 6.6s 成功 = 数回叩いて optimization が
		// 通れば warm 化し以後安定、という決定的挙動。`server.warmup` config では解消しなかった。
		// この観測挙動に合わせ、route を **warm+retry** して cold timeout を吸収する
		// (committed admin-settings-routes.spec.ts も同じ vite-8 flake を持つ pre-existing infra 問題。
		//  CI = npm run preview (built) では SSR module-runner が無く発生しない)。
		await gotoWarm(page, '/admin/settings/data', 'data-export-section');
		await page.waitForLoadState('load').catch(() => {});

		// /api/v1/import を mode で出し分けてモックする (UI 表示分岐を決定的に検証)。
		await page.route('**/api/v1/import**', async (route) => {
			const url = route.request().url();
			const body = url.includes('mode=replace')
				? { ok: true, result: PARTIAL_RESULT, cleared: {} }
				: { ok: true, preview: PREVIEW };
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify(body),
			});
		});

		// JSON バックアップを選択 → preview ステップに進む。
		// file input の onchange は client hydration 完了後に配線されるため、hydration race を
		// 吸収するよう setInputFiles → preview-summary 出現を最大数回 retry する
		// (goal-flows.ts openMenu と同じリポジトリ標準の hydration 耐性パターン)。
		const fileInput = page.getByTestId('import-file-input');
		const previewSummary = page.getByTestId('import-preview-summary');
		for (let attempt = 0; attempt < 5; attempt++) {
			await fileInput.setInputFiles({
				name: 'backup.json',
				mimeType: 'application/json',
				buffer: Buffer.from(JSON.stringify({ format: 'ganbari-quest-backup', version: '1.3.0' })),
			});
			try {
				await expect(previewSummary).toBeVisible({ timeout: 3_000 });
				break;
			} catch {
				if (attempt === 4) {
					// 最終 attempt は通常の timeout でエラー詳細を出す
					await expect(previewSummary).toBeVisible({ timeout: 10_000 });
				}
				// hydration 未完で onchange 未配線 → file を clear して次 attempt で再 dispatch
				await fileInput.setInputFiles([]);
			}
		}

		// 置換実行 (importMode 既定 = replace)。Button primitive のため testid でなく role+name で取得
		// (tests/CLAUDE.md「getByRole/text/label 優先」)。
		await page.getByRole('button', { name: 'インポートを実行' }).click();

		// done ステップ: 部分復元警告が出る (緑「完了」の silent success ではない)
		const partialWarning = page.getByTestId('data-import-partial-warning');
		await expect(partialWarning).toBeVisible({ timeout: 15_000 });
		await expect(partialWarning).toContainText('既存データはクリア済み');

		// errors 内訳が surface される (silent-skip 禁止)
		const errors = page.getByTestId('data-import-errors');
		await expect(errors).toBeVisible();
		await expect(errors).toContainText('特別なごほうび');
		await expect(errors).toContainText('avatars/2/x.png');

		// skip 件数 (静的ファイル / チェックリスト履歴) が結果に表示される (#3095 part2)
		const result = page.getByTestId('data-import-result');
		await expect(result).toContainText('画像・音声ファイル');
		await expect(result).toContainText('チェックリスト履歴');

		// #3095: PR 用 SS (partial-restore 警告 + errors 内訳 + skip 件数の可視化状態)
		if (process.env.CAPTURE_SS) {
			await page.screenshot({
				path: 'tmp/screenshots/pr-3095/partial-restore.png',
				fullPage: true,
			});
		}
	});
});
