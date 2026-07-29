// tests/unit/db/pglite-journal-when-range-3948.test.ts
// #3948 — drizzle journal `when` の **値域** を機械検証する gate のテスト (class-lock)。
//
// #3947 が追加した [JM1] (pglite-journal-monotonic-3946.test.ts) は `when` の狭義単調増加のみを
// assert しており、**末尾 entry に遠い未来値を手書きすれば PASS したまま**、以後 drizzle-kit が
// 生成する全 migration が本番既存 DB で永久 skip される (#3946 と完全に同型の本番 500)。
// 本テストはその穴を塞ぐ gate (scripts/lib/db/drizzle-journal-gate.mjs) を CI で hard-fail させる。
//
//   [WR1] 実 journal (drizzle/<dialect>/meta/_journal.json、glob で発見した全件) が gate の全ルールを満たす
//   [WR2] gate 自体の実効性: 未来値 / 手書き丸め値 / 逆転 / 過去すぎる値 の fixture で fail する
//   [WR3] grandfather は既存 3 値限定 — 同型の新規丸め値は grandfather されず fail する
//   [WR4] DSQL provision は `when` を参照しない (idx 順 + tag 冪等) ことの固定
//   [WR7] grandfather 3 値を「実生成時刻へ直す」と pre-hotfix backup の restore で #3946 が再発する
//         (grandfather が必要である理由そのものを実 migrator + 実 migration で固定する)
//   [WR8] gate の適用先が全 dialect (#3953 — 走査の glob 化が実際に効いていることの検証)
//         - 0 件マッチ = fail (glob 化で「素通り」という新しい silent skip を作らない)
//         - 複数 journal がある状態で **2 本目に違反があれば fail する**
//
// [WR2] は「gate を書いたが実は何も落とせていない」を防ぐ実効性検証 (#3072 と同型の考え方)。

import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { afterAll, describe, expect, it } from 'vitest';
import {
	checkAllJournals,
	findJournalFiles,
	findJournalWhenViolations,
	formatAllJournalViolations,
	GRANDFATHERED_WHEN,
	HANDWRITTEN_WHEN_0002,
	MIN_PLAUSIBLE_WHEN,
	ROUND_UNIT_MS,
} from '../../../scripts/lib/db/drizzle-journal-gate.mjs';
import { loadMigrationFiles } from '../../../src/lib/server/db/dsql/migration/provision';

interface JournalEntry {
	idx: number;
	when: number;
	tag: string;
}

const PGLITE_MIGRATIONS_DIR = join(process.cwd(), 'drizzle', 'pglite');

function loadRealJournal(): JournalEntry[] {
	const raw = readFileSync(join(PGLITE_MIGRATIONS_DIR, 'meta', '_journal.json'), 'utf-8');
	return (JSON.parse(raw) as { entries: JournalEntry[] }).entries;
}

/** 実 journal 相当の「正常な」entries (drizzle-kit が生成した実時刻を模した値)。 */
function healthyEntries(): JournalEntry[] {
	return [
		{ idx: 0, when: 1_783_659_891_383, tag: '0000_first' },
		{ idx: 1, when: 1_784_100_586_276, tag: '0001_second' },
		{ idx: 2, when: 1_784_415_769_652, tag: '0002_third' },
	];
}

