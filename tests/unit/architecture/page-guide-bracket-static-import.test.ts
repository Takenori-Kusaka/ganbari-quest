// tests/unit/architecture/page-guide-bracket-static-import.test.ts
// #3314 (ADR-0061 same-class→guard / push-down-pyramid): bracket-path guide loader が
// bare dynamic import を使わないことを per-PR の unit fitness function で機械強制する。
//
// 背景: page-guide-registry.ts の GUIDE_LOADERS は通常 `() => import('.../_guide')` で
// 遅延 import する。しかし key が SvelteKit の動的セグメント (`[type]/[itemId]`) を含む場合、
// その literal bracket path は Vite/Rollup の build で chunk が emit されず、runtime の
// dynamic import が reject する。reject は getPageGuide の catch に飲まれ、本来出るべき
// dedicated 詳細ガイドが親 /marketplace 一覧ガイドへ **silent degrade** していた (#3314)。
// この bundling 不整合は heavy-lane E2E (marketplace-page-guide.spec.ts) でしか検出されず
// **2 PR 連続で per-PR CI をすり抜けた**。次に誰かが動的セグメント guide を `() => import(...)`
// で追加すると同じ silent-degrade が再発する。
//
// 対策 (#3314 fix): bracket path の guide は static import 済の定数を `Promise.resolve({...})`
// でラップして返す (loader interface は維持しつつ確実に bundle へ取り込む)。本 fitness
// function は registry source を静的解析し、bracket key が bare dynamic import を持たないことを
// hard-fail で守る。fast 層 (vitest + node fs、source 静的解析) で完結し heavy build/e2e に
// 依存しない (push-down-pyramid)。route-db-boundary.test.ts (#3152) と同型の
// Architecture Fitness Function (Building Evolutionary Architecture / Neal Ford 他)。

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const REGISTRY_PATH = resolve(REPO_ROOT, 'src/lib/ui/tutorial/page-guide-registry.ts');

