// tests/unit/architecture/dsql-child-scoped-tables-fitness.test.ts
// #3584 ① — deleteChild の CHILD_SCOPED_TABLES 網羅性 fitness (ADR-0061 fitness function)。
//
// 背景: deleteChild は FK/CASCADE 非対応の DSQL (§P4) で child 集約 27+ 表を明示 DELETE する。
// 旧検証は「CHILD_SCOPED_TABLES と test の削除確認 list が同一」のトートロジーで、将来
// child_id 列を持つ表を schema に追加した際、list 未更新でも test 緑のまま通り本番で
// orphan 行が残る (支払い/記録データの残骸 = プライバシー/整合性事故)。
//
// 本 fitness は **drizzle schema (実物) を introspect** して child 参照列を持つ全表を列挙し、
// CHILD_SCOPED_TABLES ∪ 明示特例 と完全一致することを assert する。schema に新表を足すと
// (a) CHILD_SCOPED_TABLES に追加するか (b) 本 test の特例に理由付きで登録するまで CI が fail する
// (no-silent-gap、admin-resource-model-registry の除外リスト方式と同型)。

import { getTableConfig } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';
import { CHILD_SCOPED_TABLES } from '../../../src/lib/server/db/child-scoped-tables';
import * as schema from '../../../src/lib/server/db/dsql/schema';

/** child_id 列そのものを持つが CHILD_SCOPED_TABLES の一括 DELETE 対象にしない表 (理由必須)。 */
const EXPLICIT_EXCLUSIONS: Record<string, string> = {
	// deleteChild の最後に単独 DELETE される集約 root (CHILD_SCOPED_TABLES は「配下」のみ)
	children: 'child 集約 root。deleteChild が最後に単独 DELETE する',
	// auth 集約: 招待は期限切れで自然消滅させる (child-repo.ts 冒頭コメントの設計判断)
	invites: 'auth 集約のため touch しない (招待は期限切れで自然消滅、child-repo.ts §設計契約)',
};

/** child_id という名前ではないが child を参照する列を持つ表 (deleteChild 内で個別処理)。 */
const NON_STANDARD_CHILD_REFS: Record<string, string> = {
	// from_child_id / to_child_id の 2 軸参照 → deleteChild が OR 条件で個別 DELETE
	sibling_cheers: 'from_child_id / to_child_id の 2 参照軸 (deleteChild 内で個別 DELETE)',
	// child_id 列なし (card_id 参照) → stamp_cards の削除前に subquery で個別 DELETE
	stamp_entries: 'card_id 経由の子孫表 (deleteChild が stamp_cards より先に subquery DELETE)',
};

describe('#3584 ① CHILD_SCOPED_TABLES 網羅性 fitness (schema 実物と突合)', () => {
	// drizzle schema の全 pgTable を introspect する
	const allTables = Object.values(schema)
		.map((v) => {
			try {
				return getTableConfig(v as Parameters<typeof getTableConfig>[0]);
			} catch {
				return null; // pgTable 以外の export (enum / relation 等) は無視
			}
		})
		.filter((c): c is NonNullable<typeof c> => c !== null);

	it('schema が空でない (introspection 自体の健全性)', () => {
		expect(allTables.length).toBeGreaterThan(20);
	});

	it('child_id 列を持つ全表 = CHILD_SCOPED_TABLES ∪ 明示特例 (漏れ・過剰の両方向を検出)', () => {
		const tablesWithChildId = allTables
			.filter((t) => t.columns.some((c) => c.name === 'child_id'))
			.map((t) => t.name)
			.sort();

		const covered = [...CHILD_SCOPED_TABLES, ...Object.keys(EXPLICIT_EXCLUSIONS)].sort();

		// 漏れ方向: schema にあるのに deleteChild が消さない表 → orphan 行が残る (本 fitness の主目的)
		const uncovered = tablesWithChildId.filter((t) => !covered.includes(t));
		expect(
			uncovered,
			`child_id 列を持つのに CHILD_SCOPED_TABLES にも EXPLICIT_EXCLUSIONS にも無い表: ${uncovered.join(', ')} — deleteChild に追加するか、理由付きで除外登録すること (#3584)`,
		).toEqual([]);

		// 過剰方向: CHILD_SCOPED_TABLES にあるのに schema に child_id 列が無い表 → DELETE が
		// 実行時エラー (undefined column) になるか、意図しない表を指している
		const phantom = CHILD_SCOPED_TABLES.filter((t) => !tablesWithChildId.includes(t));
		expect(
			phantom,
			`CHILD_SCOPED_TABLES に登録されているが schema に child_id 列が無い表: ${phantom.join(', ')}`,
		).toEqual([]);
	});

	it('非標準 child 参照列 (*_child_id) を持つ表は全て個別処理特例に登録されている', () => {
		const nonStandard = allTables
			.filter(
				(t) =>
					!t.columns.some((c) => c.name === 'child_id') &&
					t.columns.some((c) => c.name.endsWith('child_id')),
			)
			.map((t) => t.name)
			.sort();
		const unhandled = nonStandard.filter((t) => !(t in NON_STANDARD_CHILD_REFS));
		expect(
			unhandled,
			`child を参照する非標準列 (*_child_id) を持つのに特例登録が無い表: ${unhandled.join(', ')} — deleteChild で個別処理を実装し NON_STANDARD_CHILD_REFS に理由を登録すること`,
		).toEqual([]);
	});

	it('stamp_entries (card_id 経由の子孫) が deleteChild の個別処理特例として認知されている', () => {
		// stamp_entries は child_id 列も *_child_id 列も持たないため上 2 test の網には掛からない。
		// deleteChild 実装 (stamp_cards 削除前の subquery DELETE) との対応をここで明示 pin する。
		const stampEntries = allTables.find((t) => t.name === 'stamp_entries');
		expect(stampEntries, 'schema に stamp_entries が存在する').toBeTruthy();
		expect(stampEntries?.columns.some((c) => c.name === 'card_id')).toBe(true);
		expect(NON_STANDARD_CHILD_REFS.stamp_entries).toBeTruthy();
	});
});
