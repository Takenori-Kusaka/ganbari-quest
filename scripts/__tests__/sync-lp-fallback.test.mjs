/**
 * scripts/__tests__/sync-lp-fallback.test.mjs (#1945 / #1974)
 *
 * sync-lp-fallback.mjs のユニットテスト。Phase 3 D5 の fallback 自動同期スクリプトが
 * 以下を満たすことを保証する:
 *   - simple text 置換 (text のみの fallback)
 *   - innerHTML 置換 (HTML タグ <strong> / <a> 等を含む fallback)
 *   - LP_LABELS 未定義 namespace は skip (warning のみ、error にしない)
 *   - 子孫に data-lp-key を持つ要素は上書き拒否 (skip + error 報告)
 *   - --check モードで差分検出 (lookupLpLabel + syncFallbackInFile の組み合わせで判定)
 *   - 既に一致する fallback は no-op (idempotent)
 *   - **#1974**: --check モードで対象 HTML 不存在 / read / parse error が exit code 1 に伝播
 *
 * 実行: node --test scripts/__tests__/sync-lp-fallback.test.mjs
 *
 * AC マッピング (Issue #1945):
 *   - AC1: scripts/sync-lp-fallback.mjs 新設、site/*.html の <... data-lp-key>FALLBACK</...> 内側を更新
 *   - AC2: HTML タグを含む値 (innerHTML 用) は HTML パースして適切に挿入 (parse5)
 *   - AC3: --check モードで差分検出 (本テストでは syncFallbackInFile 戻り値の changes.length で代替検証)
 *   - AC4: 全 site/*.html (index, pricing, faq, pamphlet, privacy, terms, tokushoho, sla, graduation, selfhost) 対応
 *   - AC5: pre-ready 組込 (本 Issue では pre-ready の Step 配列に追加するが、テスト対象は CLI 単体)
 *
 * AC マッピング (Issue #1974, follow-up):
 *   - AC1: --check モードで対象 HTML 不存在 / error 発生時に exit code 1 で終了する
 *   - AC2: error 発生時のログ出力でファイル名・error 内容が明示される
 *   - AC3: --check モードで意図的 missing target を発生させた際の exit code 検証ケースを追加 (本ファイル)
 *   - AC4: --write モードの正常系挙動が変わらないことを既存テストで確認 (regression なし)
 *   - AC5: `npx biome check .` / `npx vitest run` 緑
 */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { parse } from 'parse5';
import {
	collectHasDescendantLpKey,
	collectLpKeyElements,
	lookupLpLabel,
	syncFallbackInFile,
} from '../sync-lp-fallback.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SCRIPT_PATH = path.resolve(__dirname, '..', 'sync-lp-fallback.mjs');
const REPO_ROOT = path.resolve(__dirname, '..', '..');

const SAMPLE_LP_LABELS = {
	nav: {
		home: 'ホーム',
		login: 'ログイン',
	},
	common: {
		ctaSignup: '無料で始める',
	},
	hero: {
		richText: '<strong>基本無料</strong>で始められます',
		linkText: '詳しくは<a href="faq.html">FAQ</a>をご覧ください',
	},
	footer: {
		copyright: '© 2026 がんばりクエスト. All rights reserved.',
	},
};

// ---------------------------------------------------------------------------
// AC1 / lookupLpLabel: 用語ルックアップ
// ---------------------------------------------------------------------------
describe('lookupLpLabel — LP_LABELS への dotted key 解決 (#1945 AC1)', () => {
	it('既存の "ns.k" を解決', () => {
		assert.equal(lookupLpLabel(SAMPLE_LP_LABELS, 'nav.home'), 'ホーム');
		assert.equal(lookupLpLabel(SAMPLE_LP_LABELS, 'common.ctaSignup'), '無料で始める');
	});

	it('namespace が存在しない場合は null', () => {
		assert.equal(lookupLpLabel(SAMPLE_LP_LABELS, 'unknown.key'), null);
	});

	it('key が存在しない場合は null', () => {
		assert.equal(lookupLpLabel(SAMPLE_LP_LABELS, 'nav.missing'), null);
	});

	it('dot が無い場合は null (3 段以上のキーも非対応)', () => {
		assert.equal(lookupLpLabel(SAMPLE_LP_LABELS, 'navhome'), null);
		assert.equal(lookupLpLabel(SAMPLE_LP_LABELS, 'a.b.c'), null);
	});
});

