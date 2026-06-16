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
 *   npm run pre-ready -- --pr 1920 --skip-vitest          # 重い vitest をスキップして高速確認
 *   npm run pre-ready                                      # PR 未作成時 (PR body / mergeable 検証はスキップ)
 *
 * exit:
 *   0 = 全 Step PASS
 *   1 = いずれかの Step FAIL
 *   2 = internal error
 */

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isAllowedBaseBranch, resolveBaseBranchAuto } from './lib/resolve-base-branch.mjs';

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
	'--skip-vitest': 'skipVitest',
	'--skip-hardcoded': 'skipHardcoded',
	'--skip-lp-dimensions': 'skipLpDimensions',
	'--skip-lp-fallback': 'skipLpFallback',
	'--skip-plan-literals': 'skipPlanLiterals',
	'--skip-license-key-leak': 'skipLicenseKeyLeak',
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
  --skip-svelte-check    Step 2 svelte-check をスキップ
  --skip-vitest          Step 3 vitest をスキップ (重いので高速確認時のみ)
  --skip-hardcoded       Step 4 hardcoded JP text 検査をスキップ
  --skip-lp-dimensions   Step 5 LP 寸法・禁止語検査をスキップ (LP 変更時のみ自動実行)
  --skip-lp-fallback     Step 6 LP fallback 同期検査をスキップ (LP / labels.ts 変更時のみ自動実行)
  --skip-plan-literals   Step 7 plan/status リテラル直書き検査をスキップ (#972 / Phase 5 F1)
  --skip-license-key-leak Step 7b license key 再導入防止検査をスキップ (#2836 / Phase 7 PR-L4)
  --skip-lp-labels       Step 8 LP labels 同期検査をスキップ (labels.ts / terms.ts / age-tier.ts 変更時のみ自動実行、Phase 1 B1)
  --skip-pr-body         Step 9 PR body 検査をスキップ
  --skip-doc-code-references Step 10 デッドリンク検査をスキップ
  --skip-terminology-coherence Step 11 用語不統一・add 経路重複検査をスキップ
  --skip-ss-embed-gate   Step 11b SS embed gate (UI 変更 PR の SS 未 embed hard-fail、#2918) をスキップ
  --skip-capture         Step 12 capture (UI 変更時のみ) をスキップ
  --help, -h             このヘルプ

Steps:
  1.  biome check                 — lint
  2.  svelte-check                — TS strict 型チェック
  3.  vitest run                  — unit test (storybook 以外)
  4.  check-hardcoded-strings.mjs — JP ハードコード baseline 監視 (#1452)
  5.  measure-lp-dimensions.mjs   — LP 寸法 / 禁止語 (LP 変更時のみ)
  6.  sync-lp-fallback.mjs        — LP fallback テキスト同期検査 (LP / labels.ts 変更時のみ、#1945)
  7.  check-no-plan-literals.mjs  — プラン / ステータスリテラル直書き検査 (#972 / Phase 5 F1 / #1918)
  8.  generate-lp-labels --check  — site/shared-labels.js 同期検査 (labels.ts / terms.ts / age-tier.ts 変更時のみ、Phase 1 B1 / #1917)
  9.  Readiness gate              — Ready checklist [x] 完了 / AC 4 列 / forbidden-terms / 必須セクション 13 個 / mergeable (check-pr-body.mjs、PR 番号必須、#2632)
  10. check-doc-code-references.mjs — ドキュメントのデッドリンク検知 (#2577)
  11. check-terminology-coherence.ts — 用語不統一・add 経路重複検知 (#2555)
  11b. check-pr-screenshot.mjs (SS embed gate) — UI 変更 PR の SS embed 未完了を hard-fail (#2918、CI screenshot-check と SSOT 共有)
  12. capture.mjs --pr            — UI 変更検知時のみ撮影 (現状は手動推奨。本 step は実行ガイダンスのみ)

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
 * `git diff origin/<base>...HEAD --name-only` で変更ファイル一覧を取得する。
 * base は scripts/lib/resolve-base-branch.mjs (#2959 SSOT) で解決する
 * (develop 二層 cutover #2870 後、feature branch は develop 基点のため
 *  origin/main 固定だと sibling PR の develop commit を誤算入する)。
 * @param {string} baseBranch 解決済み base branch 名 ('develop' | 'main')
 * @returns {Promise<string[]>}
 */
async function getChangedFiles(baseBranch) {
	// #2982: shell:true 下で `origin/${baseBranch}` をコマンド文字列に展開するため、展開前に
	// whitelist (main / develop の 2 lane) で防御的に clamp する。脅威モデルは「本人の local tool」
	// のため理論枠 (ADR-0010 整合で非 BLOCK 裁定済) だが、injection 面を構造的に閉じる。
	let base = baseBranch;
	if (!isAllowedBaseBranch(base)) {
		console.warn(
			`[pre-ready] WARN: 想定外の base branch "${base}" (whitelist: main / develop) — origin/main に clamp します (#2982)`,
		);
		base = 'main';
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

	return [
		{
			name: 'biome',
			label: 'Step 1/12: biome check (--error-on-warnings, CI と整合 — PR #2503 教訓)',
			skip: args.skipBiome,
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
			label: 'Step 2/12: svelte-check (TS strict)',
			skip: args.skipSvelteCheck,
			runner: () => run('svelte-check', ['npx', 'svelte-check', '--tsconfig', './tsconfig.json']),
			fixHint: '  型エラー箇所を修正。`as any` / `// @ts-expect-error` の追加は禁止 (ADR-0006)。',
		},
		{
			name: 'vitest',
			label: 'Step 3/12: vitest run (unit test)',
			skip: args.skipVitest,
			runner: () => run('vitest', ['npx', 'vitest', 'run']),
			fixHint:
				'  失敗テストを修正。assertion を弱める変更は禁止 (ADR-0006)。\n' +
				'  storybook テストは `npm run test:storybook` で別途確認。',
		},
		{
			name: 'hardcoded-strings',
			label: 'Step 4/12: check-hardcoded-strings.mjs (#1452 Phase A)',
			skip: args.skipHardcoded,
			runner: () => run('check-hardcoded-strings', ['node', 'scripts/check-hardcoded-strings.mjs']),
			fixHint:
				'  baseline (1607 件) より JP ハードコードが増えています。\n' +
				'  src/lib/domain/labels.ts に定数追加して `data-label` / import 経由に置換 (ADR-0009)。',
		},
		{
			name: 'lp-dimensions',
			label: `Step 5/12: measure-lp-dimensions.mjs (LP 変更検知: ${lpChanged ? 'YES' : 'NO — skip'})`,
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
			label: `Step 6/12: sync-lp-fallback.mjs --check (LP / labels.ts 変更検知: ${lpFallbackTrigger ? 'YES' : 'NO — skip'})`,
			skip: args.skipLpFallback || !lpFallbackTrigger,
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
			skip: args.skipPlanLiterals || !planLiteralsScriptExists,
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
			skip: args.skipLicenseKeyLeak || !licenseKeyLeakScriptExists,
			runner: () => run('check-license-key-leak', ['node', 'scripts/check-license-key-leak.mjs']),
			fixHint:
				'  allowlist 外のコード行に license key 参照を検出しました (#2836)。\n' +
				'  - LP / メール / ラベル / UI で license key 概念を再導入しないでください。\n' +
				'  - entitlement は Stripe Subscription (tenant.status=ACTIVE) が唯一 SSOT です。\n' +
				'  - DB 層 / LEGACY_URL_MAP entry は PR-L5 担当の allowlist (FILE_ALLOWLIST)。',
		},
		// Step 8: generate-lp-labels --check (Phase 1 B1 / #1917)
		// Issue #1920 graceful degradation: 検査 script が未配備なら skip + warning。
		// labels.ts / terms.ts / age-tier.ts いずれかの変更検知時のみ実行 (LP shared-labels.js への波及)
		{
			name: 'lp-labels',
			label: !lpLabelsScriptExists
				? 'Step 8/12: generate-lp-labels --check (script 未配備 — skip)'
				: `Step 8/12: generate-lp-labels --check (labels.ts / terms.ts / age-tier.ts 変更検知: ${lpLabelsTrigger ? 'YES' : 'NO — skip'})`,
			skip: args.skipLpLabels || !lpLabelsScriptExists || !lpLabelsTrigger,
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
			skip: args.skipPrBody || !args.pr,
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
			skip: args.skipDocCodeReferences,
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
			skip: args.skipTerminologyCoherence,
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
			skip: args.skipSsEmbedGate || !uiChanged || !args.pr,
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
	console.log(`[pre-ready] PR 番号: ${args.pr ?? '(未指定 — Step 9, 12 はスキップ)'}`);

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

	// #2929 項目 3: fail-open / 明示 skip した gate を summary で可視化 (silent pass の誤認防止)
	for (const note of failOpenNotes) {
		console.log(`\n[pre-ready] ⚠ fail-open: ${note}`);
	}

	console.log(
		`\n[pre-ready] ALL PASS${failOpenNotes.length > 0 ? ` (fail-open ${failOpenNotes.length} 件あり — 上記 ⚠ を確認)` : ''} — Ready for Review に進めます。\n` +
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
