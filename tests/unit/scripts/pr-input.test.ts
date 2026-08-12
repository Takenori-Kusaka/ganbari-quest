/**
 * tests/unit/scripts/pr-input.test.ts (#4348 対象 #7)
 *
 * 検証対象: PR を入力に取る gate が **入力ゼロのまま成功終了しない**こと。
 *
 * 実測 (2026-08-12、PR #4513 / #4515):
 *   $ node scripts/check-ss-blob-sha-uniqueness.mjs --pr 4513
 *   [ss-blob-sha-uniqueness] SKIP — PR body に ... 参照が見つかりません     ← exit 0
 *   $ node scripts/check-pr-screenshot.mjs --pr 4515
 *   [screenshot-check] UI 関連ファイル変更なし — スキップ                   ← exit 0
 *   $ node scripts/check-ss-render-health.mjs --pr 4513
 *   [ss-render-health] SKIP — PR_NUMBER 未指定 (PR コンテキスト外)          ← exit 0
 *
 * 3 本とも argv を一切パースせず env からしか入力を読まないため、`--pr` を付けた誤用が
 * **空文字列を検査して成功終了**していた。PR #4513 は body の SS URL が 404 していたが、
 * この偽 SKIP でローカルは緑になり、CI で初めて hard error として露見した。
 *
 * 本 test は「実行できて、何も検査せず、成功終了する」を不可能にする不変条件を固定する。
 * 判定ロジック層 (#4348 の対象一覧 6 箇所) は本 test の対象ではない。
 */

import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
	formatPrInputUsage,
	PrInputError,
	parseGhPrView,
	parsePrNumberArg,
	planPrInput,
	resolvePrInput,
} from '../../../scripts/lib/ci/pr-input.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

/** 入力ゼロで実行しても成功終了してはいけない gate 群 (#4348 対象 #7 + 兄弟 2 本)。 */
const INPUT_ZERO_GATES = [
	'scripts/check-ss-blob-sha-uniqueness.mjs',
	'scripts/check-pr-screenshot.mjs',
	'scripts/check-ss-render-health.mjs',
] as const;

/** 子プロセスで gate を起動し exit code と出力を返す (throw しない)。 */
function runGate(script: string, args: string[]): { status: number; output: string } {
	// PR 由来 env を明示的に落とす (CI 上で PR_BODY 等が入っていても「入力ゼロ」を再現する)
	const env = { ...process.env };
	for (const k of ['PR_BODY', 'PR_NUMBER', 'PR_LABELS', 'PR_FILES', 'GITHUB_REPOSITORY']) {
		delete env[k];
	}
	try {
		const out = execFileSync(process.execPath, [resolve(REPO_ROOT, script), ...args], {
			cwd: REPO_ROOT,
			encoding: 'utf-8',
			stdio: ['ignore', 'pipe', 'pipe'],
			timeout: 60_000,
			env,
		});
		return { status: 0, output: out };
	} catch (e) {
		const err = e as { status?: number; stdout?: string; stderr?: string };
		return { status: err.status ?? 1, output: `${err.stdout ?? ''}\n${err.stderr ?? ''}` };
	}
}

describe('入力ゼロで成功終了しない (CLI 不変条件、#4348)', () => {
	for (const script of INPUT_ZERO_GATES) {
		it(`${script}: 引数も env も無ければ非 0 で終了する`, () => {
			const { status, output } = runGate(script, []);
			expect(status).not.toBe(0);
			expect(output).toContain('INPUT ERROR');
		});

		it(`${script}: --pr の値が PR 番号でなければ非 0 で終了する`, () => {
			const { status, output } = runGate(script, ['--pr', 'abc']);
			expect(status).not.toBe(0);
			expect(output).toContain('INPUT ERROR');
		});

		it(`${script}: --pr の値が欠落していれば非 0 で終了する (次の引数を食わない)`, () => {
			const { status } = runGate(script, ['--pr']);
			expect(status).not.toBe(0);
		});
	}
});