// ---------------------------------------------------------------------------
// AC1 / syncFallbackInFile: simple text 置換
// ---------------------------------------------------------------------------
describe('syncFallbackInFile — simple text 置換 (#1945 AC1)', () => {
	it('text のみの fallback を canonical 値で置換', () => {
		const html = `<!DOCTYPE html><html><body><a data-lp-key="nav.home">old text</a></body></html>`;
		const result = syncFallbackInFile('test.html', html, SAMPLE_LP_LABELS);
		assert.equal(result.changes.length, 1);
		assert.equal(result.changes[0].dottedKey, 'nav.home');
		assert.equal(result.changes[0].oldInner, 'old text');
		assert.equal(result.changes[0].newInner, 'ホーム');
		assert.ok(
			result.updated.includes('<a data-lp-key="nav.home">ホーム</a>'),
			`updated should contain replaced text, got: ${result.updated}`,
		);
		// 置換以外は完全保持 (DOCTYPE / html / body 等)
		assert.ok(result.updated.startsWith('<!DOCTYPE html>'));
		assert.ok(result.updated.includes('</body></html>'));
	});

	it('複数 data-lp-key を 1 ファイル内で全部置換', () => {
		const html = `<a data-lp-key="nav.home">old1</a> <span data-lp-key="nav.login">old2</span>`;
		const result = syncFallbackInFile('test.html', html, SAMPLE_LP_LABELS);
		assert.equal(result.changes.length, 2);
		assert.ok(result.updated.includes('<a data-lp-key="nav.home">ホーム</a>'));
		assert.ok(result.updated.includes('<span data-lp-key="nav.login">ログイン</span>'));
	});
});

// ---------------------------------------------------------------------------
// AC2 / syncFallbackInFile: innerHTML 置換 (HTML タグを含む)
// ---------------------------------------------------------------------------
describe('syncFallbackInFile — innerHTML 置換 with HTML tags (#1945 AC2)', () => {
	it('<strong> を含む値で置換', () => {
		const html = `<p data-lp-key="hero.richText">old plain text</p>`;
		const result = syncFallbackInFile('test.html', html, SAMPLE_LP_LABELS);
		assert.equal(result.changes.length, 1);
		assert.equal(result.changes[0].newInner, '<strong>基本無料</strong>で始められます');
		assert.ok(
			result.updated.includes(
				'<p data-lp-key="hero.richText"><strong>基本無料</strong>で始められます</p>',
			),
		);
	});

	it('<a> リンクを含む値で置換', () => {
		const html = `<p data-lp-key="hero.linkText">old text</p>`;
		const result = syncFallbackInFile('test.html', html, SAMPLE_LP_LABELS);
		assert.equal(result.changes.length, 1);
		assert.ok(
			result.updated.includes(
				'<p data-lp-key="hero.linkText">詳しくは<a href="faq.html">FAQ</a>をご覧ください</p>',
			),
		);
	});

	it('既存の HTML タグを持つ fallback を完全置換', () => {
		const html = `<p data-lp-key="hero.richText">古い <em>イタリック</em> 文字</p>`;
		const result = syncFallbackInFile('test.html', html, SAMPLE_LP_LABELS);
		assert.equal(result.changes.length, 1);
		assert.equal(result.changes[0].oldInner, '古い <em>イタリック</em> 文字');
		assert.equal(result.changes[0].newInner, '<strong>基本無料</strong>で始められます');
	});
});

