// tests/unit/db/dsql-check-from-ssot.test.ts
// EPIC #3424 / 実装 #3512 / 設計 SSOT: docs/design/dsql-data-model.md §11.1 / §13.1(fitness#13)
//
// fitness#13「dialect-parity / CHECK は SSOT 生成」:
//   children の theme/ui_mode/archived_reason CHECK 制約は age-tier-types.ts / labels.ts /
//   archive-types.ts の SSOT から生成し、DDL に値を手書き二重化しない (§11.1)。
//   SSOT に値を足したのに DDL の CHECK が古いまま = drift を CI で検出する。
//   pg/sqlite 両 backend が同一 helper (enumCheck) + 同一 SSOT を使うため CHECK 文字列は
//   構造的に一致する (dialect-parity)。sqlite 側 children の CHECK 付与は cutover [4] で追加。
//
// ── Canon TDD (red-first) ── check-constraints helper + children CHECK 未実装で fail。

import { getTableConfig, PgDialect } from 'drizzle-orm/pg-core';
import { describe, expect, it, vi } from 'vitest';
import { ARCHIVED_REASONS } from '$lib/domain/archive-types';
import { UI_MODES } from '$lib/domain/validation/age-tier-types';

describe('fitness#13: children DDL CHECK は SSOT 生成 (手書き二重化禁止)', () => {
	const dialect = new PgDialect();

	async function checkSql(name: string, tableName = 'children'): Promise<string> {
		const schema = (await import('../../../src/lib/server/db/dsql/schema')) as Record<
			string,
			unknown
		>;
		// biome-ignore lint/suspicious/noExplicitAny: getTableConfig は PgTable を要求、export 走査のため
		const table = schema[tableName] as any;
		const ck = getTableConfig(table).checks.find((c) => c.name === name);
		if (!ck) throw new Error(`CHECK not found: ${tableName}.${name}`);
		return dialect.sqlToQuery(ck.value).sql;
	}

	it('ui_mode CHECK が UI_MODES 全値を含む (SSOT 生成)', async () => {
		const s = await checkSql('children_ui_mode_ck');
		for (const m of UI_MODES) expect(s).toContain(`'${m}'`);
	});

	it('archived_reason CHECK が ARCHIVED_REASONS 全値を含む (SSOT 生成)', async () => {
		const s = await checkSql('children_archived_reason_ck');
		for (const r of ARCHIVED_REASONS) expect(s).toContain(`'${r}'`);
	});

	it('theme CHECK が THEME_KEYS 全値を含む (SSOT 生成)', async () => {
		const { THEME_KEYS } = await import('../../../src/lib/server/db/dsql/check-constraints');
		const s = await checkSql('children_theme_ck');
		for (const t of THEME_KEYS) expect(s).toContain(`'${t}'`);
	});

	// ── auth 3 表 (§6.6、#3528 cycle (a)) ──

	it('memberships role CHECK が ROLES 全値を含む (SSOT 生成)', async () => {
		const { ROLES } = await import('../../../src/lib/server/auth/types');
		const s = await checkSql('memberships_role_ck', 'memberships');
		for (const r of ROLES) expect(s).toContain(`'${r}'`);
	});

	it('families status CHECK が ALL_SUBSCRIPTION_STATUSES 全値を含む (SSOT 生成)', async () => {
		const { ALL_SUBSCRIPTION_STATUSES } = await import(
			'../../../src/lib/domain/constants/subscription-status'
		);
		const s = await checkSql('families_status_ck', 'families');
		for (const st of ALL_SUBSCRIPTION_STATUSES) expect(s).toContain(`'${st}'`);
	});

	it('users provider CHECK が AUTH_PROVIDERS 全値を含む (SSOT 生成)', async () => {
		const { AUTH_PROVIDERS } = await import('../../../src/lib/server/auth/entities');
		const s = await checkSql('users_provider_ck', 'users');
		for (const p of AUTH_PROVIDERS) expect(s).toContain(`'${p}'`);
	});

	// ── child_activities (#3539 #N4-1 Phase C) ──

	it('child_activities priority CHECK が ACTIVITY_PRIORITY_KEYS 全値を含む (SSOT 生成)', async () => {
		const { ACTIVITY_PRIORITY_KEYS } = await import(
			'../../../src/lib/server/db/dsql/check-constraints'
		);
		const s = await checkSql('child_activities_priority_ck', 'childActivities');
		expect(ACTIVITY_PRIORITY_KEYS.length).toBeGreaterThan(0);
		for (const p of ACTIVITY_PRIORITY_KEYS) expect(s).toContain(`'${p}'`);
	});

	it('child_activities archived_reason CHECK が ARCHIVED_REASONS 全値を含む (SSOT 生成)', async () => {
		const s = await checkSql('child_activities_archived_reason_ck', 'childActivities');
		for (const r of ARCHIVED_REASONS) expect(s).toContain(`'${r}'`);
	});

	// ── stamp_cards / checklist_templates (#N4 StampCard/ChecklistTemplate 集約) ──

	it('stamp_cards status CHECK が STAMP_CARD_STATUSES 全値を含む (SSOT 生成)', async () => {
		const { STAMP_CARD_STATUSES } = await import(
			'../../../src/lib/domain/constants/stamp-card-status'
		);
		const s = await checkSql('stamp_cards_status_ck', 'stampCards');
		expect(STAMP_CARD_STATUSES.length).toBeGreaterThan(0);
		for (const st of STAMP_CARD_STATUSES) expect(s).toContain(`'${st}'`);
	});

	it('checklist_templates time_slot CHECK が VALID_TIME_SLOTS 全値を含む (SSOT 生成)', async () => {
		const { VALID_TIME_SLOTS } = await import(
			'../../../src/lib/domain/constants/checklist-time-slot'
		);
		const s = await checkSql('checklist_templates_time_slot_ck', 'checklistTemplates');
		for (const t of VALID_TIME_SLOTS) expect(s).toContain(`'${t}'`);
	});

	// ── daily_battles / checklist_overrides (#3424 Child 集約 Slice A) ──

	it('daily_battles status/outcome CHECK が SSOT 全値を含む (DAILY_BATTLE_STATUSES / BATTLE_OUTCOMES)', async () => {
		const { DAILY_BATTLE_STATUSES, BATTLE_OUTCOMES } = await import(
			'../../../src/lib/domain/battle-types'
		);
		const statusSql = await checkSql('daily_battles_status_ck', 'dailyBattles');
		for (const st of DAILY_BATTLE_STATUSES) expect(statusSql).toContain(`'${st}'`);
		const outcomeSql = await checkSql('daily_battles_outcome_ck', 'dailyBattles');
		for (const o of BATTLE_OUTCOMES) expect(outcomeSql).toContain(`'${o}'`);
	});

	it('checklist_overrides action CHECK が CHECKLIST_OVERRIDE_ACTIONS 全値を含む (SSOT 生成)', async () => {
		const { CHECKLIST_OVERRIDE_ACTIONS } = await import(
			'../../../src/lib/domain/constants/checklist-override-action'
		);
		const s2 = await checkSql('checklist_overrides_action_ck', 'checklistOverrides');
		for (const a of CHECKLIST_OVERRIDE_ACTIONS) expect(s2).toContain(`'${a}'`);
	});

	// ── Slice B: parent_messages / reward_redemption_requests / child_challenges (#3424) ──

	it('parent_messages message_type CHECK が MESSAGE_TYPES 全値を含む (SSOT 生成)', async () => {
		const { MESSAGE_TYPES } = await import('../../../src/lib/domain/validation/message');
		const s2 = await checkSql('parent_messages_message_type_ck', 'parentMessages');
		for (const m of MESSAGE_TYPES) expect(s2).toContain(`'${m}'`);
	});

	it('reward_redemption_requests status CHECK が REDEMPTION_STATUSES 全値を含む (SSOT 生成)', async () => {
		const { REDEMPTION_STATUSES } = await import(
			'../../../src/lib/domain/constants/redemption-status'
		);
		const s2 = await checkSql('reward_redemption_requests_status_ck', 'rewardRedemptionRequests');
		for (const st of REDEMPTION_STATUSES) expect(s2).toContain(`'${st}'`);
	});

	it('child_challenges status/period_type CHECK が SSOT 全値を含む (challenge_type は増減集合で対象外)', async () => {
		const { CHILD_CHALLENGE_STATUSES, CHALLENGE_PERIOD_TYPES } = await import(
			'../../../src/lib/domain/constants/child-challenge'
		);
		const statusSql = await checkSql('child_challenges_status_ck', 'childChallenges');
		for (const st of CHILD_CHALLENGE_STATUSES) expect(statusSql).toContain(`'${st}'`);
		const periodSql = await checkSql('child_challenges_period_type_ck', 'childChallenges');
		for (const pt of CHALLENGE_PERIOD_TYPES) expect(periodSql).toContain(`'${pt}'`);
	});

	// ── Slice C: cloud_exports (#3424 Family 系) ──

	it('cloud_exports status CHECK が CLOUD_EXPORT_STATUSES 全値を含む (SSOT 生成)', async () => {
		const { CLOUD_EXPORT_STATUSES } = await import(
			'../../../src/lib/domain/constants/cloud-export-status'
		);
		const s2 = await checkSql('cloud_exports_status_ck', 'cloudExports');
		for (const st of CLOUD_EXPORT_STATUSES) expect(s2).toContain(`'${st}'`);
	});

	// ── invites / consents (§6.6、#3528 cycle (b)) ──

	it('invites status/role CHECK が SSOT 全値を含む (INVITE_STATUSES / ROLES)', async () => {
		const { INVITE_STATUSES } = await import('../../../src/lib/server/auth/entities');
		const { ROLES } = await import('../../../src/lib/server/auth/types');
		const statusSql = await checkSql('invites_status_ck', 'invites');
		for (const st of INVITE_STATUSES) expect(statusSql).toContain(`'${st}'`);
		const roleSql = await checkSql('invites_role_ck', 'invites');
		for (const r of ROLES) expect(roleSql).toContain(`'${r}'`);
	});

	// #4497: consents.type は 'cross-border' の追加で「作成時に確定した不変集合」でなくなった。
	// DSQL は ALTER で CHECK を張り直せない (§10-5 / transform.ts は ADD CONSTRAINT を throw) ため、
	// 0000 の inline CHECK は migration 0007 で DROP し、許可値の強制を app 層へ移した。
	// CHECK の再導入は本番 DSQL に適用不能な DDL を生むので、無いことを固定する。
	it('consents.type には CHECK を張らない (値集合が増える型、#4497 / migration 0007)', async () => {
		const { consents } = await import('../../../src/lib/server/db/dsql/schema');
		const checks = getTableConfig(consents).checks.map((c) => c.name);
		expect(
			checks,
			'consents.type の CHECK は DSQL で後から広げられない。許可値は CONSENT_TYPES + recordConsent で強制する',
		).toEqual([]);
	});

	it('consents.type の許可値強制が app 層に存在する (DB CHECK の代替、#4497)', async () => {
		vi.resetModules();
		vi.doMock('$lib/server/db/factory', () => ({
			getRepos: () => ({
				auth: {
					recordConsent: async (input: unknown) => input,
					findLatestConsent: async () => undefined,
					findAllConsents: async () => [],
				},
			}),
		}));
		vi.doMock('$lib/server/logger', () => ({
			logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
		}));

		const { recordConsent } = await import('../../../src/lib/server/services/consent-service');
		const { CONSENT_TYPES } = await import('../../../src/lib/server/auth/entities');

		// SSOT に載っている種別は書ける
		await expect(
			recordConsent('t-1', 'u-1', CONSENT_TYPES, '127.0.0.1', 'ua'),
		).resolves.toHaveLength(CONSENT_TYPES.length);

		// 載っていない種別は拒否される (旧 DB CHECK と同じ役割)
		await expect(
			recordConsent(
				't-1',
				'u-1',
				['marketing' as unknown as (typeof CONSENT_TYPES)[number]],
				'127.0.0.1',
				'ua',
			),
		).rejects.toThrow(/Unknown consent type/);

		vi.doUnmock('$lib/server/db/factory');
		vi.doUnmock('$lib/server/logger');
		vi.resetModules();
	});

	it('families.plan には CHECK を張らない (plans lookup 参照、§6.6 営業パネル 2026-07-01)', async () => {
		const { families } = await import('../../../src/lib/server/db/dsql/schema');
		const checks = getTableConfig(families).checks.map((c) => c.name);
		expect(
			checks.some((n) => n.includes('plan')),
			'plan CHECK は増減集合ゆえ禁止',
		).toBe(false);
	});
});
