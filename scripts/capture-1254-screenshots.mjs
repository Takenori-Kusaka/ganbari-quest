#!/usr/bin/env node
// #1254 G3 インポート verify Dialog のスクリーンショット採取
// 使い方: 別ターミナルで `npm run dev` を起動後、`node scripts/capture-1254-screenshots.mjs`

import { createHash } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from 'playwright';

const BASE = 'http://localhost:5173';
const OUT = resolve('docs/screenshots/1254-import-verify-dialog');
mkdirSync(OUT, { recursive: true });

const EXPORT_VERSION = '1.2.0';

function computeChecksum(payload) {
	return `sha256:${createHash('sha256').update(payload).digest('hex')}`;
}

function buildExportJson({ activities = [], validChecksum = true } = {}) {
	const data = {
		format: 'ganbari-quest-backup',
		version: EXPORT_VERSION,
		exportedAt: new Date().toISOString(),
		checksum: '',
		family: { children: [{ nickname: 'テストくん', age: 7, theme: 'blue' }] },
		master: {
			activities: activities.map((a) => ({
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
	data.checksum = validChecksum ? computeChecksum(payload) : 'sha256:tampered0000';
	return JSON.stringify(data);
}

const browser = await chromium.launch();

async function capture(name, { validChecksum, viewport }) {
	const ctx = await browser.newContext({ viewport });
	const page = await ctx.newPage();
	await page.goto(`${BASE}/admin/settings`, { waitUntil: 'domcontentloaded', timeout: 60000 });
	await page.waitForFunction(() => window.__APP_HYDRATED__ === true, undefined, {
		timeout: 60000,
	});

	const previewResponse = page.waitForResponse(
		(res) => res.url().includes('/api/v1/import') && res.url().includes('mode=preview'),
		{ timeout: 30000 },
	);
	const json = buildExportJson({
		activities: [{ name: 'ごみすて' }, { name: 'おかたづけ', sourcePresetId: 'seikatsu/basic' }],
		validChecksum,
	});
	await page.getByTestId('import-file-input').setInputFiles({
		name: validChecksum ? 'backup.json' : 'tampered.json',
		mimeType: 'application/json',
		buffer: Buffer.from(json, 'utf-8'),
	});
	await previewResponse;

	// 整合性 OK マーカー or エラーメッセージが見えるまで待機
	if (validChecksum) {
		await page.getByTestId('import-preview-summary').waitFor({ state: 'visible', timeout: 15000 });
	} else {
		await page
			.getByText('ファイルが破損しているか改ざんされています')
			.waitFor({ state: 'visible', timeout: 15000 });
	}
	await page.waitForTimeout(500);

	const path = `${OUT}/${name}.png`;
	await page.screenshot({ path, fullPage: true });
	console.log(`OK -> ${path}`);
	await ctx.close();
}

try {
	await capture('01-valid-checksum-desktop', {
		validChecksum: true,
		viewport: { width: 1280, height: 900 },
	});
	await capture('02-valid-checksum-mobile', {
		validChecksum: true,
		viewport: { width: 390, height: 844 },
	});
	await capture('03-tampered-checksum-desktop', {
		validChecksum: false,
		viewport: { width: 1280, height: 900 },
	});
} finally {
	await browser.close();
}