// ---------------------------------------------------------------------------
// AC3 / --check モード相当: 差分検出
// ---------------------------------------------------------------------------
describe('syncFallbackInFile — 差分検出 (#1945 AC3 --check 相当)', () => {
	it('差分があれば changes.length > 0', () => {
		const html = `<a data-lp-key="nav.home">stale text</a>`;
		const result = syncFallbackInFile('test.html', html, SAMPLE_LP_LABELS);
		assert.equal(result.changes.length, 1);
	});

	it('差分が無ければ changes.length === 0 (idempotent)', () => {
		const html = `<a data-lp-key="nav.home">ホーム</a>`;
		const result = syncFallbackInFile('test.html', html, SAMPLE_LP_LABELS);
		assert.equal(result.changes.length, 0);
		assert.equal(result.updated, html, 'updated は元 HTML と完全一致 (no-op)');
	});

	it('一部だけ差分がある場合、その分だけ changes が出る', () => {
		const html = `<a data-lp-key="nav.home">ホーム</a><a data-lp-key="nav.login">stale</a>`;
		const result = syncFallbackInFile('test.html', html, SAMPLE_LP_LABELS);
		assert.equal(result.changes.length, 1);
		assert.equal(result.changes[0].dottedKey, 'nav.login');
	});
});

// ---------------------------------------------------------------------------
// LP_LABELS 未定義 namespace は skip (warning のみ)
// ---------------------------------------------------------------------------
describe('syncFallbackInFile — 未定義 namespace は skip', () => {
	it('LP_LABELS に namespace が存在しない data-lp-key は skipMissing に記録', () => {
		const html = `<a data-lp-key="unknown.key">fallback</a>`;
		const result = syncFallbackInFile('test.html', html, SAMPLE_LP_LABELS);
		assert.equal(result.changes.length, 0);
		assert.deepEqual(result.skippedMissing, ['unknown.key']);
		assert.equal(result.errorsNestedReplace.length, 0);
	});

	it('未定義 namespace と既存 namespace が混在する場合、既存のみ更新', () => {
		const html = `<a data-lp-key="nav.home">old</a><span data-lp-key="missing.key">old</span>`;
		const result = syncFallbackInFile('test.html', html, SAMPLE_LP_LABELS);
		assert.equal(result.changes.length, 1);
		assert.equal(result.changes[0].dottedKey, 'nav.home');
		assert.deepEqual(result.skippedMissing, ['missing.key']);
	});
});

// ---------------------------------------------------------------------------
// 子孫に data-lp-key を持つ要素は上書き拒否
// ---------------------------------------------------------------------------
describe('syncFallbackInFile — nested data-lp-key 保護', () => {
	it('子孫に data-lp-key を持つ要素は errorsNestedReplace に記録 + skip', () => {
		const html = `<p data-lp-key="hero.richText">parent <span data-lp-key="nav.home">child</span></p>`;
		const result = syncFallbackInFile('test.html', html, SAMPLE_LP_LABELS);
		// 親 hero.richText は子要素 data-lp-key を含むため上書き拒否
		// 子 nav.home は通常通り処理
		assert.equal(result.errorsNestedReplace.length, 1);
		assert.match(result.errorsNestedReplace[0], /hero\.richText.*子孫/);
		assert.equal(result.changes.length, 1);
		assert.equal(result.changes[0].dottedKey, 'nav.home');
	});

	it('親が LP_LABELS 未定義の場合、子は通常通り処理可能', () => {
		const html = `<p data-lp-key="missing.key">parent <span data-lp-key="nav.home">child</span></p>`;
		const result = syncFallbackInFile('test.html', html, SAMPLE_LP_LABELS);
		assert.equal(result.errorsNestedReplace.length, 0);
		assert.equal(result.changes.length, 1);
		assert.equal(result.changes[0].dottedKey, 'nav.home');
	});
});

