// tests/unit/helpers/plan-fixtures.test.ts
// #759 — plan-fixtures ヘルパ自体のユニットテスト

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
	makeFamilyContext,
	makeFreeContext,
	makeStandardContext,
	seedTrialActive,
	seedTrialActiveContext,
	seedTrialExpired,
	type TestSqlite,
} from '../../helpers/plan-fixtures';
import { closeDb, createTestDb } from './test-db';

/** ローカル時刻ベースで "YYYY-MM-DD" を返す（helper 側と同じ formatDate） */
function todayLocalStr(): string {
	const d = new Date();
	const y = d.getFullYear();
	const m = String(d.getMonth() + 1).padStart(2, '0');
	const day = String(d.getDate()).padStart(2, '0');
	return `${y}-${m}-${day}`;
}

describe('plan-fixtures', () => {
	let sqlite: TestSqlite;

	beforeEach(() => {
		const { sqlite: s } = createTestDb();
		sqlite = s;
	});

	afterEach(() => {
		closeDb(sqlite);
	});

	// ============================================================
	// AuthContext コンストラクタ
	// ============================================================

	describe('makeFreeContext', () => {
		it('licenseStatus=none / plan=undefined を返す', () => {
			const ctx = makeFreeContext();
			expect(ctx.licenseStatus).toBe('none');
			expect(ctx.plan).toBeUndefined();
			expect(ctx.role).toBe('owner');
			expect(ctx.tenantId).toBe('test-tenant-1');
		});

		it('overrides が反映される', () => {
			const ctx = makeFreeContext({ tenantId: 't-42', role: 'parent', childId: 7 });
			expect(ctx.tenantId).toBe('t-42');
			expect(ctx.role).toBe('parent');
			expect(ctx.childId).toBe(7);
		});
	});

	describe('makeStandardContext', () => {
		it('licenseStatus=active / plan=monthly を返す', () => {
			const ctx = makeStandardContext();
			expect(ctx.licenseStatus).toBe('active');
			expect(ctx.plan).toBe('monthly');
		});
	});

	describe('makeFamilyContext', () => {
		it('licenseStatus=active / plan=family-monthly を返す', () => {
			const ctx = makeFamilyContext();
			expect(ctx.licenseStatus).toBe('active');
			expect(ctx.plan).toBe('family-monthly');
		});
	});

	// ============================================================
	// seedTrialActive
	// ============================================================

	describe('seedTrialActive', () => {
		it('trial_history に行を 1 件挿入する', () => {
			seedTrialActive(sqlite, { tenantId: 't-trial' });
			const rows = sqlite
				.prepare('SELECT COUNT(*) as c FROM trial_history WHERE tenant_id = ?')
				.get('t-trial') as { c: number };
			expect(rows.c).toBe(1);
		});

		it('end_date が今日より未来になる', () => {
			seedTrialActive(sqlite, { tenantId: 't-trial', daysOffset: 5 });
			const row = sqlite
				.prepare('SELECT end_date FROM trial_history WHERE tenant_id = ?')
				.get('t-trial') as { end_date: string };
			expect(row.end_date > todayLocalStr()).toBe(true);
		});

		it('tier=family を指定できる', () => {
			seedTrialActive(sqlite, { tenantId: 't-trial', tier: 'family' });
			const row = sqlite
				.prepare('SELECT tier FROM trial_history WHERE tenant_id = ?')
				.get('t-trial') as { tier: string };
			expect(row.tier).toBe('family');
		});

		it('source / campaignId を指定できる', () => {
			seedTrialActive(sqlite, {
				tenantId: 't-trial',
				source: 'campaign',
				campaignId: 'spring-2026',
			});
			const row = sqlite
				.prepare('SELECT source, campaign_id FROM trial_history WHERE tenant_id = ?')
				.get('t-trial') as { source: string; campaign_id: string };
			expect(row.source).toBe('campaign');
			expect(row.campaign_id).toBe('spring-2026');
		});

		it('返り値に tenantId / 日付 / tier が含まれる', () => {
			const result = seedTrialActive(sqlite, { tenantId: 't-trial' });
			expect(result.tenantId).toBe('t-trial');
			expect(result.tier).toBe('standard');
			expect(result.startDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
			expect(result.endDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
		});
	});

	// ============================================================
	// seedTrialExpired
	// ============================================================

	describe('seedTrialExpired', () => {
		it('end_date が今日より過去になる', () => {
			seedTrialExpired(sqlite, { tenantId: 't-expired' });
			const row = sqlite
				.prepare('SELECT end_date FROM trial_history WHERE tenant_id = ?')
				.get('t-expired') as { end_date: string };
			expect(row.end_date < todayLocalStr()).toBe(true);
		});

		it('start_date < end_date', () => {
			seedTrialExpired(sqlite, { tenantId: 't-expired' });
			const row = sqlite
				.prepare('SELECT start_date, end_date FROM trial_history WHERE tenant_id = ?')
				.get('t-expired') as { start_date: string; end_date: string };
			expect(row.start_date < row.end_date).toBe(true);
		});
	});

	// ============================================================
	// seedTrialActiveContext（組み合わせ）
	// ============================================================

	describe('seedTrialActiveContext', () => {
		it('AuthContext と seed されたレコードを同時に返す', () => {
			const { context, trial } = seedTrialActiveContext(sqlite, {
				tenantId: 't-combo',
				tier: 'family',
				daysOffset: 3,
			});

			// context: licenseStatus=none のまま（trial で resolve される）
			expect(context.tenantId).toBe('t-combo');
			expect(context.licenseStatus).toBe('none');
			expect(context.plan).toBeUndefined();

			// trial: family tier で挿入されている
			expect(trial.tier).toBe('family');
			expect(trial.tenantId).toBe('t-combo');

			// DB にも行がある
			const count = sqlite
				.prepare('SELECT COUNT(*) as c FROM trial_history WHERE tenant_id = ?')
				.get('t-combo') as { c: number };
			expect(count.c).toBe(1);
		});
	});
});