describe('parsePrNumberArg', () => {
	it('--pr <N> / --pr=<N> / -p <N> を読む', () => {
		expect(parsePrNumberArg(['--pr', '4513'])).toEqual({
			present: true,
			value: '4513',
			raw: '4513',
		});
		expect(parsePrNumberArg(['--pr=4513']).value).toBe('4513');
		expect(parsePrNumberArg(['-p', '4513']).value).toBe('4513');
	});

	it('「渡した事実」と「妥当な値」を分ける (誤用を env fallback に落とさない)', () => {
		// 値が無い / 数字でない場合でも present=true。これが false になると
		// 「--pr を書いたのに env の空 body を検査する」旧挙動に戻る。
		expect(parsePrNumberArg(['--pr'])).toEqual({ present: true, value: null, raw: '' });
		expect(parsePrNumberArg(['--pr', '--verbose'])).toEqual({
			present: true,
			value: null,
			raw: '',
		});
		expect(parsePrNumberArg(['--pr', 'abc'])).toEqual({ present: true, value: null, raw: 'abc' });
	});

	it('--pr が無ければ present=false', () => {
		expect(parsePrNumberArg([])).toEqual({ present: false, value: null, raw: '' });
		expect(parsePrNumberArg(['--help']).present).toBe(false);
	});
});

describe('planPrInput', () => {
	it('--pr <N> があれば gh 経由で引く', () => {
		expect(planPrInput({ argv: ['--pr', '4513'], env: {} })).toEqual({
			source: 'gh',
			prNumber: '4513',
		});
	});

	it('--pr があっても env PR_BODY で代替しない (誤用を黙って通さない)', () => {
		const plan = planPrInput({ argv: ['--pr', 'abc'], env: { PR_BODY: 'x'.repeat(50) } });
		expect(plan.source).toBe('error');
	});

	it('argv 無し + env PR_BODY 実体あり = 既存 CI 経路は不変', () => {
		expect(planPrInput({ argv: [], env: { PR_BODY: '## 概要\n本文' } })).toEqual({
			source: 'env',
			prNumber: null,
		});
	});

	it('env PR_BODY が空 / 空白のみなら error (これが本 Issue の現象)', () => {
		expect(planPrInput({ argv: [], env: {} }).source).toBe('error');
		expect(planPrInput({ argv: [], env: { PR_BODY: '   \n' } }).source).toBe('error');
	});

	it('need=prNumber は PR_NUMBER を見る (check-ss-render-health)', () => {
		expect(planPrInput({ argv: [], env: { PR_NUMBER: '4513' }, need: 'prNumber' })).toEqual({
			source: 'env',
			prNumber: '4513',
		});
		expect(planPrInput({ argv: [], env: { PR_BODY: 'x' }, need: 'prNumber' }).source).toBe('error');
	});

	it('error メッセージは入力の渡し方 2 通りを案内する', () => {
		const plan = planPrInput({ argv: [], env: {}, scriptName: 'scripts/foo.mjs' });
		expect(plan.source).toBe('error');
		if (plan.source !== 'error') return;
		expect(plan.message).toContain('--pr <N>');
		expect(plan.message).toContain('PR_BODY=');
	});
});

describe('parseGhPrView', () => {
	const raw = JSON.stringify({
		body: '## 概要\n本文',
		labels: [{ name: 'type:fix' }, { name: 'priority:high' }],
		files: [{ path: 'scripts/a.mjs' }, { path: 'src/b.svelte' }],
		url: 'https://github.com/Takenori-Kusaka/ganbari-quest/pull/4513',
	});

	it('body / labels / files / owner / repo を取り出す', () => {
		expect(parseGhPrView(raw)).toEqual({
			body: '## 概要\n本文',
			labels: ['type:fix', 'priority:high'],
			files: ['scripts/a.mjs', 'src/b.svelte'],
			owner: 'Takenori-Kusaka',
			repo: 'ganbari-quest',
		});
	});

	it('url が取れない出力は実在確認できないので throw する', () => {
		// gh の単一フィールド --json は存在しない PR でも値を返すことがあるため、
		// url を実在確認に使う (memory: gh-single-field-json-fabricates)。
		expect(() => parseGhPrView(JSON.stringify({ body: 'x' }))).toThrow(PrInputError);
		expect(() => parseGhPrView('not json')).toThrow(PrInputError);
	});
});

