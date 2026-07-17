// tests/unit/db/backup-entity-registry.test.ts
// #3329: backup 対象分類レジストリの機械検証 (silent-gap ガード)。
//
// 主軸 (#3329 QM BLOCK 是正): 実体の「真実集合」は schema.ts の **全 sqliteTable 定義**。
// schema.ts の全テーブルが backup-entity-registry に分類済 (`schemaTable` で宣言) であることを assert する。
// 実テーブルを持たない logical entity (派生集計 / 廃止機能残置 等) も必ず分類対象に含めることで、
// 「盲点で緑通過」する旧バグを根治する。
//
// 実テーブル (schema テーブル) を追加して分類を忘れると本テストが fail し、「backup 対象への入れ忘れ」を
// CI で検知する。replace import で活動/評価/ごほうび交換履歴等が silent に失われた事故 (#3327/#3329) の
// 構造的再発防止 (設計 doc backup-import-redesign §3.1)。
//
// 注 (#3438 Phase 3): 旧「補助軸」= keys.ts の DynamoDB single-table key builder 照合は、DynamoDB
// backend 撤去 (dynamodb/keys.ts 削除) に伴い廃止。schemaTable を持たない logical entity は
// SCHEMALESS_LOGICAL_ENTITIES で凍結し、追加/削除を exact-equality で機械強制する (ratchet)。

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
	BACKUP_ENTITY_REGISTRY,
	classifiedSchemaTables,
	deferredExcludedEntities,
	notYetExportedSourceEntities,
	notYetExportedSourceLabels,
} from '../../../src/lib/server/db/backup-entity-registry';

const DB_DIR = join(process.cwd(), 'src/lib/server/db');
const SCHEMA_TS = join(DB_DIR, 'schema.ts');

/**
 * schemaTable を持たない (専用 SQLite table を持たない) logical entity の凍結集合。
 * 派生集計 (pointBalance 等) / 廃止機能残置 (title / childTitle 等) / 運用 key
 * (inquiry / counter) など、実テーブルに 1:1 対応しない分類エントリを列挙する。
 * schemaTable 権威列挙で拾えないため、ここで exact-equality 凍結し「新規 schemaTable-less
 * エントリの silent 追加」「既存エントリの silent 削除」を CI で検知する (#3438 で keys.ts
 * key-builder 照合 = 旧補助軸を代替する ratchet)。
 */
const SCHEMALESS_LOGICAL_ENTITIES: readonly string[] = [
	'childChallengeAutoWeekly',
	'childTitle',
	'counter',
	'inquiry',
	'pointBalance',
	'pointLedgerIdempotency',
	'redemptionPendingMarker',
	'title',
];