// SvelteKit 動的セグメント (`[type]` / `[itemId]` 等) を含む key 判定。
const BRACKET_PARAM_RE = /\[[^\]]+\]/;
// bare dynamic / lazy import: `import('...')` / `await import('...')`。
const DYNAMIC_IMPORT_RE = /\bimport\s*\(/;

interface LoaderEntry {
	key: string;
	loaderText: string;
}

/** ソースから `/* *​/` ブロック + `//` 行コメントを除去する (コメント内の "import(" 誤検出回避)。 */
function stripComments(source: string): string {
	return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

/**
 * `GUIDE_LOADERS` オブジェクトリテラルの本体 (中括弧の内側) を、ネスト中括弧を考慮した
 * 深さカウントで切り出す (`Promise.resolve({ X })` 等のネスト brace に対応)。
 */
function extractGuideLoadersBody(source: string): string {
	const declIdx = source.indexOf('GUIDE_LOADERS');
	if (declIdx === -1) throw new Error('GUIDE_LOADERS 宣言が見つからない');
	// 代入 `= {` を探す。型注釈内の `() =>` (arrow) や `Promise<{` を誤検出しないよう、
	// `=` の直後 (whitespace 跨ぎ) が `{` であるものに限定する。
	const assignRe = /=\s*\{/g;
	assignRe.lastIndex = declIdx;
	const assignMatch = assignRe.exec(source);
	if (!assignMatch) throw new Error('GUIDE_LOADERS の代入 (= {) が見つからない');
	const braceOpen = source.indexOf('{', assignMatch.index);
	let depth = 0;
	for (let i = braceOpen; i < source.length; i++) {
		const ch = source[i];
		if (ch === '{') depth++;
		else if (ch === '}') {
			depth--;
			if (depth === 0) return source.slice(braceOpen + 1, i);
		}
	}
	throw new Error('GUIDE_LOADERS の閉じ括弧が見つからない');
}

/**
 * GUIDE_LOADERS の各エントリ (`'/path': loader`) を抽出する。loader は複数行に跨り得るため、
 * 次の key の出現位置 (または末尾) までを loader 本体として切り出す。
 */
function parseLoaderEntries(source: string): LoaderEntry[] {
	const body = stripComments(extractGuideLoadersBody(source));
	// key は path 文字列リテラル。`'/marketplace/[type]/[itemId]':` 等。
	const keyRe = /(['"])(\/[^'"]+)\1\s*:/g;
	const marks: { key: string; colonEnd: number; keyStart: number }[] = [];
	for (let m = keyRe.exec(body); m !== null; m = keyRe.exec(body)) {
		marks.push({ key: m[2], colonEnd: keyRe.lastIndex, keyStart: m.index });
	}
	return marks.map((mark, i) => ({
		key: mark.key,
		loaderText: body.slice(mark.colonEnd, marks[i + 1]?.keyStart ?? body.length),
	}));
}

/**
 * bracket-path key が bare dynamic import を使っている違反を列挙する (純粋関数)。
 * 実 registry source / fixture 文字列の両方に同一ロジックを適用できるよう切り出している。
 */
function findBracketDynamicImportViolations(source: string): LoaderEntry[] {
	return parseLoaderEntries(source).filter(
		(e) => BRACKET_PARAM_RE.test(e.key) && DYNAMIC_IMPORT_RE.test(e.loaderText),
	);
}

const registrySource = readFileSync(REGISTRY_PATH, 'utf8');

describe('#3314 fitness: bracket-path guide loader は static import 必須 (bare dynamic import 禁止)', () => {
	it('現状の registry: bracket-path key が bare dynamic import を使っていない (PASS)', () => {
		const violations = findBracketDynamicImportViolations(registrySource);
		expect(
			violations,
			`動的セグメント (bracket) を含む key の loader が bare dynamic import (() => import(...)) を\n` +
				`使っている。Vite build で chunk が emit されず runtime で reject → 親ガイドへ silent\n` +
				`degrade する (#3314)。static import 済定数を Promise.resolve({...}) でラップする形にすること:\n` +
				`${violations.map((v) => `  ${v.key}: ${v.loaderText.trim()}`).join('\n')}`,
		).toEqual([]);
	});

	it('parser が実 registry の bracket key を実際に検出できている (vacuous PASS でない)', () => {
		const entries = parseLoaderEntries(registrySource);
		const bracketKeys = entries.filter((e) => BRACKET_PARAM_RE.test(e.key)).map((e) => e.key);
		// #3269 で導入された marketplace 詳細 dedicated guide が bracket key として存在する。
		expect(bracketKeys).toContain('/marketplace/[type]/[itemId]');
	});

	it('bracket key の loader は static import 済定数を Promise.resolve でラップしている', () => {
		const bracketEntries = parseLoaderEntries(registrySource).filter((e) =>
			BRACKET_PARAM_RE.test(e.key),
		);
		for (const e of bracketEntries) {
			expect(
				/Promise\.resolve/.test(e.loaderText),
				`bracket key ${e.key} の loader は Promise.resolve({ <static import 済定数> }) 形であること: ${e.loaderText.trim()}`,
			).toBe(true);
		}
		// 詳細ガイドの static import が file 冒頭に存在する (確実に bundle される)。
		expect(registrySource).toMatch(/import\s*\{\s*MARKETPLACE_DETAIL_GUIDE\s*\}\s*from/);
	});
});

describe('#3314 fitness: detector の regression sentinel (negative / positive fixture)', () => {
	// bracket key を bare dynamic import に戻した「壊れた registry」fixture。
	// #3314 の silent-degrade トラップを再現したもの。detector が必ず flag することを確認する。
	const BAD_FIXTURE = `
const GUIDE_LOADERS = {
	'/admin': () => import('../../../routes/(parent)/admin/_guide'),
	'/marketplace': () => import('../../../routes/marketplace/_guide'),
	'/marketplace/[type]/[itemId]': () => import('../../../routes/marketplace/[type]/[itemId]/_guide'),
};
`;
	// 正しい registry を模した fixture (bracket key は Promise.resolve でラップ)。
	const GOOD_FIXTURE = `
const GUIDE_LOADERS = {
	'/admin': () => import('../../../routes/(parent)/admin/_guide'),
	'/marketplace': () => import('../../../routes/marketplace/_guide'),
	'/marketplace/[type]/[itemId]': () => Promise.resolve({ MARKETPLACE_DETAIL_GUIDE }),
};
`;

	it('bracket key を () => import(...) に戻すと detector が FAIL する (silent-degrade regression を捕捉)', () => {
		const violations = findBracketDynamicImportViolations(BAD_FIXTURE);
		expect(violations.map((v) => v.key)).toEqual(['/marketplace/[type]/[itemId]']);
	});

	it('bracket key が Promise.resolve ラップなら detector は PASS する', () => {
		expect(findBracketDynamicImportViolations(GOOD_FIXTURE)).toEqual([]);
	});

	it('() group path (bracket なし key) の dynamic import は誤検出しない', () => {
		// `/admin` (key 上は () group が解決済) の dynamic import は許容。
		const violations = findBracketDynamicImportViolations(GOOD_FIXTURE);
		expect(violations.some((v) => v.key === '/admin' || v.key === '/marketplace')).toBe(false);
	});
});
