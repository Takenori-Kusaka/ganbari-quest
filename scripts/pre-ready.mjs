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
 * #4121 (E5 Wave 2): step が 20 本まで増えて 1 PR が 1 日で回らなくなったため、
 * **hard-fail は 6 本**に絞った。選定は ADR-0007 §1-2「判断原則 v2」に従い、
 * 類型 1 (証跡の真正性 / 不可逆な損失) と 類型 2 (顧客に見える正しさ) のうち安価なものだけを残す。
 * **外した検査は消していない** — CI (ci.yml lint-and-test / unit-test、lp-metrics.yml、
 * lp-fallback-check.yml) で hard-fail のまま走る。対応表は `--help` を参照。
 *
 * 6 step を順次実行し、各 fail で即 exit 1 + 修正方針を表示する。
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
 *   npm run pre-ready -- --pr 1920 --skip-svelte-check     # 部分確認 (ALL PASS は名乗らない)
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
	'--skip-svelte-check': 'skipSvelteCheck',
	'--skip-plan-literals': 'skipPlanLiterals',
	'--skip-local-tz-getters': 'skipLocalTzGetters',
	'--skip-pr-body': 'skipPrBody',
	'--skip-ss-embed-gate': 'skipSsEmbedGate',
};

function parseArgs(argv) {
	const args = {
		pr: null,
		skipBiome: false,
		skipSvelteCheck: false,
		skipPlanLiterals: false,
		skipLocalTzGetters: false,
		skipPrBody: false,
		skipSsEmbedGate: false,
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
  npm run pre-ready                                # PR 未作成時 (Step 9 / 11b はスキップ)

Options:
  --pr <num>             GitHub PR 番号 (Step 9 PR body / mergeable 検証用)
  --skip-biome           Step 1 biome check をスキップ
  --skip-svelte-check    Step 2 svelte-check をスキップ
  --skip-plan-literals   Step 7 plan/status リテラル直書き検査をスキップ (#972)
  --skip-local-tz-getters Step 7g ローカル TZ 日付 getter 検査をスキップ (#4015 / ADR-0061)
  --skip-pr-body         Step 9 Readiness gate をスキップ
  --skip-ss-embed-gate   Step 11b SS embed gate (UI 変更 PR の SS 未 embed hard-fail、#2918) をスキップ
  --help, -h             このヘルプ

Steps (6 本。番号は既存の識別子を維持 — 実行順は下記「実行順」を参照、#4048 / #4121):
  1.  biome check                 — lint (recommended の correctness / suspicious を含む)
  2.  svelte-check                — TS strict 型チェック
  7.  check-no-plan-literals.mjs  — プラン / ステータスリテラル直書き検査 (#972)
  7g. check-local-tz-date-getters.mjs — TZ 依存の日付導出禁止 / JST SSOT 強制 (#4015 / #4127)
  9.  Readiness gate              — Ready checklist [x] 完了 / AC 4 列 / forbidden-terms / 必須セクション 13 個 / mergeable (check-pr-body.mjs、PR 番号必須、#2632)
  11b. check-pr-screenshot.mjs (SS embed gate) — UI 変更 PR の SS embed 未完了を hard-fail (#2918)
       CI screenshot-check とは同じ判定関数 (isUiPr / hasInternalRefactorLabel /
       hasEmbeddedScreenshotImage / checkRenderImpossibleDeclaration) を共有する (#4158)。
       ただし本 step は checkScreenshotEmbedReadiness まで見るため CI より広い —
       「未来形記述 (後で push する)」「該当なしマーカー」は本 step だけが hard-fail する。
       委譲の宣言 SSOT: scripts/lib/ci/workflow-judgment-registry.mjs

選定基準 (ADR-0007 §1-2 判断原則 v2、#4121):
  類型 1 (証跡の真正性 / 不可逆な損失) と 類型 2 (顧客に見える正しさ) のうち安価なものだけを
  pre-ready に残す。残りは CI 側で hard-fail のまま走る。
    - 類型 1: Step 9 (Ready checklist / AC 証跡 / 禁止語) / Step 11b (SS 証跡)
    - 類型 2: Step 1 / 2 / 7 / 7g

pre-ready から外した検査の行き先 (**検査を消したわけではない** — CI で hard-fail のまま走る、#4121):
  cspell / hardcoded-strings / license-key-leak / cli-entry-guard /
  sparse-checkout-closure / readdir-rotation-guard / repo-scan-test-declaration /
  doc-code-references / terminology-coherence / generate-lp-labels --check
                                  → .github/workflows/ci.yml (lint-and-test)
  vitest                          → .github/workflows/ci.yml (unit-test、2 shard)
  measure-lp-dimensions           → .github/workflows/lp-metrics.yml
  sync-lp-fallback --check        → .github/workflows/lp-fallback-check.yml
  capture (撮影ガイダンス表示のみで検査ではなかった) → 撤去。SS 未 embed は Step 11b が検出する
  ローカルで個別に回したいときは npm run cspell / npx vitest run 等を直接叩く。

実行順 (cheap-fail-first、#4048):
  Step 番号は PR body / docs / Issue から広く参照されるため変更しない。実行順だけを
  「判定に要する時間と参照する情報の量」で並べ替える。同一クラス内は上記の番号順を保つ。
    1) meta      PR body / メタ情報だけを見る    — Step 9
    2) static    静的テキスト / 単一ファイル検査 — Step 1 / 7 / 7g
    3) typecheck 型検査                          — Step 2
    4) ui        SS 系                           — Step 11b
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
 * 自動 install されない。依存欠落のまま pre-ready を回すと Step 2 (svelte-check) が
 * 「変更と無関係な」大量 error / spawn 失敗になり、品質ゲートが空振りする
 * (#3855 / #3856 の 2 agent が共に遭遇)。これを silent に通さず、着手前に明示ガイダンス付きで
 * fail-fast する (ADR-0006 no-silent-fail 整合 / #3857 AC1「依存欠落を silent に pass しない」)。
 *
 * biome の「Checked 0 files」false-negative は本体側 (biome.json の `.claude` ignore を
 * repo 相対 `!.claude` に anchor 化) で根治済み (#3857 Fix B)。
 *
 * 検出:
 *   - worktree 判定: `repoRoot/.git` が「ファイル」(linked worktree の gitdir ポインタ) なら worktree。
 *     通常 clone では `.git` はディレクトリなので false。
 *   - 依存欠落判定: pre-ready 各 step が依存する代表 sentinel の存在確認。
 *     #4121 で 6 step に絞ったため、vitest / tsx / infra の aws-cdk-lib は pre-ready の依存では
 *     なくなった (それぞれ CI job 側の依存)。sentinel を過剰に要求すると、pre-ready が回せない
 *     理由を本来不要な install に求めることになるため、残す 6 step が実際に spawn するものだけを見る。
 *
 * pre-ready Step 1 / 2 が依存する代表 sentinel。1 つでも欠落したら install 未完了とみなす。
 * (export: tests/unit/scripts/pre-ready-preflight.test.ts が root 差替えで検証する)
 */
export const PREFLIGHT_SENTINELS = [
	'node_modules', // 本体
	'node_modules/.bin', // spawn する CLI 群 (svelte-check / biome)
	'node_modules/svelte-check', // Step 2
	'node_modules/@biomejs/biome', // Step 1
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
 * step 定義オブジェクトの必須フィールド SSOT (#4086)。
 *
 * **step を 1 つ足すのに必要な登録はここに並ぶ 7 フィールドだけ**であり、他の registry への
 * 二重登録は要らない。旧実装は `skipStateOf()` 経由の skip 分類 (#4018 `[K10]`) と
 * `STEP_COST_CLASS_BY_NAME` (#4048 `[O1]`) の 2 registry への同時登録を要求しており、片方を
 * 直しても残りは次の CI が回るまで分からず、PR #4066 が 2 度連続 red になった (#4086 実測)。
 *
 * `costClass` を step 定義に取り込んで registry を 1 本化し、欠落・不正値は
 * `assertStepShapes` (= `orderSteps` の入口) が throw する。強度は旧 `[O1]` / `[O9]` と同じか
 * それ以上 (runner / fixHint / skipKind の欠落も同じ 1 箇所で落ちる)。
 */
export const REQUIRED_STEP_FIELDS = /** @type {const} */ ([
	'name',
	'label',
	'costClass',
	'skip',
	'skipKind',
	'runner',
	'fixHint',
]);

/**
 * step 定義の shape を検証し、欠落 / 不正値があれば throw する (#4086 案 A + 案 B)。
 *
 * 登録漏れを silent に通さない (ADR-0061 same-class→guard)。`skipKind` は `null` を取り得るので
 * 「値が falsy か」ではなく **キーが存在するか** で判定する。
 *
 * @param {{ name?: string }[]} steps
 * @returns {void}
 */
export function assertStepShapes(steps) {
	const problems = [];
	for (const [index, step] of steps.entries()) {
		const label = step?.name ?? `(name 未設定 / index ${index})`;
		const missing = REQUIRED_STEP_FIELDS.filter((f) => !(step && f in step));
		// 型も見る: runner が関数でない / label・fixHint が文字列でない step は実行時に落ちる
		const typeErrors = [];
		if (step && 'runner' in step && typeof step.runner !== 'function')
			typeErrors.push('runner (関数であること)');
		if (step && 'skip' in step && typeof step.skip !== 'boolean')
			typeErrors.push('skip (boolean であること)');
		if (missing.length > 0 || typeErrors.length > 0) {
			problems.push(`  - ${label}: 必須フィールド不足 [${[...missing, ...typeErrors].join(', ')}]`);
			continue;
		}
		if (!STEP_COST_CLASSES.includes(step.costClass)) {
			problems.push(
				`  - ${label}: costClass の値が不正 (${JSON.stringify(step.costClass)}) — ` +
					`許容値: ${STEP_COST_CLASSES.join(' / ')}`,
			);
		}
	}
	if (problems.length > 0) {
		throw new Error(
			`[pre-ready] step 定義が不完全です (#4086):\n${problems.join('\n')}\n` +
				`  対応: scripts/pre-ready.mjs の buildSteps() の当該 step に ` +
				`${REQUIRED_STEP_FIELDS.join(' / ')} を揃える。\n` +
				`  skip / skipKind は \`...skipStateOf({...})\` の spread で入る (#4018)。` +
				`costClass は step 定義に直接書く (第 2 registry は #4086 で廃止)。`,
		);
	}
}

/**
 * step 配列を cheap-fail-first に並べ替える (#4048 AC1)。
 *
 * - 検査の集合・合否条件は変えない。**順序だけ**を変える (AC2)
 * - 同一クラス内は定義順 (= Step 番号順) を保つ安定ソート
 * - shape 不備 (costClass 欠落 / 不正値 / runner 欠落 等) があれば throw (#4086)
 *
 * @template {{ name: string }} T
 * @param {T[]} steps
 * @returns {T[]}
 */
export function orderSteps(steps) {
	assertStepShapes(steps);
	const rank = (/** @type {{ costClass: string }} */ s) => STEP_COST_CLASSES.indexOf(s.costClass);
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
 * #4007 / #4121: pre-ready は 6 step に絞り、残りの検査は CI で hard-fail のまま走る。
 * 「pre-ready ALL PASS = 全部通った」と誤読されると沈黙 skip と同じ害になるため、summary は
 * 必ず「pre-ready 外で走る検査と、その確認方法」を出す (`ci-gate` は skipped を failure として
 * 数えないため ci-gate green は委譲先が走った証拠にならない)。
 *
 * @param {{ totalSteps: number; skippedByFlag: string[]; skippedScriptMissing: string[];
 *           skippedPrMissing?: string[]; skippedNotApplicable: string[];
 *           failOpenCount?: number; pr?: string | null }} input
 * @returns {{ status: 'ALL_PASS' | 'PARTIAL_PASS'; text: string }}
 */
export function buildSummary({
	totalSteps,
	skippedByFlag,
	skippedScriptMissing,
	skippedPrMissing = [],
	skippedNotApplicable,
	failOpenCount = 0,
	pr = null,
}) {
	// #4121: pre-ready 外 (CI 側 hard-fail) で走る検査の確認手順。step から外したことと
	// 検査を消したことは別なので、外した先を必ず名指しする。
	const ciSideBlock =
		`  pre-ready 外の検査 (CI で hard-fail、#4121):\n` +
		`    - unit-test        vitest (2 shard)\n` +
		`    - lint-and-test    cspell / hardcoded-strings / doc-code-references / terminology-coherence /\n` +
		`                       license-key-leak / CLI entry guard 系 / generate-lp-labels --check ほか\n` +
		`    - lp-metrics       LP 寸法・禁止語 (LP 変更時)\n` +
		`    - lp-fallback-check LP fallback 同期 (LP / labels.ts 変更時)\n` +
		`    Ready 化前に \`gh pr checks ${pr ?? '<num>'}\` でこれらが **pass (skipped でない)** ことを確認する。\n` +
		`    \`ci-gate\` は skipped を failure として数えないため、ci-gate green を根拠にしない。\n`;
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
		const ran = totalSteps - blocking.length - skippedNotApplicable.length;
		return {
			status: 'PARTIAL_PASS',
			text:
				`\n[pre-ready] PARTIAL PASS — 実行した ${ran} step は PASS しましたが、` +
				`${detail} が未実行です。\n` +
				notApplicableLine +
				`  これは開発中の部分確認結果であり、Ready 化 (gh pr ready) 判定には\n` +
				`  skip なしの \`npm run pre-ready -- --pr ${pr ?? '<num>'}\` 全 step PASS が必要です。\n` +
				ciSideBlock,
		};
	}

	return {
		status: 'ALL_PASS',
		text:
			`\n[pre-ready] ALL PASS (pre-ready 6 step)${failOpenCount > 0 ? ` (fail-open ${failOpenCount} 件あり — 上記 ⚠ を確認)` : ''} — Ready for Review に進めます。\n` +
			notApplicableLine +
			ciSideBlock +
			`  次の手順:\n` +
			`    1. node scripts/check-gh-account-before-pr.mjs   # gh アカウント確認 (#1728)\n` +
			`    2. gh pr checks ${pr ?? '<num>'}                           # 上記 CI job が pass (skipped でない) ことを確認\n` +
			`    3. gh pr ready ${pr ?? '<num>'}                            # Ready for Review に変更\n` +
			`    4. CI 全緑になるまで待機し、QM レビューを依頼\n`,
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

	// graceful degradation: 検査 script が未配備なら skip + warning に倒す (Issue #1920 設計判断)。
	// skipKind='script-missing' は ALL PASS を名乗らせないので、gate 不在は summary に必ず残る。
	const planLiteralsScriptExists = existsSync(
		resolve(repoRoot, 'scripts/check-no-plan-literals.mjs'),
	);
	// #4015: ローカル TZ 日付 getter の再混入を止める gate (ADR-0061 same-class-N → guard)
	const localTzGetterScriptExists = existsSync(
		resolve(repoRoot, 'scripts/check-local-tz-date-getters.mjs'),
	);

	return [
		{
			name: 'biome',
			costClass: 'static',
			label: 'Step 1: biome check (--error-on-warnings, CI と整合 — PR #2503 教訓)',
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
			name: 'svelte-check',
			costClass: 'typecheck',
			label: 'Step 2: svelte-check (TS strict)',
			...skipStateOf({ byFlag: args.skipSvelteCheck }),
			runner: () => run('svelte-check', ['npx', 'svelte-check', '--tsconfig', './tsconfig.json']),
			fixHint: '  型エラー箇所を修正。`as any` / `// @ts-expect-error` の追加は禁止 (ADR-0006)。',
		},
		// Step 7: check-no-plan-literals (#972 / Phase 5 F1 / #1918)
		// Issue #1920 graceful degradation: 検査 script が未配備 (F1 #1918 未 merge 等) なら skip + warning。
		// scripts/check-no-plan-literals.mjs 自体は #972 で main 取込済 (本 step は無条件で実行する)
		{
			name: 'plan-literals',
			costClass: 'static',
			label: planLiteralsScriptExists
				? 'Step 7: check-no-plan-literals.mjs (#972 / Phase 5 F1)'
				: 'Step 7: check-no-plan-literals.mjs (script 未配備 — skip)',
			...skipStateOf({ byFlag: args.skipPlanLiterals, scriptMissing: !planLiteralsScriptExists }),
			runner: () => run('check-no-plan-literals', ['node', 'scripts/check-no-plan-literals.mjs']),
			fixHint:
				'  プラン / ステータスのリテラル直書きが検出されました (#972)。\n' +
				'  - 修正: $lib/domain/constants/subscription-plan.ts 等の定数経由に置換\n' +
				"  - 例: 'family-monthly' → SUBSCRIPTION_PLAN.FAMILY_MONTHLY\n" +
				"  - 例: 'grace_period' → SUBSCRIPTION_STATUS.GRACE_PERIOD",
		},
		// Step 7g: check-local-tz-date-getters (#4015 / ADR-0061 same-class-N → guard)
		// 実時刻からローカル TZ getter で暦要素を取り出す形 (#4003 と同 class) の再混入を止める。
		{
			name: 'local-tz-getters',
			costClass: 'static',
			label: localTzGetterScriptExists
				? 'Step 7g: check-local-tz-date-getters.mjs (#4015)'
				: 'Step 7g: check-local-tz-date-getters.mjs (script 未配備 — skip)',
			...skipStateOf({
				byFlag: args.skipLocalTzGetters,
				scriptMissing: !localTzGetterScriptExists,
			}),
			runner: () =>
				run('check-local-tz-date-getters', ['node', 'scripts/check-local-tz-date-getters.mjs']),
			fixHint:
				'  ローカル TZ 日付 getter を検出しました (#4015)。\n' +
				'  - 実時刻 (new Date() / DB timestamp) から暦要素を取り出しているなら欠陥です。\n' +
				'    $lib/domain/date-utils.ts の JST SSOT (todayDateJST / weekStartJST / weekEndJST /\n' +
				'    addDaysJST / jstDayOfWeek / jstYearMonth / monthKeyJST 等) に置換してください。\n' +
				'  - TZ 非依存と言える場合のみ script の ALLOWLIST に file / max / reason を追加します\n' +
				'    (reason が空だと gate 自身が fail します)。',
		},
		{
			name: 'pr-body',
			costClass: 'meta',
			// #2632: Step 9 ラベルに「Ready checklist + AC 4 列 + forbidden-terms」を明示。
			// 本日 (2026-05-29) 7 連続再発 (#2625 / #2626 / #2629 / #2630) で「Step 9 が何を見ているか」が
			// 実装者に伝わっていない問題が露出した。check-pr-body.mjs は既に Ready checklist `[ ]` / AC 4 列 /
			// forbidden-terms / 必須セクション / BOM / mojibake / CONFLICTING を一括検出するが、ラベル
			// が `check-pr-body.mjs` だけだと「PR body 表面チェック」と誤認され skip されやすい。
			// ADR-0056 §E (#2632 で新設) 整合の構造的予防。
			label: args.pr
				? `Step 9: Readiness gate (Ready checklist + AC 4 列 + forbidden-terms + 必須セクション、check-pr-body.mjs --pr ${args.pr})`
				: 'Step 9: Readiness gate (--pr 未指定 — skip、Ready 化前は --pr 必須)',
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
		// Step 11b: SS embed gate (#2918)
		// UI 変更 PR が「SS は後で push する」未来形のまま / embed 画像なしで Ready 化され、
		// CI screenshot-check fail → Fix Agent 往復 が 4 件連続 (#2913 / #2914 / #2915 / #2909) した
		// 構造への対策。CI screenshot-check と同一 SSOT 関数 (checkScreenshotEmbedReadiness) を
		// SCREENSHOT_EMBED_GATE=1 env で error モード起動し、Ready 化前に hard-fail する。
		// UI 変更がない / --pr 未指定 / exempt label 時は gate 内部で skip。
		{
			name: 'ss-embed-gate',
			costClass: 'ui',
			label:
				uiChanged && args.pr
					? 'Step 11b: SS embed gate (check-pr-screenshot.mjs、UI 変更 PR の SS embed 未完了を hard-fail、#2918)'
					: `Step 11b: SS embed gate (${!args.pr ? '--pr 未指定 — skip' : 'UI 変更なし — skip'}、#2918)`,
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
	console.log(`[pre-ready] PR 番号: ${args.pr ?? '(未指定 — Step 9 / 11b はスキップ)'}`);

	// #3857: 依存 preflight — 欠落のまま Step 2 を回すと変更無関係の false-negative になるため fail-fast
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
			'  (依存欠落のまま Step 2 svelte-check を実行すると変更と無関係な大量 error / spawn 失敗になり、\n' +
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

	for (const step of steps) {
		if (step.skip) {
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
