// tests/unit/db/backup-entity-registry.test.ts
// #3329: backup 対象分類レジストリの機械検証 (silent-gap ガード)。
//
// keys.ts の全 key builder (`<name>Key`) が backup-entity-registry に分類済であることを assert する。
// 新実体 (key builder) を追加して分類を忘れると本テストが fail し、「backup 対象への入れ忘れ」を
// CI で検知する。replace import で活動/評価/ごほうび交換履歴等が silent に失われた事故 (#3327/#3329)
// の構造的再発防止 (設計 doc backup-import-redesign §3.1)。

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
	BACKUP_ENTITY_REGISTRY,
	notYetExportedSourceEntities,
} from '../../../src/lib/server/db/backup-entity-registry';

const KEYS_TS = join(process.cwd(), 'src/lib/server/db/dynamodb/keys.ts');

/** keys.ts から `export function <name>Key(...)` の <name> を抽出する。 */
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
	it('keys.ts の全 key builder が registry に分類されている (未分類で fail)', () => {
		const entities = keyBuilderEntityNames();
		expect(entities.length, 'keys.ts に key builder が存在する').toBeGreaterThan(20);

		const unclassified = entities.filter((name) => !(name in BACKUP_ENTITY_REGISTRY));
		expect(
			unclassified,
			`未分類の実体があります。src/lib/server/db/backup-entity-registry.ts に source/derived/excluded を追記してください: ${unclassified.join(', ')}`,
		).toEqual([]);
	});

	it('registry に keys.ts に存在しない孤児エントリが無い', () => {
		const entities = new Set(keyBuilderEntityNames());
		const orphans = Object.keys(BACKUP_ENTITY_REGISTRY).filter((name) => !entities.has(name));
		expect(
			orphans,
			`keys.ts に対応 key builder が無い registry エントリ: ${orphans.join(', ')}`,
		).toEqual([]);
	});

	it('全エントリが妥当な classification + source は backupStatus を持つ', () => {
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
			'parentMessage',
			'rewardRedemption',
			'setting',
			'siblingCheer',
			'stampCard',
			'stampEntry',
		]);
	});
});