const tempDirs: string[] = [];
afterAll(() => {
	for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

function makeMigrationsDir(entries: { idx: number; when: number; tag: string }[]): string {
	const dir = join(tmpdir(), `journal-when-3948-${process.pid}-${tempDirs.length}`);
	tempDirs.push(dir);
	mkdirSync(join(dir, 'meta'), { recursive: true });
	writeFileSync(
		join(dir, 'meta', '_journal.json'),
		JSON.stringify({ version: '7', dialect: 'postgresql', entries }),
	);
	for (const e of entries) {
		writeFileSync(join(dir, `${e.tag}.sql`), `-- ${e.tag}\nSELECT 1;`);
	}
	return dir;
}

/** 実 migration SQL を使い、指定 entries の journal を持つ temp migrations dir を作る。 */
function makeRealMigrationsDir(entries: JournalEntry[]): string {
	const dir = join(tmpdir(), `journal-when-3948-real-${process.pid}-${tempDirs.length}`);
	tempDirs.push(dir);
	mkdirSync(join(dir, 'meta'), { recursive: true });
	writeFileSync(
		join(dir, 'meta', '_journal.json'),
		JSON.stringify({ version: '7', dialect: 'postgresql', entries }),
	);
	for (const e of entries) {
		copyFileSync(join(PGLITE_MIGRATIONS_DIR, `${e.tag}.sql`), join(dir, `${e.tag}.sql`));
	}
	return dir;
}

async function tableExists(client: PGlite, table: string): Promise<boolean> {
	const result = await client.query<{ exists: boolean }>(
		'SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = $1) AS exists',
		[table],
	);
	return result.rows[0]?.exists === true;
}

describe('drizzle journal `when` 値域 gate (#3948)', () => {
	it('[WR1] 実 journal (glob で発見した全 dialect) が gate の全ルールを満たす', () => {
		// #3953 AC1: PGlite 固定パスではなく drizzle/*/meta/_journal.json の glob 走査。
		// 将来 drizzle/dsql/meta/_journal.json 等が増えたら、追加作業なしでこの assert の対象になる。
		const { files, violations } = checkAllJournals(process.cwd());
		expect(files.length, 'journal が 1 本も見つからない').toBeGreaterThan(0);
		expect(files, 'PGlite journal が走査対象に含まれていない').toContain(
			'drizzle/pglite/meta/_journal.json',
		);
		expect(
			violations,
			`journal 違反あり:\n${formatAllJournalViolations(violations)}`,
		).toStrictEqual([]);
	});

	it('[WR1b] 実 journal の grandfather 例外は既知 3 値のみ (新規追加が混ざっていない)', () => {
		// grandfather を無効化すると、既知 3 値 **だけ** が R2 で落ちる = 例外が増えていない。
		// #3953 AC1: 判定対象は glob で発見した全 journal。
		const { violations } = checkAllJournals(process.cwd(), { grandfathered: [] });
		expect(violations.every((v) => v.rule === 'R2-handwritten')).toBe(true);
		expect(violations.map((v) => v.when).sort((a, b) => a - b)).toStrictEqual([
			...GRANDFATHERED_WHEN,
		]);
	});

	it('[WR2a] 未来値を末尾に手書きすると fail する (#3946 と同型の再発を hard-fail)', () => {
		const now = 1_785_000_000_000;
		const entries = [
			...healthyEntries(),
			// [JM1] (単調増加のみ) は PASS してしまう値。gate はこれを落とさなければならない。
			{ idx: 3, when: 1_900_000_000_000, tag: '0003_far_future' },
		];
		const violations = findJournalWhenViolations(entries, { now });
		expect(violations.map((v) => v.rule)).toContain('R1-future');
		expect(violations.some((v) => v.tag === '0003_far_future')).toBe(true);
	});

	it('[WR2b] 手書きの丸め値・連番は fail する', () => {
		const now = 1_785_000_000_000;
		const rounded = 1_784_800_000_000; // 100 秒境界ちょうど = 手書きの丸め値
		const sequential = rounded + 1; // 丸め値の直後に手書きした連番
		expect(rounded % ROUND_UNIT_MS).toBe(0);

		const violations = findJournalWhenViolations(
			[
				...healthyEntries(),
				{ idx: 3, when: rounded, tag: '0003_rounded' },
				{ idx: 4, when: sequential, tag: '0004_sequential' },
			],
			{ now },
		);
		const handwritten = violations.filter((v) => v.rule === 'R2-handwritten');
		expect(handwritten.map((v) => v.tag)).toStrictEqual(['0003_rounded', '0004_sequential']);
	});

	it('[WR2c] 逆転 / idx 不整合 / 過去すぎる値も fail する', () => {
		const now = 1_785_000_000_000;
		const reversed = findJournalWhenViolations(
			[...healthyEntries(), { idx: 3, when: 1_783_000_000_000, tag: '0003_reversed' }],
			{ now },
		);
		expect(reversed.map((v) => v.rule)).toContain('R4-monotonic');

		const badIdx = findJournalWhenViolations(
			[{ idx: 7, when: 1_784_415_769_652, tag: '0000_bad_idx' }],
			{ now },
		);
		expect(badIdx.map((v) => v.rule)).toContain('R4-idx');

		const tooOld = findJournalWhenViolations([{ idx: 0, when: 1000, tag: '0000_too_old' }], {
			now,
		});
		expect(tooOld.map((v) => v.rule)).toContain('R3-too-old');
		expect(MIN_PLAUSIBLE_WHEN).toBeGreaterThan(1000);
	});

	it('[WR2d] 正常な entries は 1 件も違反を出さない (false positive を出さない)', () => {
		expect(findJournalWhenViolations(healthyEntries(), { now: 1_785_000_000_000 })).toStrictEqual(
			[],
		);
	});

	it('[WR3] grandfather は既存 3 値限定 — 同型の新規丸め値は救済されない', () => {
		const now = 1_785_000_000_000;
		// 既存の grandfather 値そのものは許容される。
		const grandfathered = findJournalWhenViolations(
			[{ idx: 0, when: HANDWRITTEN_WHEN_0002, tag: '0000_grandfathered' }],
			{ now },
		);
		expect(grandfathered).toStrictEqual([]);

		// 「grandfather があるから丸め値を足してよい」にはならない。
		const newRounded = findJournalWhenViolations(
			[
				{ idx: 0, when: HANDWRITTEN_WHEN_0002, tag: '0000_grandfathered' },
				{ idx: 1, when: 1_784_900_000_000, tag: '0001_new_rounded' },
			],
			{ now },
		);
		expect(newRounded.map((v) => v.rule)).toContain('R2-handwritten');
	});

	it('[WR5] #3946 発生時点の journal を再現すると gate が fail する (この gate があれば防げた)', () => {
		// 0002 の手書き値 1784500000000 が書かれた当時 (2026-07-12 前後) の時刻。
		const nowAtIncident = 1_784_000_000_000;
		expect(nowAtIncident).toBeLessThan(HANDWRITTEN_WHEN_0002); // 当時 0002 の when は「未来」だった

		// #3947 以前の実 journal (0003/0004 は drizzle-kit 生成の実時刻 = 0002 より過去 → 逆転)。
		const brokenJournal = [
			{ idx: 0, when: 1_783_659_891_383, tag: '0000_pretty_wolfsbane' },
			{ idx: 1, when: 1_784_100_586_276, tag: '0001_overrated_roland_deschain' },
			{ idx: 2, when: 1_784_500_000_000, tag: '0002_evaluations_week_unique' },
			{ idx: 3, when: 1_784_415_769_652, tag: '0003_login_streaks_counter' },
			{ idx: 4, when: 1_784_415_789_368, tag: '0004_drop_login_bonuses' },
		];

		// 0002 を grandfather しても、「未来値」であることは当時の時刻で必ず落ちる。
		const violations = findJournalWhenViolations(brokenJournal, { now: nowAtIncident });
		expect(violations.some((v) => v.rule === 'R1-future' && v.tag.startsWith('0002_'))).toBe(true);
		// 0003/0004 の逆転も同時に検出される。
		expect(violations.filter((v) => v.rule === 'R4-monotonic').map((v) => v.tag)).toStrictEqual([
			'0003_login_streaks_counter',
		]);
	});

	it('[WR6] 失敗メッセージが「次に何をすればいいか」を含む (踏んだ開発者が詰まらない)', () => {
		const now = 1_785_000_000_000;
		const violations = findJournalWhenViolations(
			[
				{ idx: 0, when: 1_784_800_000_000, tag: '0000_rounded' },
				{ idx: 1, when: 1_900_000_000_000, tag: '0001_future' },
				{ idx: 2, when: 1_000_000_000_000, tag: '0002_too_old' },
			],
			{ now },
		);
		const byRule = (rule: string) => violations.find((v) => v.rule === rule)?.message ?? '';

		// R2 は false positive (約 1/10,000) があり得るため、「本当に生成値だった場合」の導線が要る。
		expect(byRule('R2-handwritten')).toContain('drizzle-kit generate');
		expect(byRule('R2-handwritten')).toContain('GRANDFATHERED_WHEN');
		// R1 / R3 は手書き / 取り違えが原因なので戻し方を示す。
		expect(byRule('R1-future')).toContain('→');
		expect(byRule('R3-too-old')).toContain('→');
		// どのルールも「→」で始まる次アクション行を必ず持つ。
		for (const v of violations) {
			expect(v.message, `${v.rule} に次アクションがない`).toContain('→');
		}
	});

	it('[WR7] grandfather 3 値を実生成時刻へ直すと pre-hotfix backup の restore で #3946 が再発する', async () => {
		// grandfather が必要な本当の理由を実 migrator + 実 migration SQL で固定する。
		// drizzle migrator (pg-core dialect) は `適用済み最大 created_at < folderMillis` の
		// 1 条件だけで判定し、per-tag の突合はしない。したがって「再適用」は起きない一方、
		// **適用済み最大が 1784500000000 の DB (= #3947 以前の backup を restore した DB)** では、
		// 0003/0004 を実生成時刻 (それより小さい) へ「直す」と永久 skip されて #3946 が再発する。
		// pre-hotfix backup は #3950 の restore drill 対象として現に存在するため、これは机上の話ではない。
		const entries = loadRealJournal();
		const idx0002 = entries.findIndex((e) => e.tag.startsWith('0002_'));
		expect(idx0002).toBeGreaterThanOrEqual(0);

		// 0003/0004 を「drizzle-kit の実生成時刻」へ書き戻した journal (#3947 以前の値)。
		const REAL_GENERATED_WHEN: Record<string, number> = {
			'0003_': 1_784_415_769_652,
			'0004_': 1_784_415_789_368,
		};
		const rewritten = entries.map((e) => {
			const key = Object.keys(REAL_GENERATED_WHEN).find((k) => e.tag.startsWith(k));
			return key ? { ...e, when: REAL_GENERATED_WHEN[key] as number } : e;
		});
		// 「直した」journal は 0002 の grandfather 値より小さくなる = 逆転する。
		expect(rewritten[idx0002 + 1]?.when).toBeLessThan(HANDWRITTEN_WHEN_0002);

		// pre-hotfix backup 相当 (0000-0002 適用済み) を 2 つ用意し、以後の journal だけを変える。
		const preHotfixDir = makeRealMigrationsDir(entries.slice(0, idx0002 + 1));
		const rewrittenDir = makeRealMigrationsDir(rewritten);

		const broken = new PGlite();
		try {
			const db = drizzle(broken);
			await migrate(db, { migrationsFolder: preHotfixDir });
			expect(await tableExists(broken, 'login_streaks')).toBe(false);

			// 「直した」journal で migrate → 0003/0004 が永久 skip され #3946 が再発する。
			await migrate(db, { migrationsFolder: rewrittenDir });
			expect(
				await tableExists(broken, 'login_streaks'),
				'grandfather を外すと pre-hotfix restore で login_streaks が作られず #3946 が再発する',
			).toBe(false);
			expect(await tableExists(broken, 'login_bonuses')).toBe(true);
		} finally {
			await broken.close();
		}

		// 対照: grandfather を維持した現行 journal なら同じ backup から正しく復旧する。
		const healthy = new PGlite();
		try {
			const db = drizzle(healthy);
			await migrate(db, { migrationsFolder: preHotfixDir });
			await migrate(db, { migrationsFolder: PGLITE_MIGRATIONS_DIR });
			expect(await tableExists(healthy, 'login_streaks')).toBe(true);
			expect(await tableExists(healthy, 'login_bonuses')).toBe(false);
		} finally {
			await healthy.close();
		}
	}, 120_000);

	// -------------------------------------------------------------------------
	// [WR8] gate の適用先が全 dialect であることの検証 (#3953 AC1-AC3)
	//
	// 「glob にした」と書くだけでは、実際に 2 本目以降へ適用されている保証がない。
	// 複数 journal を持つ fake repo root を作り、**2 本目にだけ違反を置いて** fail することを固定する。
	// -------------------------------------------------------------------------

	/** `<root>/drizzle/<dialect>/meta/_journal.json` を持つ fake repo root を作る。 */
	function makeFakeRepoRoot(journals: Record<string, JournalEntry[]>): string {
		const root = join(tmpdir(), `journal-glob-3953-${process.pid}-${tempDirs.length}`);
		tempDirs.push(root);
		for (const [dialect, entries] of Object.entries(journals)) {
			const metaDir = join(root, 'drizzle', dialect, 'meta');
			mkdirSync(metaDir, { recursive: true });
			writeFileSync(
				join(metaDir, '_journal.json'),
				JSON.stringify({ version: '7', dialect: 'postgresql', entries }),
			);
		}
		return root;
	}

	it('[WR8a] journal が 1 本も無ければ fail する (glob 化で「0 件マッチ = 素通り」を作らない)', () => {
		const emptyRoot = join(tmpdir(), `journal-glob-3953-empty-${process.pid}`);
		tempDirs.push(emptyRoot);
		mkdirSync(emptyRoot, { recursive: true });

		const { files, violations } = checkAllJournals(emptyRoot);
		expect(files).toStrictEqual([]);
		expect(violations.map((v) => v.rule)).toStrictEqual(['R0-no-journal']);
		// 踏んだ人が次に何をすればいいか分かること (既存 gate と同じ「→」始まりの次アクション行)。
		expect(violations[0]?.message).toContain('→');
	});

	it('[WR8b] 複数 journal のうち 2 本目に違反があれば fail する (glob が実際に効いている)', () => {
		const now = 1_785_000_000_000;
		const root = makeFakeRepoRoot({
			// 1 本目は健全。固定パス実装ならここだけを見て PASS してしまう。
			pglite: healthyEntries(),
			// 2 本目に #3946 と同型の未来値。glob 化していなければ検査対象にすらならない。
			// 丸め値 (R2) ではなく **未来値 (R1) だけ**で落ちる値にして、検出理由を一意にする。
			dsql: [
				...healthyEntries(),
				{ idx: 3, when: 1_900_000_123_456, tag: '0003_far_future_on_second_journal' },
			],
		});

		const { files, violations } = checkAllJournals(root, { now });
		expect(files).toStrictEqual([
			'drizzle/dsql/meta/_journal.json',
			'drizzle/pglite/meta/_journal.json',
		]);
		expect(violations.map((v) => v.rule)).toStrictEqual(['R1-future']);
		expect(violations[0]?.file).toBe('drizzle/dsql/meta/_journal.json');
		expect(violations[0]?.tag).toBe('0003_far_future_on_second_journal');
		// 出力に file 名が出ること (どの journal を直せばいいか分かる)。
		expect(formatAllJournalViolations(violations)).toContain('drizzle/dsql/meta/_journal.json');
	});

	it('[WR8c] 複数 journal がすべて健全なら違反 0 件 (false positive を出さない)', () => {
		const root = makeFakeRepoRoot({ pglite: healthyEntries(), dsql: healthyEntries() });
		const { files, violations } = checkAllJournals(root, { now: 1_785_000_000_000 });
		expect(files).toHaveLength(2);
		expect(violations).toStrictEqual([]);
	});

	it('[WR8d] findJournalFiles は dialect ディレクトリのみを拾う (meta 無しは無視)', () => {
		const root = makeFakeRepoRoot({ pglite: healthyEntries() });
		// journal を持たない dialect ディレクトリ (SQL だけ置いた作業中ディレクトリ等) は対象外。
		mkdirSync(join(root, 'drizzle', 'work-in-progress'), { recursive: true });
		expect(findJournalFiles(root)).toStrictEqual(['drizzle/pglite/meta/_journal.json']);
	});

	it('[WR8e] JSON として壊れた journal は R0-parse で fail する', () => {
		const root = makeFakeRepoRoot({ pglite: healthyEntries() });
		writeFileSync(join(root, 'drizzle', 'pglite', 'meta', '_journal.json'), '{ broken');
		const { violations } = checkAllJournals(root);
		expect(violations.map((v) => v.rule)).toStrictEqual(['R0-parse']);
	});

	it('[WR4] DSQL provision は `when` を参照しない (idx 順 + tag 冪等) — 影響波及なしの固定', () => {
		// `when` を意図的に逆転させても、DSQL の loadMigrationFiles は idx 順で読む。
		// = #3946 / #3948 の class は PGlite (drizzle-orm migrator) 固有であり cloud には波及しない。
		const dir = makeMigrationsDir([
			{ idx: 0, when: 3000, tag: '0000_a' },
			{ idx: 1, when: 2000, tag: '0001_b' },
			{ idx: 2, when: 1000, tag: '0002_c' },
		]);
		expect(loadMigrationFiles(dir).map((f) => f.tag)).toStrictEqual(['0000_a', '0001_b', '0002_c']);
	});
});
