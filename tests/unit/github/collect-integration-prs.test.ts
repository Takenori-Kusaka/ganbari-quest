// Issue #4053: 統合 PR の「含有 PR 一覧」が main..develop の実差分と一致することを固定する回帰テスト。
//
// 背景 (実測): 旧実装は候補 PR を「main HEAD の commit 日時 (%cI = +09:00 形) 以降に develop へ
// merge された PR」として jq の**文字列比較**で絞っていた。
//   - 原因 1: `+09:00` 形と `Z` 形の辞書順比較は時刻比較にならない
//   - 原因 2: anchor が前回統合 merge ではなく main HEAD (= hotfix commit) だった
// 結果、main..develop に 21 本の merged PR がある状態で含有一覧が 3 本しか出ず、
// 監査証跡 (#2950 AC4) と `Closes` 集約 (#3423) が同時に壊れていた。
//
// fixture は **実在の履歴** (origin/main=7821e9ff / origin/develop=9d20b59a) をそのまま使う。
// 規則から外れた実在物 (subject が `@ (#4009)` の squash commit / main HEAD が hotfix merge /
// dependabot PR で `## 関連 Issue` section を持たない body) を意図的に含める (#3956 教訓)。
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
	compareIsoInstant,
	computeDriftDays,
	excludeReason,
	extractMergedPrNumber,
	extractMergedPrNumbers,
	findLastIntegrationAnchor,
	formatReconcileReport,
	isAtOrAfterInstant,
	isIntegrationMergeSubject,
	parseFirstParentLog,
	reconcileCandidates,
	toEpochMs,
} from '../../../scripts/collect-integration-prs.mjs';
import {
	buildContainedPrTable,
	countContainedTableRows,
	extractClosedIssues,
	renderIntegrationPrBody,
} from '../../../scripts/integration-pr-body.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = resolve(__dirname, '../../fixtures/integration-pr');
const readFixture = (name: string) => readFileSync(resolve(FIXTURE_DIR, name), 'utf8');

const RANGE_LOG = readFixture('main-develop-first-parent.txt');
const MAIN_LOG = readFixture('main-first-parent.txt');
type PrFixture = {
	number: number;
	title: string;
	headRefName: string;
	labels: { name: string }[];
	mergedAt: string;
	body: string;
};
const PRS = JSON.parse(readFixture('develop-merged-prs.json')) as PrFixture[];
const PRS_TZ_MIXED = JSON.parse(readFixture('develop-merged-prs-tz-mixed.json')) as PrFixture[];

// 実測値 (Issue #4053 AC3): main..develop の merged PR 21 本 = 含有 19 + 除外 2 (back-merge)。
const TOTAL_MERGED_PRS = 21;
const EXPECTED_CONTAINED = 19;
const EXPECTED_EXCLUDED = [3933, 3949];

describe('extractMergedPrNumber (#4053 — merge 履歴から PR 番号を取る)', () => {
	it('merge commit 形から PR 番号を取る', () => {
		expect(
			extractMergedPrNumber('Merge pull request #3949 from Takenori-Kusaka/back-merge/fix-3946'),
		).toBe(3949);
	});

	it('squash 形は末尾の (#N) を PR 番号として取る (subject 中の Issue 番号を拾わない)', () => {
		expect(
			extractMergedPrNumber('fix(db): #3948 drizzle journal `when` の値域 gate を追加 (#3951)'),
		).toBe(3951);
	});

	it('実在の異形 subject `@ (#4009)` からも取れる', () => {
		expect(extractMergedPrNumber('@ (#4009)')).toBe(4009);
	});

	it('PR を伴わない直 push commit は null', () => {
		expect(extractMergedPrNumber('fix: 直接 push した commit')).toBeNull();
	});
});

describe('parseFirstParentLog / extractMergedPrNumbers (#4053 AC3)', () => {
	it('実履歴 main..develop の first-parent log を 21 entry として読む', () => {
		expect(parseFirstParentLog(RANGE_LOG)).toHaveLength(TOTAL_MERGED_PRS);
	});

	it('subject に `|` を含む行でも sha / 日時 / subject を壊さない', () => {
		const parsed = parseFirstParentLog('abc123|2026-07-26T08:01:03+09:00|fix: a|b|c (#1)');
		expect(parsed).toEqual([
			{ sha: 'abc123', committedIso: '2026-07-26T08:01:03+09:00', subject: 'fix: a|b|c (#1)' },
		]);
	});

	it('実履歴から 21 本の merged PR 番号を漏れなく取る', () => {
		const numbers = extractMergedPrNumbers(parseFirstParentLog(RANGE_LOG));
		expect(numbers).toHaveLength(TOTAL_MERGED_PRS);
		// Issue で名指しされた脱落 PR が候補に入っていること。
		expect(numbers).toEqual(expect.arrayContaining([3932, 3944, 3951]));
	});
});

