// tests/unit/scripts/check-schema-migration-completeness.test.ts
//
// #2520 AC6/AC7 — schema 破壊的変更検出 (check-schema-migration-completeness.mjs) の unit test。
//
// `detectBreakingChanges(diff)` が `git diff --unified=0` 形式の文字列から
// 破壊的変更 (DROP COLUMN / FK target 変更 / NOT NULL 変更 / cross-table flip) を検出し、
// 通常の ADD COLUMN を破壊扱いしないことを assert する。
// 完全 SQL parser でなく正規表現ベース (AC7) のため、drizzle column 定義行を入力にする。

import { describe, expect, it } from 'vitest';
import { detectBreakingChanges } from '../../../scripts/check-schema-migration-completeness.mjs';

describe('detectBreakingChanges (#2520 AC6/AC7)', () => {
	describe('非破壊的変更 (warn 対象、本 gate は OK)', () => {
		it('ADD COLUMN のみ (列追加) は破壊扱いしない', () => {
			const diff = [
				'@@ -10,0 +11,1 @@',
				"+	newFlag: integer('new_flag').notNull().default(0),",
			].join('\n');
			expect(detectBreakingChanges(diff)).toEqual([]);
		});

		it('default 値だけ変わった ADD は破壊扱いしない', () => {
			const diff = ["+	score: integer('score').notNull().default(5),"].join('\n');
			expect(detectBreakingChanges(diff)).toEqual([]);
		});

		it('空 diff は破壊扱いしない', () => {
			expect(detectBreakingChanges('')).toEqual([]);
		});
	});

	describe('DROP COLUMN', () => {
		it('列定義が削除され追加側に同名 dbColumn が無い → 破壊', () => {
			const diff = ["-	legacyKind: text('kind').notNull().default('routine'),"].join('\n');
			const result = detectBreakingChanges(diff);
			expect(result.length).toBeGreaterThanOrEqual(1);
			expect(
				result.some((b) => b.reason.includes('DROP COLUMN') && b.reason.includes('kind')),
			).toBe(true);
		});

		it('列名 (fieldName) を rename しても dbColumn が同じなら DROP 扱いしない', () => {
			const diff = [
				"-	oldName: text('display_name').notNull(),",
				"+	newName: text('display_name').notNull(),",
			].join('\n');
			// dbColumn 'display_name' は両方に存在するため DROP ではない
			expect(detectBreakingChanges(diff).some((b) => b.reason.includes('DROP COLUMN'))).toBe(false);
		});

		it('text(name, { enum: ... }) で enum 制約が追加されても DROP 扱いしない (#2689 regression)', () => {
			// Phase 7 PR-2a (#2689) で発覚した false positive 回帰防止。
			// drizzle `text('name')` → `text('name', { enum: ARCHIVED_REASONS })` への変更は
			// TypeScript 型強制のみで DDL 変更を伴わない (CHECK 制約ではない) ため破壊的でない。
			// 旧正規表現は閉じ括弧 `\)` を必須としていたため第 2 引数を持つ + 側がマッチせず
			// DROP COLUMN と誤判定 → CI fail を招いていた (本 PR で正規表現を緩和)。
			const diff = [
				"-	archivedReason: text('archived_reason'),",
				"+	archivedReason: text('archived_reason', { enum: ARCHIVED_REASONS }),",
			].join('\n');
			expect(detectBreakingChanges(diff).some((b) => b.reason.includes('DROP COLUMN'))).toBe(false);
		});

		it('既存列に追加引数 ($type<T>()) が付与されても DROP 扱いしない (#2689 regression)', () => {
			// 同様の false positive ガード: drizzle の `$type<T>()` 型 caster 追加も DDL 変更なし。
			const diff = [
				"-	reason: text('reason'),",
				"+	reason: text('reason', { enum: REASONS }).$type<ReasonType>(),",
			].join('\n');
			expect(detectBreakingChanges(diff).some((b) => b.reason.includes('DROP COLUMN'))).toBe(false);
		});
	});

	describe('FK target 変更', () => {
		it('references target が activities → child_activities に変わる → 破壊', () => {
			const diff = [
				"-	activityId: integer('activity_id').notNull().references(() => activities.id),",
				"+	activityId: integer('activity_id').notNull().references(() => childActivities.id),",
			].join('\n');
			const result = detectBreakingChanges(diff);
			expect(result.some((b) => b.reason.includes('FK target 変更'))).toBe(true);
		});
	});

	describe('NOT NULL 変更', () => {
		it('既存列に notNull が付与される (なし→あり) → 破壊', () => {
			const diff = ["-	memo: text('memo'),", "+	memo: text('memo').notNull().default(''),"].join(
				'\n',
			);
			const result = detectBreakingChanges(diff);
			expect(result.some((b) => b.reason.includes('NOT NULL 変更'))).toBe(true);
		});

		it('既存列の notNull が撤去される (あり→なし) → 破壊', () => {
			const diff = ["-	memo: text('memo').notNull(),", "+	memo: text('memo'),"].join('\n');
			const result = detectBreakingChanges(diff);
			expect(result.some((b) => b.reason.includes('NOT NULL 変更'))).toBe(true);
		});
	});

	describe('cross-table flip (#2480 checklist_templates 型)', () => {
		it('child_id (→children) NOT NULL を tenant_id に flip → 破壊', () => {
			const diff = [
				"-	childId: integer('child_id').notNull().references(() => children.id),",
				"+	tenantId: text('tenant_id').notNull(),",
			].join('\n');
			const result = detectBreakingChanges(diff);
			expect(result.some((b) => b.reason.includes('cross-table flip'))).toBe(true);
		});
	});

	// ---- #2827: 検出漏れ 2 経路 (新規 table 追加同期漏れ / 新規 NOT NULL no-default 列) ----

	describe('(5) 新規 table 追加同期漏れ (#2827 穴A)', () => {
		const newTableDiff = [
			'@@ -200,0 +201,4 @@',
			"+export const familyEvents = sqliteTable('family_events', {",
			"+	id: integer('id').primaryKey({ autoIncrement: true }),",
			"+	tenantId: text('tenant_id').notNull().default(''),",
			'+});',
		].join('\n');

		it('新規 table が追加され create-tables / lazy に同期が無い → 破壊 (blocker)', () => {
			// syncedTableNames を渡さない = 同期なし扱い
			const result = detectBreakingChanges(newTableDiff);
			expect(
				result.some(
					(b) => b.reason.includes('新規 table 追加') && b.reason.includes('family_events'),
				),
			).toBe(true);
		});

		it('新規 table だが create-tables / lazy の同 PR diff に該当 table 名が出現 → 非検出', () => {
			// 境界ケース: create-tables.ts または lazy-startup-migrations.ts に 'family_events' が出現
			const result = detectBreakingChanges(newTableDiff, {
				syncedTableNames: new Set(['family_events']),
			});
			expect(result.some((b) => b.reason.includes('新規 table 追加'))).toBe(false);
		});

		it('table の rename (削除側にも同名 sqliteTable) は新規扱いしない', () => {
			// 削除側と追加側の両方に同名 table → 行移動 / rename であり新規ではない
			const diff = [
				"-export const familyEvents = sqliteTable('family_events', {",
				"+export const familyEvents = sqliteTable('family_events', {",
			].join('\n');
			const result = detectBreakingChanges(diff);
			expect(result.some((b) => b.reason.includes('新規 table 追加'))).toBe(false);
		});
	});

	describe('(6) 新規 NOT NULL no-default 列追加 (#2827 穴B)', () => {
		it('既存 table に notNull かつ DEFAULT なし列を新規追加 → 破壊 (blocker)', () => {
			const diff = ["+	ownerId: text('owner_id').notNull(),"].join('\n');
			const result = detectBreakingChanges(diff);
			expect(
				result.some(
					(b) =>
						b.reason.includes('新規 NOT NULL no-default 列追加') && b.reason.includes('owner_id'),
				),
			).toBe(true);
		});

		it('境界ケース: 新規 notNull 列でも .default() があれば非検出', () => {
			const diff = ["+	ownerId: text('owner_id').notNull().default(''),"].join('\n');
			const result = detectBreakingChanges(diff);
			expect(result.some((b) => b.reason.includes('新規 NOT NULL no-default 列追加'))).toBe(false);
		});

		it('境界ケース: 新規列でも nullable (notNull なし) なら非検出', () => {
			const diff = ["+	memo: text('memo'),"].join('\n');
			const result = detectBreakingChanges(diff);
			expect(result.some((b) => b.reason.includes('新規 NOT NULL no-default 列追加'))).toBe(false);
		});

		it('境界ケース: 新規 table 配下の notNull no-default 列は (6) の対象外 (CREATE TABLE 経路)', () => {
			// 新規 table 丸ごと追加時、その配下の notNull no-default 列は validateAndMigrate の
			// missing-table 判定が先行し ALTER ADD COLUMN 経路に乗らないため (6) では flag しない。
			// (table 自体は (5) で同期検証される)
			const diff = [
				"+export const familyEvents = sqliteTable('family_events', {",
				"+	id: integer('id').primaryKey({ autoIncrement: true }),",
				"+	label: text('label').notNull(),",
				'+});',
			].join('\n');
			const result = detectBreakingChanges(diff, {
				syncedTableNames: new Set(['family_events']),
			});
			expect(result.some((b) => b.reason.includes('新規 NOT NULL no-default 列追加'))).toBe(false);
		});

		it('既存列の notNull 反転 (両側に存在) は (3) の責務で (6) では検出しない', () => {
			const diff = ["-	memo: text('memo'),", "+	memo: text('memo').notNull(),"].join('\n');
			const result = detectBreakingChanges(diff);
			// (3) NOT NULL 変更で検出されるが、(6) では検出しない
			expect(result.some((b) => b.reason.includes('NOT NULL 変更'))).toBe(true);
			expect(result.some((b) => b.reason.includes('新規 NOT NULL no-default 列追加'))).toBe(false);
		});
	});
});
