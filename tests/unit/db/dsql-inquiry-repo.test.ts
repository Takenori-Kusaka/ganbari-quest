// tests/unit/db/dsql-inquiry-repo.test.ts
// EPIC #3424 / #3612 / 設計 SSOT: inquiry-repo.ts ヘッダー
//
// IInquiryRepo DSQL 実装の契約テスト (実 schema PGlite):
//   - 専用表 round-trip (settings KVS 間借りからの脱却、#3612 案 A)
//   - family_id nullable (未ログイン founder 導線)
//   - status CHECK (INQUIRY_STATUSES SSOT からの機械生成)
//   - inquiry_id 形式 (sqlite backend と同形式 INQ-YYYYMMDD-nnnn)

import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { isCheckViolation } from '../../../src/lib/server/db/dsql/dsql-errors';
import { createDsqlInquiryRepo } from '../../../src/lib/server/db/dsql/inquiry-repo';
import type { IInquiryRepo } from '../../../src/lib/server/db/interfaces/inquiry-repo.interface';
import { createDsqlTestDb, type DsqlTestDb } from '../helpers/dsql-test-db';

const FAMILY = '00000000-0000-4000-8000-0000000000f1';

describe('DSQL inquiry-repo (#3612、実 schema PGlite)', () => {
	let t: DsqlTestDb;
	let repo: IInquiryRepo;

	beforeAll(async () => {
		t = await createDsqlTestDb();
		repo = createDsqlInquiryRepo(t.db);
	}, 60_000);
	afterAll(async () => {
		await t.close();
	});

	const record = (overrides?: Partial<Parameters<IInquiryRepo['saveInquiry']>[0]>) => ({
		inquiryId: 'INQ-20260709-0001',
		tenantId: FAMILY,
		email: 'parent@example.com',
		replyEmail: null,
		category: 'consultation',
		body: '相談内容です',
		status: 'open' as const,
		createdAt: '2026-07-09T00:00:00.000Z',
		...overrides,
	});

	it('[Q1] saveInquiry → 専用表に全フィールド round-trip', async () => {
		await repo.saveInquiry(record());
		const rows = await t.db.execute(
			sql`SELECT * FROM inquiries WHERE inquiry_id = 'INQ-20260709-0001'`,
		);
		const row = rows.rows[0] as Record<string, unknown>;
		expect(row.family_id).toBe(FAMILY);
		expect(row.email).toBe('parent@example.com');
		expect(row.category).toBe('consultation');
		expect(row.body).toBe('相談内容です');
		expect(row.status).toBe('open');
	});

	it('[Q2] family_id nullable: 未ログイン founder 導線 (tenantId=null) を受ける', async () => {
		await repo.saveInquiry(
			record({ inquiryId: 'INQ-20260709-0002', tenantId: null, email: 'anon@example.com' }),
		);
		const rows = await t.db.execute(
			sql`SELECT family_id FROM inquiries WHERE inquiry_id = 'INQ-20260709-0002'`,
		);
		expect((rows.rows[0] as { family_id: unknown }).family_id).toBeNull();
	});

	it('[Q3] status CHECK: INQUIRY_STATUSES 逸脱は 23514 で拒否 (SSOT 機械生成)', async () => {
		let caught: unknown;
		try {
			await t.db.execute(sql`
				INSERT INTO inquiries (inquiry_id, email, category, body, status)
				VALUES ('INQ-20260709-0003', 'x@example.com', 'c', 'b', 'invalid-status')
			`);
		} catch (err) {
			caught = err;
		}
		expect(isCheckViolation(caught)).toBe(true);
	});

	it('[Q4] generateInquiryId は sqlite backend と同形式 (INQ-YYYYMMDD-nnnn)', async () => {
		const id = await repo.generateInquiryId();
		expect(id).toMatch(/^INQ-\d{8}-\d{4}$/);
	});
});
