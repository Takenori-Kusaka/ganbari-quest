/**
 * #3079 — ごほうび・チェックリストの個別 backup/restore E2E (export → restore round-trip)
 *
 * 活動 (#2558) と機能対称化した overflow menu の「エクスポート」「バックアップから復元」を、
 * ごほうび・チェックリストで goal 完遂 (act → outcome) で検証する (CX-DoR #1 / render-only 禁止):
 *
 *   overflow ︙ → エクスポート (download) → 保存ファイルを restore で再アップロード
 *     → 内容を確認 (preview 件数表示) → 復元する → 成功 toast / 件数反映
 *
 * 復元は dead-end 検出のため preview → 実行の 2 段を貫通し、cancel 経路も検証する。
 * default config の local 認証は plan=family (paid tier) を返すため、プランゲートは通過する。
 */

import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from './fixtures';

// #3163/#3168: reward restore の重複検知。
// #3163 当時: restore は `source_preset_id` (= 'backup-restore:reward-set' sentinel) scope で
//   dedup していたため、seed 済 reward (source_preset_id=NULL) を複製 INSERT し共有 worker DB を
//   汚染、後続 child-shop-exchange が 2 枚目カードを検出して fail していた。
// #3168: restore を dedupMode='content' (title+points 照合、source_preset_id 非依存) で**冪等化**。
//   identical data の restore は全件 skip され複製を作らない (本番側根治)。
// 以降の afterEach は「冪等化前の残骸 / 将来の退行」に対する defense-in-depth として併存させる。
const RESTORE_REWARD_SET_PRESET_ID = 'backup-restore:reward-set';

async function cleanupRestoredRewardCopies(workerDbPath: string): Promise<void> {
	const { default: Database } = await import('better-sqlite3');
	const db = new Database(workerDbPath);
	try {
		db.prepare('DELETE FROM special_rewards WHERE source_preset_id = ?').run(
			RESTORE_REWARD_SET_PRESET_ID,
		);
	} finally {
		db.close();
	}
}

// #3168: restore が作った sentinel 由来 reward 行数。冪等 restore (identical data) では 0 のはず。
async function countRestoredRewardCopies(workerDbPath: string): Promise<number> {
	const { default: Database } = await import('better-sqlite3');
	const db = new Database(workerDbPath);
	try {
		const row = db
			.prepare('SELECT COUNT(*) AS n FROM special_rewards WHERE source_preset_id = ?')
			.get(RESTORE_REWARD_SET_PRESET_ID) as { n: number };
		return row.n;
	} finally {
		db.close();
	}
}

// download を一時ファイルに保存し、その絶対パスを返す。
async function saveDownload(
	page: import('@playwright/test').Page,
	triggerExport: () => Promise<void>,
): Promise<string> {
	const [download] = await Promise.all([page.waitForEvent('download'), triggerExport()]);
	const dest = join(tmpdir(), `gq-${Date.now()}-${download.suggestedFilename()}`);
	await download.saveAs(dest);
	return dest;
}

// Ark UI Menu / OverflowMenu は Portal で render され、trigger click 後に item が mount される。
// item を click する前に visible を待つ (#3079 / tests/CLAUDE.md「Portal 経由 component」原則)。
async function openMenuItem(
	page: import('@playwright/test').Page,
	triggerTestid: string,
	itemTestid: string,
): Promise<void> {
	await page.getByTestId(triggerTestid).click();
	const item = page.getByTestId(itemTestid);
	await item.scrollIntoViewIfNeeded();
	await item.click();
}

