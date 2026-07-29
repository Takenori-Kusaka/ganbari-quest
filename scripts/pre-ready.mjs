#!/usr/bin/env node
/**
 * scripts/pre-ready.mjs — Issue #1775 AC1 + Issue #1920 (Phase 5 F3 SSOT 検証 step 組込)
 *
 * `npm run pre-ready -- --pr <num>` で呼ばれる Ready 化前ローカル一括セルフチェック CLI。
 *
 * 直近 50 PR で頻発した CI 自己言及循環 / PR body 禁止語混入 / 必須セクション欠落 /
 * mergeable: CONFLICTING / ローカル biome / svelte-check / vitest 忘れ を、
 * Ready 化前に開発者がローカルで一括検出できるようにする。
 *
 * Issue #1920 で SSOT 検証 3 step を追加 (1 step は既存): check-no-plan-literals (#972 /
 * Phase 5 F1) / sync-lp-fallback (#1945 / Phase 5 F2、既存) / generate-lp-labels --check
 * (#1917 / Phase 1 B1)。F1 #1918 未 merge でも graceful degradation で skip + warning とし、
 * 本 PR を独立に Ready 化可能にする。
 *
 * Step 1-10 を順次実行し、各 fail で即 exit 1 + 修正方針を表示する。
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
 *   npm run pre-ready -- --pr 1920
 *   npm run pre-ready -- --pr 1920 --skip-vitest          # vitest 判定を CI unit-test へ委譲 (#4007)
 *   npm run pre-ready                                      # PR 未作成時 (PR body / mergeable 検証はスキップ)
 *
 * exit:
 *   0 = 全 Step PASS
 *   1 = いずれかの Step FAIL
 *   2 = internal error
 */

import { spawn, spawnSync } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
	isAllowedBaseBranch,
	isSafeGitRefName,
	resolveBaseBranchAuto,
} from './lib/ci/resolve-base-branch.mjs';
import { isMain as isMainModule } from './lib/is-main.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');

// #2929 項目 3: fail-open / 明示 skip した gate の監査注記。
// Step 11b (SS embed gate) は gh pr view 失敗時に WARN + PASS 扱い (fail-open) で素通りし、
// --skip-ss-embed-gate flag でも skip できるが、その事実が最終 summary から見えないと
// 「ローカル ALL PASS = SS embed 検証済」と誤認される。ここに集約し summary で 1 行明示する。
const failOpenNotes = [];

// ---------------------------------------------------------------------------
// CLI 引数
// ---------------------------------------------------------------------------

