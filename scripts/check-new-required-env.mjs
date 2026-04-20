#!/usr/bin/env node
/**
 * #914 / ADR-0029 — 新規必須 env / secret 追加チェック
 *
 * PR diff から「production で必須となる新しい env / secret」を追加した行を検出し、
 * PR 本文に **「配布済み:」証跡** が無ければ exit 1 で CI を red にする。
 *
 * 検出パターン (追加行 = `+` で始まる行のみ):
 *   1. 関数名 `assert*Configured()`         例: assertLicenseKeyConfigured()
 *   2. `throw new Error('...required...')`   "required" を含むエラー文字列
 *   3. `process.env.X || (() => { throw ... })()` 同等パターン
 *
 * 抽出された env 名 (大文字スネークケース) について PR 本文に
 * 「配布済み: <ENV_NAME>」 が含まれているか検証する。
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
 *   0 = 新規必須 env なし、または全て配布済み証跡あり
 *   1 = 新規必須 env が検出され、PR 本文に証跡が無い (CI を red にする)
 *   2 = git コマンド失敗等の internal error
 */

import { execFileSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';

const BASE_REF = process.env.BASE_REF || 'origin/main';
const PR_BODY = process.env.PR_BODY || '';

// CLI args
for (const arg of process.argv.slice(2)) {
	if (arg.startsWith('--base=')) {
		process.env.BASE_REF = arg.slice('--base='.length);
	}
}
const baseRef = process.env.BASE_REF || BASE_REF;

/**
 * Get git diff vs base ref. Returns the unified diff as a string.
 *
 * CI モード (PR_BODY あり): `git diff <base>...HEAD` でコミット済みのみ比較
 * ローカルモード (PR_BODY なし): `git diff <base>` で staged + working tree を比較。
 *   `git diff` は untracked file を含まないため、`git status --porcelain` で
 *   untracked を検出して `git diff --no-index /dev/null <path>` で追加行として合成する。
 *   これによりローカルでも `git add` 前の新規 guard ファイルを取りこぼさない。
 *
 * Fail-closed (ADR-0029): CI モードで git diff が失敗した場合は exit 2。
 * ローカルモードでは warn + 空文字列を返す (ローカル開発の利便性のため)。
 */
function getDiff() {
	const range = PR_BODY ? `${baseRef}...HEAD` : baseRef;
	let diff;
	try {
		// 新規ファイル (staged) 含む全 diff (--no-renames で確実に追加行として検出)
		// execFileSync で arg-array 渡し → shell metachar 注入リスクを排除
		diff = execFileSync('git', ['diff', '--no-renames', range], {
			encoding: 'utf-8',
			maxBuffer: 50 * 1024 * 1024,
		});
	} catch (err) {
		const msg = `[check-new-required-env] could not git diff against ${range}: ${err.message}`;
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
		return '';
	}

	// ローカルモードのみ untracked を補完 (CI モードはコミット済みしか見ない)
	if (!PR_BODY) {
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
				// untracked ファイル内容を読み込み、unified diff フォーマットを合成する。
				// `git diff --no-index /dev/null <path>` は Windows (NUL) との互換性が
				// 不安定なため、git に頼らず純粋にファイル内容から組み立てる。
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
					diff += header + body + '\n';
				} catch (e) {
					console.warn(`[check-new-required-env] could not read untracked ${path}: ${e.message}`);
				}
			}
		} catch (e) {
			console.warn(`[check-new-required-env] could not enumerate untracked files: ${e.message}`);
		}
	}

	return diff;
}

/**
 * 検査対象外のファイルパス (docs / .md / 自身 / テスト / lock files)
 * 文字列内の env 名による誤検知を避けるため、コードファイルのみを対象とする。
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
 * Extract added lines (those starting with `+` but not `+++`) from a unified diff.
 * docs/ や *.md などのファイル変更ブロックはスキップする。
 */
function extractAddedLines(diff) {
	const lines = [];
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
		if (raw.startsWith('+++')) continue;
		if (raw.startsWith('+')) lines.push(raw.slice(1));
	}
	return lines;
}

/**
 * Detect new required env names from added lines.
 *
 * Heuristics:
 *   - Pattern A: `assertXxxConfigured()` 関数定義/呼び出し
 *     関数名から推測した env 名 (XXX_CONFIGURED → XXX) と、近傍行で参照される
 *     `process.env.<ENV>` を抽出する。
 *   - Pattern B: `throw new Error('... <ENV> is required ...')` 形式の文字列内 env 名
 *   - Pattern C: `process.env.<ENV> || (() => { throw ... })()` 形式
 *
 * 戻り値: env 名 (大文字スネーク) の Set
 */
