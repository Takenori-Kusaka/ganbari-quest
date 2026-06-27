// tests/unit/db/backup-entity-registry.test.ts
// #3329: backup 対象分類レジストリの機械検証 (silent-gap ガード)。
//
// 主軸 (#3329 QM BLOCK 是正): 実体の「真実集合」は schema.ts の **全 sqliteTable 定義**。
// schema.ts の全テーブルが backup-entity-registry に分類済 (`schemaTable` で宣言) であることを assert する。
// key builder を持たない実テーブル (rest_days / child_custom_voices / usage_logs / stamp_masters) も
// 必ず分類対象に含めることで、「key builder が無い実テーブルが盲点で緑通過」する旧バグを根治する。
//
// 補助軸: keys.ts の全 key builder (`<name>Key`) も registry に分類済であること (DynamoDB single-table key の網羅)。
//
// いずれかの実体 (schema テーブル or key builder) を追加して分類を忘れると本テストが fail し、
// 「backup 対象への入れ忘れ」を CI で検知する。replace import で活動/評価/ごほうび交換履歴等が
// silent に失われた事故 (#3327/#3329) の構造的再発防止 (設計 doc backup-import-redesign §3.1)。

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
	BACKUP_ENTITY_REGISTRY,
	classifiedSchemaTables,
	deferredExcludedEntities,
	notYetExportedSourceEntities,
} from '../../../src/lib/server/db/backup-entity-registry';

const DB_DIR = join(process.cwd(), 'src/lib/server/db');
const SCHEMA_TS = join(DB_DIR, 'schema.ts');
const KEYS_TS = join(DB_DIR, 'dynamodb/keys.ts');

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

/** keys.ts から `export function <name>Key(...)` の <name> を抽出する (補助軸)。 */
function keyBuilderEntityNames(): string[] {
	const src = readFileSync(KEYS_TS, 'utf8');
	const names = new Set<string>();
	const re = /export function (\w+)Key\b/g;
	let m: RegExpExecArray | null;
	// biome-ignore lint/suspicious/noAssignInExpressions: 正規表現の逐次 match 抽出
	while ((m = re.exec(src)) !== null) {
		const base = m[1];
		if (base) names.add(base);
	}
	return [...names].sort();
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

	it('【補助】keys.ts の全 key builder が registry に分類されている (未分類で fail)', () => {
		const entities = keyBuilderEntityNames();
		expect(entities.length, 'keys.ts に key builder が存在する').toBeGreaterThan(20);

		const unclassified = entities.filter((name) => !(name in BACKUP_ENTITY_REGISTRY));
		expect(
			unclassified,
			`未分類の key builder があります。src/lib/server/db/backup-entity-registry.ts に source/derived/excluded を追記してください: ${unclassified.join(', ')}`,
		).toEqual([]);
	});

	it('registry に schema テーブルにも keys.ts builder にも対応しない孤児エントリが無い', () => {
		const builders = new Set(keyBuilderEntityNames());
		const tables = new Set(schemaTableConstNames());
		const orphans = Object.entries(BACKUP_ENTITY_REGISTRY)
			.filter(
				([name, entry]) =>
					!builders.has(name) &&
					!(entry.schemaTable !== undefined && tables.has(entry.schemaTable)),
			)
			.map(([name]) => name);
		expect(
			orphans,
			`schema テーブル / keys.ts key builder のどちらにも対応しない孤児 registry エントリ: ${orphans.join(', ')}`,
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

	it('未 export の source 実体ベースライン (#3329 残課題、ratchet)', () => {
		// export に足したら 'exported' へ flip し本ベースラインから外す (意図的更新)。
		// 新たな not-yet-exported source の silent 増加を禁止する (回帰ネット)。
		expect(notYetExportedSourceEntities()).toEqual([
			'activityPref',
			'certificate',
			'checklistAssignment',
			'checklistOverride',
			'childChallenge',
			'childChallengeAutoWeekly',
			'childCustomVoices',
			'parentMessage',
			'restDays',
			// rewardRedemption は #3329 で export 実装済 → exported へ flip (本ベースラインから除外)
			'setting',
			'siblingCheer',
			'stampCard',
			'stampEntry',
		]);
	});

	it('excluded 繰延 (deferred) 実体ベースライン (#3329 Phase 2 再分類強制、ratchet)', () => {
		// Phase 2 等で source / derived 化したら本ベースラインから外す (意図的更新)。
		// 「暫定除外のまま放置」を禁止し、実装フェーズ到来時の再分類を強制する。
		expect(deferredExcludedEntities()).toEqual(['characterImage', 'dailyMission']);
	});
});
