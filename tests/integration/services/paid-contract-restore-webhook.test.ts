// tests/integration/services/paid-contract-restore-webhook.test.ts
// #4708 AC1: 「trial 終了で archive → 有料購入 → 復元される」を **webhook 経路で** 実 DB に対して固定する。
//
// なぜこの層か: 旧実装は復元関数 `restoreArchivedResources` の呼び手が
// `POST /api/v1/admin/downgrade-restore` だけで、顧客が実際に有料化する経路 (Stripe webhook) から
// 一切呼ばれていなかった。E2E (downgrade-flow.spec.ts) は復元 API を **後片付け**に直叩きしていたため、
// 「webhook では復元されない」ことを誰も検出できなかった。ここでは Stripe SDK だけを差し替え、
// handleWebhookEvent → 契約状態の書き込み → 復元 → 実 DB の行が戻る、までを通しで assert する。

import Database from 'better-sqlite3';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as schema from '../../../src/lib/server/db/schema';

let sqlite: InstanceType<typeof Database>;
let testDb: ReturnType<typeof drizzle>;

// local (sqlite) auth repo のダミーテナント id (src/lib/server/db/sqlite/auth-repo.ts)
const TENANT = 'local';
const SUB_ID = 'sub_new';

const SQL_TABLES = `
	CREATE TABLE categories (
		id INTEGER PRIMARY KEY, code TEXT NOT NULL UNIQUE, name TEXT NOT NULL, icon TEXT, color TEXT
	);
	INSERT INTO categories VALUES (1, 'undou', 'うんどう', '🏃', '#FF6B6B');

	CREATE TABLE children (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		nickname TEXT NOT NULL, age INTEGER NOT NULL, birth_date TEXT,
		-- #4718: 年齢だけで登録した子供の誕生日は「推定値」であることを持つ列。
		-- drizzle schema (src/lib/server/db/schema) に合わせないと insert が
		-- 「table children has no column named birth_date_estimated」で落ちる。
		birth_date_estimated INTEGER NOT NULL DEFAULT 0,
		theme TEXT NOT NULL DEFAULT 'pink',
		ui_mode TEXT NOT NULL DEFAULT 'preschool',
		ui_mode_manually_set INTEGER NOT NULL DEFAULT 0,
		avatar_url TEXT, active_title_id INTEGER, display_config TEXT, user_id TEXT,
		birthday_bonus_multiplier REAL NOT NULL DEFAULT 1.0,
		last_birthday_bonus_year INTEGER,
		created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
		updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
		_sv INTEGER,
		is_archived INTEGER NOT NULL DEFAULT 0,
		archived_reason TEXT
	);

	CREATE TABLE child_activities (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		child_id INTEGER NOT NULL REFERENCES children(id) ON DELETE CASCADE,
		name TEXT NOT NULL,
		category_id INTEGER NOT NULL REFERENCES categories(id),
		icon TEXT NOT NULL,
		base_points INTEGER NOT NULL DEFAULT 5,
		is_visible INTEGER NOT NULL DEFAULT 1,
		daily_limit INTEGER,
		sort_order INTEGER NOT NULL DEFAULT 0,
		source TEXT NOT NULL DEFAULT 'seed',
		name_kana TEXT, name_kanji TEXT, trigger_hint TEXT,
		is_main_quest INTEGER NOT NULL DEFAULT 0,
		created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
		is_archived INTEGER NOT NULL DEFAULT 0,
		archived_reason TEXT,
		source_preset_id TEXT,
		priority TEXT NOT NULL DEFAULT 'optional'
	);

	CREATE TABLE checklist_templates (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		tenant_id TEXT NOT NULL DEFAULT 'default',
		name TEXT NOT NULL,
		icon TEXT NOT NULL DEFAULT '📋',
		points_per_item INTEGER NOT NULL DEFAULT 2,
		completion_bonus INTEGER NOT NULL DEFAULT 5,
		time_slot TEXT NOT NULL DEFAULT 'anytime',
		is_active INTEGER NOT NULL DEFAULT 1,
		created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
		updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
		is_archived INTEGER NOT NULL DEFAULT 0,
		archived_reason TEXT,
		source_preset_id TEXT
	);
	CREATE TABLE checklist_template_assignments (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		template_id INTEGER NOT NULL REFERENCES checklist_templates(id),
		child_id INTEGER NOT NULL REFERENCES children(id),
		created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
	);

	CREATE TABLE activity_logs (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		child_id INTEGER NOT NULL REFERENCES children(id),
		activity_id INTEGER NOT NULL REFERENCES child_activities(id),
		points INTEGER NOT NULL,
		streak_days INTEGER NOT NULL DEFAULT 1,
		streak_bonus INTEGER NOT NULL DEFAULT 0,
		recorded_date TEXT NOT NULL,
		recorded_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
		cancelled INTEGER NOT NULL DEFAULT 0
	);
	CREATE INDEX idx_activity_logs_child_date ON activity_logs(child_id, recorded_date);

	CREATE TABLE settings (
		key TEXT PRIMARY KEY, value TEXT NOT NULL,
		updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
	);
	CREATE TABLE stripe_webhook_events (
		event_id TEXT PRIMARY KEY,
		event_type TEXT NOT NULL,
		processed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
		handler_result TEXT NOT NULL,
		error_message TEXT,
		retry_count INTEGER NOT NULL DEFAULT 0,
		tenant_id TEXT
	);
`;