/** schema.ts の全 sqliteTable const 名を権威列挙する (実テーブルの真実集合)。 */
function schemaTableConstNames(): string[] {
	const src = readFileSync(SCHEMA_TS, 'utf8');
	const names = new Set<string>();
	const re = /export const (\w+) = sqliteTable\(/g;
	let m: RegExpExecArray | null;
	// biome-ignore lint/suspicious/noAssignInExpressions: 正規表現の逐次 match 抽出
	while ((m = re.exec(src)) !== null) {
		const name = m[1];
		if (name) names.add(name);
	}
	return [...names].sort();
}

/** registry のうち schemaTable を持たない (実テーブル非対応) エントリ名一覧。 */
function schemalessRegistryEntities(): string[] {
	return Object.entries(BACKUP_ENTITY_REGISTRY)
		.filter(([, entry]) => entry.schemaTable === undefined)
		.map(([name]) => name)
		.sort();
}

describe('#3329 backup-entity-registry — silent-gap ガード', () => {
	it('【主軸】schema.ts の全テーブルが registry に分類されている (key builder の有無に依らず、未分類で fail)', () => {
		const tables = schemaTableConstNames();
		expect(tables.length, 'schema.ts に sqliteTable 定義が存在する').toBeGreaterThan(30);

		const classified = new Set(classifiedSchemaTables());
		const unclassified = tables.filter((t) => !classified.has(t));
		expect(
			unclassified,
			`未分類の schema テーブルがあります。src/lib/server/db/backup-entity-registry.ts に entry を追加し source/derived/excluded と schemaTable を宣言してください: ${unclassified.join(', ')}`,
		).toEqual([]);
	});

	it('registry が宣言する schemaTable が全て schema.ts に実在する (stale schemaTable で fail)', () => {
		const tables = new Set(schemaTableConstNames());
		const stale = classifiedSchemaTables().filter((t) => !tables.has(t));
		expect(
			stale,
			`schema.ts に存在しない schemaTable を registry が宣言しています: ${stale.join(', ')}`,
		).toEqual([]);
	});

	it('【補助】schemaTable を持たない logical entity は凍結集合と exact-match (silent 追加/削除で fail)', () => {
		// #3438: 旧 keys.ts key-builder 照合の代替。schemaTable-less エントリは派生集計 / 廃止機能残置
		// 等の意図的分類のみを許容し、新規 silent 追加 (backup 盲点) と silent 削除の両方を検知する。
		expect(
			schemalessRegistryEntities(),
			'schemaTable を持たない registry エントリが凍結集合と不一致。意図的な追加/削除なら SCHEMALESS_LOGICAL_ENTITIES を更新すること',
		).toEqual([...SCHEMALESS_LOGICAL_ENTITIES]);
	});

	it('registry の全エントリが「実 schema テーブル」または「凍結 schemaless 集合」に対応する (孤児で fail)', () => {
		const tables = new Set(schemaTableConstNames());
		const schemaless = new Set(SCHEMALESS_LOGICAL_ENTITIES);
		const orphans = Object.entries(BACKUP_ENTITY_REGISTRY)
			.filter(
				([name, entry]) =>
					!(entry.schemaTable !== undefined && tables.has(entry.schemaTable)) &&
					!schemaless.has(name),
			)
			.map(([name]) => name);
		expect(
			orphans,
			`実 schema テーブルにも凍結 schemaless 集合にも対応しない孤児 registry エントリ: ${orphans.join(', ')}`,
		).toEqual([]);
	});

	it('全エントリが妥当な classification + source は backupStatus / excluded は excludedKind を持つ', () => {
		for (const [name, entry] of Object.entries(BACKUP_ENTITY_REGISTRY)) {
			expect(['source', 'derived', 'excluded'], `${name} の classification`).toContain(
				entry.classification,
			);
			expect(entry.reason.length, `${name} に reason`).toBeGreaterThan(0);
			if (entry.classification === 'source') {
				expect(['exported', 'not-yet-exported'], `${name} (source) は backupStatus 必須`).toContain(
					entry.backupStatus,
				);
			}
			if (entry.classification === 'excluded') {
				expect(['permanent', 'deferred'], `${name} (excluded) は excludedKind 必須`).toContain(
					entry.excludedKind,
				);
			}
		}
	});

	it('未 export の source 実体ベースライン (#3329 完遂、ratchet)', () => {
		// #3329 で全 source 実体の export/import を実装完了 → 未 export source は 0 件。
		// 以後 not-yet-exported な source を新規追加すると本 assert が fail する (新 source の
		// backup 取りこぼしを CI で即検知する回帰ネット)。
		expect(notYetExportedSourceEntities()).toEqual([]);
	});

	it('excluded 繰延 (deferred) 実体ベースライン (#3329 Phase 2 再分類強制、ratchet)', () => {
		// Phase 2 等で source / derived 化したら本ベースラインから外す (意図的更新)。
		// 「暫定除外のまま放置」を禁止し、実装フェーズ到来時の再分類を強制する。
		expect(deferredExcludedEntities()).toEqual(['characterImage', 'dailyMission']);
	});

	it('#3372: notYetExportedSourceLabels は not-yet-exported source の表示名一覧を返す (現ベースライン 0 件)', () => {
		// import/restore UI の partial-backup 警告が本関数を registry SSOT として参照する。
		// #3329 完遂により現状は空 = UI 警告非表示。not-yet-exported source を追加すると
		// 一覧が非空になり警告が自動表示される (registry 駆動)。
		expect(notYetExportedSourceLabels()).toEqual(notYetExportedSourceEntities());
		expect(notYetExportedSourceLabels()).toEqual([]);
	});

	it('#3372: not-yet-exported な source は displayLabel (UI 表示名) が必須 (内部コード露出禁止)', () => {
		// partial-backup 警告は displayLabel を UI に列挙する。displayLabel 無しで
		// not-yet-exported source を追加すると内部実体名がそのまま UI に露出するため、
		// 本 assert が追加時点で fail し表示名の付与を強制する。
		for (const [name, entry] of Object.entries(BACKUP_ENTITY_REGISTRY)) {
			if (entry.classification === 'source' && entry.backupStatus === 'not-yet-exported') {
				expect(
					entry.displayLabel,
					`${name} (not-yet-exported source) は displayLabel 必須`,
				).toBeTruthy();
			}
		}
	});
});
