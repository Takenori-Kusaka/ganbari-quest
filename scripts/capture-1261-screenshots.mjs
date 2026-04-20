#!/usr/bin/env node
// #1261 Issue テンプレート差分スクショ（YAML ブロブ view）
// 公開リポジトリなので認証不要で GitHub 上の YAML 表示が見られる。

import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from 'playwright';

const BRANCH = 'feat/1261-issue-template-dependencies';
const REPO = 'Takenori-Kusaka/ganbari-quest';
const OUT = resolve('docs/screenshots/1261-issue-template-dependencies');
mkdirSync(OUT, { recursive: true });

const targets = [
	{
		name: '01-dev-ticket-yaml',
		url: `https://github.com/${REPO}/blob/${BRANCH}/.github/ISSUE_TEMPLATE/dev_ticket.yml`,
	},
	{
		name: '02-bug-report-yaml',
		url: `https://github.com/${REPO}/blob/${BRANCH}/.github/ISSUE_TEMPLATE/bug_report.yml`,
	},
	{
		name: '03-feature-request-yaml',
		url: `https://github.com/${REPO}/blob/${BRANCH}/.github/ISSUE_TEMPLATE/feature_request.yml`,
	},
];

const browser = await chromium.launch();
try {
	for (const t of targets) {
		const ctx = await browser.newContext({ viewport: { width: 1400, height: 1600 } });
		const page = await ctx.newPage();
		await page.goto(t.url, { waitUntil: 'domcontentloaded', timeout: 90000 });
		await page.waitForTimeout(3000);
		// Preview ボタンを force click
		const previewBtn = page.locator('button:has-text("Preview")').first();
		await previewBtn.waitFor({ state: 'visible', timeout: 15000 }).catch(() => {});
		await previewBtn
			.click({ force: true })
			.catch((e) => console.error('preview click failed:', e.message));
		await page.waitForTimeout(3500);
		const path = `${OUT}/${t.name}.png`;
		await page.screenshot({ path, fullPage: true });
		console.log(`OK -> ${path}`);
		await ctx.close();
	}
} finally {
	await browser.close();
}
