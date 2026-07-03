// tests/unit/db/dsql-stamp-checklist-schema.test.ts
// EPIC #3424 / Phase C (StampCard / ChecklistTemplate 集約) / 設計 SSOT: dsql-data-model.md §11.2 / §3
//
// §11.2 凍結表のうち PK 以外の構造要件 (fitness#9 の PK 検証で拾えないもの) を assert:
//   - stamp_entries: UNIQUE (family_id, card_id, login_date) — 1日1押印 (consistency minor)
//   - checklist_template_assignments: secondary (family_id, child_id) — findTemplatesByChild hot
// PK / temporal / CHECK は既存 fitness#9/#6/#13 が自動検証する。
//
// ── Canon TDD (red-first) ── 対象表の DDL 未実装で fail。

import { getTableConfig } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';

describe('StampCard / ChecklistTemplate 集約 DDL の構造要件 (§11.2 補助 UNIQUE/secondary)', () => {
	it('stamp_cards に droppable UNIQUE (family_id, child_id, week_start) がある (1子1週1枚、PO 決裁 2026-07-03)', async () => {
		const { stampCards } = await import('../../../src/lib/server/db/dsql/schema');
		const cfg = getTableConfig(stampCards);
		const uniqueCols = cfg.uniqueConstraints.map((u) => u.columns.map((c) => c.name).join(','));
		expect(uniqueCols).toContain('family_id,child_id,week_start');
	});

	it('stamp_entries に UNIQUE (family_id, card_id, login_date) がある (1日1押印)', async () => {
		const { stampEntries } = await import('../../../src/lib/server/db/dsql/schema');
		const cfg = getTableConfig(stampEntries);
		const uniqueCols = cfg.uniqueConstraints.map((u) => u.columns.map((c) => c.name).join(','));
		expect(uniqueCols).toContain('family_id,card_id,login_date');
	});

	it('checklist_template_assignments に secondary (family_id, child_id) がある (findTemplatesByChild hot)', async () => {
		const { checklistTemplateAssignments } = await import('../../../src/lib/server/db/dsql/schema');
		const cfg = getTableConfig(checklistTemplateAssignments);
		const indexCols = cfg.indexes.map((i) =>
			i.config.columns.map((c) => ('name' in c ? (c as { name: string }).name : '')).join(','),
		);
		expect(indexCols).toContain('family_id,child_id');
	});
});
