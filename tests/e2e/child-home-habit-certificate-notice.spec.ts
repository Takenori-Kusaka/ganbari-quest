// tests/e2e/child-home-habit-certificate-notice.spec.ts
//
// #4261 ③ — 習慣化告知は「次回起動で 1 回だけ」。既読で消え、再表示しない (PO 決裁 2026-08-06)。
//
// ## なぜ e2e でなければ捕まらないか
//
// 既読化は **表示できた時点で client が自動で 1 回だけ** `?/ackHabitCertificateNotice` を叩く
// (ADR-0012「記録する → 数秒で閉じる」を伸ばさないため、子に × を押させない)。
// この経路は hydration → fetch → server action → settings KV という実ブラウザの往復であり、
// unit では再現できない。実際に**初回実装は表示直後の画面遷移で fetch が中断され、
// 次回また同じ告知が出ていた** (実機で観測 → `keepalive: true` で修正)。
// 「バナーが出ること」だけを見る test では本欠陥を検出できないため、
// **再訪して出ないこと**を assert する。

import { expect, test } from './fixtures';

const NICKNAME = 'けんたくん'; // elementary
const NOTICE = '[data-testid="habit-certificate-notice"]';
const NOTICE_KEY_PREFIX = 'habit_certificate_notice:';

async function childIdOf(workerDbPath: string): Promise<number> {
	const { default: Database } = await import('better-sqlite3');
	const db = new Database(workerDbPath, { readonly: true });
	try {
		const row = db.prepare('SELECT id FROM children WHERE nickname = ? LIMIT 1').get(NICKNAME) as
			| { id: number }
			| undefined;
		if (!row) throw new Error(`${NICKNAME} not found in worker DB`);
		return row.id;
	} finally {
		db.close();
	}
}

async function seedNotice(workerDbPath: string, childId: number): Promise<void> {
	const { default: Database } = await import('better-sqlite3');
	const db = new Database(workerDbPath);
	try {
		db.prepare(
			"INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now'))",
		).run(`${NOTICE_KEY_PREFIX}${childId}`, JSON.stringify({ yearMonth: '2026-08', points: 50 }));
	} finally {
		db.close();
	}
}

/** 自分が足した行だけを消して worker DB を seed 状態へ戻す (tests/CLAUDE.md §worker DB 共有) */
async function cleanupNotice(workerDbPath: string, childId: number): Promise<void> {
	const { default: Database } = await import('better-sqlite3');
	const db = new Database(workerDbPath);
	try {
		db.prepare('DELETE FROM settings WHERE key = ?').run(`${NOTICE_KEY_PREFIX}${childId}`);
	} finally {
		db.close();
	}
}

async function openChildHome(page: import('@playwright/test').Page): Promise<void> {
	await page.goto('/switch');
	await page.locator('[data-testid^="child-select-"]').filter({ hasText: NICKNAME }).click();
	await page.locator('[data-testid="elementary-home-page"]').waitFor({ state: 'visible' });
}

/** 既読 = 空文字 upsert (settings repo に削除 API が無いため、#4261 ③) */
async function isRead(workerDbPath: string, childId: number): Promise<boolean> {
	const { default: Database } = await import('better-sqlite3');
	const db = new Database(workerDbPath, { readonly: true });
	try {
		const row = db
			.prepare('SELECT value FROM settings WHERE key = ?')
			.get(`${NOTICE_KEY_PREFIX}${childId}`) as { value: string } | undefined;
		return row?.value === '';
	} finally {
		db.close();
	}
}

// /switch → home を 2 往復するため既定 30s では足りない (実測 ~35s、初回 compile 込み)。
// 同 worker DB の settings 行を共有するため serial (並行だと後続の cleanup が先行 test を壊す)。
test.describe.configure({ mode: 'serial', timeout: 120_000 });

test.describe('#4261 ③ 習慣化告知は 1 回だけ', () => {
	test('表示 → 再訪で出ない (既読化が画面遷移で失われない)', async ({ page, workerDbPath }) => {
		const childId = await childIdOf(workerDbPath);
		await seedNotice(workerDbPath, childId);

		try {
			// 1 回目: 出る
			await openChildHome(page);
			await expect(page.locator(NOTICE)).toBeVisible();
			// 閉じる操作をしていないのに既読になる (× を押させない、ADR-0012)。
			// network event ではなく **server 側の状態**を見る (既読化の結果そのもの)。
			await expect.poll(() => isRead(workerDbPath, childId), { timeout: 30_000 }).toBe(true);

			// 2 回目: 出ない
			await openChildHome(page);
			await expect(page.locator(NOTICE)).toHaveCount(0);
		} finally {
			await cleanupNotice(workerDbPath, childId);
		}
	});

	test('pending が無ければ出ない', async ({ page, workerDbPath }) => {
		const childId = await childIdOf(workerDbPath);
		await cleanupNotice(workerDbPath, childId);

		await openChildHome(page);

		await expect(page.locator(NOTICE)).toHaveCount(0);
	});
});