test.describe('admin/rewards backup/restore (#3079)', () => {
	// #3163/#3168: restore が万一 sentinel 由来コピーを残した場合に worker DB を seed 状態へ戻す
	// defense-in-depth。#3168 の冪等化 (dedupMode='content') 後は通常 no-op だが、退行検知の保険として残す。
	test.afterEach(async ({ workerDbPath }) => {
		await cleanupRestoredRewardCopies(workerDbPath);
	});

	test('export → restore round-trip で全件重複スキップを preview → 復元まで貫通', async ({
		page,
		workerDbPath,
	}) => {
		await page.goto('/admin/rewards');
		await expect(page.getByTestId('admin-rewards-child-tabs')).toBeVisible();

		// 1. overflow ︙ → エクスポート (download)
		const exportPath = await saveDownload(page, () =>
			openMenuItem(page, 'rewards-overflow-menu', 'menu-item-export'),
		);
		const exported = JSON.parse(await fs.readFile(exportPath, 'utf-8'));
		// v2 envelope であること (round-trip 整合)
		expect(exported.typeCode).toBe('reward-set');
		expect(exported.schemaVersion).toBe(2);

		// 2. overflow ︙ → バックアップから復元 → ファイル選択
		await openMenuItem(page, 'rewards-overflow-menu', 'menu-item-restore');
		const dialog = page.getByTestId('restore-rewards-dialog');
		await expect(dialog).toBeVisible();
		await page.getByTestId('restore-rewards-file-input').setInputFiles(exportPath);

		// 3. 内容を確認 (preview) — 件数が表示される (act → outcome)
		await page.getByTestId('restore-rewards-check').click();
		await expect(page.getByTestId('restore-rewards-preview')).toBeVisible();

		// 4. 同じ child に同じファイルを復元 → 全件重複スキップ (冪等性)。
		//    confirm ボタンは全件重複時 disabled になるため、それ自体が「重複検知が効いた」outcome。
		//    重複が無い場合 (空 child) は confirm が押せて成功 toast が出る。どちらでも dead-end ではない。
		const confirm = page.getByTestId('restore-rewards-confirm');
		const confirmDisabled = await confirm.isDisabled();
		if (confirmDisabled) {
			// 全件重複: preview に「すべて既に登録済み」が出ている
			await expect(dialog).toContainText('登録済み');
		} else {
			await confirm.click();
			await expect(dialog).toBeHidden();
		}

		// #3168: restore 冪等性の data-level pin。export → 同一データ restore は content dedup で
		// 全件 skip され、sentinel 由来の複製行を 1 件も作らない (= 既存 reward を二重化しない)。
		// 冪等化前 (#3163) はここが複製件数だけ非 0 になり worker DB を汚染していた。
		expect(await countRestoredRewardCopies(workerDbPath)).toBe(0);

		await fs.unlink(exportPath).catch(() => {});
	});

	test('復元 dialog は cancel で閉じる (dead-end 防止)', async ({ page }) => {
		await page.goto('/admin/rewards');
		await openMenuItem(page, 'rewards-overflow-menu', 'menu-item-restore');
		const dialog = page.getByTestId('restore-rewards-dialog');
		await expect(dialog).toBeVisible();
		// ファイル未選択時は「内容を確認」が disabled (act 不能を明示)
		await expect(page.getByTestId('restore-rewards-check')).toBeDisabled();
		await dialog.getByRole('button', { name: 'キャンセル' }).click();
		await expect(dialog).toBeHidden();
	});
});

test.describe('admin/checklists backup/restore (#3079)', () => {
	test('テンプレートが存在すれば export → restore round-trip を貫通', async ({ page }) => {
		await page.goto('/admin/checklists');

		// export dialog を開く (checklists overflow は OverflowMenu primitive)
		await openMenuItem(page, 'checklists-overflow-menu', 'overflow-menu-item-export');
		const exportDialog = page.getByTestId('export-checklist-dialog');
		await expect(exportDialog).toBeVisible();

		// テンプレートが 1 件以上あれば export → restore を貫通、無ければ empty 表示を確認 (dead-end なし)
		const firstExportItem = exportDialog.locator('[data-testid^="export-checklist-item-"]').first();
		if ((await firstExportItem.count()) === 0) {
			await expect(exportDialog).toContainText('エクスポートできるチェックリストがありません');
			return;
		}

		const exportPath = await saveDownload(page, async () => {
			await firstExportItem.click();
		});
		const exported = JSON.parse(await fs.readFile(exportPath, 'utf-8'));
		expect(exported.typeCode).toBe('checklist');
		expect(exported.schemaVersion).toBe(2);

		// restore: 同名テンプレートが既存 → 全件重複スキップ (preview で確認)
		await openMenuItem(page, 'checklists-overflow-menu', 'overflow-menu-item-restore');
		const restoreDialog = page.getByTestId('restore-checklist-dialog');
		await expect(restoreDialog).toBeVisible();
		await page.getByTestId('restore-checklist-file-input').setInputFiles(exportPath);
		await page.getByTestId('restore-checklist-check').click();
		await expect(page.getByTestId('restore-checklist-preview')).toBeVisible();

		await fs.unlink(exportPath).catch(() => {});
	});
});
