#!/usr/bin/env node
/**
 * scripts/check-pr-screenshot.mjs
 *
 * #1740 + #1741: PR スクリーンショット添付の品質ゲート。
 *
 * 1. **ローカルパス禁止検証 (#1741)**
 *    PR body 内の `tmp/screenshots/...` / `.tmp-screenshots/...` 等のローカル相対パス参照を検知して fail。
 *    GitHub web 上で表示できない URL を使うと QM 代替撮影が必要になる事故を防ぐ
 *    (PR #1691 で観察された運用問題の構造対策)。
 *
 * 2. **修正前 / 修正後ラベル検証 (#1740)**
 *    PR body の Markdown 画像 (`![alt](url)`) または HTML img の alt / surrounding text に
 *    「修正前 / Before / before-...」「修正後 / After / after-...」のいずれもが含まれているかを検証。
 *    両方が揃わない場合、警告 / 失敗 (mode により切替)。
 *
 * 3. **スキップ判定**
 *    docs only / refactor 系の PR (UI 関連ファイルを含まない) は両検証ともスキップ。
 *    ファイルパターンは scripts/check-pr-screenshot.mjs::isUiPr() 参照。
 *
 * 4. **段階適用フラグ (#1740 — 「最初は警告のみで開始 → 1-2 週間 dogfooding → エラー化」要件)**
 *    env `SCREENSHOT_CHECK_MODE` で動作切替:
 *    - `warn` (default): すべての違反を warning として記録、exit 0
 *    - `error`: 違反があれば exit 1 (CI を red にする)
 *
 *    ローカルパス禁止 (#1741) は警告でもログとして表示される。CI ジョブ側で
 *    `SCREENSHOT_CHECK_MODE: warn` で warming 期間を運用し、定着後に `error` に昇格する設計。
 *
 * 想定実行環境: GitHub Actions の pull_request トリガ
 *   env:
 *     PR_BODY:   ${{ github.event.pull_request.body }}
 *     PR_FILES:  改行区切りの変更ファイル一覧（gh pr view --json files で取得）
 *     SCREENSHOT_CHECK_MODE: 'warn' (default) | 'error'
 *
 * ローカル実行例:
 *   PR_BODY="$(gh pr view 1740 --json body --jq .body)" \
 *   PR_FILES="$(gh pr view 1740 --json files --jq '.files[].path' | tr '\n' '\n')" \
 *     node scripts/check-pr-screenshot.mjs
 *
 * exit:
 *   0 = OK, または warn モードで違反あり
 *   1 = error モードで違反あり
 *   2 = internal error
 */

const MODE = (process.env.SCREENSHOT_CHECK_MODE || 'warn').toLowerCase();
const PR_BODY = process.env.PR_BODY || '';
const PR_FILES = (process.env.PR_FILES || '')
	.split('\n')
	.map((s) => s.trim())
	.filter(Boolean);

// ---------------------------------------------------------------------------
// 検証関数（pure functions, named exports for unit testing）
// ---------------------------------------------------------------------------

const UI_FILE_PATTERN = /\.(svelte|svelte\.ts|svelte\.js|css|scss)$|^site\//;

/**
 * 変更ファイル一覧から UI 関連ファイルが含まれるかを判定。
 * 含まれない場合 SS は不要（docs only / refactor / chore のみの PR）。
 *
 * @param {string[]} files
 * @returns {boolean}
 */
export function isUiPr(files) {
	return files.some((f) => UI_FILE_PATTERN.test(f));
}

const LOCAL_PATH_PATTERNS = [
	// Markdown image: ![alt](tmp/...) / ![alt](.tmp-screenshots/...)
	/!\[[^\]]*\]\((?:\.\/)?(?:tmp|\.tmp-screenshots)\/[^)]+\)/g,
	// HTML img: <img src="tmp/..."> / <img src=".tmp-screenshots/...">
	/<img[^>]+src=["'](?:\.\/)?(?:tmp|\.tmp-screenshots)\/[^"']+["'][^>]*>/g,
];

/**
 * PR body 内のローカル相対パス参照（tmp/ / .tmp-screenshots/）を検出する。
 *
 * @param {string} body
 * @returns {string[]} 検出された違反箇所の文字列配列
 */
export function detectLocalPaths(body) {
	const violations = [];
	for (const pattern of LOCAL_PATH_PATTERNS) {
		const matches = body.matchAll(pattern);
		for (const m of matches) {
			violations.push(m[0]);
		}
	}
	return violations;
}

