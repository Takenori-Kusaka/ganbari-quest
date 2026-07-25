// tests/unit/db/pglite-journal-when-range-3948.test.ts
// #3948 — drizzle journal `when` の **値域** を機械検証する gate のテスト (class-lock)。
//
// #3947 が追加した [JM1] (pglite-journal-monotonic-3946.test.ts) は `when` の狭義単調増加のみを
// assert しており、**末尾 entry に遠い未来値を手書きすれば PASS したまま**、以後 drizzle-kit が
// 生成する全 migration が本番既存 DB で永久 skip される (#3946 と完全に同型の本番 500)。
// 本テストはその穴を塞ぐ gate (scripts/lib/db/drizzle-journal-gate.mjs) を CI で hard-fail させる。
//
//   [WR1] 実 journal (drizzle/pglite/meta/_journal.json) が gate の全ルールを満たす
//   [WR2] gate 自体の実効性: 未来値 / 手書き丸め値 / 逆転 / 過去すぎる値 の fixture で fail する
//   [WR3] grandfather は既存 3 値限定 — 同型の新規丸め値は grandfather されず fail する
//   [WR4] DSQL provision は `when` を参照しない (idx 順 + tag 冪等) ことの固定
//
// [WR2] は「gate を書いたが実は何も落とせていない」を防ぐ実効性検証 (#3072 と同型の考え方)。

import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
	findJournalWhenViolations,
	formatJournalWhenViolations,
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

describe('drizzle journal `when` 値域 gate (#3948)', () => {
	it('[WR1] 実 journal (drizzle/pglite) が gate の全ルールを満たす', () => {
		const entries = loadRealJournal();
		expect(entries.length).toBeGreaterThan(0);
		const violations = findJournalWhenViolations(entries);
		expect(
			violations,
			`journal 違反あり:\n${formatJournalWhenViolations(violations)}`,
		).toStrictEqual([]);
	});

	it('[WR1b] 実 journal の grandfather 例外は既知 3 値のみ (新規追加が混ざっていない)', () => {
		const entries = loadRealJournal();
		// grandfather を無効化すると、既知 3 値 **だけ** が R2 で落ちる = 例外が増えていない。
		const withoutGrandfather = findJournalWhenViolations(entries, { grandfathered: [] });
		expect(withoutGrandfather.every((v) => v.rule === 'R2-handwritten')).toBe(true);
		expect(withoutGrandfather.map((v) => v.when).sort()).toStrictEqual([...GRANDFATHERED_WHEN]);
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