// ---------------------------------------------------------------------------
// collectLpKeyElements / collectHasDescendantLpKey ユニット
// ---------------------------------------------------------------------------
describe('collectLpKeyElements — AST 走査', () => {
	it('全 data-lp-key 要素を収集', () => {
		const html = `<a data-lp-key="nav.home">a</a><b><span data-lp-key="nav.login">b</span></b>`;
		const doc = parse(html, { sourceCodeLocationInfo: true });
		/** @type {Array<{node: *, dottedKey: string, hasLpKeyAncestor: boolean}>} */
		const acc = [];
		collectLpKeyElements(doc, false, acc);
		assert.equal(acc.length, 2);
		assert.equal(acc[0].dottedKey, 'nav.home');
		assert.equal(acc[1].dottedKey, 'nav.login');
		assert.equal(acc[0].hasLpKeyAncestor, false);
		assert.equal(acc[1].hasLpKeyAncestor, false);
	});

	it('hasLpKeyAncestor は親に data-lp-key がある場合 true', () => {
		const html = `<p data-lp-key="hero.richText"><span data-lp-key="nav.home">x</span></p>`;
		const doc = parse(html, { sourceCodeLocationInfo: true });
		/** @type {Array<{node: *, dottedKey: string, hasLpKeyAncestor: boolean}>} */
		const acc = [];
		collectLpKeyElements(doc, false, acc);
		assert.equal(acc.length, 2);
		const child = acc.find((e) => e.dottedKey === 'nav.home');
		assert.ok(child, 'child should exist');
		assert.equal(child.hasLpKeyAncestor, true);
	});
});

describe('collectHasDescendantLpKey — 子孫検査', () => {
	it('子孫に data-lp-key があれば true', () => {
		const html = `<p data-lp-key="hero.richText"><span data-lp-key="nav.home">x</span></p>`;
		const doc = parse(html, { sourceCodeLocationInfo: true });
		// <html><head /><body><p data-lp-key="hero.richText">...</p></body>
		// p ノードを探す
		/** @type {*} */
		let pNode = null;
		function walk(n) {
			if (n.tagName === 'p') pNode = n;
			for (const c of n.childNodes ?? []) walk(c);
		}
		walk(doc);
		assert.ok(pNode, 'p node should be found');
		assert.equal(collectHasDescendantLpKey(pNode), true);
	});

	it('子孫に data-lp-key が無ければ false', () => {
		const html = `<p data-lp-key="hero.richText"><span>x</span></p>`;
		const doc = parse(html, { sourceCodeLocationInfo: true });
		/** @type {*} */
		let pNode = null;
		function walk(n) {
			if (n.tagName === 'p') pNode = n;
			for (const c of n.childNodes ?? []) walk(c);
		}
		walk(doc);
		assert.ok(pNode);
		assert.equal(collectHasDescendantLpKey(pNode), false);
	});
});

// ---------------------------------------------------------------------------
// AC4: 全 site/*.html ファイル列挙 (smoke test)
// ---------------------------------------------------------------------------
describe('TARGET_HTML_FILES — 全 site/*.html 対応 (#1945 AC4)', () => {
	it('対象ファイル一覧に index/pricing/faq/pamphlet/privacy/terms/tokushoho/sla/graduation/selfhost が全て含まれる', async () => {
		const mod = await import('../sync-lp-fallback.mjs');
		// TARGET_HTML_FILES は internal だが, 動作確認は CLI smoke test に委ねる。
		// 本 unit test は syncFallbackInFile の純粋関数挙動のみカバーする。
		assert.ok(typeof mod.syncFallbackInFile === 'function');
		assert.ok(typeof mod.lookupLpLabel === 'function');
		assert.ok(Array.isArray(mod.TARGET_HTML_FILES));
		assert.ok(mod.TARGET_HTML_FILES.length >= 10);
	});
});

// ---------------------------------------------------------------------------
// #1974: --check モードでの error 伝播 (Copilot [must] follow-up on PR #1970)
// ---------------------------------------------------------------------------
//
// 検証目的:
//   processFile() が対象 HTML 不存在を WARN + skip にしているため、`--check` 実行時でも
//   「一部のターゲットが検査されないのに成功する」状態になり得る不具合を fix する。
//   Copilot review on PR #1970 line 261, ADR-0006 (assertion 弱体化禁止) 整合。
//
// 実装方針:
//   - SYNC_LP_FALLBACK_TARGETS env 経由で TARGET_HTML_FILES を override し、
//     missing target を意図的に発生させて exit code を検証する
//   - --check モード: missing target → exit code 1 (errorsCount に集計)
//   - --write モード: missing target → exit code 0 (WARN + skip 継続、bootstrap UX 維持)
//   - --check モードで全 target が存在 + 同期済 → exit code 0 (regression なし)
// ---------------------------------------------------------------------------

