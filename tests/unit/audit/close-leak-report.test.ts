import { describe, expect, it } from 'vitest';
import {
	buildCloseLeakReport,
	DEFAULT_REF,
	DEFAULT_SINCE,
	detectCloseLeaks,
	extractCommitIssueRefs,
	isEpicLike,
	parseArgs,
	parseGitLog,
} from '../../../scripts/audit/close-leak-report.mjs';

const RS = String.fromCharCode(0x1e);
const US = String.fromCharCode(0x1f);

const commit = (subject: string, body = '', sha = 'a'.repeat(40), date = '2026-07-01') => ({
	sha,
	date,
	subject,
	body,
});

describe('parseGitLog', () => {
	it('RS/US 区切り raw を record 配列に parse する', () => {
		const raw = [
			`sha1${US}2026-07-01${US}fix: #100 subject${US}body line${RS}`,
			`\nsha2${US}2026-07-02${US}feat: #200 second${US}${RS}`,
		].join('');
		expect(parseGitLog(raw)).toEqual([
			{ sha: 'sha1', date: '2026-07-01', subject: 'fix: #100 subject', body: 'body line' },
			{ sha: 'sha2', date: '2026-07-02', subject: 'feat: #200 second', body: '' },
		]);
	});

	it('空入力 / 非文字列は空配列', () => {
		expect(parseGitLog('')).toEqual([]);
		expect(parseGitLog('   \n ')).toEqual([]);
		// @ts-expect-error 純関数の防御動作検証
		expect(parseGitLog(undefined)).toEqual([]);
	});
});

describe('extractCommitIssueRefs — C 層 close漏れパターン (#3133/#3246/#3088 実データ形)', () => {
	it('#3133 型: conventional subject の issue 参照を拾い、末尾 squash PR 番号 (#N) は除外する', () => {
		const refs = extractCommitIssueRefs(
			commit(
				'fix(security): #3133 /tenants + /uploads/avatars の cross-tenant IDOR を tenant 一致検証で封殺 (#3137)',
			),
		);
		expect(refs).toEqual([3133]); // #3137 (PR 番号) は含まれない
	});

	it('#3246 型: 括弧内の追加参照 (#3244 HOLD) も候補として拾う (report-only、人間が判断)', () => {
		const refs = extractCommitIssueRefs(
			commit(
				'fix(security): #3246 export endpoint を import と対称な owner/parent gate に揃える（家庭内 IDOR、#3244 HOLD） (#3249)',
			),
		);
		expect(refs).toEqual([3244, 3246]);
	});

	it('#3088 型: perf prefix でも subject の issue 参照を拾う', () => {
		const refs = extractCommitIssueRefs(
			commit(
				'perf: #3088 admin landing load を並列化 — 逐次 await + per-child N+1 の wall-clock を短縮 (#3120)',
			),
		);
		expect(refs).toEqual([3088]);
	});

	it('merge commit subject (Merge pull request #N) は PR 番号のため拾わない', () => {
		expect(
			extractCommitIssueRefs(
				commit('Merge pull request #3570 from Takenori-Kusaka/release/2026-07-03'),
			),
		).toEqual([]);
		expect(extractCommitIssueRefs(commit('Merge branch main into develop'))).toEqual([]);
	});

	it('body の行頭 closing keyword 行 (Closes #N / 全角 ＃) を拾う', () => {
		const refs = extractCommitIssueRefs(
			commit('chore: no subject ref', 'Closes #123\nfixes: ＃456\n- resolves #789'),
		);
		expect(refs).toEqual([123, 456, 789]);
	});

	it('body の非 closing 参照 (関連: #N / 文中の closes #N) は拾わない', () => {
		const refs = extractCommitIssueRefs(
			commit('docs: update readme', '関連: #999\nsee also closes #888 in prior PR'),
		);
		expect(refs).toEqual([]);
	});

	it('subject の全角 ＃ 参照も拾う (#3444 under-close 教訓と同型)', () => {
		expect(extractCommitIssueRefs(commit('fix: ＃3200 全角参照'))).toEqual([3200]);
	});

	it('空 commit は空配列', () => {
		expect(extractCommitIssueRefs({})).toEqual([]);
	});
});

