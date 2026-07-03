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
import { describe, expect, it } from 'vitest';
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

	// ── invites / consents (§6.6、#3528 cycle (b)) ──

	it('invites status/role CHECK が SSOT 全値を含む (INVITE_STATUSES / ROLES)', async () => {
		const { INVITE_STATUSES } = await import('../../../src/lib/server/auth/entities');
		const { ROLES } = await import('../../../src/lib/server/auth/types');
		const statusSql = await checkSql('invites_status_ck', 'invites');
		for (const st of INVITE_STATUSES) expect(statusSql).toContain(`'${st}'`);
		const roleSql = await checkSql('invites_role_ck', 'invites');
		for (const r of ROLES) expect(roleSql).toContain(`'${r}'`);
	});

	it('consents type CHECK が CONSENT_TYPES 全値を含む (SSOT 生成)', async () => {
		const { CONSENT_TYPES } = await import('../../../src/lib/server/auth/entities');
		const s = await checkSql('consents_type_ck', 'consents');
		for (const t of CONSENT_TYPES) expect(s).toContain(`'${t}'`);
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
