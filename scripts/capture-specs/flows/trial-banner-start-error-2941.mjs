/**
 * scripts/capture-specs/flows/trial-banner-start-error-2941.mjs
 *
 * #2941 項目 2: trialUsed=true 再押下 negative path の visible feedback 撮影。
 *
 * 旧挙動: TrialBanner の use:enhance が failure result を黙殺し、startTrial の
 * fail(400) がユーザーに一切見えなかった (NN/G #1 違反)。本 fix で
 * getActionErrorDisplay (#2913) 経由の role=alert エラーメッセージを表示する。
 *
 * 撮影 2 状態:
 *   1. trial 未使用 free ユーザーの「開始」バナー (stale 画面)
 *   2. DB 直接 seed で使用済み化 → 再押下 → trial-banner-start-error 表示
 *
 * 前提: cognito-dev サーバ (port 5174) + free storageState。
 *
 * 使用例:
 *   node scripts/capture.mjs --pr 2941 \
 *     --flow trial-banner-start-error-2941 \
 *     --url /admin \
 *     --actions scripts/capture-specs/flows/trial-banner-start-error-2941.mjs \
 *     --storage-state playwright/.auth/free.json \
 *     --server-mode cognito --presets desktop
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

const BASE_URL = process.env.BASE_URL || 'http://localhost:5174';
const DB_PATH = path.resolve('data/ganbari-quest.db');
const TENANT = 'dev-tenant-free';

/** dev-tenant-free の trial 履歴を削除して未使用状態に戻す（撮影前後の冪等化）。 */
function cleanTrial() {
	const db = new Database(DB_PATH);
	try {
		db.prepare('DELETE FROM trial_history WHERE tenant_id = ?').run(TENANT);
	} finally {
		db.close();
	}
}

/** 「別タブで既に開始済み」を再現する使用済み trial seed（tests/e2e/trial-flow.spec.ts と同手法）。 */
function seedUsedTrial() {
	const db = new Database(DB_PATH);
	try {
		const pastEnd = new Date();
		pastEnd.setDate(pastEnd.getDate() - 3);
		const pastStart = new Date();
		pastStart.setDate(pastStart.getDate() - 10);
		db.prepare(
			'INSERT INTO trial_history (tenant_id, start_date, end_date, tier, source) VALUES (?, ?, ?, ?, ?)',
		).run(
			TENANT,
			pastStart.toISOString().split('T')[0],
			pastEnd.toISOString().split('T')[0],
			'standard',
			'user_initiated',
		);
	} finally {
		db.close();
	}
}

/**
 * @param {import('playwright').Page} page
 * @param {(label: string) => Promise<string>} capture
 */
export default async (page, capture) => {
	cleanTrial();
	try {
		// --- 1) trial 未使用の「開始」バナー (stale 画面の起点) ---
		await page.goto(`${BASE_URL}/admin`);
		await page
			.getByTestId('trial-banner-start-button')
			.waitFor({ state: 'visible', timeout: 30_000 });
		// #702 hydration marker: use:enhance バインド前 click の native POST fallback を防ぐ
		await page.waitForFunction(() => window.__APP_HYDRATED__ === true, undefined, {
			timeout: 30_000,
		});
		await capture('2941-trial-banner-not-started');

		// --- 2) 使用済み化 → 再押下 → エラーメッセージ表示 (NN/G #1) ---
		seedUsedTrial();
		await page.getByTestId('trial-banner-start-button').click();
		await page
			.getByTestId('trial-banner-start-error')
			.waitFor({ state: 'visible', timeout: 15_000 });
		await capture('2941-trial-banner-start-error-visible');

		// #1747: SS と同一 page から DOM snapshot を保存 (flow mode は per-step dom 出力が
		// 無いため、エラー表示状態の outerHTML を明示保存して SS との同時取得を保証する)
		const outDir = path.resolve(process.env.DOM_OUT_DIR || 'tmp/screenshots/pr-2941');
		mkdirSync(outDir, { recursive: true });
		const html = await page.evaluate(() => document.documentElement.outerHTML);
		writeFileSync(path.join(outDir, 'trial-banner-start-error-2941-flow.dom.html'), html, 'utf-8');
	} finally {
		cleanTrial();
	}
};
