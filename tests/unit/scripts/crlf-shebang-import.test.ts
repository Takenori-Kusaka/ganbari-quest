/**
 * tests/unit/scripts/crlf-shebang-import.test.ts (#3984)
 *
 * 回帰テスト: **CRLF の shebang 付き `.mjs` を import しても壊れない**。
 *
 * 背景 (#3984): vite 本体の shebang 除去 RE は `/^#!.*\n/` (`getFileStartIndex`)。
 * JS の `.` は行終端子にマッチしないため CRLF (`#!...\r\n`) では**マッチせず**、
 * shebang が残ったまま ssr transform が import 文を先頭行へ hoist する。結果
 * `const x = __vite__cjsImport0_...;#!/usr/bin/env node` という 1 行が生まれ、
 * rolldown が `Invalid Character \`!\`` で parse 失敗し **test file 自体が読めなくなる**
 * (`Tests no tests`)。エラー文言から改行コードに辿り着けず flake と誤判定された。
 *
 * 対処 (`vite.config.ts` の `stripShebangPlugin`): ssr transform より前に、改行種別に
 * 依らず shebang 行を除去する。
 *
 * fixture (`tests/fixtures/crlf/crlf-shebang-module.mjs`) は `.gitattributes` の
 * `eol=crlf` で **全 checkout 環境 (CI Linux 含む) で CRLF に固定**される。fixture の
 * 改行が CRLF であること自体も本 test で assert し、eol 指定が外れたら気付けるようにする。
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// この import 自体が回帰の本体 — plugin が無いと本 file 全体が読み込めず fail する
import { baseOf, MARKER } from '../../fixtures/crlf/crlf-shebang-module.mjs';

const fixturePath = path.resolve(process.cwd(), 'tests/fixtures/crlf/crlf-shebang-module.mjs');

describe('CRLF shebang module import (#3984)', () => {
	it('fixture は CRLF 改行 + shebang で保存されている (前提条件の固定)', () => {
		const raw = readFileSync(fixturePath, 'utf8');
		expect(raw.startsWith('#!')).toBe(true);
		expect(raw).toContain('\r\n');
		// LF 単独行が混ざっていない (CRLF に正規化されている)
		expect(raw.replace(/\r\n/g, '')).not.toContain('\n');
	});

	it('CRLF shebang 付き .mjs を import しても export が読める', () => {
		expect(MARKER).toBe('crlf-shebang-ok');
	});

	it('import 文を持つ module でも transform が壊れない (hoist 済み import との衝突回帰)', () => {
		// baseOf() は fixture が import した `node:path` の basename を呼ぶ。
		// import 文が先頭行へ hoist されるため #3984 の衝突条件を満たす。
		expect(baseOf('/tmp/foo/bar.mjs')).toBe('bar.mjs');
	});
});