function detectNewRequiredEnvs(addedLines) {
	const found = new Set();

	const assertFnRe = /assert([A-Z]\w*?)Configured\s*\(/;
	const processEnvThrowRe =
		/process\.env\.([A-Z][A-Z0-9_]+)\s*\|\|\s*\(?\s*\(\s*\)\s*=>\s*\{[^}]*throw/;
	// 「FOO_BAR is required」「FOO_BAR is not set」「FOO_BAR must be set」等
	// 案件の env 名は ALL_CAPS_SNAKE_CASE のみを対象 (camelCase の JSON フィールド名は除外)
	// アンダースコアを 1 つ以上含むものを必須にして "PORT" 等の単語を弾く
	const envInStringRe =
		/\b([A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+)\b\s+(?:is\s+(?:not\s+set|required|missing|undefined)|must\s+be\s+set)/;

	// 全追加行を結合して走査することで、複数行に渡る `throw new Error(...)` も拾う
	const fullText = addedLines.join('\n');

	// Pattern B (multi-line): throw new Error(...'FOO is required'...)
	const throwBlockRe = /throw\s+new\s+Error\s*\(\s*([\s\S]*?)\)/g;
	for (const m of fullText.matchAll(throwBlockRe)) {
		const errorBody = m[1];
		// 同一エラーボディ内に複数 env 名が含まれる可能性があるので global で探す
		for (const em of errorBody.matchAll(new RegExp(envInStringRe.source, 'g'))) {
			found.add(em[1]);
		}
	}

	// 行単位で処理する Pattern A / C
	for (let i = 0; i < addedLines.length; i++) {
		const line = addedLines[i];

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
	const exclude = new Set([
		'NODE_ENV',
		'PORT',
		'HOST',
		'CI',
		'PWD',
		'PATH',
		'VITE_DEV',
		'PUBLIC_BASE_URL',
	]);
	for (const e of exclude) found.delete(e);

	return found;
}

/**
 * 配布済み証跡が PR 本文に書かれているか検証する。
 * 書式: 「配布済み: ENV_NAME」 もしくは英語 "Distributed: ENV_NAME"
 * 配布先 (GitHub Secrets / SSM / NUC .env) は ADR-0029 上必須だが、
 * このスクリプトは env 名の証跡有無のみを検証する (配布先文言は人間レビュー)。
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

	const addedLines = extractAddedLines(diff);
	const newEnvs = detectNewRequiredEnvs(addedLines);

	if (newEnvs.size === 0) {
		console.log('[check-new-required-env] no new required env / secret detected — OK');
		process.exit(0);
	}

	console.log(`[check-new-required-env] detected new required env(s): ${[...newEnvs].join(', ')}`);

	if (!PR_BODY) {
		console.log(
			'[check-new-required-env] PR_BODY is empty — running locally, skipping evidence check',
		);
		console.log('  (CI will enforce this with `PR_BODY="$(gh pr view ... -q .body)"`)');
		process.exit(0);
	}

	const missing = [];
	for (const env of newEnvs) {
		if (!hasDistributionEvidence(env, PR_BODY)) {
			missing.push(env);
		}
	}

	if (missing.length > 0) {
		console.error('');
		console.error('BLOCKED by ADR-0029 — new required env(s) without distribution evidence:');
		for (const env of missing) {
			console.error(`  - ${env}`);
		}
		console.error('');
		console.error('PR 本文に次の形式で配布済み証跡を記載してください:');
		console.error('');
		console.error('  ## 配布済み env / secret (ADR-0029)');
		console.error(
			`  - 配布済み: ${missing[0]} → GitHub Actions Secrets (deploy.yml, deploy-nuc.yml)`,
		);
		console.error(
			`  - 配布済み: ${missing[0]} → SSM Parameter Store /ganbari-quest/prod/${missing[0].toLowerCase()}`,
		);
		console.error(`  - 配布済み: ${missing[0]} → NUC .env (本機 + バックアップ機)`);
		console.error('');
		console.error('See: docs/decisions/0006-safety-assertion-erosion-ban.md');
		process.exit(1);
	}

	console.log(
		`[check-new-required-env] all detected env(s) have distribution evidence — OK (${[...newEnvs].join(', ')})`,
	);
	process.exit(0);
}

main();
