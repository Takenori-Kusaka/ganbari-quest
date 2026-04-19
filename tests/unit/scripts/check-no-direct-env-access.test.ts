import { describe, expect, it } from 'vitest';

// @ts-expect-error — JS module, no types
import {
	detectEnvAccessInLine,
	detectEnvAccessInText,
} from '../../../scripts/check-no-direct-env-access.mjs';

type LineHit = {
	kind: 'process.env' | '$env-import';
	match: string;
} | null;

describe('check-no-direct-env-access (#1210 拡張)', () => {
	describe('detectEnvAccessInLine — ドット記法', () => {
		it('process.env.FOO を検出する', () => {
			const r = detectEnvAccessInLine('const x = process.env.FOO;') as LineHit;
			expect(r).not.toBeNull();
			expect(r?.kind).toBe('process.env');
			expect(r?.match).toBe('process.env.FOO');
		});

		it('アンダースコア付きの大文字 env を検出する', () => {
			const r = detectEnvAccessInLine('if (process.env.MY_LONG_NAME_2) doStuff();') as LineHit;
			expect(r?.match).toBe('process.env.MY_LONG_NAME_2');
		});
	});

	describe('detectEnvAccessInLine — ブラケット記法 (#1210 追加)', () => {
		it("process.env['FOO'] を検出する", () => {
			const r = detectEnvAccessInLine("const x = process.env['FOO'];") as LineHit;
			expect(r).not.toBeNull();
			expect(r?.kind).toBe('process.env');
		});

		it('process.env["FOO"] (double quote) を検出する', () => {
			const r = detectEnvAccessInLine('const x = process.env["FOO_BAR"];') as LineHit;
			expect(r).not.toBeNull();
			expect(r?.kind).toBe('process.env');
		});

		it('ブラケット内の空白を許容する', () => {
			const r = detectEnvAccessInLine("process.env[ 'FOO' ]") as LineHit;
			expect(r).not.toBeNull();
		});
	});

	describe('detectEnvAccessInLine — $env import (#1210 追加)', () => {
		it("'$env/dynamic/private' import を検出する", () => {
			const r = detectEnvAccessInLine("import { env } from '$env/dynamic/private';") as LineHit;
			expect(r).not.toBeNull();
			expect(r?.kind).toBe('$env-import');
		});

		it("'$env/static/private' import を検出する", () => {
			const r = detectEnvAccessInLine('import { SECRET } from "$env/static/private";') as LineHit;
			expect(r?.kind).toBe('$env-import');
		});

		it("'$env/dynamic/public' import を検出する", () => {
			const r = detectEnvAccessInLine("import { env } from '$env/dynamic/public';") as LineHit;
			expect(r?.kind).toBe('$env-import');
		});
	});

	describe('detectEnvAccessInLine — false positive 回避', () => {
		it('小文字の変数名にはマッチしない', () => {
			const r = detectEnvAccessInLine('const foo = process.env.lowercase;');
			expect(r).toBeNull();
		});

		it('単なる文字列 "process.env" にはマッチしない', () => {
			const r = detectEnvAccessInLine('const msg = "process.env is global";');
			expect(r).toBeNull();
		});

		it('$env を含むが import ではない文字列にはマッチしない', () => {
			const r = detectEnvAccessInLine('// see $env/dynamic/private docs');
			// コメント除外は detectEnvAccessInText 側で行う。行レベルでは正規表現が
			// from '...' を要求するためこの文字列は素通りすべき
			expect(r).toBeNull();
		});

		it('通常の変数参照 envFoo にはマッチしない', () => {
			const r = detectEnvAccessInLine('const x = envFoo.BAR;');
			expect(r).toBeNull();
		});
	});

	describe('detectEnvAccessInText — 複数行・コメント除外', () => {
		it('複数の検出を行番号付きで返す', () => {
			const text = `import { env } from '$env/dynamic/private';
const a = process.env.FOO;
const b = process.env['BAR'];`;
			const hits = detectEnvAccessInText(text);
			expect(hits).toHaveLength(3);
			expect(hits[0].line).toBe(1);
			expect(hits[0].kind).toBe('$env-import');
			expect(hits[1].line).toBe(2);
			expect(hits[1].kind).toBe('process.env');
			expect(hits[2].line).toBe(3);
			expect(hits[2].kind).toBe('process.env');
		});

		it('// コメント行はスキップする', () => {
			const text = `// const ignored = process.env.SKIP;
const real = process.env.REAL;`;
			const hits = detectEnvAccessInText(text);
			expect(hits).toHaveLength(1);
			expect(hits[0].line).toBe(2);
			expect(hits[0].match).toContain('REAL');
		});

		it('* ブロックコメント行はスキップする', () => {
			const text = ` * @example process.env.DOC_ONLY
const real = process.env.REAL;`;
			const hits = detectEnvAccessInText(text);
			expect(hits).toHaveLength(1);
			expect(hits[0].match).toContain('REAL');
		});

		it('検出がゼロなら空配列を返す', () => {
			const hits = detectEnvAccessInText("import { env } from '$lib/runtime/env';");
			expect(hits).toEqual([]);
		});
	});
});