vi.mock('$lib/server/db', () => ({
	get db() {
		return testDb;
	},
}));
vi.mock('$lib/server/db/client', () => ({
	get db() {
		return testDb;
	},
}));

// Stripe SDK だけを差し替える (契約状態の書き込み / 復元は実装と実 DB のまま)
const mockGetStripeClient = vi.fn();
vi.mock('$lib/server/stripe/client', () => ({
	isStripeEnabled: () => true,
	getStripeClient: (...args: unknown[]) => mockGetStripeClient(...args),
}));
vi.mock('$lib/server/stripe/config', () => ({
	getPlans: () => ({
		monthly: { priceId: 'price_monthly_123', amount: 500, interval: 'month', label: '月額' },
	}),
	planIdFromPriceId: (priceId: string) => (priceId === 'price_monthly_123' ? 'monthly' : null),
	planIdFromLookupKey: () => null,
	getWebhookSecret: () => 'whsec_test',
	GRACE_PERIOD_DAYS: 7,
	CURRENCY: 'jpy',
}));
vi.mock('$lib/server/stripe/alert', () => ({ notifyStripeAlert: vi.fn() }));
vi.mock('$lib/server/services/discord-notify-service', () => ({
	notifyBillingEvent: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('$lib/server/logger', () => ({
	logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { archiveExcessResources } from '../../../src/lib/server/services/resource-archive-service';
import { handleWebhookEvent } from '../../../src/lib/server/services/stripe-service';

beforeAll(() => {
	sqlite = new Database(':memory:');
	sqlite.pragma('foreign_keys = ON');
	sqlite.exec(SQL_TABLES);
	testDb = drizzle(sqlite, { schema });
});

afterAll(() => {
	sqlite.close();
});

beforeEach(() => {
	vi.clearAllMocks();
	sqlite.exec('DELETE FROM activity_logs');
	sqlite.exec('DELETE FROM checklist_template_assignments');
	sqlite.exec('DELETE FROM checklist_templates');
	sqlite.exec('DELETE FROM child_activities');
	sqlite.exec('DELETE FROM children');
	sqlite.exec('DELETE FROM settings');
	sqlite.exec('DELETE FROM stripe_webhook_events');
	sqlite.exec(
		"DELETE FROM sqlite_sequence WHERE name IN ('children','child_activities','checklist_templates','checklist_template_assignments')",
	);
	mockGetStripeClient.mockReturnValue({
		subscriptions: {
			retrieve: vi.fn().mockResolvedValue({
				id: SUB_ID,
				customer: 'cus_new',
				status: 'active',
				metadata: { tenantId: TENANT },
				items: { data: [{ price: { id: 'price_monthly_123', lookup_key: null } }] },
			}),
		},
	});
});

/** 無料プランの上限を超える 3 資源を作る (子供 4 / カスタム活動 5 / チェックリスト 4) */
function seedOverLimit() {
	for (let i = 1; i <= 4; i++) {
		testDb
			.insert(schema.children)
			.values({ nickname: `テストちゃん${i}`, age: 6 })
			.run();
	}
	const firstChild = testDb.select({ id: schema.children.id }).from(schema.children).get();
	if (!firstChild) throw new Error('seed failed');
	for (let i = 1; i <= 5; i++) {
		testDb
			.insert(schema.childActivities)
			.values({
				childId: firstChild.id,
				name: `カスタム活動${i}`,
				categoryId: 1,
				icon: '🏃',
				basePoints: 5,
				source: 'custom',
				sortOrder: i,
			})
			.run();
	}
	for (let i = 1; i <= 4; i++) {
		const t = testDb
			.insert(schema.checklistTemplates)
			.values({ name: `テンプレ${i}`, icon: '📋', tenantId: TENANT })
			.returning()
			.get();
		testDb
			.insert(schema.checklistTemplateAssignments)
			.values({ templateId: t.id, childId: firstChild.id })
			.run();
	}
}

const countArchived = () => ({
	children: testDb.select().from(schema.children).where(eq(schema.children.isArchived, 1)).all()
		.length,
	activities: testDb
		.select()
		.from(schema.childActivities)
		.where(eq(schema.childActivities.isArchived, 1))
		.all().length,
	checklists: testDb
		.select()
		.from(schema.checklistTemplates)
		.where(eq(schema.checklistTemplates.isArchived, 1))
		.all().length,
});

const checkoutEvent = {
	id: 'evt_checkout_restore',
	type: 'checkout.session.completed',
	data: {
		object: {
			id: 'cs_test',
			metadata: { tenantId: TENANT, planId: 'monthly' },
			customer: 'cus_new',
			subscription: SUB_ID,
			customer_details: { email: 'owner@example.com' },
			customer_email: null,
		},
	},
};

describe('#4708 trial 終了で archive → 有料購入 (webhook) → 実 DB で復元される', () => {
	it('checkout.session.completed (W1) で 3 資源とも復元される', async () => {
		seedOverLimit();
		await archiveExcessResources(TENANT);
		const archived = countArchived();
		expect(archived.children).toBeGreaterThan(0);
		expect(archived.activities).toBeGreaterThan(0);
		expect(archived.checklists).toBeGreaterThan(0);

		// biome-ignore lint/suspicious/noExplicitAny: Stripe.Event の fixture は部分形で足りる
		await handleWebhookEvent(checkoutEvent as any);

		expect(countArchived()).toEqual({ children: 0, activities: 0, checklists: 0 });
	});

	// W2 (invoice.paid) / W4 (subscription.updated) の復元は本層では駆動できない:
	// local (sqlite) の auth repo は `findTenantByStripeCustomerId` が常に undefined を返すため
	// (契約 4 列は settings の単一ダミーテナントに持つ設計、#4156)、`resolveSubscriptionContext` が
	// tenant を解決できず handler が早期 return する。実 DB で見られるのは customer 逆引きを要しない
	// W1 (metadata.tenantId 直参照) のみ。W2 / W4 の分岐は
	// `tests/unit/services/stripe-paid-contract-restore.test.ts` が repo を差し替えて網羅する。

	it('顧客自身が選んで archive した分 (downgrade_user_selected) も同じ webhook で戻る', async () => {
		seedOverLimit();
		await archiveExcessResources(TENANT, 'trial_expired');
		// 顧客選択による archive を混在させる
		sqlite.exec(
			"UPDATE children SET is_archived = 1, archived_reason = 'downgrade_user_selected' WHERE id = 1",
		);
		expect(countArchived().children).toBeGreaterThan(1);

		// biome-ignore lint/suspicious/noExplicitAny: Stripe.Event の fixture は部分形で足りる
		await handleWebhookEvent(checkoutEvent as any);

		expect(countArchived()).toEqual({ children: 0, activities: 0, checklists: 0 });
	});
});
