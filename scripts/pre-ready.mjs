#!/usr/bin/env node
/**
 * scripts/pre-ready.mjs — Issue #1775 AC1
 *
 * `npm run pre-ready -- --pr <num>` で呼ばれる Ready 化前ローカル一括セルフチェック CLI。
 *
 * 直近 50 PR で頻発した CI 自己言及循環 / PR body 禁止語混入 / 必須セクション欠落 /
 * mergeable: CONFLICTING / ローカル biome / svelte-check / vitest 忘れ を、
 * Ready 化前に開発者がローカルで一括検出できるようにする。
 *
 * Step 1-7 を順次実行し、各 fail で即 exit 1 + 修正方針を表示する。
 * 各 Step は既存の `scripts/*.mjs` / `npm run *` を子プロセスで呼ぶラッパー（独自実装は最小化）。
 *
 * 設計選定 (Issue #1775 / OSS 比較):
 *   採用しなかった選択肢:
 *     - Husky + lint-staged: pre-commit に重い検査を入れると開発体験悪化（commit 単位検査でなく PR 単位）
 *     - lefthook: Husky 同様 git hook 用途。本 CLI は明示的 `npm run pre-ready` 起動が PO 方針
 *     - pre-commit (python): Python 環境必須で本リポジトリ (Node) と整合せず
 *   採用:
 *     - 純 Node CLI (本ファイル)。`scripts/*.mjs` を `child_process.spawn` で順次呼ぶ薄いオーケストレータ。
 *       既存の `lint`, `lint:parallel` 系 npm scripts と同じ世界観。`.husky/pre-push` 連携は AC6 で別 ADR 化。
 *
 * Usage:
 *   npm run pre-ready -- --pr 1775
 *   npm run pre-ready -- --pr 1775 --skip-vitest          # 重い vitest をスキップして高速確認
 *   npm run pre-ready                                      # PR 未作成時 (PR body / mergeable 検証はスキップ)
 *
 * exit:
 *   0 = 全 Step PASS
 *   1 = いずれかの Step FAIL
 *   2 = internal error
 */

import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');

// ---------------------------------------------------------------------------
// CLI 引数
// ---------------------------------------------------------------------------

const SKIP_FLAGS = {
	'--skip-biome': 'skipBiome',
	'--skip-svelte-check': 'skipSvelteCheck',
	'--skip-vitest': 'skipVitest',
	'--skip-hardcoded': 'skipHardcoded',
	'--skip-lp-dimensions': 'skipLpDimensions',
	'--skip-lp-fallback': 'skipLpFallback',
	'--skip-pr-body': 'skipPrBody',
	'--skip-capture': 'skipCapture',
};

function parseArgs(argv) {
	const args = {
		pr: null,
		skipBiome: false,
		skipSvelteCheck: false,
		skipVitest: false,
		skipHardcoded: false,
		skipLpDimensions: false,
		skipLpFallback: false,
		skipPrBody: false,
		skipCapture: false,
		help: false,
	};
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		if (a === '--pr' || a === '-p') {
			args.pr = argv[++i];
		} else if (a.startsWith('--pr=')) {
			args.pr = a.slice('--pr='.length);
		} else if (a === '--help' || a === '-h') {
			args.help = true;
		} else if (SKIP_FLAGS[a]) {
			args[SKIP_FLAGS[a]] = true;
		}
	}
	return args;
}

function printHelp() {
	console.log(`
pre-ready — Ready for Review 前のローカル一括セルフチェック (Issue #1775)

Usage:
  npm run pre-ready -- --pr <number>
  npm run pre-ready                                # PR 未作成時 (Step 6/7 はスキップ)

Options:
  --pr <num>             GitHub PR 番号 (Step 6 PR body / mergeable 検証用)
  --skip-biome           Step 1 biome check をスキップ
  --skip-svelte-check    Step 2 svelte-check をスキップ
  --skip-vitest          Step 3 vitest をスキップ (重いので高速確認時のみ)
  --skip-hardcoded       Step 4 hardcoded JP text 検査をスキップ
  --skip-lp-dimensions   Step 5 LP 寸法・禁止語検査をスキップ (LP 変更時のみ自動実行)
  --skip-lp-fallback     Step 6 LP fallback 同期検査をスキップ (LP / labels.ts 変更時のみ自動実行)
  --skip-pr-body         Step 7 PR body 検査をスキップ
  --skip-capture         Step 8 capture (UI 変更時のみ) をスキップ
  --help, -h             このヘルプ

Steps:
  1. biome check                 — lint
  2. svelte-check                — TS strict 型チェック
  3. vitest run                  — unit test (storybook 以外)
  4. check-hardcoded-strings.mjs — JP ハードコード baseline 監視 (#1452)
  5. measure-lp-dimensions.mjs   — LP 寸法 / 禁止語 (LP 変更時のみ)
  6. sync-lp-fallback.mjs        — LP fallback テキスト同期検査 (LP / labels.ts 変更時のみ、#1945)
  7. check-pr-body.mjs           — PR body 必須セクション / 禁止語 / AC マップ / mergeable (PR 番号必須)
  8. capture.mjs --pr            — UI 変更検知時のみ撮影 (現状は手動推奨。本 step は実行ガイダンスのみ)

Exit codes:
  0 = 全 Step PASS
  1 = いずれかの Step FAIL (即停止 + 修正方針表示)
  2 = internal error
`);
}

