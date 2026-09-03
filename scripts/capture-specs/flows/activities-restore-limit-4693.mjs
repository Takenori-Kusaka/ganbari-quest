/**
 * scripts/capture-specs/flows/activities-restore-limit-4693.mjs (#4693)
 *
 * `/admin/activities` の ︙「バックアップから復元」を**無料プラン上限到達状態**で実行し、
 * 結果メッセージを撮る。
 *
 *   before … 上限で 1 件も入っていないのに「0 件を復元しました」と成功トーンで出る
 *            (上限の理由は `errors` にしか無く、画面がそれを読んでいなかった)
 *   after  … 上限メッセージ + アップグレード導線が出る
 *
 * `activities-bulk-limit-4693.mjs` と同じ前提 (`DEBUG_PLAN=free` + カスタム活動 3/3 到達済の
 * ローカル DB + `npm run dev`)。復元する JSON は本 flow が一時ファイルとして生成するため、
 * 手元に fixture を用意する必要はない。
 *
 * 使用例:
 *   SS_PHASE=after BASE_URL=http://localhost:5199 node scripts/capture.mjs --pr <N> \
 *     --flow activities-restore-limit \
 *     --url /admin/activities \
 *     --actions scripts/capture-specs/flows/activities-restore-limit-4693.mjs \
 *     --presets desktop
 */

import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const BASE_URL = process.env.BASE_URL || 'http://localhost:5173';
const PHASE = process.env.SS_PHASE === 'before' ? 'before' : 'after';

/** 復元入力 (上限 3 に対し 5 件 = 必ず超過する) を一時ファイルに書き出す。 */
function writeRestoreFile() {
	const dir = mkdtempSync(join(tmpdir(), 'gq-restore-'));
	const path = join(dir, 'activities-backup.json');
	// ageMin / ageMax / gradeLevel は nullable (optional ではない) ため必ず持たせる。
	const activities = Array.from({ length: 5 }, (_, i) => ({
		name: `復元する活動${i + 1}`,
		categoryCode: 'benkyou',
		icon: '📚',
		basePoints: 5,
		ageMin: null,
		ageMax: null,
		gradeLevel: null,
	}));
	writeFileSync(path, JSON.stringify({ activities }), 'utf-8');
	return path;
}

/**
 * @param {import('playwright').Page} page
 * @param {(label: string) => Promise<string>} capture
 */
export default async (page, capture) => {
	const filePath = writeRestoreFile();

	await page.goto(`${BASE_URL}/admin/activities`, { waitUntil: 'domcontentloaded' });
	await page.waitForLoadState('networkidle').catch(() => {});

	// header の ︙ overflow menu → 「バックアップから復元」
	await page.getByTestId('header-overflow-menu-btn').click();
	const restoreItem = page.getByTestId('menu-item-restore').first();
	await restoreItem.waitFor({ state: 'visible', timeout: 15_000 });
	await restoreItem.click();

	// 復元ダイアログのファイル入力に上限超過の JSON を渡して送信
	const fileInput = page.getByTestId('restore-file-input');
	await fileInput.waitFor({ state: 'visible', timeout: 15_000 });
	await fileInput.setInputFiles(filePath);
	await page
		.getByRole('button', { name: /読み込む/ })
		.first()
		.click();

	// 結果メッセージ (banner) が読める状態になるまで待つ。
	// dialog が閉じきる前に撮ると banner が backdrop でぼけるため、閉じるまで待ってから撮る。
	await page
		.getByTestId('restore-activities-dialog')
		.waitFor({ state: 'hidden', timeout: 20_000 })
		.catch(() => {});
	await page
		.getByTestId('admin-activities-action-message')
		.waitFor({ state: 'visible', timeout: 20_000 });

	await capture(`${PHASE}-activities-restore-limit`);
};