describe('anchor 判定 (#4053 AC2 — hotfix で anchor が前進しない)', () => {
	it('main HEAD が hotfix merge でも anchor は直近の統合 merge を指す', () => {
		const entries = parseFirstParentLog(MAIN_LOG);
		// 実履歴の main HEAD は hotfix。
		expect(entries[0]?.subject).toContain(
			'Merge pull request #3947 from Takenori-Kusaka/fix/3946-pglite-journal-monotonic',
		);
		const anchor = findLastIntegrationAnchor(entries);
		expect(anchor?.sha.slice(0, 8)).toBe('62236700');
		expect(anchor?.subject).toContain('develop→main 統合');
	});

	it('統合 merge の 3 形式を認識する', () => {
		expect(isIntegrationMergeSubject('Merge pull request #3995 from Takenori-Kusaka/develop')).toBe(
			true,
		);
		expect(isIntegrationMergeSubject("Merge branch 'develop' into main")).toBe(true);
		expect(isIntegrationMergeSubject('[統合] develop → main (2026-07-26)')).toBe(true);
	});

	it('hotfix の main 直 merge は統合 merge と判定しない', () => {
		expect(
			isIntegrationMergeSubject(
				'Merge pull request #3947 from Takenori-Kusaka/fix/3946-pglite-journal-monotonic',
			),
		).toBe(false);
		expect(
			isIntegrationMergeSubject(
				'fix(deploy): 第16回リリース完遂 — ADR-0019 replacement 承認 (#3885)',
			),
		).toBe(false);
	});

	it('統合 merge が 1 件も無い履歴では null (呼び出し側が warning 付きで fallback する)', () => {
		expect(
			findLastIntegrationAnchor(parseFirstParentLog('abc|2026-07-26T08:01:03+09:00|fix: x')),
		).toBeNull();
	});
});

describe('時刻比較 (#4053 AC1 — TZ 表記に依存しない)', () => {
	// 実測の 2 値: SINCE_ISO = 2026-07-26T08:01:03+09:00 / mergedAt = 2026-07-25T23:01:03Z
	const JST = '2026-07-26T08:01:03+09:00';
	const SAME_INSTANT_Z = '2026-07-25T23:01:03Z';

	it('TZ 表記が異なる同一時刻は等しいと判定される', () => {
		expect(toEpochMs(JST)).toBe(toEpochMs(SAME_INSTANT_Z));
		expect(compareIsoInstant(JST, SAME_INSTANT_Z)).toBe(0);
		expect(isAtOrAfterInstant(SAME_INSTANT_Z, JST)).toBe(true);
		expect(isAtOrAfterInstant(JST, SAME_INSTANT_Z)).toBe(true);
	});

	it('旧実装の文字列比較は同一時刻を false にする (回帰の固定)', () => {
		// これが 3/21 しか出なかった直接の原因。時刻比較なら true になる。
		expect(SAME_INSTANT_Z >= JST).toBe(false);
		expect(isAtOrAfterInstant(SAME_INSTANT_Z, JST)).toBe(true);
	});

	it('実際に anchor より後の PR (#3951) を文字列比較は落とし、時刻比較は拾う', () => {
		const mergedAt = '2026-07-26T00:36:09Z'; // #3951
		expect(mergedAt >= JST).toBe(false);
		expect(isAtOrAfterInstant(mergedAt, JST)).toBe(true);
	});

	it('解釈不能な ISO は例外にする (silent に false を返さない)', () => {
		expect(() => compareIsoInstant('not-a-date', '2026-07-26T00:00:00Z')).toThrow();
	});

	it('drift 日数は TZ 混在でも epoch 正規化で計算する', () => {
		expect(computeDriftDays('2026-07-24T19:54:00+09:00', '2026-07-26T21:00:00Z')).toBe(2);
	});
});

