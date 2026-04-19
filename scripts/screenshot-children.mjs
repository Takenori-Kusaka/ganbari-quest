// Quick screenshot script for #0273 visual verification
import { chromium } from 'playwright';
import { waitForStablePage } from './lib/screenshot-helpers.mjs';

const BASE = 'http://localhost:5173';

async function main() {
	const browser = await chromium.launch();

	// Mobile viewport
	const mobile = await browser.newContext({
		viewport: { width: 390, height: 844 },
		deviceScaleFactor: 2,
	});
	const mPage = await mobile.newPage();

	// Navigate to children page
	await mPage.goto(`${BASE}/admin/children`, { waitUntil: 'networkidle' });
	await waitForStablePage(mPage);
	await mPage.screenshot({ path: 'screenshots/0273-children-list-mobile.png', fullPage: true });
	console.log('✅ Mobile: children list');

	// Click first child to see detail
	const firstChild = mPage.locator('[data-tutorial="child-card"]');
	if (await firstChild.count()) {
		await firstChild.click();
		await waitForStablePage(mPage, { skipNetworkIdle: true });
		await mPage.screenshot({ path: 'screenshots/0273-children-detail-mobile.png', fullPage: true });
		console.log('✅ Mobile: children detail (view mode)');

		// Click edit button
		const editBtn = mPage.locator('button:has-text("編集")').first();
		if (await editBtn.count()) {
			await editBtn.click();
			await waitForStablePage(mPage, { skipNetworkIdle: true });
			await mPage.screenshot({ path: 'screenshots/0273-children-edit-mobile.png', fullPage: true });
			console.log('✅ Mobile: children edit mode');
		}
	}

	// Tablet viewport
	const tablet = await browser.newContext({
		viewport: { width: 768, height: 1024 },
		deviceScaleFactor: 2,
	});
	const tPage = await tablet.newPage();
	await tPage.goto(`${BASE}/admin/children`, { waitUntil: 'networkidle' });
	await waitForStablePage(tPage);
	await tPage.screenshot({ path: 'screenshots/0273-children-list-tablet.png', fullPage: true });
	console.log('✅ Tablet: children list');

	const firstChildTab = tPage.locator('[data-tutorial="child-card"]');
	if (await firstChildTab.count()) {
		await firstChildTab.click();
		await waitForStablePage(tPage, { skipNetworkIdle: true });
		await tPage.screenshot({ path: 'screenshots/0273-children-detail-tablet.png', fullPage: true });
		console.log('✅ Tablet: children detail (view mode)');
	}

	await browser.close();
	console.log('\n📸 Screenshots saved to screenshots/');
}

main().catch(console.error);
