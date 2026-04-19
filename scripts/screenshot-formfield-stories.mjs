#!/usr/bin/env node
// #1191 FormField stories の Storybook スクリーンショットを撮る

import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const BASE = process.env.STORYBOOK_URL || 'http://localhost:6006';
const OUT = path.resolve('docs/screenshots/1191-formfield-variants');
fs.mkdirSync(OUT, { recursive: true });

const STORIES = [
	['textarea', 'primitives-formfield--textarea'],
	['textarea-large', 'primitives-formfield--textarea-large'],
	['textarea-with-error', 'primitives-formfield--textarea-with-error'],
	['textarea-disabled', 'primitives-formfield--textarea-disabled'],
	['number', 'primitives-formfield--number'],
	['tel', 'primitives-formfield--tel'],
	['date', 'primitives-formfield--date'],
	['time', 'primitives-formfield--time'],
	['password-with-toggle', 'primitives-formfield--password-with-toggle'],
];

const browser = await chromium.launch();
const ctx = await browser.newContext({
	viewport: { width: 560, height: 340 },
	deviceScaleFactor: 2,
});
const page = await ctx.newPage();

for (const [name, id] of STORIES) {
	const url = `${BASE}/iframe.html?viewMode=story&id=${id}`;
	await page.goto(url, { waitUntil: 'commit', timeout: 60000 });
	await page.waitForFunction(
		() => {
			const root = document.getElementById('storybook-root');
			return root && root.children.length > 0 && (root.textContent?.trim().length ?? 0) > 0;
		},
		{ timeout: 60000 },
	);
	// document.fonts.ready + 2× RAF でアニメ・フォント settle を待つ (#1208: waitForTimeout 禁止)
	await page.evaluate(
		() =>
			new Promise((resolve) => {
				const finish = () => requestAnimationFrame(() => requestAnimationFrame(resolve));
				if (document.fonts?.ready) document.fonts.ready.then(finish);
				else finish();
			}),
	);
	const file = path.join(OUT, `${name}.png`);
	await page.screenshot({ path: file, timeout: 60000 });
	console.log(`captured ${file}`);
}

await browser.close();