describe('reconcileCandidates (#4053 AC3 / AC5 — 実差分との突合)', () => {
	const numbers = extractMergedPrNumbers(parseFirstParentLog(RANGE_LOG));

	it('実履歴で 含有 19 + 除外 2 = 21 (main..develop の merged PR 数) が成立する', () => {
		const r = reconcileCandidates({ mergedPrNumbers: numbers, prs: PRS });
		expect(r.total).toBe(TOTAL_MERGED_PRS);
		expect(r.contained).toHaveLength(EXPECTED_CONTAINED);
		expect(r.excluded.map((e) => e.number)).toEqual(EXPECTED_EXCLUDED);
		expect(r.missing).toEqual([]);
		expect(r.ok).toBe(true);
	});

	it('旧実装が落としていた #3932 / #3944 / #3951 が含有に入る', () => {
		const r = reconcileCandidates({ mergedPrNumbers: numbers, prs: PRS });
		expect(r.contained).toEqual(expect.arrayContaining([3932, 3944, 3951]));
	});

	it('mergedAt の TZ 表記が混在しても結果が変わらない (候補収集が時刻に依存しない、AC1)', () => {
		const zForm = reconcileCandidates({ mergedPrNumbers: numbers, prs: PRS });
		const mixed = reconcileCandidates({ mergedPrNumbers: numbers, prs: PRS_TZ_MIXED });
		// fixture は半数の mergedAt を同一時刻の +09:00 表記に置換したもの。
		expect(PRS_TZ_MIXED.some((p) => p.mergedAt.endsWith('+09:00'))).toBe(true);
		expect(PRS_TZ_MIXED.some((p) => p.mergedAt.endsWith('Z'))).toBe(true);
		expect(mixed).toEqual(zForm);
	});

	it('除外理由が back-merge であることを出力する (AC5)', () => {
		const r = reconcileCandidates({ mergedPrNumbers: numbers, prs: PRS });
		for (const e of r.excluded) expect(e.reason).toContain('back-merge');
		expect(formatReconcileReport(r)).toContain('19 (含有) + 2 (除外) = 21 / 21');
		expect(formatReconcileReport(r)).toContain('RESULT: OK');
	});

	it('候補から 1 件落とすと突合が失敗する (AC6 mutation)', () => {
		const mutated = PRS.filter((p) => p.number !== 3951);
		const r = reconcileCandidates({ mergedPrNumbers: numbers, prs: mutated });
		expect(r.ok).toBe(false);
		expect(r.missing).toEqual([3951]);
		expect(formatReconcileReport(r)).toContain('RESULT: MISMATCH');
	});

	it('戻すと突合が成功する (AC6 mutation の対、pass 側)', () => {
		expect(reconcileCandidates({ mergedPrNumbers: numbers, prs: PRS }).ok).toBe(true);
	});

	it('統合 PR 自身 (head=develop) は除外理由付きで落ちる', () => {
		expect(excludeReason({ headRefName: 'develop' })).toContain('統合 PR 自身');
		expect(excludeReason({ headRefName: 'fix/1-x' })).toBeNull();
	});
});

describe('旧実装の再現 (#4053 — 3 本しか出なかったことの固定)', () => {
	it('main HEAD anchor + 文字列比較だと 3 本まで減る (#3995 body の実測と一致)', () => {
		// 旧 workflow: SINCE_ISO = main HEAD (hotfix #3947) の %cI、jq の文字列 >= で絞る。
		const sinceIso = parseFirstParentLog(MAIN_LOG)[0]?.committedIso ?? '';
		expect(sinceIso).toBe('2026-07-26T08:01:03+09:00');
		// #3995 body を最終生成した run (2026-07-26T21:21:33Z) 時点に存在した PR のみを母集合にする。
		const RUN_AT = Date.parse('2026-07-26T21:21:33Z');
		const existed = PRS.filter((p) => Date.parse(p.mergedAt) <= RUN_AT);
		const legacy = existed.filter((p) => p.mergedAt >= sinceIso); // ← jq の文字列比較の再現
		const table = buildContainedPrTable(legacy);
		expect(countContainedTableRows(table)).toBe(3);
		// 実際に #3995 body に出ていた 3 本と一致する。
		expect(legacy.map((p) => p.number).sort((a, b) => a - b)).toEqual([3956, 3965, 3968]);
	});

	it('新実装 (merge 履歴ベース) では 19 本になる', () => {
		const table = buildContainedPrTable(PRS);
		expect(countContainedTableRows(table)).toBe(EXPECTED_CONTAINED);
	});
});

