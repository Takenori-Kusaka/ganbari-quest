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

	async function checkSql(name: string): Promise<string> {
		const { children } = await import('../../../src/lib/server/db/dsql/schema');
		const ck = getTableConfig(children).checks.find((c) => c.name === name);
		if (!ck) throw new Error(`CHECK not found: ${name}`);
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
});