const BEFORE_LABEL_PATTERN =
	/!\[[^\]]*(?:修正前|before)[^\]]*\]|<img[^>]*alt=["'][^"']*(?:修正前|before)[^"']*["']/i;
const AFTER_LABEL_PATTERN =
	/!\[[^\]]*(?:修正後|after)[^\]]*\]|<img[^>]*alt=["'][^"']*(?:修正後|after)[^"']*["']/i;

/**
 * PR body から「修正前」「修正後」両方のラベル付き画像参照が見つかるかを判定。
 *
 * 検出パターン:
 * - ![before-mobile](url) / ![Before: ...](url) / ![修正前](url)
 * - <img alt="after-pc" .../> / <img alt="修正後" .../>
 *
 * @param {string} body
 * @returns {{ hasBefore: boolean, hasAfter: boolean }}
 */
export function detectBeforeAfterLabels(body) {
	return {
		hasBefore: BEFORE_LABEL_PATTERN.test(body),
		hasAfter: AFTER_LABEL_PATTERN.test(body),
	};
}

/**
 * 「該当なし」明示記述の検出。refactor / docs / chore のみで UI 影響がない PR の opt-out 用。
 *
 * @param {string} body
 * @returns {boolean}
 */
export function hasUiNotApplicableMarker(body) {
	return /該当なし\s*[（(](?:refactor|docs|chore)/i.test(body) || /UI\s*変更\s*なし/i.test(body);
}

// ---------------------------------------------------------------------------
// メイン処理
// ---------------------------------------------------------------------------

function main() {
	const violations = [];

	// 検証 1: ローカルパス禁止 (#1741) — UI PR でなくても貼ったらアウト
	const localPaths = detectLocalPaths(PR_BODY);
	if (localPaths.length > 0) {
		violations.push({
			id: 'local-path-forbidden',
			issue: '#1741',
			message:
				`PR body にローカル相対パス参照が ${localPaths.length} 件検出されました。GitHub Web 上で表示できる URL に置き換えてください。\n` +
				`検出箇所:\n${localPaths
					.slice(0, 5)
					.map((s) => `  - ${s}`)
					.join('\n')}\n` +
				`\n対応方法:\n` +
				`  - user-attachments URL: PR 本文編集画面に画像をドラッグ&ドロップ\n` +
				`  - screenshots branch raw URL: docs/troubleshoot/screenshot_capture.md SC-007 参照\n` +
				`  - docs/screenshots/ にコミット後、GitHub raw URL を貼付（SC-008 参照）`,
		});
	}

	// UI PR かどうかで以降の検証をゲート
	const isUi = isUiPr(PR_FILES);
	const optOut = hasUiNotApplicableMarker(PR_BODY);

	if (!isUi || optOut) {
		console.log(
			`[screenshot-check] UI 関連ファイル変更なし${optOut ? '（または「該当なし」明示）' : ''} — before/after 検証をスキップ`,
		);
	} else {
		// 検証 2: before/after ラベル検証 (#1740)
		const { hasBefore, hasAfter } = detectBeforeAfterLabels(PR_BODY);
		if (!hasBefore || !hasAfter) {
			const missing = [];
			if (!hasBefore) missing.push('「修正前 / Before / before-...」ラベル付き画像');
			if (!hasAfter) missing.push('「修正後 / After / after-...」ラベル付き画像');
			violations.push({
				id: 'before-after-missing',
				issue: '#1740',
				message:
					`PR body に ${missing.join(' および ')} が見つかりません。\n` +
					`PR template の「4 スロット添付」セクション（修正前 / 修正後 × モバイル / PC）を参考に、\n` +
					`![before-mobile](URL) / ![after-mobile](URL) / ![before-pc](URL) / ![after-pc](URL) の形式で添付してください。\n` +
					`UI 変更を含まない PR の場合は「該当なし（refactor / docs / chore）」と明記してください。`,
			});
		}
	}

	// 結果出力
	if (violations.length === 0) {
		console.log('[screenshot-check] OK — 違反なし');
		return 0;
	}

	const isError = MODE === 'error';
	const prefix = isError ? '[screenshot-check] ERROR' : '[screenshot-check] WARN';

	for (const v of violations) {
		console.log(`\n${prefix} (${v.id}, ${v.issue}):`);
		console.log(v.message);
	}

	console.log(
		`\n[screenshot-check] mode=${MODE}, violations=${violations.length} ` +
			`(${isError ? 'CI を red にします' : '段階適用中: warning として記録、CI は通過させます (#1740 段階適用フラグ)'})`,
	);

	return isError ? 1 : 0;
}

import { resolve as pathResolve } from 'node:path';
// CLI 実行時のみ main を呼ぶ（テスト import 時は呼ばない）
// Windows では import.meta.url が file:///C:/... 形式、process.argv[1] が C:\... 形式になるため
// fileURLToPath で双方を絶対パスに正規化して比較する
import { fileURLToPath } from 'node:url';

const isMain = (() => {
	try {
		return pathResolve(fileURLToPath(import.meta.url)) === pathResolve(process.argv[1] || '');
	} catch {
		return false;
	}
})();

if (isMain) {
	try {
		process.exit(main());
	} catch (err) {
		console.error('[screenshot-check] internal error:', err);
		process.exit(2);
	}
}
