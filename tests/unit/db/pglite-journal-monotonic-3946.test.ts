// tests/unit/db/pglite-journal-monotonic-3946.test.ts
// #3946 — drizzle/pglite journal `when` 単調増加の回帰テスト。
//
// drizzle-orm 公式 migrator (pg-core dialect) は「最後に適用した migration の created_at より
// 大きい folderMillis のみ適用」する。journal の `when` が idx 順で逆転していると、逆転より
// 前まで適用済みの既存 DB (NUC 本番) で後続 migration が永久 skip される (本番 500 の実因:
// 0002 when=1784500000000 > 0003/0004 の生成時刻 → login_streaks 未作成)。
//
//   [JM1] _journal.json の entries が idx 連番 + `when` 狭義単調増加 (同型再発の静的防止)
//   [JM2] 逆転 journal の実挙動再現: 0002 相当まで適用済みの DB に対し、`when` が過去の
//         後続 migration は skip される (drizzle migrator の適用条件の物理確認)
//   [JM3] 是正後 journal での incremental upgrade: 0002 まで適用済み DB → full journal で
//         migrate → 0003/0004 が適用され login_streaks が存在する (NUC 復旧経路の検証)
//
// [JM2]/[JM3] は実 drizzle/pglite migration を temp dir に部分コピーして in-memory PGlite に
// 適用する (pglite-login-bonus-fold-3330.test.ts と同系の実データ検証)。

import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { afterAll, describe, expect, it } from 'vitest';

interface JournalEntry {
	idx: number;
	when: number;
	tag: string;
}

const MIGRATIONS_DIR = join(process.cwd(), 'drizzle', 'pglite');

function loadJournal(): JournalEntry[] {
	const raw = readFileSync(join(MIGRATIONS_DIR, 'meta', '_journal.json'), 'utf-8');
	return (JSON.parse(raw) as { entries: JournalEntry[] }).entries;
}

const tempDirs: string[] = [];
afterAll(() => {
	for (const dir of tempDirs) {
		rmSync(dir, { recursive: true, force: true });
	}
});

/** 実 migration の先頭 count 件だけを持つ temp migrations dir を作る。 */
function makePartialMigrationsDir(entries: JournalEntry[], count: number): string {
	const dir = join(tmpdir(), `pglite-journal-3946-${process.pid}-${tempDirs.length}`);
	tempDirs.push(dir);
	mkdirSync(join(dir, 'meta'), { recursive: true });
	const partial = entries.slice(0, count);
	writeFileSync(
		join(dir, 'meta', '_journal.json'),
		JSON.stringify({ version: '7', dialect: 'postgresql', entries: partial }),
	);
	for (const e of partial) {
		copyFileSync(join(MIGRATIONS_DIR, `${e.tag}.sql`), join(dir, `${e.tag}.sql`));
	}
	return dir;
}

async function tableExists(client: PGlite, table: string): Promise<boolean> {
	const result = await client.query<{ exists: boolean }>(
		`SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = $1) AS exists`,
		[table],
	);
	return result.rows[0]?.exists === true;
}

describe('pglite journal monotonicity (#3946)', () => {
	it('[JM1] entries は idx 連番 + when 狭義単調増加', () => {
		const entries = loadJournal();
		expect(entries.length).toBeGreaterThan(0);
		entries.forEach((e, i) => {
			expect(e.idx).toBe(i);
		});
		// reduce で「直前 entry」を型安全に持ち回る (index アクセスの undefined 混入を避ける)。
		entries.reduce<JournalEntry | null>((prev, entry) => {
			if (prev) {
				expect(
					entry.when,
					`journal 逆転: ${entry.tag} (when=${entry.when}) は直前 ${prev.tag} (when=${prev.when}) より大きい必要がある (drizzle migrator が skip し本番 DB に未適用のまま残る)`,
				).toBeGreaterThan(prev.when);
			}
			return entry;
		}, null);
	});

	it('[JM2] 適用済み最終 when より過去の後続 migration は drizzle migrator が skip する', async () => {
		const client = new PGlite();
		try {
			const db = drizzle(client);
			// 2 migration の最小 journal: 先行 (when=2000) 適用済み → 後続 (when=1000, 逆転) を追加
			const dir = join(tmpdir(), `pglite-journal-3946-inv-${process.pid}`);
			tempDirs.push(dir);
			mkdirSync(join(dir, 'meta'), { recursive: true });
			writeFileSync(join(dir, '0000_first.sql'), 'CREATE TABLE "jm2_first" ("id" integer);');
			writeFileSync(join(dir, '0001_second.sql'), 'CREATE TABLE "jm2_second" ("id" integer);');
			const journal = (entries: { idx: number; when: number; tag: string }[]) =>
				JSON.stringify({
					version: '7',
					dialect: 'postgresql',
					entries: entries.map((e) => ({ ...e, version: '7', breakpoints: true })),
				});
			writeFileSync(
				join(dir, 'meta', '_journal.json'),
				journal([{ idx: 0, when: 2000, tag: '0000_first' }]),
			);
			await migrate(db, { migrationsFolder: dir });
			writeFileSync(
				join(dir, 'meta', '_journal.json'),
				journal([
					{ idx: 0, when: 2000, tag: '0000_first' },
					{ idx: 1, when: 1000, tag: '0001_second' },
				]),
			);
			await migrate(db, { migrationsFolder: dir });
			// 逆転 when=1000 < 適用済み 2000 → skip される (これが本番 500 の機構)
			expect(await tableExists(client, 'jm2_second')).toBe(false);
		} finally {
			await client.close();
		}
	}, 60_000);

	it('[JM3] 0002 まで適用済み DB → full journal migrate で 0003/0004 が適用される (NUC 復旧経路)', async () => {
		const entries = loadJournal();
		const idx0002 = entries.findIndex((e) => e.tag.startsWith('0002_'));
		expect(idx0002).toBeGreaterThanOrEqual(0);

		const client = new PGlite();
		try {
			const db = drizzle(client);
			// NUC 本番相当: 0000-0002 適用済み (login_streaks なし / login_bonuses あり)
			await migrate(db, { migrationsFolder: makePartialMigrationsDir(entries, idx0002 + 1) });
			expect(await tableExists(client, 'login_streaks')).toBe(false);
			expect(await tableExists(client, 'login_bonuses')).toBe(true);

			// 是正後 journal (when 引き上げ済み) での次回 boot: 0003/0004 が適用される
			await migrate(db, { migrationsFolder: MIGRATIONS_DIR });
			expect(await tableExists(client, 'login_streaks')).toBe(true);
			expect(await tableExists(client, 'login_bonuses')).toBe(false);
		} finally {
			await client.close();
		}
	}, 120_000);
});