// ---------------------------------------------------------------------------
// 子プロセス実行ヘルパー
// ---------------------------------------------------------------------------

/**
 * 子プロセスを spawn し、stdout/stderr を親に inherit、exit code を Promise で返す。
 * Windows 対応のため shell: true を使用。
 *
 * @param {string} cmd 表示用ラベル
 * @param {string[]} argv 実行コマンド (argv[0] が executable)
 * @returns {Promise<number>} exit code
 */
function run(cmd, argv) {
	return new Promise((resolveP) => {
		console.log(`\n[pre-ready] ▶ ${cmd}`);
		const child = spawn(argv[0], argv.slice(1), {
			cwd: repoRoot,
			stdio: 'inherit',
			shell: true,
		});
		child.on('exit', (code) => resolveP(code ?? 1));
		child.on('error', (err) => {
			console.error(`[pre-ready] ${cmd} error:`, err.message);
			resolveP(1);
		});
	});
}

/**
 * `git diff origin/main...HEAD --name-only` で変更ファイル一覧を取得する。
 * @returns {Promise<string[]>}
 */
async function getChangedFiles() {
	return new Promise((resolveP) => {
		const child = spawn('git', ['diff', 'origin/main...HEAD', '--name-only'], {
			cwd: repoRoot,
			stdio: ['ignore', 'pipe', 'ignore'],
			shell: true,
		});
		let out = '';
		child.stdout.on('data', (d) => (out += d.toString()));
		child.on('exit', () => {
			resolveP(
				out
					.split('\n')
					.map((s) => s.trim())
					.filter(Boolean),
			);
		});
		child.on('error', () => resolveP([]));
	});
}

// ---------------------------------------------------------------------------
// Step 定義
// ---------------------------------------------------------------------------

/**
 * 各 Step は { name, label, runner, fixHint, skip? } を返す。
 * runner は () => Promise<number> (exit code)。
 */