describe('resolvePrInput', () => {
	const ghView = () =>
		JSON.stringify({
			body: '## 概要\n本文',
			labels: [{ name: 'type:fix' }],
			files: [{ path: 'src/b.svelte' }],
			url: 'https://github.com/Takenori-Kusaka/ganbari-quest/pull/4513',
		});

	it('--pr 指定で body / labels / files / repo が揃う', () => {
		const input = resolvePrInput({ argv: ['--pr', '4513'], env: {}, ghView });
		expect(input.source).toBe('gh');
		expect(input.body).toContain('本文');
		expect(input.labels).toEqual(['type:fix']);
		expect(input.files).toEqual(['src/b.svelte']);
		expect(input.repo).toBe('Takenori-Kusaka/ganbari-quest');
	});

	it('gh 取得に失敗しても「対象なし」に倒さず throw する', () => {
		expect(() =>
			resolvePrInput({
				argv: ['--pr', '4513'],
				env: {},
				ghView: () => {
					throw new Error('gh: not authenticated');
				},
			}),
		).toThrow(PrInputError);
	});

	it('取得できた body が空なら throw する (検査対象ゼロで成功終了させない)', () => {
		expect(() =>
			resolvePrInput({
				argv: ['--pr', '4513'],
				env: {},
				ghView: () =>
					JSON.stringify({
						body: '',
						labels: [],
						files: [],
						url: 'https://github.com/Takenori-Kusaka/ganbari-quest/pull/4513',
					}),
			}),
		).toThrow(PrInputError);
	});

	it('GITHUB_REPOSITORY があれば ghView に --repo pin 用の expectedRepo を渡す', () => {
		const seen: Array<string | undefined> = [];
		resolvePrInput({
			argv: ['--pr', '4513'],
			env: { GITHUB_REPOSITORY: 'Takenori-Kusaka/ganbari-quest' },
			ghView: (_prNumber, expectedRepo) => {
				seen.push(expectedRepo);
				return ghView();
			},
		});
		expect(seen).toEqual(['Takenori-Kusaka/ganbari-quest']);
	});

	it('gh が別リポジトリの PR url を返したら throw する (検査対象の真正性突合、#4519 と同軸)', () => {
		// cwd ずれ / checkout 構成ミスで意図と違うリポジトリの同番号 PR を引いてしまうケースの再現。
		// url 自体は妥当な形なので #4519 前の実装 (url 形式チェックのみ) は通してしまっていた。
		expect(() =>
			resolvePrInput({
				argv: ['--pr', '4513'],
				env: { GITHUB_REPOSITORY: 'Takenori-Kusaka/ganbari-quest' },
				ghView: () =>
					JSON.stringify({
						body: '## 概要\n本文',
						labels: [],
						files: [],
						url: 'https://github.com/some-other-org/some-other-repo/pull/4513',
					}),
			}),
		).toThrow(PrInputError);
	});

	it('GITHUB_REPOSITORY 未設定ならリポジトリ突合を skip する (ローカル実行の既存経路は不変)', () => {
		const input = resolvePrInput({ argv: ['--pr', '4513'], env: {}, ghView });
		expect(input.repo).toBe('Takenori-Kusaka/ganbari-quest');
	});

	it('env 経路は従来どおり labels / files を分解する', () => {
		const input = resolvePrInput({
			argv: [],
			env: { PR_BODY: '本文', PR_LABELS: 'a, b', PR_FILES: 'x.svelte\ny.ts' },
			ghView,
		});
		expect(input.source).toBe('env');
		expect(input.labels).toEqual(['a', 'b']);
		expect(input.files).toEqual(['x.svelte', 'y.ts']);
	});
});

describe('formatPrInputUsage', () => {
	it('need に応じて env の渡し方を出し分ける', () => {
		expect(formatPrInputUsage('scripts/foo.mjs', 'body')).toContain('PR_BODY=');
		expect(formatPrInputUsage('scripts/foo.mjs', 'prNumber')).toContain('PR_NUMBER=');
	});
});
