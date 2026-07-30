#!/usr/bin/env node
/**
 * #914 / ADR-0024 — 必須化された env / secret の配布証跡チェック
 *
 * PR diff から「production で必須になった env / secret」を検出し、
 * PR 本文に **「配布済み:」証跡** が無ければ exit 1 で CI を red にする。
 *
 * ## 検出範囲 (#4129 AC5 で「既存 env の必須化」まで拡張)
 *
 * 追加行 (`+`) から:
 *   1. 関数名 `assert*Configured()`          例: assertLicenseKeyConfigured()
 *   2. `throw new Error('...is required...')` 英語の必須文言
 *   2-JP. `throw new Error('...が未設定です...')` **日本語の必須文言** (#4129)
 *   3. `process.env.X || (() => { throw ... })()` 同等パターン
 *   4. fail-fast guard `if (!X) { ... process.exit(1) }` (#4129)
 *
 * 追加行 × 削除行 (`-`) の対比から:
 *   5. optional → required への **変化** (#4129)
 *      — `.optional()` 剥がし / 既定値 fallback 撤去 / CDK silent skip 撤去
 *
 * ## なぜ「変化」まで見るか (#4129 AC5)
 *
 * 2026-07-31、本番 NUC の日次バックアップが 7/30 deploy 後の初回実行から毎晩失敗していた。
 * 原因は `CRON_SECRET` が NUC の .env に未配布だったこと。#3950 でバックアップ入口が
 * `scripts/backup-nuc.cjs` の pglite 経路に一本化された結果、**以前から存在する**
 * `CRON_SECRET` が backup コンテナの hard requirement になったが、本 gate は
 * 「新規追加された env」しか見ていなかったため素通りした。`DISCORD_ALERT_WEBHOOK_URL` も
 * 未配布で失敗通知すら届かず、発覚まで 18 日かかった。
 *
 * ## 検出できない範囲 (明示。黙って守れていることにしない)
 *
 *   - **diff 外での必須化**: 別 file の代替経路が消えた結果、既存 script が唯一の入口に
 *     なるケース。当該 env は追加行に現れないため検出不能
 *   - **アプリ外の消費者**: docker-compose / systemd unit / shell script / workflow yaml
 *     など、JS の `process.env` 以外の形で env を要求する経路
 *   - **条件付き必須**: 「別 env が特定値のときだけ必須」といった実行時条件
 *   - **動的な env 名**: `process.env[name]` のように名前が実行時に決まるもの
 *   - **配布先の実在**: 本 gate は PR 本文の証跡文字列の有無しか見ない。実際に NUC .env /
 *     GitHub Secrets / SSM へ入っているかは検証しない (人間レビュー + deploy 側 validation)
 *
 * ## 誤検出時の解除 (理由必須、#3956 教訓)
 *
 * 検出が誤りなら PR 本文に理由付きで宣言する。理由が空 / 定型 stub の宣言は受理しない:
 *
 *   <!-- env-not-newly-required: <ENV_NAME> <12 文字以上の理由> -->
 *
 * 「配布済み: <ENV_NAME>」を書けるなら、解除ではなくそちらを書くこと。
 *
 * 使い方 (CI):
 *   PR_BODY="$(gh pr view ${{ github.event.number }} --json body -q .body)" \
 *     node scripts/check-new-required-env.mjs
 *
 * 使い方 (ローカル検証):
 *   node scripts/check-new-required-env.mjs                # diff against origin/main
 *   node scripts/check-new-required-env.mjs --base=HEAD~1  # diff against arbitrary base
 *
 * 環境変数:
 *   PR_BODY    PR 本文 (CI で `gh pr view ... -q .body` の結果を渡す)
 *              ローカル実行時は未設定でも OK (検出のみ・exit 0)
 *   BASE_REF   diff のベース ref (デフォルト: origin/main)
 *
 * exit:
 *   0 = 必須化された env なし、または全て配布済み証跡 / 有効な解除宣言あり
 *   1 = 必須化された env が検出され、PR 本文に証跡も有効な解除宣言も無い (CI を red にする)
 *   2 = git コマンド失敗等の internal error
 */

import { execFileSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { isSubstantiveReason, MIN_REASON_LENGTH } from './lib/ci/reason-declaration.mjs';
import { isMain as isMainModule } from './lib/is-main.mjs';

const BASE_REF = process.env.BASE_REF || 'origin/main';
const PR_BODY = process.env.PR_BODY || '';

/**
 * 既知のフレームワーク / ランタイム内蔵 env。配布証跡の対象外。
 */
const FRAMEWORK_ENVS = new Set([
	'NODE_ENV',
	'PORT',
	'HOST',
	'CI',
	'PWD',
	'PATH',
	'VITE_DEV',
	'PUBLIC_BASE_URL',
]);

/**
 * 日本語の必須文言 (#4129 AC5)。
 *
 * 実害 (#3950 → #4129): `throw new Error('CRON_SECRET が未設定です (...)')` が英語前提の
 * regex に掛からず素通りし、本番 NUC のバックアップが 18 日間無音で停止した。
 * env 名と述語の間に助詞や短い修飾 (`env`、`(...)` 等) が挟まる場合を許すため窓を 40 字取る。
 */
const ENV_REQUIRED_JP_RE =
	/\b([A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+)\b[^\n]{0,40}?(?:が未設定|が設定されていません|が必要|は必須|が必須|を設定してください)/;

// CLI args
for (const arg of process.argv.slice(2)) {
	if (arg.startsWith('--base=')) {
		process.env.BASE_REF = arg.slice('--base='.length);
	}
}
const baseRef = process.env.BASE_REF || BASE_REF;

/**
 * Run `git diff <range>` and return the unified diff as a string.
 *
 * Fail-closed (ADR-0029): CI モード (PR_BODY あり) で git diff が失敗した場合は exit 2。
 * ローカルモードでは warn + `null` を返し、呼び出し側で fallback させる。
 *
 * @param {string} range
 * @returns {string | null}
 */
function runGitDiff(range) {
	try {
		// 新規ファイル (staged) 含む全 diff (--no-renames で確実に追加行として検出)
		// execFileSync で arg-array 渡し → shell metachar 注入リスクを排除
		return execFileSync('git', ['diff', '--no-renames', range], {
			encoding: 'utf-8',
			maxBuffer: 50 * 1024 * 1024,
		});
	} catch (err) {
		const errMsg = err instanceof Error ? err.message : String(err);
		const msg = `[check-new-required-env] could not git diff against ${range}: ${errMsg}`;
		if (PR_BODY) {
			// CI モード: fail-closed (ADR-0029) — 検出を素通りさせない
			console.error(msg);
			console.error('[check-new-required-env] FAIL-CLOSED in CI mode (ADR-0029)');
			process.exit(2);
		}
		console.warn(msg);
		console.warn(
			'[check-new-required-env] skipping check (local mode, likely new repo or shallow clone)',
		);
		return null;
	}
}

/**
 * Append synthesized unified diff for untracked files (local mode only).
 *
 * `git diff` は untracked file を含まないため、`git status --porcelain` で
 * untracked を検出してファイル内容から追加行を合成する。
 * これによりローカルでも `git add` 前の新規 guard ファイルを取りこぼさない。
 *
 * `git diff --no-index /dev/null <path>` は Windows (NUL) との互換性が
 * 不安定なため、git に頼らず純粋にファイル内容から組み立てる。
 *
 * @param {string} diff
 * @returns {string}
 */
function appendUntrackedFiles(diff) {
	let result = diff;
	try {
		const status = execFileSync('git', ['status', '--porcelain'], {
			encoding: 'utf-8',
			maxBuffer: 10 * 1024 * 1024,
		});
		const untracked = status
			.split('\n')
			.filter((l) => l.startsWith('?? '))
			.map((l) => l.slice(3));
		for (const path of untracked) {
			try {
				const stat = statSync(path);
				if (stat.isDirectory()) continue; // ディレクトリは扱わない
				const content = readFileSync(path, 'utf-8');
				const lines = content.split('\n');
				// 末尾の空行を除外（split('\n') が末尾に空文字列を残すため）
				if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
				const lineCount = lines.length;
				const header =
					`diff --git a/${path} b/${path}\n` +
					`new file mode 100644\n` +
					`--- /dev/null\n` +
					`+++ b/${path}\n` +
					`@@ -0,0 +1,${lineCount} @@\n`;
				const body = lines.map((l) => `+${l}`).join('\n');
				result += `${header + body}\n`;
			} catch (e) {
				console.warn(
					`[check-new-required-env] could not read untracked ${path}: ${e instanceof Error ? e.message : String(e)}`,
				);
			}
		}
	} catch (e) {
		console.warn(
			`[check-new-required-env] could not enumerate untracked files: ${e instanceof Error ? e.message : String(e)}`,
		);
	}
	return result;
}

/**
 * Get git diff vs base ref. Returns the unified diff as a string.
 *
 * CI モード (PR_BODY あり): `git diff <base>...HEAD` でコミット済みのみ比較
 * ローカルモード (PR_BODY なし): `git diff <base>` で staged + working tree を比較し、
 *   さらに untracked file を合成して追加。
 *
 * Orchestration only: calls `runGitDiff()` and optionally `appendUntrackedFiles()`
 * based on mode (CI vs local).
 *
 * @returns {string}
 */
function getDiff() {
	const range = PR_BODY ? `${baseRef}...HEAD` : baseRef;
	const diff = runGitDiff(range);
	if (diff === null) {
		// ローカルモードで git diff 失敗 → 空文字列を返して check を skip
		return '';
	}
	// ローカルモードのみ untracked を補完 (CI モードはコミット済みしか見ない)
	if (!PR_BODY) {
		return appendUntrackedFiles(diff);
	}
	return diff;
}

/**
 * 検査対象外のファイルパス (docs / .md / 自身 / テスト / lock files)
 * 文字列内の env 名による誤検知を避けるため、コードファイルのみを対象とする。
 */
/**
 * @param {string | null | undefined} path
 * @returns {boolean}
 */
function isExcludedPath(path) {
	if (!path) return true;
	if (path.startsWith('docs/')) return true;
	if (path.endsWith('.md')) return true;
	if (path.startsWith('tests/')) return true;
	if (path.endsWith('.test.ts') || path.endsWith('.test.js') || path.endsWith('.spec.ts'))
		return true;
	if (path === 'package-lock.json') return true;
	if (path.startsWith('scripts/check-new-required-env')) return true; // 自身を除外
	return false;
}

/**
 * unified diff から追加行 (`+`) と削除行 (`-`) を分けて抽出する。
 *
 * 削除行は「optional → required の変化」(#4129 AC5 Pattern F) 判定に使う。
 * `+++` / `---` のヘッダ行と、docs / test など検査対象外 file のブロックは除外する。
 *
 * @param {string} diff
 * @returns {{ addedLines: string[]; removedLines: string[] }}
 */
export function extractDiffLines(diff) {
	const addedLines = [];
	const removedLines = [];
	let skipCurrentFile = false;

	for (const raw of diff.split('\n')) {
		// 新しいファイルブロック開始
		if (raw.startsWith('diff --git ')) {
			// "diff --git a/path b/path" から path を取り出す
			const m = raw.match(/^diff --git a\/(.+?) b\/(.+)$/);
			const path = m ? m[2] : null;
			skipCurrentFile = isExcludedPath(path);
			continue;
		}
		if (skipCurrentFile) continue;
		if (raw.startsWith('+++') || raw.startsWith('---')) continue;
		if (raw.startsWith('+')) addedLines.push(raw.slice(1));
		else if (raw.startsWith('-')) removedLines.push(raw.slice(1));
	}
	return { addedLines, removedLines };
}

/**
 * Detect new required env names from added lines.
 *
 * Heuristics:
 *   - Pattern A: `assertXxxConfigured()` 関数定義/呼び出し
 *     関数名から推測した env 名 (XXX_CONFIGURED → XXX) と、近傍行で参照される
 *     `process.env.<ENV>` を抽出する。
 *   - Pattern B: `throw new Error('... <ENV> is required ...')` 形式の文字列内 env 名
 *   - Pattern B-JP (#4129): `throw new Error('... <ENV> が未設定です ...')` 日本語必須文言
 *   - Pattern C: `process.env.<ENV> || (() => { throw ... })()` 形式
 *   - Pattern E (#4129): fail-fast guard `if (!X) { ... process.exit(1) }`
 *
 * 戻り値: env 名 (大文字スネーク) の Set
 */
/**
 * @param {string[]} addedLines
 * @returns {Set<string>}
 */
export function detectNewRequiredEnvs(addedLines) {
	const found = new Set();

	const assertFnRe = /assert([A-Z]\w*?)Configured\s*\(/;
	const processEnvThrowRe =
		/process\.env\.([A-Z][A-Z0-9_]+)\s*\|\|\s*\(?\s*\(\s*\)\s*=>\s*\{[^}]*throw/;
	// 「FOO_BAR is required」「FOO_BAR is not set」「FOO_BAR must be set」等
	// #2337 (PR #2325 教訓): env 名と "is required" の間に "env var" / "environment variable"
	// / "secret" の修飾語が挟まる場合も検出する。実例:
	//   "[PARENT_GATE] PARENT_GATE_COOKIE_SECRET env var is required in production"
	// が PR #2325 で検出漏れし本番障害を起こしたため、自然語表現 3 パターンを包含化。
	// 案件の env 名は ALL_CAPS_SNAKE_CASE のみを対象 (camelCase の JSON フィールド名は除外)
	// アンダースコアを 1 つ以上含むものを必須にして "PORT" 等の単語を弾く
	const envInStringRe =
		/\b([A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+)\b(?:\s+(?:env\s+var|environment\s+variable|secret))?\s+(?:is\s+(?:not\s+set|required|missing|undefined)|must\s+be\s+set)/;

	// 全追加行を結合して走査することで、複数行に渡る `throw new Error(...)` も拾う
	const fullText = addedLines.join('\n');

	// Pattern B / B-JP (multi-line): throw new Error(...'FOO is required' / 'FOO が未設定です'...)
	const throwBlockRe = /throw\s+new\s+Error\s*\(\s*([\s\S]*?)\)/g;
	for (const m of fullText.matchAll(throwBlockRe)) {
		const errorBody = m[1];
		if (!errorBody) continue;
		// 同一エラーボディ内に複数 env 名が含まれる可能性があるので global で探す
		for (const em of errorBody.matchAll(new RegExp(envInStringRe.source, 'g'))) {
			found.add(em[1]);
		}
		for (const em of errorBody.matchAll(new RegExp(ENV_REQUIRED_JP_RE.source, 'g'))) {
			found.add(em[1]);
		}
	}

	// Pattern E: fail-fast guard (throw を使わず process.exit(1) で落とす形)
	for (const env of detectFailFastGuardedEnvs(addedLines)) found.add(env);

	// 行単位で処理する Pattern A / C
	for (let i = 0; i < addedLines.length; i++) {
		const line = addedLines[i];
		if (!line) continue;

		// Pattern A: assertXxxConfigured — 同 PR 内の関数定義 or 呼び出し
		const fnMatch = line.match(assertFnRe);
		if (fnMatch) {
			// 前後 ±10 行を見て process.env.XXX を回収
			const window = addedLines.slice(Math.max(0, i - 10), i + 11).join('\n');
			const envMatches = window.matchAll(/process\.env\.([A-Z][A-Z0-9_]+)/g);
			for (const em of envMatches) found.add(em[1]);
			// 同 window 内で env in string パターンも探す
			for (const em of window.matchAll(new RegExp(envInStringRe.source, 'g'))) {
				found.add(em[1]);
			}
		}

		// Pattern C: process.env.X || (() => { throw ... })()
		const procMatch = line.match(processEnvThrowRe);
		if (procMatch) {
			found.add(procMatch[1]);
		}
	}

	// 既知のフレームワーク / Vite 内蔵 env は除外する
	for (const e of FRAMEWORK_ENVS) found.delete(e);

	return found;
}

/**
 * fail-fast guard 経由で必須化された env を検出する (#4129 AC5 Pattern E)。
 *
 * `throw new Error(...)` を使わず `process.exit(1)` で落とす guard は、既存 regex の
 * どのパターンにも掛からない。実害 (#3950 / #4129) の backup 経路もこの形だった。
 *
 * 判定は 3 点セット:
 *   1. `const X = process.env.ENV ...` で変数 ↔ env の対応を取る (fallback 連鎖は全て拾う)
 *   2. `if (!X)` / `if (!process.env.ENV)` の否定 guard を見つける
 *   3. guard 行から後方 10 行以内に fail-fast (`process.exit(非 0)` / `throw` / `exitCode = 非 0`)
 *
 * `process.exit(0)` で終わる guard は「未設定なら黙って skip」= optional の作法なので検出しない。
 *
 * @param {string[]} lines
 * @returns {Set<string>}
 */
function detectFailFastGuardedEnvs(lines) {
	const found = new Set();

	/** @type {Map<string, Set<string>>} 変数名 → 由来 env 名 */
	const aliases = new Map();
	for (const line of lines) {
		const m = line.match(/(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(.+)$/);
		if (!m) continue;
		const varName = m[1];
		if (!varName) continue;
		/** @type {Set<string>} */
		const bucket = aliases.get(varName) ?? new Set();
		for (const em of (m[2] ?? '').matchAll(/process\.env\.([A-Z][A-Z0-9_]+)/g)) {
			const env = em[1];
			if (env) bucket.add(env);
		}
		if (bucket.size === 0) continue;
		aliases.set(varName, bucket);
	}

	const negationGuardRe = /if\s*\(\s*!\s*(?:process\.env\.)?([A-Za-z_$][\w$]*)/;
	const failFastRe = /process\.exit\s*\(\s*[1-9]|throw\s+|exitCode\s*=\s*[1-9]/;

	for (let i = 0; i < lines.length; i++) {
		const guard = (lines[i] ?? '').match(negationGuardRe);
		if (!guard) continue;

		const name = guard[1] ?? '';
		const envs = aliases.get(name) ?? (/^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+$/.test(name) ? [name] : []);
		if ([...envs].length === 0) continue;

		const window = lines.slice(i, i + 11).join('\n');
		if (!failFastRe.test(window)) continue;

		for (const env of envs) found.add(env);
	}

	return found;
}

/**
 * optional → required への「変化」を検出する (#4129 AC5 Pattern F)。
 *
 * 追加行だけを見ていると「その env が以前は optional だった」ことが分からない。削除行に
 * optional の目印があり、追加行では目印が消えたまま env が使われ続けているなら、その PR は
 * **既存 env を必須化している**。
 *
 * optional の目印 (削除行側):
 *   - `process.env.X || 'default'` / `?? 'default'` — 既定値 fallback
 *   - `X: z.string().optional()` — schema の optional
 *   - `...(x ? { X: x } : {})` — CDK silent skip (ADR-0024 ルール 1 で禁止された形)
 *
 * false positive 抑止:
 *   - 追加行に同じ目印が残っていれば「整形しただけ」なので検出しない
 *   - 追加行に env の言及が無ければ「参照ごと消えた」なので検出しない
 *
 * @param {{ addedLines: string[]; removedLines: string[] }} input
 * @returns {Map<string, string>} env 名 → 検出理由 (BLOCK メッセージ用)
 */
export function detectRequirementTransitions({ addedLines, removedLines }) {
	const transitions = new Map();

	const wasOptional = collectOptionalMarkedEnvs(removedLines ?? []);
	const stillOptional = collectOptionalMarkedEnvs(addedLines ?? []);
	const mentioned = collectMentionedEnvs(addedLines ?? []);

	for (const [env, reason] of wasOptional) {
		if (FRAMEWORK_ENVS.has(env)) continue;
		if (stillOptional.has(env)) continue; // optional のまま = 変化なし
		if (!mentioned.has(env)) continue; // 参照ごと消えた = 必須化ではない
		transitions.set(env, reason);
	}

	return transitions;
}

/**
 * 行群から「optional の目印付き env」を集める。
 *
 * @param {string[]} lines
 * @returns {Map<string, string>} env 名 → どの目印で optional と判断したか
 */
function collectOptionalMarkedEnvs(lines) {
	const found = new Map();
	for (const line of lines) {
		// a) 既定値 fallback: process.env.X || ... / ?? ...
		for (const m of line.matchAll(/process\.env\.([A-Z][A-Z0-9_]+)\s*(?:\|\||\?\?)/g)) {
			found.set(m[1], 'optional の目印だった既定値 fallback (`|| ...` / `?? ...`) が消えている');
		}
		// b) schema の .optional()
		if (/\.optional\s*\(\s*\)/.test(line)) {
			for (const m of line.matchAll(/\b([A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+)\b/g)) {
				found.set(m[1], 'schema の `.optional()` が外れている');
			}
		}
		// c) CDK silent skip: ...(x ? { X: x } : {})
		for (const m of line.matchAll(/\.\.\.\([^)]*\?\s*\{\s*([A-Z][A-Z0-9_]+)\s*:/g)) {
			found.set(m[1], 'CDK の silent skip (`...(x ? { X: x } : {})`) が外れている');
		}
	}
	return found;
}

/**
 * 行群で env が「まだ使われている」ことを示す言及を集める。
 *
 * `process.env.X` の直参照と、`X:` の object / schema キーの 2 形を見る。
 * コメント中の単なる env 名の出現は言及とみなさない (誤検出を増やすため)。
 *
 * @param {string[]} lines
 * @returns {Set<string>}
 */
function collectMentionedEnvs(lines) {
	const found = new Set();
	for (const line of lines) {
		for (const m of line.matchAll(/process\.env\.([A-Z][A-Z0-9_]+)/g)) found.add(m[1]);
		for (const m of line.matchAll(/\b([A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+)\b\s*:/g)) found.add(m[1]);
	}
	return found;
}

/**
 * PR 本文の解除宣言を読む (#4129 AC5、理由必須 — #3956 教訓)。
 *
 *   <!-- env-not-newly-required: <ENV_NAME> <12 文字以上の理由> -->
 *
 * 理由が空 / 定型 stub の宣言は `valid: false` として受理しない。判定は
 * `scripts/lib/ci/reason-declaration.mjs` (SSOT) に委譲する。
 *
 * @param {string | null | undefined} prBody
 * @returns {Map<string, { present: boolean; reason: string; valid: boolean }>}
 */
export function parseNotNewlyRequiredExemptions(prBody) {
	const map = new Map();
	for (const m of (prBody ?? '').matchAll(/<!--\s*env-not-newly-required\s*:([^>]*?)-->/g)) {
		const raw = (m[1] ?? '').trim();
		const parsed = raw.match(/^([A-Z][A-Z0-9_]*)\s*[-—:]?\s*([\s\S]*)$/);
		if (!parsed) continue;
		const reason = (parsed[2] ?? '').trim();
		map.set(parsed[1], { present: true, reason, valid: isSubstantiveReason(reason) });
	}
	return map;
}

/**
 * 配布済み証跡が PR 本文に書かれているか検証する。
 * 書式: 「配布済み: ENV_NAME」 もしくは英語 "Distributed: ENV_NAME"
 * 配布先 (GitHub Secrets / SSM / NUC .env) は ADR-0029 上必須だが、
 * このスクリプトは env 名の証跡有無のみを検証する (配布先文言は人間レビュー)。
 */
/**
 * @param {string} envName
 * @param {string | null | undefined} prBody
 * @returns {boolean}
 */
function hasDistributionEvidence(envName, prBody) {
	if (!prBody) return false;
	const re = new RegExp(`(?:配布済み|Distributed)\\s*[::]\\s*[^\\n]*\\b${envName}\\b`, 'i');
	return re.test(prBody);
}

function main() {
	const diff = getDiff();
	if (!diff) {
		console.log('[check-new-required-env] empty diff — skipping');
		process.exit(0);
	}

	const { addedLines, removedLines } = extractDiffLines(diff);
	const newEnvs = detectNewRequiredEnvs(addedLines);
	const transitions = detectRequirementTransitions({ addedLines, removedLines });

	/** @type {Map<string, string>} env 名 → 検出理由 */
	const detected = new Map();
	for (const env of newEnvs) detected.set(env, 'この PR で必須 (hard requirement) になっている');
	for (const [env, reason] of transitions) detected.set(env, reason);

	if (detected.size === 0) {
		console.log('[check-new-required-env] no newly required env / secret detected — OK');
		process.exit(0);
	}

	console.log(
		`[check-new-required-env] detected newly required env(s): ${[...detected.keys()].join(', ')}`,
	);

	if (!PR_BODY) {
		console.log(
			'[check-new-required-env] PR_BODY is empty — running locally, skipping evidence check',
		);
		console.log('  (CI will enforce this with `PR_BODY="$(gh pr view ... -q .body)"`)');
		process.exit(0);
	}

	const exemptions = parseNotNewlyRequiredExemptions(PR_BODY);

	/** @type {string[]} 証跡も有効な解除宣言も無い env */
	const missing = [];
	/** @type {string[]} 解除宣言はあるが理由が空 / 定型 stub の env */
	const badReason = [];

	for (const env of detected.keys()) {
		if (hasDistributionEvidence(env, PR_BODY)) continue;
		const exemption = exemptions.get(env);
		if (exemption?.valid) {
			console.log(`[check-new-required-env] ${env}: 解除宣言を受理 — ${exemption.reason}`);
			continue;
		}
		if (exemption?.present) badReason.push(env);
		else missing.push(env);
	}

	if (missing.length > 0 || badReason.length > 0) {
		console.error('');
		console.error('BLOCKED by ADR-0024 — 必須化された env に配布証跡がありません:');
		for (const env of missing) {
			console.error(`  - ${env}: ${detected.get(env)}`);
		}
		for (const env of badReason) {
			console.error(
				`  - ${env}: 解除宣言はありますが理由が空 / 定型 stub のため受理できません (理由必須、#3956 教訓)`,
			);
		}
		console.error('');
		console.error('PR 本文に次のいずれかを記載してください:');
		console.error('');
		const firstMissing = missing[0] ?? badReason[0];
		if (firstMissing) {
			console.error('  (a) 配布済み証跡 — 実際に配布したうえで書く');
			console.error('      ## 配布済み env / secret (ADR-0024)');
			console.error(
				`      - 配布済み: ${firstMissing} → GitHub Actions Secrets (deploy.yml, deploy-nuc.yml)`,
			);
			console.error(
				`      - 配布済み: ${firstMissing} → SSM Parameter Store /ganbari-quest/prod/${firstMissing.toLowerCase()}`,
			);
			console.error(`      - 配布済み: ${firstMissing} → NUC .env (本機 + バックアップ機)`);
			console.error('');
			console.error('  (b) 検出が誤りの場合のみ — 理由付きで解除する');
			console.error(
				`      <!-- env-not-newly-required: ${firstMissing} <${MIN_REASON_LENGTH} 文字以上の理由> -->`,
			);
		}
		console.error('');
		console.error('See: docs/decisions/0024-infra-pr-required-baseline.md (ルール 5)');
		process.exit(1);
	}

	console.log(
		`[check-new-required-env] all detected env(s) have distribution evidence — OK (${[...detected.keys()].join(', ')})`,
	);
	process.exit(0);
}

// CLI 起動時のみ main を呼ぶ。`import { detectNewRequiredEnvs }` 経由のテスト時は呼ばない。
// (#2337 / Issue #2337 AC: regex unit test 追加のため export 化、CLI 互換性維持)
const isDirectInvocation = isMainModule(import.meta.url);
if (isDirectInvocation) {
	main();
}