function buildSteps(args, changedFiles) {
	const lpChanged = changedFiles.some((f) => f.startsWith('site/'));
	const labelsChanged = changedFiles.some(
		(f) => f === 'src/lib/domain/labels.ts' || f === 'src/lib/domain/terms.ts',
	);
	// LP fallback 同期は LP / labels.ts どちらかが変わると影響を受ける
	const lpFallbackTrigger = lpChanged || labelsChanged;
	const uiChanged = changedFiles.some(
		(f) => /\.(svelte|css|scss)$/.test(f) || f.startsWith('site/'),
	);

	return [
		{
			name: 'biome',
			label: 'Step 1/8: biome check',
			skip: args.skipBiome,
			runner: () => run('biome check', ['npx', 'biome', 'check', '.']),
			fixHint:
				'  npx biome check --write .   # 自動修正可能なものを修正\n' +
				'  remaining error は手動で修正してから再実行',
		},
		{
			name: 'svelte-check',
			label: 'Step 2/8: svelte-check (TS strict)',
			skip: args.skipSvelteCheck,
			runner: () => run('svelte-check', ['npx', 'svelte-check', '--tsconfig', './tsconfig.json']),
			fixHint: '  型エラー箇所を修正。`as any` / `// @ts-expect-error` の追加は禁止 (ADR-0006)。',
		},
		{
			name: 'vitest',
			label: 'Step 3/8: vitest run (unit test)',
			skip: args.skipVitest,
			runner: () => run('vitest', ['npx', 'vitest', 'run']),
			fixHint:
				'  失敗テストを修正。assertion を弱める変更は禁止 (ADR-0006)。\n' +
				'  storybook テストは `npm run test:storybook` で別途確認。',
		},
		{
			name: 'hardcoded-strings',
			label: 'Step 4/8: check-hardcoded-strings.mjs (#1452 Phase A)',
			skip: args.skipHardcoded,
			runner: () => run('check-hardcoded-strings', ['node', 'scripts/check-hardcoded-strings.mjs']),
			fixHint:
				'  baseline (1607 件) より JP ハードコードが増えています。\n' +
				'  src/lib/domain/labels.ts に定数追加して `data-label` / import 経由に置換 (ADR-0009)。',
		},
		{
			name: 'lp-dimensions',
			label: `Step 5/8: measure-lp-dimensions.mjs (LP 変更検知: ${lpChanged ? 'YES' : 'NO — skip'})`,
			skip: args.skipLpDimensions || !lpChanged,
			runner: () => run('measure-lp-dimensions', ['node', 'scripts/measure-lp-dimensions.mjs']),
			fixHint:
				'  LP 寸法 / 禁止語の閾値違反 (#1163 ratchet)。\n' +
				'  - mobileHeight ≤ 15000px / desktopHeight ≤ 8000px\n' +
				'  - 禁止語 (ガチャ / 抽選 / コンプリート / git clone 等) を含めない\n' +
				'  - CTA は 3 種以下',
		},
		{
			name: 'lp-fallback',
			label: `Step 6/8: sync-lp-fallback.mjs --check (LP / labels.ts 変更検知: ${lpFallbackTrigger ? 'YES' : 'NO — skip'})`,
			skip: args.skipLpFallback || !lpFallbackTrigger,
			runner: () => run('sync-lp-fallback', ['node', 'scripts/sync-lp-fallback.mjs', '--check']),
			fixHint:
				'  site/*.html の data-lp-key fallback テキストが labels.ts と乖離しています (#1945)。\n' +
				'  修正: `node scripts/sync-lp-fallback.mjs` を実行して fallback を再生成し、\n' +
				'        生成された site/*.html の差分をコミットしてください。',
		},
		{
			name: 'pr-body',
			label: args.pr
				? `Step 7/8: check-pr-body.mjs --pr ${args.pr}`
				: 'Step 7/8: check-pr-body.mjs (--pr 未指定 — skip)',
			skip: args.skipPrBody || !args.pr,
			runner: () => run('check-pr-body', ['node', 'scripts/check-pr-body.mjs', '--pr', args.pr]),
			fixHint:
				'  PR body の必須セクション欠落 / 禁止語混入 / AC マップ未記入 / CONFLICTING など。\n' +
				'  詳細は scripts/check-pr-body.mjs --help を参照。',
		},
		{
			name: 'capture',
			label: `Step 8/8: capture.mjs (UI 変更検知: ${uiChanged ? 'YES' : 'NO — skip'})`,
			skip: args.skipCapture || !uiChanged || !args.pr,
			runner: async () => {
				console.log(
					`[pre-ready] UI 変更を検知しました。スクリーンショット撮影は手動実行を推奨します:\n` +
						`  MSYS_NO_PATHCONV=1 node scripts/capture.mjs --url <path> --presets mobile,desktop --pr ${args.pr}\n` +
						`  詳細は docs/sessions/dev-session.md §「Screenshot Agent」を参照。\n` +
						`  本 Step は実行ガイダンスのみで PASS 扱いとします (実機 dev server 起動を要求しないため)。`,
				);
				return 0;
			},
			fixHint:
				'  `npm run capture -- --url <path> --pr <num>` で撮影し PR body に貼り付け。\n' +
				'  /demo/* は実アプリ検証証跡として禁止 (#1026)。',
		},
	];
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

async function main() {
	const args = parseArgs(process.argv.slice(2));
	if (args.help) {
		printHelp();
		return 0;
	}

	console.log('[pre-ready] Ready for Review 前のローカル一括セルフチェック (Issue #1775)');
	console.log(`[pre-ready] PR 番号: ${args.pr ?? '(未指定 — Step 6/7 はスキップ)'}`);

	// 変更ファイル取得 (LP / UI 変更検知用)
	const changedFiles = await getChangedFiles();
	if (changedFiles.length === 0) {
		console.log(
			'[pre-ready] WARN: origin/main からの変更ファイルが取得できませんでした (origin 未 fetch / ブランチ不一致の可能性)',
		);
	} else {
		console.log(`[pre-ready] 変更ファイル数: ${changedFiles.length}`);
	}

	const steps = buildSteps(args, changedFiles);
	const failed = [];
	const skipped = [];

	for (const step of steps) {
		if (step.skip) {
			console.log(`[pre-ready] ⊘ ${step.label}`);
			skipped.push(step.name);
			continue;
		}
		const code = await step.runner();
		if (code !== 0) {
			console.log(`\n[pre-ready] ✗ ${step.label} FAILED (exit ${code})`);
			console.log('[pre-ready] 修正方針:');
			console.log(step.fixHint);
			failed.push(step.name);
			// 即停止 (AC1 「各 Step で fail で即 exit 1 + 修正方針表示」)
			console.log(
				`\n[pre-ready] FAIL — Step ${step.name} で停止しました。修正後に再実行してください。`,
			);
			return 1;
		}
		console.log(`[pre-ready] ✓ ${step.label}`);
	}

	console.log(
		`\n[pre-ready] ALL PASS — Ready for Review に進めます。\n` +
			`  実行: ${steps.length - skipped.length} step / skip: ${skipped.length} step (${skipped.join(', ') || 'none'})\n` +
			`  次の手順:\n` +
			`    1. node scripts/check-gh-account-before-pr.mjs   # gh アカウント確認 (#1728)\n` +
			`    2. gh pr ready ${args.pr ?? '<num>'}                            # Ready for Review に変更\n` +
			`    3. CI 全緑になるまで待機し、QM レビューを依頼\n`,
	);
	return 0;
}

main()
	.then((code) => process.exit(code))
	.catch((err) => {
		console.error('[pre-ready] internal error:', err);
		process.exit(2);
	});
