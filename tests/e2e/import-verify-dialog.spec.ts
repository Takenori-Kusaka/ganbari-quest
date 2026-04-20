// tests/e2e/import-verify-dialog.spec.ts
// #1254 G3: インポート時の verify Dialog (checksum + duplicates 表示) を E2E 検証

import { createHash } from 'node:crypto';
import { expect, test } from '@playwright/test';

const EXPORT_VERSION = '1.2.0';

function computeChecksum(payload: string): string {
	return `sha256:${createHash('sha256').update(payload).digest('hex')}`;
}

function buildExportJson(options: {
	activities?: Array<{ name: string; sourcePresetId?: string | null }>;
	validChecksum?: boolean;
}): string {
	const data = {
		format: 'ganbari-quest-backup',
		version: EXPORT_VERSION,
		exportedAt: new Date().toISOString(),
		checksum: '',
		family: {
			children: [{ nickname: 'テストくん', age: 7, theme: 'blue' }],
		},
		master: {
			activities: (options.activities ?? []).map((a) => ({
				name: a.name,
				categoryCode: 'seikatsu',
				icon: '🧹',
				basePoints: 3,
				sourcePresetId: a.sourcePresetId ?? null,
			})),
		},
		data: {
			activityLogs: [],
			pointLedger: [],
			statuses: [],
			childAchievements: [],
			childTitles: [],
			loginBonuses: [],
			checklistTemplates: [],
			specialRewards: [],
			statusHistory: [],
		},
	};
	const payload = JSON.stringify({ ...data, checksum: undefined });
	data.checksum =
		options.validChecksum === false ? 'sha256:tampered0000' : computeChecksum(payload);
	return JSON.stringify(data);
}

test.describe('#1254 G3 インポート verify Dialog', () => {
	// Vite dev のコールドコンパイル対策。account-deletion.spec.ts と同じパターン
	test.setTimeout(360_000);

	test.beforeEach(async ({ page }) => {
		test.slow();
		await page.goto('/admin/settings', { waitUntil: 'domcontentloaded' });
		// #702: Svelte 5 の onchange ハンドラは hydration 完了後にのみ bind される。
		// ハイドレーション完了マーカーを待つ（`+layout.svelte` の $effect で立つ）
		await page.waitForFunction(() => window.__APP_HYDRATED__ === true, undefined, {
			timeout: 60_000,
		});
	});

	test('正しい checksum のファイルではプレビュー Dialog に整合性チェック ✓ と件数が表示される', async ({
		page,
	}) => {
		const json = buildExportJson({ activities: [{ name: 'ごみすて' }] });

		const previewResponse = page.waitForResponse(
			(res) => res.url().includes('/api/v1/import') && res.url().includes('mode=preview'),
			{ timeout: 30_000 },
		);
		await page.getByTestId('import-file-input').setInputFiles({
			name: 'backup.json',
			mimeType: 'application/json',
			buffer: Buffer.from(json, 'utf-8'),
		});
		await previewResponse;

		const summary = page.getByTestId('import-preview-summary');
		await expect(summary).toBeVisible({ timeout: 10_000 });
		await expect(page.getByTestId('import-preview-checksum-ok')).toContainText(
			'ファイルの整合性を確認しました',
		);
		await expect(summary).toContainText('子供: 1人');
	});

	test('改ざんされた checksum のファイルではエラー表示される', async ({ page }) => {
		const json = buildExportJson({
			activities: [{ name: 'ごみすて' }],
			validChecksum: false,
		});

		const previewResponse = page.waitForResponse(
			(res) => res.url().includes('/api/v1/import') && res.url().includes('mode=preview'),
			{ timeout: 30_000 },
		);
		await page.getByTestId('import-file-input').setInputFiles({
			name: 'tampered.json',
			mimeType: 'application/json',
			buffer: Buffer.from(json, 'utf-8'),
		});
		await previewResponse;

		await expect(page.getByText('ファイルが破損しているか改ざんされています')).toBeVisible({
			timeout: 10_000,
		});
		await expect(page.getByTestId('import-preview-summary')).toHaveCount(0);
	});
});