const SKIP_FLAGS = {
	'--skip-biome': 'skipBiome',
	'--skip-cspell': 'skipCspell',
	'--skip-svelte-check': 'skipSvelteCheck',
	'--skip-vitest': 'skipVitest',
	'--skip-hardcoded': 'skipHardcoded',
	'--skip-lp-dimensions': 'skipLpDimensions',
	'--skip-lp-fallback': 'skipLpFallback',
	'--skip-plan-literals': 'skipPlanLiterals',
	'--skip-license-key-leak': 'skipLicenseKeyLeak',
	'--skip-cli-entry-guard': 'skipCliEntryGuard',
	'--skip-sparse-checkout-closure': 'skipSparseCheckoutClosure',
	'--skip-readdir-rotation-guard': 'skipReaddirRotationGuard',
	'--skip-lp-labels': 'skipLpLabels',
	'--skip-pr-body': 'skipPrBody',
	'--skip-doc-code-references': 'skipDocCodeReferences',
	'--skip-terminology-coherence': 'skipTerminologyCoherence',
	'--skip-ss-embed-gate': 'skipSsEmbedGate',
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
		skipPlanLiterals: false,
		skipLicenseKeyLeak: false,
		skipCliEntryGuard: false,
		skipSparseCheckoutClosure: false,
		skipReaddirRotationGuard: false,
		skipLpLabels: false,
		skipPrBody: false,
		skipDocCodeReferences: false,
		skipTerminologyCoherence: false,
		skipSsEmbedGate: false,
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
  npm run pre-ready                                # PR 未作成時 (Step 9, 12 はスキップ)

Options:
  --pr <num>             GitHub PR 番号 (Step 9 PR body / mergeable 検証用)
  --skip-biome           Step 1 biome check をスキップ
  --skip-cspell          Step 1b cspell spell check をスキップ
  --skip-svelte-check    Step 2 svelte-check をスキップ
  --skip-vitest          Step 3 vitest をローカルで実行せず CI job unit-test へ委譲 (#4007)
                         Ready 化前に gh pr checks <num> で unit-test が pass (skipped でない)
                         ことを確認すること。ci-gate は skipped を failure として数えないため
                         ci-gate green は委譲先が走った証拠にならない
  --skip-hardcoded       Step 4 hardcoded JP text 検査をスキップ
  --skip-lp-dimensions   Step 5 LP 寸法・禁止語検査をスキップ (LP 変更時のみ自動実行)
  --skip-lp-fallback     Step 6 LP fallback 同期検査をスキップ (LP / labels.ts 変更時のみ自動実行)
  --skip-plan-literals   Step 7 plan/status リテラル直書き検査をスキップ (#972 / Phase 5 F1)
  --skip-license-key-leak Step 7b license key 再導入防止検査をスキップ (#2836 / Phase 7 PR-L4)
  --skip-cli-entry-guard Step 7c 自前の CLI 直接実行判定 / 手組み file:// URL 検査をスキップ (#3969)
  --skip-sparse-checkout-closure Step 7d workflow sparse-checkout の import 閉包検査をスキップ (#3969)
  --skip-readdir-rotation-guard Step 7e readdir の緩い一致 × 破壊的操作の検査をスキップ (#3978)
  --skip-lp-labels       Step 8 LP labels 同期検査をスキップ (labels.ts / terms.ts / age-tier.ts 変更時のみ自動実行、Phase 1 B1)
  --skip-pr-body         Step 9 PR body 検査をスキップ
  --skip-doc-code-references Step 10 デッドリンク検査をスキップ
  --skip-terminology-coherence Step 11 用語不統一・add 経路重複検査をスキップ
  --skip-ss-embed-gate   Step 11b SS embed gate (UI 変更 PR の SS 未 embed hard-fail、#2918) をスキップ
  --skip-capture         Step 12 capture (UI 変更時のみ) をスキップ
  --help, -h             このヘルプ

Steps (番号は表示上の識別子。実行順は下記「実行順」を参照 — #4048):
  1.  biome check                 — lint
  1b. cspell                      — spell check (CI lint-and-test と同一コマンド、#3649)
  2.  svelte-check                — TS strict 型チェック
  3.  vitest run                  — unit test (storybook 以外)
  4.  check-hardcoded-strings.mjs — JP ハードコード baseline 監視 (#1452)
  5.  measure-lp-dimensions.mjs   — LP 寸法 / 禁止語 (LP 変更時のみ)
  6.  sync-lp-fallback.mjs        — LP fallback テキスト同期検査 (LP / labels.ts 変更時のみ、#1945)
  7.  check-no-plan-literals.mjs  — プラン / ステータスリテラル直書き検査 (#972 / Phase 5 F1 / #1918)
  7c. check-cli-entry-guard.mjs  — 自前の CLI 直接実行判定 / 手組み file:// URL 禁止 (#3969)
  7d. check-workflow-sparse-checkout-closure.mjs — workflow sparse-checkout の import 閉包検査 (#3969)
  7e. check-readdir-rotation-guard.mjs — readdir の緩い一致で世代を数える class の検出 (#3978)
  8.  generate-lp-labels --check  — site/shared-labels.js 同期検査 (labels.ts / terms.ts / age-tier.ts 変更時のみ、Phase 1 B1 / #1917)
  9.  Readiness gate              — Ready checklist [x] 完了 / AC 4 列 / forbidden-terms / 必須セクション 13 個 / mergeable (check-pr-body.mjs、PR 番号必須、#2632)
  10. check-doc-code-references.mjs — ドキュメントのデッドリンク検知 (#2577)
  11. check-terminology-coherence.ts — 用語不統一・add 経路重複検知 (#2555)
  11b. check-pr-screenshot.mjs (SS embed gate) — UI 変更 PR の SS embed 未完了を hard-fail (#2918、CI screenshot-check と SSOT 共有)
  12. capture.mjs --pr            — UI 変更検知時のみ撮影 (現状は手動推奨。本 step は実行ガイダンスのみ)

実行順 (cheap-fail-first、#4048):
  Step 番号は PR body / docs / Issue から広く参照されるため変更しない。実行順だけを
  「判定に要する時間と参照する情報の量」で並べ替える。同一クラス内は上記の番号順を保つ。
    1) meta      PR body / メタ情報だけを見る    — Step 9
    2) static    静的テキスト / 単一ファイル検査 — Step 1 / 1b / 4 / 6 / 7 / 7b / 7c / 7d / 8 / 10 / 11
    3) typecheck 型検査                          — Step 2
    4) test      テスト実行                      — Step 3
    5) browser   ヘッドレスブラウザ実測          — Step 5
    6) ui        SS 系                           — Step 11b / 12
  検査の集合・合否条件は並べ替えの前後で同一 (tests/unit/scripts/pre-ready-order-and-base.test.ts が固定)。

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
 * 変更集合の算出に使う base ref を決定する純関数 (#4046、unit test 対象)。
 *
 * 旧実装は lane whitelist (main / develop) 外の base を無条件で `origin/main` に clamp していた。
 * stacked PR (別 PR の branch を base にする PR) はこれに該当し、**変更集合が PR の実差分と
 * 一致しなくなる**。変更集合は条件付き step (`lpChanged` / `lpFallbackTrigger` /
 * `lpLabelsTrigger` / `uiChanged`) の判定入力なので、over-inclusive な差分は
 * 「他 PR の `.svelte` 変更で `uiChanged` が YES になる」→ SS embed gate が
 * 「この PR は UI 変更 PR だ」という誤った前提で走る、という false-pass 経路を作る (#4046 §何が壊れるか 3)。
 *
 * 本関数は lane ではなく「shell 展開に安全な名前で、かつ remote ref が実在すること」だけを要求する
 * (#2982 の injection 防御目的はこれで満たされる)。実在しない ref を渡すと `git diff` が失敗して
 * 変更集合が空になり、全条件付き step が黙って NO 判定になるため、その場合のみ main に clamp する。
 *
 * @param {{ base: string; refExists: (base: string) => boolean }} input
 * @returns {{ base: string; clamped: boolean; reason: 'unsafe-name' | 'ref-missing' | null }}
 */
export function resolveDiffBase({ base, refExists }) {
	if (!isSafeGitRefName(base)) return { base: 'main', clamped: true, reason: 'unsafe-name' };
	if (!refExists(base)) return { base: 'main', clamped: true, reason: 'ref-missing' };
	return { base, clamped: false, reason: null };
}

/**
 * clamp 発生時の監査注記文言 (#4046 AC1 / AC2、unit test 対象)。
 *
 * #2929 が定めた「fail-open / 明示 skip した gate は summary で 1 行明示する」原則の適用漏れを塞ぐ。
 * WARN 1 行が長い出力の途中に流れるだけだと、clamp された事実が summary に残らず
 * 「ローカル ALL PASS = この PR の差分を検査済」と誤認される。
 *
 * @param {string} original 解決された (clamp 前の) base branch 名
 * @param {'unsafe-name' | 'ref-missing'} reason
 * @returns {string}
 */
export function buildBaseClampNote(original, reason) {
	const why =
		reason === 'ref-missing'
			? `origin/${original} がローカルに存在しない (git fetch origin ${original} で解消)`
			: `base 名 "${original}" が ref 名として安全でない`;
	return (
		`base-clamp: base を origin/main に clamp しました (理由: ${why}) — ` +
		'変更集合が PR の実差分と一致していません。条件付き step ' +
		'(lp-dimensions / lp-fallback / lp-labels / ss-embed-gate / capture) の判定は ' +
		'PR の実差分ではなく clamp 後の差分に基づきます (#4046)'
	);
}

/**
 * `origin/<base>` がローカルに実在するか。
 * @param {string} base `isSafeGitRefName` を通過済みの branch 名
 * @returns {boolean}
 */
function remoteRefExists(base) {
	const r = spawnSync('git', ['rev-parse', '--verify', '--quiet', `refs/remotes/origin/${base}`], {
		cwd: repoRoot,
		stdio: ['ignore', 'pipe', 'ignore'],
		shell: true,
	});
	return r.status === 0;
}

/**
 * `git diff origin/<base>...HEAD --name-only` で変更ファイル一覧を取得する。
 * base は scripts/lib/ci/resolve-base-branch.mjs (#2959 SSOT) で解決する
 * (develop 二層 cutover #2870 後、feature branch は develop 基点のため
 *  origin/main 固定だと sibling PR の develop commit を誤算入する)。
 * stacked PR の base (lane 外) もそのまま使う (#4046)。
 * @param {string} baseBranch 解決済み base branch 名 (通常は 'develop' | 'main'、stacked PR では任意の branch 名)
 * @returns {Promise<string[]>}
 */
async function getChangedFiles(baseBranch) {
	const decision = resolveDiffBase({ base: baseBranch, refExists: remoteRefExists });
	const base = decision.base;
	if (decision.clamped) {
		const note = buildBaseClampNote(baseBranch, decision.reason);
		console.warn(`[pre-ready] WARN: ${note}`);
		failOpenNotes.push(note);
	} else if (!isAllowedBaseBranch(base)) {
		// lane 外 base (= stacked PR)。誤 base への PR を静かに通さないよう事実だけ告知する
		// (変更集合自体は実差分と一致しているので clamp も fail-open 注記もしない)。
		console.log(
			`[pre-ready] stacked PR base を検出: origin/${base} (lane: main / develop 以外)。変更集合は本 base との差分で算出します (#4046)`,
		);
	}
	return new Promise((resolveP) => {
		const child = spawn('git', ['diff', `origin/${base}...HEAD`, '--name-only'], {
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

/**
 * 子プロセスを spawn し、追加 env を渡して exit code を返す (#2918 SS embed gate 用)。
 * stdout/stderr は親に inherit する。
 *
 * @param {string} cmd 表示用ラベル
 * @param {string[]} argv 実行コマンド (argv[0] が executable)
 * @param {Record<string, string>} extraEnv 追加環境変数
 * @returns {Promise<number>} exit code
 */
function runWithEnv(cmd, argv, extraEnv) {
	return new Promise((resolveP) => {
		console.log(`\n[pre-ready] ▶ ${cmd}`);
		const child = spawn(argv[0], argv.slice(1), {
			cwd: repoRoot,
			stdio: 'inherit',
			shell: true,
			env: { ...process.env, ...extraEnv },
		});
		child.on('exit', (code) => resolveP(code ?? 1));
		child.on('error', (err) => {
			console.error(`[pre-ready] ${cmd} error:`, err.message);
			resolveP(1);
		});
	});
}

/**
 * `gh pr view <num> --json body,labels` で PR body / ラベル一覧を取得する (#2918)。
 * gh 失敗時は null を返す (gate 側で skip + warning に倒す)。
 *
 * @param {string} prNumber
 * @returns {Promise<{ body: string; labels: string[] } | null>}
 */
function fetchPrBodyAndLabels(prNumber) {
	return new Promise((resolveP) => {
		const child = spawn('gh', ['pr', 'view', String(prNumber), '--json', 'body,labels'], {
			cwd: repoRoot,
			stdio: ['ignore', 'pipe', 'ignore'],
			shell: true,
		});
		let out = '';
		child.stdout.on('data', (d) => (out += d.toString()));
		child.on('exit', (code) => {
			if (code !== 0) return resolveP(null);
			try {
				const parsed = JSON.parse(out);
				resolveP({
					body: parsed.body || '',
					labels: (parsed.labels || []).map((l) => l.name).filter(Boolean),
				});
			} catch {
				resolveP(null);
			}
		});
		child.on('error', () => resolveP(null));
	});
}

// ---------------------------------------------------------------------------
// #3857: worktree 依存 preflight (silent false-negative 防止)
// ---------------------------------------------------------------------------

/**
 * 隔離 worktree (`.claude/worktrees/`) では worktree 生成後に `node_modules` が
 * 自動 install されない。依存欠落のまま pre-ready を回すと Step 2/3 (svelte-check /
 * vitest) が「変更と無関係な」大量 error / spawn 失敗になり、品質ゲートが空振りする
 * (#3855 / #3856 の 2 agent が共に遭遇)。これを silent に通さず、着手前に明示ガイダンス付きで
 * fail-fast する (ADR-0006 no-silent-fail 整合 / #3857 AC1「依存欠落を silent に pass しない」)。
 *
 * biome の「Checked 0 files」false-negative は本体側 (biome.json の `.claude` ignore を
 * repo 相対 `!.claude` に anchor 化) で根治済み (#3857 Fix B)。本 preflight は残る
 * node_modules 欠落 (Step 2/3 svelte-check/vitest、Step 11 tsx) を対象とする。
 *
 * 検出:
 *   - worktree 判定: `repoRoot/.git` が「ファイル」(linked worktree の gitdir ポインタ) なら worktree。
 *     通常 clone では `.git` はディレクトリなので false。
 *   - 依存欠落判定: pre-ready 各 step が依存する代表 sentinel の存在確認。root `node_modules` に加え、
 *     `infra/node_modules/aws-cdk-lib` も検査する — Step 3 vitest の scope (`tests/unit/**`) には
 *     `tests/unit/infra/*.test.ts` が含まれ aws-cdk-lib (infra 配下) を要求するため (tests/CLAUDE.md)。
 *     `npm ci` の prepare が `cd infra && npm ci` を warn-only で実行する構造上、root だけ入って
 *     infra が欠ける組合せがあり得るので両方を sentinel にする (#3857 で報告された aws-cdk-lib 欠落を捕捉)。
 *
 * pre-ready Step 1/2/3/11 が依存する代表 sentinel。1 つでも欠落したら install 未完了とみなす。
 * (export: tests/unit/scripts/pre-ready-preflight.test.ts が root 差替えで検証する)
 */
export const PREFLIGHT_SENTINELS = [
	'node_modules', // 本体
	'node_modules/.bin', // spawn する CLI 群 (svelte-check / vitest / tsx / biome)
	'node_modules/svelte-check', // Step 2
	'node_modules/vitest', // Step 3
	'node_modules/tsx', // Step 11 (npx tsx check-terminology-coherence.ts)
	'node_modules/@biomejs/biome', // Step 1
	'infra/node_modules/aws-cdk-lib', // Step 3 vitest (tests/unit/infra/*.test.ts、tests/CLAUDE.md)
];

/**
 * @param {string} [root] 検査対象ルート (既定: repoRoot、test では depsless な temp dir を渡す)
 * @returns {{ ok: boolean, isWorktree: boolean, missing: string[] }}
 */
export function preflightWorktreeDeps(root = repoRoot) {
	const gitPath = resolve(root, '.git');
	let isWorktree = false;
	try {
		isWorktree = existsSync(gitPath) && statSync(gitPath).isFile();
	} catch {
		// stat 失敗時は worktree 判定を false に倒す (guidance の文言差のみに影響)
	}
	const missing = PREFLIGHT_SENTINELS.filter((s) => !existsSync(resolve(root, s)));
	return { ok: missing.length === 0, isWorktree, missing };
}

// ---------------------------------------------------------------------------
// 実行順 SSOT (cheap-fail-first、#4048)
// ---------------------------------------------------------------------------

/**
 * 実行順のコストクラス。左が安く、早く落ちうる。
 *
 * 旧実装は step 定義配列の並び (= Step 番号順) をそのまま実行順にしていたため、
 * PR body の体裁ミス 1 つ (Step 9 = ファイルを 1 行も読まない、1 分未満で判定できる検査) を
 * 検出するのに vitest / svelte-check / cspell の完走を待つ必要があり、実測 23 分を捨てていた
 * (PR #4043、2026-07-28)。判定内容は正しく順序だけが損をしていたので、順序だけを入れ替える。
 */
export const STEP_COST_CLASSES = /** @type {const} */ ([
	'meta', // PR body / メタ情報だけを見る。ファイルを読まない
	'static', // 静的テキスト / 単一ファイル検査
	'typecheck', // 型検査
	'test', // テスト実行
	'browser', // ヘッドレスブラウザでの実測
	'ui', // SS 系 (撮影 / embed 検証)
]);

/**
 * step 名 → コストクラスの SSOT (#4048 AC2)。
 *
 * **新しい step を buildSteps に足したら、必ずここにも登録する。** 登録漏れは
 * `orderSteps` が throw して即座に落ちる (末尾に黙って足されて cheap-fail-first が
 * 崩れる劣化は、動いてしまうと誰も気づけないため fail closed にする / ADR-0061 same-class→guard)。
 *
 * @type {Record<string, typeof STEP_COST_CLASSES[number]>}
 */
export const STEP_COST_CLASS_BY_NAME = {
	// meta — PR body のテキストだけを見る。最も早く落ちうる
	'pr-body': 'meta',
	// static — 静的テキスト / 単一ファイル検査
	biome: 'static',
	cspell: 'static',
	'hardcoded-strings': 'static',
	'lp-fallback': 'static',
	'plan-literals': 'static',
	'license-key-leak': 'static',
	'cli-entry-guard': 'static',
	'sparse-checkout-closure': 'static',
	'readdir-rotation-guard': 'static',
	'lp-labels': 'static',
	'doc-code-references': 'static',
	'terminology-coherence': 'static',
	// typecheck / test
	'svelte-check': 'typecheck',
	vitest: 'test',
	// browser — LP を実ブラウザで描画して寸法を測る
	'lp-dimensions': 'browser',
	// ui — SS 撮影 / embed 検証
	'ss-embed-gate': 'ui',
	capture: 'ui',
};

/**
 * step 配列を cheap-fail-first に並べ替える (#4048 AC1)。
 *
 * - 検査の集合・合否条件は変えない。**順序だけ**を変える (AC2)
 * - 同一クラス内は定義順 (= Step 番号順) を保つ安定ソート
 * - `STEP_COST_CLASS_BY_NAME` に未登録の step があれば throw (登録漏れを silent に通さない)
 *
 * @template {{ name: string }} T
 * @param {T[]} steps
 * @returns {T[]}
 */
export function orderSteps(steps) {
	const unknown = steps.filter((s) => !(s.name in STEP_COST_CLASS_BY_NAME)).map((s) => s.name);
	if (unknown.length > 0) {
		throw new Error(
			`[pre-ready] step のコストクラス未登録: ${unknown.join(', ')} — ` +
				'scripts/pre-ready.mjs の STEP_COST_CLASS_BY_NAME に追加してください (#4048)',
		);
	}
	const rank = (/** @type {{ name: string }} */ s) =>
		STEP_COST_CLASSES.indexOf(STEP_COST_CLASS_BY_NAME[s.name]);
	// index を tiebreaker にして安定ソートを明示 (Array#sort の安定性に依存しない)
	return steps
		.map((step, index) => ({ step, index }))
		.sort((a, b) => rank(a.step) - rank(b.step) || a.index - b.index)
		.map(({ step }) => step);
}

// ---------------------------------------------------------------------------
// Step 定義
// ---------------------------------------------------------------------------

/**
 * 各 Step は { name, label, runner, fixHint, skip? } を返す。
 * runner は () => Promise<number> (exit code)。
 */
/**
 * step の skip 理由を分類する (#4018)。
 *
 * `--skip-*` flag による明示 skip と、変更内容に依存する自動 skip (LP を触っていないので
 * LP 検査は適用対象外、等) を同じ配列に混ぜると、**LP を触らない PR は原理的に ALL PASS を
 * 表示できなくなる**。summary 自身が「Ready 化には skip なしの全 step PASS が必要」と書くため、
 * 到達不能な条件を Ready 化要件として提示する状態になっていた (実測: PR #3996 / merge 済 #4011)。
 *
 * 分類:
 *   - `flag`           `--skip-*` を明示指定した。開発中の部分確認であり ALL PASS を名乗らない (#3649 の意図)
 *   - `script-missing` 検査 script 自体が未配備。gate が存在しないので ALL PASS を名乗らない
 *   - `pr-missing`     **前提 (`--pr <num>`) が未充足**で Readiness gate 系を実行できていない。
 *                      「内容的に適用対象外」ではなく「Ready 化に必須の gate を回していない」ので
 *                      **ALL PASS を名乗らない** (下記「n/a と pr-missing の線引き」参照)
 *   - `n/a`            変更内容が検査の適用対象外。**ALL PASS を妨げない**
 *
 * 優先順位は flag > script-missing > pr-missing > n/a。明示 skip したのに「適用対象外」と
 * 表示すると skip した事実が summary から消えるため。
 *
 * ### n/a と pr-missing の線引き (#4018 QM 指摘、本 script の中核)
 *
 * `!lpChanged` / `!uiChanged` 等の条件 skip は「LP を触っていないので LP 検査は不要」であり、
 * 実行者が何をしても満たせない到達不能条件ではない = ALL PASS を妨げてはならない (本 Issue の主目的)。
 *
 * 一方 `--pr` 未指定は「Ready 化に必須の前提を実行者が渡していない」だけであり、`--pr <num>` を
 * 渡せば必ず実行できる。ここを n/a にすると `npm run pre-ready` (`--pr` なし) が Readiness gate
 * (check-pr-body = Ready checklist / AC 4 列 / forbidden-terms / mergeable 判定) を一度も回さずに
 * 「ALL PASS — Ready for Review に進めます」と案内してしまい、**gate を素通りする新しい抜け穴**に
 * なる (ADR-0060「チケット close ≠ 完了」と同型の self-report 汚染)。よって別分類にして blocking 側に置く。
 *
 * @param {{ byFlag?: boolean; scriptMissing?: boolean; prMissing?: boolean; notApplicable?: boolean }} reasons
 * @returns {{ skip: boolean; skipKind: 'flag' | 'script-missing' | 'pr-missing' | 'n/a' | null }}
 */
export function skipStateOf({
	byFlag = false,
	scriptMissing = false,
	prMissing = false,
	notApplicable = false,
}) {
	if (byFlag) return { skip: true, skipKind: 'flag' };
	if (scriptMissing) return { skip: true, skipKind: 'script-missing' };
	if (prMissing) return { skip: true, skipKind: 'pr-missing' };
	if (notApplicable) return { skip: true, skipKind: 'n/a' };
	return { skip: false, skipKind: null };
}

/**
 * 最終 summary の文言と判定を組み立てる (#4018)。
 *
 * 判定は 2 値:
 *   - `ALL_PASS`     実行すべき step を全て実行して PASS した。適用対象外 (n/a) があっても妨げない
 *   - `PARTIAL_PASS` 明示 skip / 検査 script 未配備 / `--pr` 未指定で「実行すべきだったのに
 *                    実行していない」step がある
 *
 * console.log を持たない純関数にしてあるのは、AC1〜AC3 (適用対象外のみなら ALL PASS /
 * flag 指定なら PARTIAL PASS / 両者を別行表示) を全 step を回さずに unit test で固定するため。
 *
 * #4007: `delegated` は「未実行」ではなく「判定の場所を CI に移した」step。ALL PASS を妨げないが、
 * 委譲先 job が **実行されて pass した** ことの確認手順を必ず出す (`ci-gate` は skipped を failure
 * として数えないため ci-gate green は委譲先が走った証拠にならない = 沈黙 skip を作らない)。
 *
 * @param {{ totalSteps: number; skippedByFlag: string[]; skippedScriptMissing: string[];
 *           skippedPrMissing?: string[]; skippedNotApplicable: string[];
 *           delegated?: { name: string; job: string; howToVerify: string }[];
 *           failOpenCount?: number; pr?: string | null }} input
 * @returns {{ status: 'ALL_PASS' | 'PARTIAL_PASS'; text: string }}
 */
export function buildSummary({
	totalSteps,
	skippedByFlag,
	skippedScriptMissing,
	skippedPrMissing = [],
	skippedNotApplicable,
	delegated = [],
	failOpenCount = 0,
	pr = null,
}) {
	// #4007: CI へ委譲した step の確認手順ブロック (委譲が無ければ空文字)
	const delegationBlock =
		delegated.length > 0
			? `  CI へ委譲した step (${delegated.map((d) => d.name).join(', ')}):\n` +
				delegated
					.map(
						(d) =>
							`    - ${d.name} → CI job \`${d.job}\`。Ready 化前に **実行されて pass した** ことを確認する:\n` +
							`        ${d.howToVerify}\n` +
							`      \`${d.job}\` が skipped の PR は Ready にしない (skipped は pass ではない)。\n` +
							`      \`ci-gate\` は skipped を failure として数えないため、ci-gate green を根拠にしない。\n`,
					)
					.join('')
			: '';
	// 適用対象外 (n/a) は「実行しなくてよいので実行していない」であり ALL PASS を妨げない。
	const notApplicableLine =
		skippedNotApplicable.length > 0
			? `  適用対象外 ${skippedNotApplicable.length} step (${skippedNotApplicable.join(', ')}) — 変更内容が検査対象を含まないため未実行 (#4018)\n`
			: '';

	// #3649: --skip-* で step を飛ばした実行は「ALL PASS」を名乗らない。skip flag は開発中の
	// 部分確認用であり、Ready 化判定 (=「pre-ready ALL PASS」という self-report) には skip なし
	// 実行が必要。検査 script 未配備も「gate が存在しない」ので同様に ALL PASS を名乗らせない。
	const blocking = [...skippedByFlag, ...skippedScriptMissing, ...skippedPrMissing];
	if (blocking.length > 0) {
		const detail = [
			skippedByFlag.length > 0
				? `--skip 指定 ${skippedByFlag.length} step (${skippedByFlag.join(', ')})`
				: null,
			skippedScriptMissing.length > 0
				? `検査 script 未配備 ${skippedScriptMissing.length} step (${skippedScriptMissing.join(', ')})`
				: null,
			skippedPrMissing.length > 0
				? `--pr 未指定で Readiness gate ${skippedPrMissing.length} step (${skippedPrMissing.join(', ')})`
				: null,
		]
			.filter(Boolean)
			.join(' / ');
		const ran = totalSteps - blocking.length - skippedNotApplicable.length - delegated.length;
		return {
			status: 'PARTIAL_PASS',
			text:
				`\n[pre-ready] PARTIAL PASS — 実行した ${ran} step は PASS しましたが、` +
				`${detail} が未実行です。\n` +
				notApplicableLine +
				`  これは開発中の部分確認結果であり、Ready 化 (gh pr ready) 判定には\n` +
				`  skip なしの \`npm run pre-ready -- --pr ${pr ?? '<num>'}\` 全 step PASS が必要です。\n` +
				delegationBlock,
		};
	}

	return {
		status: 'ALL_PASS',
		text:
			`\n[pre-ready] ALL PASS${delegated.length > 0 ? ` (${delegated.length} step は CI へ委譲 — 下記を確認)` : ''}${failOpenCount > 0 ? ` (fail-open ${failOpenCount} 件あり — 上記 ⚠ を確認)` : ''} — Ready for Review に進めます。\n` +
			notApplicableLine +
			delegationBlock +
			`  次の手順:\n` +
			`    1. node scripts/check-gh-account-before-pr.mjs   # gh アカウント確認 (#1728)\n` +
			(delegated.length > 0
				? `    2. gh pr checks ${pr ?? '<num>'}                           # 委譲先 job が pass (skipped でない) ことを確認\n` +
					`    3. gh pr ready ${pr ?? '<num>'}                            # Ready for Review に変更\n` +
					`    4. CI 全緑になるまで待機し、QM レビューを依頼\n`
				: `    2. gh pr ready ${pr ?? '<num>'}                            # Ready for Review に変更\n` +
					`    3. CI 全緑になるまで待機し、QM レビューを依頼\n`),
	};
}

/**
 * step 定義を組み立てる。unit test から skip 分類 (`skipKind`) を配線ごと検証するため export する
 * (#4018 QM 指摘: `skipStateOf` 単体では「step 定義側が正しい引数を渡しているか」を固定できない)。
 * unit test は同時に「全 step にコストクラスが登録済」も本 export 経由で検証する (#4048)。
 *
 * **配列の並びは Step 番号順**であり実行順ではない。実行順は `orderSteps` が決める (#4048)。
 *
 * @param {Record<string, unknown>} args      parseArgs() の戻り値相当
 * @param {string[]} changedFiles             base branch との差分ファイル一覧
 */
export function buildSteps(args, changedFiles) {
	const lpChanged = changedFiles.some((f) => f.startsWith('site/'));
	const labelsChanged = changedFiles.some(
		(f) => f === 'src/lib/domain/labels.ts' || f === 'src/lib/domain/terms.ts',
	);
	const ageTierChanged = changedFiles.some((f) => f === 'src/lib/domain/validation/age-tier.ts');
	// LP fallback 同期は LP / labels.ts どちらかが変わると影響を受ける
	const lpFallbackTrigger = lpChanged || labelsChanged;
	// LP labels (site/shared-labels.js) 同期は labels.ts / terms.ts / age-tier.ts いずれかが変わると影響を受ける
	const lpLabelsTrigger = labelsChanged || ageTierChanged;
	const uiChanged = changedFiles.some(
		(f) => /\.(svelte|css|scss)$/.test(f) || f.startsWith('site/'),
	);

	// #2929 項目 3: UI 変更があるのに --skip-ss-embed-gate で明示 skip した場合は監査注記を残す
	// (UI 変更なし / --pr 未指定による自動 skip は通常動作なので注記しない)
	if (args.skipSsEmbedGate && uiChanged && args.pr) {
		failOpenNotes.push(
			'ss-embed-gate: --skip-ss-embed-gate 指定により UI 変更 PR の SS embed 検証を skip — CI screenshot-quality-check が authoritative (#2929)',
		);
	}

	// graceful degradation: 未実装 / 移動済の検査 script は skip + warning に倒す (Issue #1920 設計判断)
	const planLiteralsScript = resolve(repoRoot, 'scripts/check-no-plan-literals.mjs');
	const lpLabelsScript = resolve(repoRoot, 'scripts/generate-lp-labels.mjs');
	const planLiteralsScriptExists = existsSync(planLiteralsScript);
	const lpLabelsScriptExists = existsSync(lpLabelsScript);
	// #2836 (Epic #2525 Phase 7 PR-L4): license key 全廃の再導入防止 gate
	const licenseKeyLeakScript = resolve(repoRoot, 'scripts/check-license-key-leak.mjs');
	const licenseKeyLeakScriptExists = existsSync(licenseKeyLeakScript);
	// #3969: 自前の CLI 直接実行判定 / 手組み file:// URL の再混入を止める gate
	const cliEntryGuardScript = resolve(repoRoot, 'scripts/check-cli-entry-guard.mjs');
	const cliEntryGuardScriptExists = existsSync(cliEntryGuardScript);
	// #3969: workflow の sparse-checkout が「実行する script の import 先」まで列挙しているかの検査
	const sparseClosureScript = resolve(
		repoRoot,
		'scripts/check-workflow-sparse-checkout-closure.mjs',
	);
	const sparseClosureScriptExists = existsSync(sparseClosureScript);
	// #3978: readdir の緩い一致で世代を数え、その結果を破壊的操作の対象にする class の検出
	const readdirRotationScript = resolve(repoRoot, 'scripts/check-readdir-rotation-guard.mjs');
	const readdirRotationScriptExists = existsSync(readdirRotationScript);

	return [
		{
			name: 'biome',
			label: 'Step 1/12: biome check (--error-on-warnings, CI と整合 — PR #2503 教訓)',
			...skipStateOf({ byFlag: args.skipBiome }),
			// #2503 (Issue #2475 14 件目): pre-ready Step 1 は CI .github/workflows/ci.yml
			// lint-and-test の `npx biome check --error-on-warnings .` と完全一致させる。
			// 旧来は `--error-on-warnings` 欠落で local PASS / CI FAIL 乖離が発生していた。
			runner: () => run('biome check', ['npx', 'biome', 'check', '--error-on-warnings', '.']),
			fixHint:
				'  npx biome check --error-on-warnings --write .   # 自動修正可能なものを修正\n' +
				'  remaining warning / error は手動で修正してから再実行 (CI は warning=error 扱い)',
		},
		{
			name: 'cspell',
			label: 'Step 1b/12: cspell (CI lint-and-test と同一コマンド — #3649)',
			...skipStateOf({ byFlag: args.skipCspell }),
			// #3649: CI lint-and-test の `npm run cspell` (#1432 warning=error) と同一。
			// pre-ready に本 step が無かった gap により「pre-ready ALL PASS ↔ CI cspell red」の
			// self-report 乖離が反復 (PR #3647 の Millis 等)。glob は package.json "cspell" が SSOT。
			runner: () => run('cspell', ['npm', 'run', 'cspell']),
			fixHint:
				'  typo なら修正 / 正当な技術語・固有名詞なら .cspell.json の words に追加 (小文字で登録、大文字小文字非依存)',
		},
		{
			name: 'svelte-check',
			label: 'Step 2/12: svelte-check (TS strict)',
			...skipStateOf({ byFlag: args.skipSvelteCheck }),
			runner: () => run('svelte-check', ['npx', 'svelte-check', '--tsconfig', './tsconfig.json']),
			fixHint: '  型エラー箇所を修正。`as any` / `// @ts-expect-error` の追加は禁止 (ADR-0006)。',
		},
		{
			name: 'vitest',
			label: args.skipVitest
				? 'Step 3/12: vitest run (unit test) — ローカル未実行 / CI unit-test へ委譲 (#4007)'
				: 'Step 3/12: vitest run (unit test)',
			// #4018 の skip 分類 (flag / script-missing / pr-missing / n/a) は維持する。
			// 本 step は `delegatedToCi` を持つため、main() のループが分類より先に委譲へ振り分ける。
			...skipStateOf({ byFlag: args.skipVitest }),
			// #4007: `--skip-vitest` は「検証しない」ではなく「判定の場所を CI に移す」。
			// 16 コアを 4 エージェントで共有する運用ではローカルのフルスイートが並走で落ち、
			// その red は PR の欠陥ではなく実行環境の産物になる (同一 HEAD 対照実測: ローカル 1753s /
			// 2 件 timeout ↔ 同 SHA の CI run は 2 shard とも pass)。
			// ただし委譲先が **実行された** ことの確認は省略できない (skip された job は pass ではない)。
			delegatedToCi: {
				job: 'unit-test',
				howToVerify: 'gh pr checks <num> --watch  # unit-test (1) / (2) が pass であること',
			},
			runner: () => run('vitest', ['npx', 'vitest', 'run']),
			fixHint:
				'  失敗テストを修正。assertion を弱める変更は禁止 (ADR-0006)。\n' +
				'  storybook テストは `npm run test:storybook` で別途確認。',
		},
		{
			name: 'hardcoded-strings',
			label: 'Step 4/12: check-hardcoded-strings.mjs (#1452 Phase A)',
			...skipStateOf({ byFlag: args.skipHardcoded }),
			runner: () => run('check-hardcoded-strings', ['node', 'scripts/check-hardcoded-strings.mjs']),
			fixHint:
				'  baseline (1607 件) より JP ハードコードが増えています。\n' +
				'  src/lib/domain/labels.ts に定数追加して `data-label` / import 経由に置換 (ADR-0009)。',
		},
		{
			name: 'lp-dimensions',
			label: `Step 5/12: measure-lp-dimensions.mjs (LP 変更検知: ${lpChanged ? 'YES' : 'NO — skip'})`,
			...skipStateOf({ byFlag: args.skipLpDimensions, notApplicable: !lpChanged }),
			runner: () => run('measure-lp-dimensions', ['node', 'scripts/measure-lp-dimensions.mjs']),
			fixHint:
				'  LP 寸法 / 禁止語の閾値違反 (#1163 ratchet)。\n' +
				'  - mobileHeight ≤ 15000px / desktopHeight ≤ 8000px\n' +
				'  - 禁止語 (ガチャ / 抽選 / コンプリート / git clone 等) を含めない\n' +
				'  - CTA は 3 種以下',
		},
		{
			name: 'lp-fallback',
			label: `Step 6/12: sync-lp-fallback.mjs --check (LP / labels.ts 変更検知: ${lpFallbackTrigger ? 'YES' : 'NO — skip'})`,
			...skipStateOf({ byFlag: args.skipLpFallback, notApplicable: !lpFallbackTrigger }),
			runner: () => run('sync-lp-fallback', ['node', 'scripts/sync-lp-fallback.mjs', '--check']),
			fixHint:
				'  site/*.html の data-lp-key fallback テキストが labels.ts と乖離しています (#1945)。\n' +
				'  修正: `node scripts/sync-lp-fallback.mjs` を実行して fallback を再生成し、\n' +
				'        生成された site/*.html の差分をコミットしてください。',
		},
		// Step 7: check-no-plan-literals (#972 / Phase 5 F1 / #1918)
		// Issue #1920 graceful degradation: 検査 script が未配備 (F1 #1918 未 merge 等) なら skip + warning。
		// scripts/check-no-plan-literals.mjs 自体は #972 で main 取込済 (本 step は無条件で実行する)
		{
			name: 'plan-literals',
			label: planLiteralsScriptExists
				? 'Step 7/12: check-no-plan-literals.mjs (#972 / Phase 5 F1)'
				: 'Step 7/12: check-no-plan-literals.mjs (script 未配備 — skip)',
			...skipStateOf({ byFlag: args.skipPlanLiterals, scriptMissing: !planLiteralsScriptExists }),
			runner: () => run('check-no-plan-literals', ['node', 'scripts/check-no-plan-literals.mjs']),
			fixHint:
				'  プラン / ステータスのリテラル直書きが検出されました (#972)。\n' +
				'  - 修正: $lib/domain/constants/subscription-plan.ts 等の定数経由に置換\n' +
				"  - 例: 'family-monthly' → SUBSCRIPTION_PLAN.FAMILY_MONTHLY\n" +
				"  - 例: 'grace_period' → SUBSCRIPTION_STATUS.GRACE_PERIOD",
		},
		// Step 7b: check-license-key-leak (#2836 / Epic #2525 Phase 7 PR-L4)
		// license key 全廃の再導入防止。allowlist 外のコード行に license key 参照を検出したら fail。
		{
			name: 'license-key-leak',
			label: licenseKeyLeakScriptExists
				? 'Step 7b/12: check-license-key-leak.mjs (#2836 / Phase 7 PR-L4)'
				: 'Step 7b/12: check-license-key-leak.mjs (script 未配備 — skip)',
			...skipStateOf({
				byFlag: args.skipLicenseKeyLeak,
				scriptMissing: !licenseKeyLeakScriptExists,
			}),
			runner: () => run('check-license-key-leak', ['node', 'scripts/check-license-key-leak.mjs']),
			fixHint:
				'  allowlist 外のコード行に license key 参照を検出しました (#2836)。\n' +
				'  - LP / メール / ラベル / UI で license key 概念を再導入しないでください。\n' +
				'  - entitlement は Stripe Subscription (tenant.status=ACTIVE) が唯一 SSOT です。\n' +
				'  - DB 層 / LEGACY_URL_MAP entry は PR-L5 担当の allowlist (FILE_ALLOWLIST)。',
		},
		// Step 7c: check-cli-entry-guard (#3969)
		// 各 script が自前で書く「直接実行判定」は symlink / junction 経由で必ず false になり、
		// main() が呼ばれず「何も検査せず exit 0 (= PASS)」になる。判定 SSOT は
		// scripts/lib/is-main.mjs で、本 step は次の方言が持ち込まれるのを止める。
		{
			name: 'cli-entry-guard',
			label: cliEntryGuardScriptExists
				? 'Step 7c/12: check-cli-entry-guard.mjs (#3969)'
				: 'Step 7c/12: check-cli-entry-guard.mjs (script 未配備 — skip)',
			...skipStateOf({ byFlag: args.skipCliEntryGuard, scriptMissing: !cliEntryGuardScriptExists }),
			runner: () => run('check-cli-entry-guard', ['node', 'scripts/check-cli-entry-guard.mjs']),
			fixHint:
				'  自前の CLI 直接実行判定 / 手組み file:// URL を検出しました (#3969)。\n' +
				"  - 修正: import { isMain } from '<rel>/lib/is-main.mjs' を使い、\n" +
				'          `if (isMain(import.meta.url)) main();` の形にする\n' +
				'  - path → URL は node:url の pathToFileURL() を使う (手組みは Windows で常に不一致)\n' +
				'  - 正当な例外は `allow-argv1: <理由>` / `allow-file-url: <理由>` を当該行か直前行に置く',
		},
		// Step 7d: check-workflow-sparse-checkout-closure (#3969)
		// gate job は sparse-checkout で必要ファイルを個別列挙する。Step 7c が判定 SSOT の利用を
		// 強制するため、gate script を列挙するたびに helper への import が生え、列挙し忘れると
		// job が ERR_MODULE_NOT_FOUND で落ちる (#3969 対応時に必須 gate 6 job が同時 fail した)。
		{
			name: 'sparse-checkout-closure',
			label: sparseClosureScriptExists
				? 'Step 7d/12: check-workflow-sparse-checkout-closure.mjs (#3969)'
				: 'Step 7d/12: check-workflow-sparse-checkout-closure.mjs (script 未配備 — skip)',
			...skipStateOf({
				byFlag: args.skipSparseCheckoutClosure,
				scriptMissing: !sparseClosureScriptExists,
			}),
			runner: () =>
				run('check-workflow-sparse-checkout-closure', [
					'node',
					'scripts/check-workflow-sparse-checkout-closure.mjs',
				]),
			fixHint:
				'  workflow の sparse-checkout に import 先の列挙漏れがあります (#3969)。\n' +
				'  - 修正: 出力された不足パスを当該 sparse-checkout ブロックに追加する\n' +
				'  - 放置すると当該 job が ERR_MODULE_NOT_FOUND で落ちる (無言 PASS ではなく hard fail)',
		},
		// Step 7e: check-readdir-rotation-guard (#3978)
		// readdir の戻りを prefix / suffix の緩い一致で絞り込み、その結果を削除対象にする class。
		// 同じ指摘を #3956 / #3978 と 2 度受けたため、3 度目を待たず機械 gate 化した
		// (docs/sessions/dev-session.md §「QA 指摘の再発防止台帳」#2 / ADR-0061)。
		{
			name: 'readdir-rotation-guard',
			label: readdirRotationScriptExists
				? 'Step 7e/12: check-readdir-rotation-guard.mjs (#3978)'
				: 'Step 7e/12: check-readdir-rotation-guard.mjs (script 未配備 — skip)',
			...skipStateOf({
				byFlag: args.skipReaddirRotationGuard,
				scriptMissing: !readdirRotationScriptExists,
			}),
			runner: () =>
				run('check-readdir-rotation-guard', ['node', 'scripts/check-readdir-rotation-guard.mjs']),
			fixHint:
				'  readdir の緩い一致 (startsWith / endsWith) の結果を破壊的操作の対象にしています (#3978)。\n' +
				'  - 修正: 命名規則を `*_PATTERN` 名の正規表現 const にし、その完全一致で絞り込む\n' +
				'  - 生成側にも同じパターンの assert を置く (命名変更で silent に壊れないようにする)\n' +
				'  - 別 class だと判断した場合のみ `rotation-gate-ok: <理由>` を当該行/直前行に置く',
		},
		// Step 8: generate-lp-labels --check (Phase 1 B1 / #1917)
		// Issue #1920 graceful degradation: 検査 script が未配備なら skip + warning。
		// labels.ts / terms.ts / age-tier.ts いずれかの変更検知時のみ実行 (LP shared-labels.js への波及)
		{
			name: 'lp-labels',
			label: !lpLabelsScriptExists
				? 'Step 8/12: generate-lp-labels --check (script 未配備 — skip)'
				: `Step 8/12: generate-lp-labels --check (labels.ts / terms.ts / age-tier.ts 変更検知: ${lpLabelsTrigger ? 'YES' : 'NO — skip'})`,
			...skipStateOf({
				byFlag: args.skipLpLabels,
				scriptMissing: !lpLabelsScriptExists,
				notApplicable: !lpLabelsTrigger,
			}),
			runner: () =>
				run('generate-lp-labels --check', ['node', 'scripts/generate-lp-labels.mjs', '--check']),
			fixHint:
				'  site/shared-labels.js が labels.ts / terms.ts / age-tier.ts と同期していません (Phase 1 B1 / #1917)。\n' +
				'  修正: `node scripts/generate-lp-labels.mjs` を実行して再生成し、\n' +
				'        site/shared-labels.js の差分をコミットしてください。',
		},
		{
			name: 'pr-body',
			// #2632: Step 9 ラベルに「Ready checklist + AC 4 列 + forbidden-terms」を明示。
			// 本日 (2026-05-29) 7 連続再発 (#2625 / #2626 / #2629 / #2630) で「Step 9 が何を見ているか」が
			// 実装者に伝わっていない問題が露出した。check-pr-body.mjs は既に Ready checklist `[ ]` / AC 4 列 /
			// forbidden-terms / 必須セクション / BOM / mojibake / CONFLICTING を一括検出するが、ラベル
			// が `check-pr-body.mjs` だけだと「PR body 表面チェック」と誤認され skip されやすい。
			// ADR-0056 §E (#2632 で新設) 整合の構造的予防。
			label: args.pr
				? `Step 9/12: Readiness gate (Ready checklist + AC 4 列 + forbidden-terms + 必須セクション、check-pr-body.mjs --pr ${args.pr})`
				: 'Step 9/12: Readiness gate (--pr 未指定 — skip、Ready 化前は --pr 必須)',
			...skipStateOf({ byFlag: args.skipPrBody, prMissing: !args.pr }),
			runner: () => run('check-pr-body', ['node', 'scripts/check-pr-body.mjs', '--pr', args.pr]),
			fixHint:
				'  Readiness gate FAIL — Ready 化前必須 (本日 7 連続再発 #2625 / #2626 / #2629 / #2630、#2632 で gate 強化)\n' +
				'  検出対象:\n' +
				'    1. Ready for Review チェックリスト未チェック残置 (`- [ ]` 1 件で BLOCK)\n' +
				'    2. AC 検証マップ 4 列形式違反 (2 列簡略 / 空セル / 列数 < 4)\n' +
				'    3. PR body 禁止語混入 (予定 / follow-up / TODO / PENDING / DEFERRED / 別途 / 個別起票)\n' +
				'    4. 必須セクション 13 個の見出し欠落\n' +
				'    5. BOM / `??` mojibake (heredoc cp932 由来、#2562 / #2576)\n' +
				'    6. PR mergeable: CONFLICTING (rebase 必要)\n' +
				'    7. hotfix label PR の ADR-0006 env 配布証跡欄欠落 (#2343)\n' +
				'  対応:\n' +
				'    - PR body L<N> Ready checklist を全 [x] 化 (「QA 承認・動作確認が完了している」も Dev 自身で [x])\n' +
				'    - AC マップを 4 列形式 (`| AC 番号 | AC 内容 | 検証手段 | 結果 / エビデンス |`) に置換\n' +
				'    - 禁止語は PR で完遂 or Issue 起票して PR から完全除去 (partial PR 禁止)\n' +
				'    - 詳細は scripts/check-pr-body.mjs --help を参照。',
		},
		{
			name: 'doc-code-references',
			label: 'Step 10/12: check-doc-code-references.mjs (#2577)',
			...skipStateOf({ byFlag: args.skipDocCodeReferences }),
			runner: () =>
				run('check-doc-code-references', ['node', 'scripts/check-doc-code-references.mjs']),
			fixHint:
				'  ドキュメント内の実装コードパスが実在しません (デッドリンク)。\n' +
				'  修正: bare path 表記を Markdown link 形式 `[site/pricing.html L297-301](path/to/file)` に変更するか、\n' +
				'        意図的な追加なら `node scripts/check-doc-code-references.mjs --update-baseline` を実行してください。',
		},
		{
			name: 'terminology-coherence',
			label: 'Step 11/12: check-terminology-coherence.ts (#2555)',
			...skipStateOf({ byFlag: args.skipTerminologyCoherence }),
			runner: () =>
				run('check-terminology-coherence', [
					'npx',
					'tsx',
					'scripts/check-terminology-coherence.ts',
				]),
			fixHint:
				'  用語の不統一、または add 経路の重複を検知しました。\n' +
				'  修正: labels.ts の当該箇所を SSOT 用語 (terms.ts) に合わせるか、add 経路を集約してください。',
		},
		// Step 11b: SS embed gate (#2918)
		// UI 変更 PR が「SS は後で push する」未来形のまま / embed 画像なしで Ready 化され、
		// CI screenshot-check fail → Fix Agent 往復 が 4 件連続 (#2913 / #2914 / #2915 / #2909) した
		// 構造への対策。CI screenshot-check と同一 SSOT 関数 (checkScreenshotEmbedReadiness) を
		// SCREENSHOT_EMBED_GATE=1 env で error モード起動し、Ready 化前に hard-fail する。
		// UI 変更がない / --pr 未指定 / exempt label 時は gate 内部で skip。
		{
			name: 'ss-embed-gate',
			label:
				uiChanged && args.pr
					? 'Step 11b/12: SS embed gate (check-pr-screenshot.mjs、UI 変更 PR の SS embed 未完了を hard-fail、#2918)'
					: `Step 11b/12: SS embed gate (${!args.pr ? '--pr 未指定 — skip' : 'UI 変更なし — skip'}、#2918)`,
			...skipStateOf({
				byFlag: args.skipSsEmbedGate,
				prMissing: !args.pr,
				notApplicable: !uiChanged,
			}),
			runner: async () => {
				const pr = await fetchPrBodyAndLabels(args.pr);
				if (!pr) {
					console.log(
						'[pre-ready] WARN: gh pr view で PR body / labels 取得失敗 — SS embed gate を fail-open (PASS 扱い) で素通りします (#2918)。' +
							'最終判定は CI screenshot-quality-check (authoritative) を確認してください。',
					);
					failOpenNotes.push(
						'ss-embed-gate: gh pr view 失敗により fail-open (SS embed 未検証のまま PASS 扱い) — CI screenshot-quality-check が authoritative (#2929)',
					);
					return 0;
				}
				const tmpFiles = changedFiles.join('\n');
				return runWithEnv(
					'check-pr-screenshot (SS embed gate)',
					['node', 'scripts/check-pr-screenshot.mjs'],
					{
						SCREENSHOT_EMBED_GATE: '1',
						PR_BODY: pr.body,
						PR_FILES: tmpFiles,
						PR_LABELS: pr.labels.join(','),
					},
				);
			},
			fixHint:
				'  UI 変更 PR ですが SS embed が未完了です (#2918、#2913 / #2914 / #2915 / #2909 の再発防止)。\n' +
				'  Ready 化前に以下を完了してください:\n' +
				'    1. node scripts/capture.mjs --pr <N> で撮影 → screenshots branch push\n' +
				'    2. raw.githubusercontent.com/.../screenshots/pr-<N>/ 形式の embed 画像を PR body に貼付\n' +
				'    3. 「後で push する」「添付予定」等の未来形記述を完了形 (実 embed) に置換\n' +
				'  UI 変更を含まない PR の場合は PR body に「該当なし（refactor / docs / chore）」と明記、\n' +
				'  または視覚差分ゼロの内部 refactor なら refactor:internal-no-doc-impact ラベルを付与。',
		},
		{
			name: 'capture',
			label: `Step 12/12: capture.mjs (UI 変更検知: ${uiChanged ? 'YES' : 'NO — skip'})`,
			...skipStateOf({ byFlag: args.skipCapture, prMissing: !args.pr, notApplicable: !uiChanged }),
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
	console.log(`[pre-ready] PR 番号: ${args.pr ?? '(未指定 — Step 9, 12 はスキップ)'}`);

	// #3857: 依存 preflight — 欠落のまま Step 2/3 を回すと変更無関係の false-negative になるため fail-fast
	const pf = preflightWorktreeDeps();
	if (!pf.ok) {
		console.error(
			`\n[pre-ready] ✗ preflight FAIL — 依存が未 install です (欠落 sentinel: ${pf.missing.join(', ')})`,
		);
		if (pf.isWorktree) {
			console.error(
				'  隔離 worktree (.claude/worktrees/) では worktree 生成後に node_modules が自動 install されません (#3857)。',
			);
		}
		console.error('  以下を実行してから pre-ready を再実行してください:');
		console.error('    npm ci');
		console.error(
			'    cd infra && npm ci   # CDK 単体テスト (cd infra && npx vitest) を回す場合のみ',
		);
		console.error(
			'  (依存欠落のまま Step 2/3 svelte-check / vitest を実行すると変更と無関係な大量 error / spawn 失敗になり、\n' +
				'   「pre-ready を回した」証跡が空振りします。ADR-0006 no-silent-fail 整合で着手前に fail-fast します。#3857)',
		);
		return 1;
	}

	// base branch 解決 (#2959 / develop 二層 cutover #2870)
	let baseBranch = 'main';
	try {
		baseBranch = resolveBaseBranchAuto({ cwd: repoRoot });
	} catch {
		// git 情報取得不能時は main fallback (従来挙動と同一)
	}
	console.log(`[pre-ready] base branch: origin/${baseBranch} (#2959 SSOT 解決)`);

	// 変更ファイル取得 (LP / UI 変更検知用)
	const changedFiles = await getChangedFiles(baseBranch);
	if (changedFiles.length === 0) {
		console.log(
			`[pre-ready] WARN: origin/${baseBranch} からの変更ファイルが取得できませんでした (origin 未 fetch / ブランチ不一致の可能性)`,
		);
	} else {
		console.log(`[pre-ready] 変更ファイル数: ${changedFiles.length}`);
	}

	// #4048: 定義順 (Step 番号順) ではなく cheap-fail-first で実行する。
	const steps = orderSteps(buildSteps(args, changedFiles));
	console.log(
		`[pre-ready] 実行順 (cheap-fail-first、#4048): ${steps.map((s) => s.name).join(' → ')}`,
	);
	const failed = [];
	/** `--skip-*` を明示指定した step (#3649: ALL PASS を名乗らない) */
	const skippedByFlag = [];
	/** 検査 script 自体が未配備の step (gate 不在なので ALL PASS を名乗らない) */
	const skippedScriptMissing = [];
	/** `--pr` 未指定で Readiness gate を回せていない step (#4018 QM 指摘: ALL PASS を名乗らない) */
	const skippedPrMissing = [];
	/** 変更内容が適用対象外の step (#4018: ALL PASS を妨げない) */
	const skippedNotApplicable = [];
	/** #4007: skip ではなく「CI の特定 job へ委譲」した step */
	const delegated = [];

	for (const step of steps) {
		if (step.skip) {
			if (step.delegatedToCi) {
				console.log(`[pre-ready] → ${step.label}`);
				delegated.push({ name: step.name, ...step.delegatedToCi });
				continue;
			}
			console.log(`[pre-ready] ⊘ ${step.label}`);
			if (step.skipKind === 'flag') skippedByFlag.push(step.name);
			else if (step.skipKind === 'script-missing') skippedScriptMissing.push(step.name);
			else if (step.skipKind === 'pr-missing') skippedPrMissing.push(step.name);
			else skippedNotApplicable.push(step.name);
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

	// #2929 項目 3: fail-open / 明示 skip した gate を summary で可視化 (silent pass の誤認防止)
	for (const note of failOpenNotes) {
		console.log(`\n[pre-ready] ⚠ fail-open: ${note}`);
	}

	const summary = buildSummary({
		totalSteps: steps.length,
		skippedByFlag,
		skippedScriptMissing,
		skippedPrMissing,
		skippedNotApplicable,
		delegated,
		failOpenCount: failOpenNotes.length,
		pr: args.pr,
	});
	console.log(summary.text);
	return 0;
}

// import 時 (unit test) は main() を走らせない。CLI 直接起動時のみ実行する
// (パターンは scripts/check-pr-body.mjs と同一)。
const isMain = isMainModule(import.meta.url);

if (isMain) {
	main()
		.then((code) => process.exit(code))
		.catch((err) => {
			console.error('[pre-ready] internal error:', err);
			process.exit(2);
		});
}
