#!/usr/bin/env node
/**
 * scripts/create-owner-storage-state.mjs
 *
 * cognito-dev サーバに対し owner@example.com で login し、認証済 storageState を
 * tmp/auth-state-owner.json に保存する。capture.mjs --storage-state に渡す用。
 *
 * 使用例:
 *   node scripts/create-owner-storage-state.mjs
 *   node scripts/create-owner-storage-state.mjs --base-url http://localhost:5174
 */

import { chromium } from 'playwright';
import { parseArgs } from 'node:util';

const { values } = parseArgs({
	options: {
		'base-url': { type: 'string', default: 'http://localhost:5174' },
		output: { type: 'string', default: 'tmp/auth-state-owner.json' },
	},
});

const BASE_URL = values['base-url'];
const OUTPUT = values.output;

const browser = await chromium.launch();
const ctx = await browser.newContext();
const page = await ctx.newPage();

try {
	console.log(`Logging in as owner@example.com at ${BASE_URL}/auth/login ...`);
	await page.goto(`${BASE_URL}/auth/login`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
	await page.getByLabel('メールアドレス').waitFor({ state: 'visible', timeout: 60_000 });
	// `type="email"` への切替を待つ (cognito-dev では initial render が type="text")
	await page.waitForFunction(
		() => {
			const input = document.querySelector('input[name="email"]');
			return input?.getAttribute('type') === 'email';
		},
		{ timeout: 60_000 },
	);

	await page.getByLabel('メールアドレス').click();
	for (const ch of 'owner@example.com') {
		await page.keyboard.type(ch, { delay: 20 });
	}
	await page.getByLabel('パスワード', { exact: true }).click();
	for (const ch of 'Gq!Dev#Owner2026x') {
		await page.keyboard.type(ch, { delay: 20 });
	}
	await page.locator('button[type="submit"]:not([disabled])').first().waitFor({
		state: 'visible',
		timeout: 60_000,
	});
	await page.getByRole('button', { name: 'ログイン' }).click();
	await page.waitForURL(/\/(admin|ops|setup|billing|switch|child)/, { timeout: 60_000 });
	console.log(`Logged in. Current URL: ${page.url()}`);

	await ctx.storageState({ path: OUTPUT });
	console.log(`Storage state saved to: ${OUTPUT}`);
} finally {
	await ctx.close();
	await browser.close();
}