describe('生成 body の自己検証 (#4053 AC4 / AC5)', () => {
	const TEMPLATE = readFileSync(
		resolve(__dirname, '../../../.github/INTEGRATION_PR_TEMPLATE.md'),
		'utf8',
	);
	const body = renderIntegrationPrBody({
		template: TEMPLATE,
		prs: PRS,
		developHead: '9d20b59a',
		sinceDate: '2026-07-24',
		untilDate: '2026-07-27',
	});

	it('含有 PR 一覧が 19 行になる (AC3)', () => {
		expect(countContainedTableRows(body)).toBe(EXPECTED_CONTAINED);
	});

	it('Closes 集約が含有 19 本の body だけから取られる (AC4)', () => {
		const closes = [...body.matchAll(/^Closes #(\d+)$/gm)].map((m) => Number(m[1]));
		const contained = PRS.filter((p) => !EXPECTED_EXCLUDED.includes(p.number));
		expect(closes).toEqual(extractClosedIssues(contained));
		// 除外した back-merge PR の body 由来の issue が混ざっていないこと。
		const excludedOnly = extractClosedIssues(
			PRS.filter((p) => EXPECTED_EXCLUDED.includes(p.number)).map((p) => ({
				...p,
				headRefName: 'fix/forced-contained',
				labels: [],
			})),
		).filter((n) => !extractClosedIssues(contained).includes(n));
		for (const n of excludedOnly) expect(closes).not.toContain(n);
	});

	it('countContainedTableRows は空表 placeholder を 0 と数える', () => {
		expect(countContainedTableRows(buildContainedPrTable([]))).toBe(0);
	});
});

describe('CLI 突合 gate (#4053 AC5 / AC6 — 実プロセス)', () => {
	const REPO_ROOT = resolve(__dirname, '../../..');
	const COLLECT = resolve(REPO_ROOT, 'scripts/collect-integration-prs.mjs');
	const BODY = resolve(REPO_ROOT, 'scripts/integration-pr-body.mjs');
	const TEMPLATE_PATH = resolve(REPO_ROOT, '.github/INTEGRATION_PR_TEMPLATE.md');
	const tmp = mkdtempSync(join(tmpdir(), 'integration-prs-'));

	const runCollect = (prsPath: string) =>
		spawnSync(
			process.execPath,
			[
				COLLECT,
				'--first-parent-log',
				resolve(FIXTURE_DIR, 'main-develop-first-parent.txt'),
				'--anchor-log',
				resolve(FIXTURE_DIR, 'main-first-parent.txt'),
				'--prs',
				prsPath,
				'--out',
				join(tmp, 'out.json'),
				'--reconcile-out',
				join(tmp, 'reconcile.json'),
			],
			{ encoding: 'utf8' },
		);

	it('実 fixture では exit 0 + 突合式と anchor を出力する', () => {
		const r = runCollect(resolve(FIXTURE_DIR, 'develop-merged-prs.json'));
		expect(r.stdout).toContain('19 (含有) + 2 (除外) = 21 / 21');
		expect(r.stdout).toContain('62236700');
		expect(r.stdout).toContain('RESULT: OK');
		expect(r.status).toBe(0);
		const reconcile = JSON.parse(readFileSync(join(tmp, 'reconcile.json'), 'utf8'));
		expect(reconcile.expectedContained).toBe(EXPECTED_CONTAINED);
		expect(reconcile.anchorIsIntegrationMerge).toBe(true);
		expect(reconcile.sinceDate).toBe('2026-07-24'); // 前回統合 merge の日付 (hotfix の 07-26 ではない)
	});

	it('候補を 1 件落とすと exit 1 (AC6 mutation: fail 側)', () => {
		const mutatedPath = join(tmp, 'mutated.json');
		writeFileSync(mutatedPath, JSON.stringify(PRS.filter((p) => p.number !== 3951)), 'utf8');
		const r = runCollect(mutatedPath);
		expect(r.status).toBe(1);
		expect(r.stdout).toContain('RESULT: MISMATCH');
		expect(r.stdout).toContain('#3951');
	});

	it('戻すと exit 0 (AC6 mutation: pass 側)', () => {
		expect(runCollect(resolve(FIXTURE_DIR, 'develop-merged-prs.json')).status).toBe(0);
	});

	it('body 生成側も期待件数と一致しなければ exit 4 (二重の gate)', () => {
		const args = [
			BODY,
			'--template',
			TEMPLATE_PATH,
			'--prs',
			resolve(FIXTURE_DIR, 'develop-merged-prs.json'),
			'--develop-head',
			'9d20b59a',
		];
		const ok = spawnSync(process.execPath, [...args, '--expected-contained', '19'], {
			encoding: 'utf8',
		});
		expect(ok.status).toBe(0);
		expect(countContainedTableRows(ok.stdout)).toBe(EXPECTED_CONTAINED);

		const ng = spawnSync(process.execPath, [...args, '--expected-contained', '21'], {
			encoding: 'utf8',
		});
		expect(ng.status).toBe(4);
		expect(ng.stderr).toContain('含有 PR 一覧の行数が git 側の実数と一致しません');
		expect(ng.stdout).toBe(''); // 少ない一覧を silent に出力しない
	});
});