describe('isEpicLike', () => {
	it('epic / tracker label を flag する (string / object 両対応)', () => {
		expect(isEpicLike(['epic'])).toBe(true);
		expect(isEpicLike([{ name: 'type:infra' }, { name: 'EPIC' }])).toBe(true);
		expect(isEpicLike([{ name: 'tracker' }])).toBe(true);
		expect(isEpicLike([{ name: 'priority:medium' }])).toBe(false);
		expect(isEpicLike([])).toBe(false);
	});
});

describe('detectCloseLeaks', () => {
	const commits = [
		commit('fix(security): #3133 IDOR 封殺 (#3137)', '', 'c1'.padEnd(40, '0'), '2026-06-20'),
		commit('perf: #3088 admin landing 並列化 (#3120)', '', 'c2'.padEnd(40, '0'), '2026-06-25'),
		commit('feat: #7777 未 open の参照', '', 'c3'.padEnd(40, '0'), '2026-06-26'),
	];

	it('open issue × main コミット参照の積集合のみを leak として返す (issue 番号昇順)', () => {
		const leaks = detectCloseLeaks({
			openIssues: [
				{ number: 3133, title: 'IDOR issue', labels: [{ name: 'type:security' }] },
				{ number: 3088, title: 'perf issue', labels: ['epic'] },
				{ number: 5000, title: 'main 未反映の open issue', labels: [] },
			],
			commits,
		});
		expect(leaks.map((l) => l.number)).toEqual([3088, 3133]);
		expect(leaks[0]).toMatchObject({
			number: 3088,
			epicLike: true,
			labels: ['epic'],
		});
		expect(leaks[0]?.commits).toEqual([
			{
				sha: 'c2'.padEnd(40, '0'),
				date: '2026-06-25',
				subject: 'perf: #3088 admin landing 並列化 (#3120)',
			},
		]);
		expect(leaks[1]).toMatchObject({ number: 3133, epicLike: false });
	});

	it('コミット参照 (#7777) があっても open issue に無ければ返さない (closed 済 / PR 番号)', () => {
		const leaks = detectCloseLeaks({
			openIssues: [{ number: 1, title: 'unrelated', labels: [] }],
			commits,
		});
		expect(leaks).toEqual([]);
	});

	it('空入力は空配列', () => {
		expect(detectCloseLeaks({ openIssues: [], commits: [] })).toEqual([]);
	});
});

describe('buildCloseLeakReport', () => {
	it('0 件時は「検出されませんでした」+ auto-close しない注記', () => {
		const md = buildCloseLeakReport([], {
			since: '90 days ago',
			ref: 'origin/main',
			totalOpen: 10,
			totalCommits: 5,
		});
		expect(md).toContain('検出: 0 件');
		expect(md).toContain('auto-close はしません');
		expect(md).toContain('close漏れ候補は検出されませんでした');
		expect(md).toContain('open issue: 10 件');
	});

	it('N 件時は markdown table + epic flag + pipe escape を出力する', () => {
		const md = buildCloseLeakReport([
			{
				number: 3133,
				title: 'IDOR | pipe を含む title',
				labels: ['type:security'],
				epicLike: false,
				commits: [
					{ sha: 'abcdef1234567890', date: '2026-06-20', subject: 'fix: #3133 封殺 (#3137)' },
				],
			},
			{
				number: 3400,
				title: 'EPIC 親',
				labels: ['epic'],
				epicLike: true,
				commits: [{ sha: 'fedcba0987654321', date: '2026-06-21', subject: 'feat: #3400 partial' }],
			},
		]);
		expect(md).toContain('検出: 2 件');
		expect(md).toContain('| #3133 | IDOR \\| pipe を含む title |');
		expect(md).toContain('`abcdef12` (2026-06-20)');
		expect(md).toContain('⚠️epic/tracker');
	});
});

describe('parseArgs', () => {
	it('デフォルト値 (since 90 days ago / ref origin/main / limit 500 / json false)', () => {
		expect(parseArgs([])).toEqual({
			since: DEFAULT_SINCE,
			ref: DEFAULT_REF,
			limit: 500,
			json: false,
		});
	});

	it('--since / --ref / --limit / --json を parse する', () => {
		expect(
			parseArgs(['--since', '30 days ago', '--ref', 'main', '--limit', '100', '--json']),
		).toEqual({
			since: '30 days ago',
			ref: 'main',
			limit: 100,
			json: true,
		});
	});
});