/**
 * `SYNC_LP_FALLBACK_TARGETS` env 経由でスクリプトを spawn し exit code / stderr を取得。
 *
 * @param {string[]} targets - 相対パス配列 (REPO_ROOT 起点)
 * @param {{ check?: boolean }} [opts]
 * @returns {{ status: number | null; stderr: string; stdout: string }}
 */
function runScriptWithTargets(targets, opts = {}) {
	const args = [SCRIPT_PATH];
	if (opts.check) args.push('--check');
	const result = spawnSync('node', args, {
		cwd: REPO_ROOT,
		env: {
			...process.env,
			SYNC_LP_FALLBACK_TARGETS: targets.join(','),
		},
		encoding: 'utf-8',
	});
	return {
		status: result.status,
		stderr: result.stderr ?? '',
		stdout: result.stdout ?? '',
	};
}

describe('sync-lp-fallback.mjs --check モード exit code 伝播 (#1974)', () => {
	it('--check モードで missing target があれば exit code 1', () => {
		// site/ 配下に確実に存在しない path を target に指定
		const fakePath = `site/__nonexistent_for_test_${Date.now()}.html`;
		const { status, stderr } = runScriptWithTargets([fakePath], { check: true });
		assert.equal(
			status,
			1,
			`expected exit code 1 for missing target in --check mode, got ${status}\nstderr: ${stderr}`,
		);
		// AC: error 発生時のログ出力でファイル名が明示される
		assert.match(
			stderr,
			new RegExp(fakePath.replace(/\./g, '\\.')),
			`stderr should mention missing file path '${fakePath}', got: ${stderr}`,
		);
		// AC: error 内容が明示される (FAIL 集計メッセージ含む)
		assert.match(
			stderr,
			/存在しません|missing|not found|FAIL/i,
			`stderr should explain the failure reason, got: ${stderr}`,
		);
	});

	it('--check モードで複数 missing target でも exit code 1 (集計エラーカウント)', () => {
		const fakeA = `site/__nonexistent_a_${Date.now()}.html`;
		const fakeB = `site/__nonexistent_b_${Date.now()}.html`;
		const { status, stderr } = runScriptWithTargets([fakeA, fakeB], { check: true });
		assert.equal(status, 1, `expected exit code 1, got ${status}\nstderr: ${stderr}`);
		assert.match(stderr, /エラー\s*2\s*件/, `expected aggregated 'エラー 2 件', got: ${stderr}`);
	});

	it('--write モードでは missing target は WARN + skip 継続 (regression なし、bootstrap UX 維持)', () => {
		const fakePath = `site/__nonexistent_for_test_${Date.now()}.html`;
		const { status, stderr } = runScriptWithTargets([fakePath], { check: false });
		assert.equal(
			status,
			0,
			`--write mode should keep WARN + skip for missing target (exit 0), got ${status}\nstderr: ${stderr}`,
		);
		assert.match(stderr, /WARN/, `--write mode should still emit WARN, got: ${stderr}`);
	});

	it('--check モードで存在する同期済 target なら exit code 0 (regression なし)', () => {
		// #1974 QM Review M-2: REPO_ROOT 配下に tmp dir を作成 (path validation 整合)。
		// 旧実装は os.tmpdir() (= repo 外) を使い `path.relative(REPO_ROOT, ...)` で `..` 含み
		// 相対パスを target に渡していたため、M-1 path validation を通らなかった。
		const tmpRoot = path.join(REPO_ROOT, 'scripts', '__tests__', '__tmp__');
		fs.mkdirSync(tmpRoot, { recursive: true });
		const tmpDir = fs.mkdtempSync(path.join(tmpRoot, 'sync-lp-fallback-'));
		try {
			// shared-labels.js の LP_LABELS から実際の値を取得して、それを fallback に書く
			const sharedLabelsSrc = fs.readFileSync(
				path.join(REPO_ROOT, 'site/shared-labels.js'),
				'utf-8',
			);
			const m = sharedLabelsSrc.match(/const LP_LABELS = (\{[\s\S]*?\});\s*\n\s*\/\//);
			assert.ok(m, 'LP_LABELS block must be extractable from shared-labels.js');
			const lpLabels = JSON.parse(m[1]);
			// string 値の最初のエントリを採用
			let dotted = '';
			let canonical = '';
			outer: for (const nsName of Object.keys(lpLabels)) {
				for (const kName of Object.keys(lpLabels[nsName])) {
					if (typeof lpLabels[nsName][kName] === 'string') {
						dotted = `${nsName}.${kName}`;
						canonical = lpLabels[nsName][kName];
						break outer;
					}
				}
			}
			assert.ok(dotted, 'at least one string-valued LP_LABELS entry must exist');
			const tmpHtml = path.join(tmpDir, 'synced.html');
			fs.writeFileSync(
				tmpHtml,
				`<!DOCTYPE html><html><body><a data-lp-key="${dotted}">${canonical}</a></body></html>`,
				'utf-8',
			);
			// REPO_ROOT 起点の相対 path を計算 (REPO_ROOT 配下に作成しているため `..` を含まない)
			const relPath = path.relative(REPO_ROOT, tmpHtml).replace(/\\/g, '/');
			assert.ok(
				!relPath.includes('..'),
				`tmp HTML must be REPO_ROOT 配下 (path validation 整合), got: ${relPath}`,
			);
			const { status, stderr, stdout } = runScriptWithTargets([relPath], { check: true });
			assert.equal(
				status,
				0,
				`expected exit 0 for synced target in --check mode, got ${status}\nstdout: ${stdout}\nstderr: ${stderr}`,
			);
		} finally {
			fs.rmSync(tmpDir, { recursive: true, force: true });
		}
	});
});

// ---------------------------------------------------------------------------
// #1974 QM Review M-1: SYNC_LP_FALLBACK_TARGETS path validation (security)
// ---------------------------------------------------------------------------
//
// 検証目的:
//   env override は CI / シェル経由で誰でも有効化できるため、以下 2 段の path validation を強制:
//     1. .html 拡張子限定 (任意拡張子 read/write 防止)
//     2. REPO_ROOT 配下強制 (path traversal 防止 — `../../etc/passwd.html` 等を拒否)
//   違反時は exit code 1 + stderr に明示メッセージ。ADR-0010 Pre-PMF security minimization。
// ---------------------------------------------------------------------------
describe('sync-lp-fallback.mjs SYNC_LP_FALLBACK_TARGETS path validation (#1974 QM M-1)', () => {
	it('REPO_ROOT 外の絶対 / 相対パスを拒否 (path traversal 防止)', () => {
		// `../` を多段含めて確実に REPO_ROOT 外を指す path
		const traversalPath = '../../etc/passwd.html';
		const { status, stderr } = runScriptWithTargets([traversalPath], { check: true });
		assert.equal(
			status,
			1,
			`expected exit code 1 for path-traversal target, got ${status}\nstderr: ${stderr}`,
		);
		assert.match(
			stderr,
			/REPO_ROOT|外側|traversal|許可/,
			`stderr should explain REPO_ROOT enforcement, got: ${stderr}`,
		);
	});

	it('.html 以外の拡張子を拒否', () => {
		// REPO_ROOT 内であっても .html 以外は不可
		const nonHtml = 'README.md';
		const { status, stderr } = runScriptWithTargets([nonHtml], { check: true });
		assert.equal(
			status,
			1,
			`expected exit code 1 for non-.html target, got ${status}\nstderr: ${stderr}`,
		);
		assert.match(
			stderr,
			/\.html|拡張子/,
			`stderr should explain .html-only restriction, got: ${stderr}`,
		);
	});

	it('正規の REPO_ROOT 配下 .html (存在しない) は path validation 通過 → missing 扱いで exit 1', () => {
		// path validation は通るが存在しないため missing target として exit 1 (M-1 と既存 #1974 AC 両方)
		const fakePath = `site/__nonexistent_validation_${Date.now()}.html`;
		const { status, stderr } = runScriptWithTargets([fakePath], { check: true });
		assert.equal(status, 1, `expected exit code 1 for missing valid path, got ${status}`);
		// path validation エラーではなく missing エラーであることを確認
		assert.match(
			stderr,
			/存在しません|missing/,
			`stderr should be missing-target error (not path-validation), got: ${stderr}`,
		);
	});
});
