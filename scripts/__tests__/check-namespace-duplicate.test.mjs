/**
 * scripts/__tests__/check-namespace-duplicate.test.mjs (#2061)
 *
 * check-namespace-duplicate.mjs の判定ロジック unit test。
 *
 * 実行: node --test scripts/__tests__/check-namespace-duplicate.test.mjs
 *
 * テスト範囲:
 * 1. extractNamespaces() が Issue body 内の XXX_LABELS / XXX_TERMS を抽出する
 * 2. extractNamespaces() が単一単語 (PLAN_TERMS) と複合 (LP_FAQ_TERMS) 両方を検出
 * 3. extractNamespaces() が EXCLUDE_NAMES (XXX_LABELS / XXX_TERMS) を除外
 * 4. checkSSotDuplicates() が SSOT (terms.ts / labels.ts) の既存 export を検出
 * 5. 衝突がない場合は空配列を返す
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..', '..');

const { extractNamespaces, checkSSotDuplicates } = await import('../check-namespace-duplicate.mjs');

// ---------------------------------------------------------------------------
// extractNamespaces (Issue #2061 AC2 / AC3)
// ---------------------------------------------------------------------------

describe('extractNamespaces() — namespace 抽出 (#2061)', () => {
	it('単一単語 namespace (PLAN_TERMS) を検出する', () => {
		const body = '`PLAN_TERMS` を atom として再利用。';
		const result = extractNamespaces(body);
		assert.deepEqual(result, ['PLAN_TERMS']);
	});

	it('複合 namespace (LP_FAQ_TERMS) を検出する', () => {
		const body = 'PR で `LP_FAQ_TERMS` を 2 回 export しようとした。';
		const result = extractNamespaces(body);
		assert.deepEqual(result, ['LP_FAQ_TERMS']);
	});

	it('複数の namespace を重複なく検出する', () => {
		const body = `
			PR #2041 で LP_FAQ_TERMS を、PR #2044 でも LP_FAQ_TERMS を export。
			別途 PLAN_TERMS を atom として参照。
			新 namespace LP_LEGAL_DISCLAIMER_TERMS を提案。
		`;
		const result = extractNamespaces(body);
		assert.deepEqual(result.sort(), ['LP_FAQ_TERMS', 'LP_LEGAL_DISCLAIMER_TERMS', 'PLAN_TERMS']);
	});

	it('XXX_LABELS / XXX_TERMS (説明用プレースホルダ) は除外する', () => {
		const body = 'Issue body 内に XXX_LABELS / XXX_TERMS 形式の namespace 名を書く場合。';
		const result = extractNamespaces(body);
		assert.deepEqual(result, []);
	});

	it('namespace 名がない body では空配列を返す', () => {
		const body = '## 背景\n\nThis is a generic refactoring with no namespace mention.';
		const result = extractNamespaces(body);
		assert.deepEqual(result, []);
	});

	it('小文字や snake_case は検出しない (false-positive 抑制)', () => {
		const body = 'lp_faq_terms や planTerms は対象外。';
		const result = extractNamespaces(body);
		assert.deepEqual(result, []);
	});

	it('_LABELS / _TERMS 以外のサフィックスは検出しない', () => {
		const body = 'PLAN_TYPES や USER_ROLES は対象外（_LABELS / _TERMS のみ検出）。';
		const result = extractNamespaces(body);
		assert.deepEqual(result, []);
	});
});

// ---------------------------------------------------------------------------
// checkSSotDuplicates (Issue #2061 AC1 / AC2)
// ---------------------------------------------------------------------------

describe('checkSSotDuplicates() — SSOT 重複検出 (#2061)', () => {
	it('terms.ts に既存の LP_FAQ_TERMS を検出する', () => {
		const result = checkSSotDuplicates(['LP_FAQ_TERMS'], REPO_ROOT);
		assert.equal(result.length, 1);
		assert.equal(result[0].namespace, 'LP_FAQ_TERMS');
		assert.match(result[0].file, /terms\.ts$/);
	});

	it('terms.ts に既存の PLAN_TERMS を検出する', () => {
		const result = checkSSotDuplicates(['PLAN_TERMS'], REPO_ROOT);
		assert.equal(result.length, 1);
		assert.equal(result[0].namespace, 'PLAN_TERMS');
		assert.match(result[0].file, /terms\.ts$/);
	});

	it('labels.ts に既存の APP_LABELS を検出する', () => {
		const result = checkSSotDuplicates(['APP_LABELS'], REPO_ROOT);
		assert.equal(result.length, 1);
		assert.equal(result[0].namespace, 'APP_LABELS');
		assert.match(result[0].file, /labels\.ts$/);
	});

	it('存在しない namespace は衝突なし', () => {
		const result = checkSSotDuplicates(['ABSOLUTELY_NEW_TERMS'], REPO_ROOT);
		assert.deepEqual(result, []);
	});

	it('複数の namespace を一度に検査できる', () => {
		const result = checkSSotDuplicates(
			['LP_FAQ_TERMS', 'PLAN_TERMS', 'NEVER_EXISTS_TERMS'],
			REPO_ROOT,
		);
		assert.equal(result.length, 2);
		const namespaces = result.map((r) => r.namespace).sort();
		assert.deepEqual(namespaces, ['LP_FAQ_TERMS', 'PLAN_TERMS']);
	});

	it('空配列を渡したら空配列を返す', () => {
		const result = checkSSotDuplicates([], REPO_ROOT);
		assert.deepEqual(result, []);
	});

	it('行頭以外の export const は誤検知しない (multi-line 限定)', () => {
		// 一時 SSOT を作って `// export const NS = ` のコメント行が誤検出されないか確認
		const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'check-ns-dup-'));
		const tmpRepoRoot = tmpDir;
		const tmpSrcDir = path.join(tmpRepoRoot, 'src', 'lib', 'domain');
		fs.mkdirSync(tmpSrcDir, { recursive: true });
		fs.writeFileSync(
			path.join(tmpSrcDir, 'terms.ts'),
			'// export const FAKE_TERMS = { ... }\nconst other = 1;\n',
		);
		fs.writeFileSync(path.join(tmpSrcDir, 'labels.ts'), '');
		const result = checkSSotDuplicates(['FAKE_TERMS'], tmpRepoRoot);
		assert.deepEqual(result, [], 'コメント行内 export は誤検出されない');
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});
});
