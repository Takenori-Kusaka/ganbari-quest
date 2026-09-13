// tests/unit/architecture/logger-message-pii-boundary.test.ts
// #4947 恒久策 (PO 判断 2026-09-12): logger の **入口** を fitness function で塞ぐ。
//
// #4947 の `sanitizeContext()` は context の key 名で機微値を落とすが、`entry.message` に
// 直接埋め込まれた PII (`logger.info(\`... from ${email} ...\`)`) は出口の key 名検査を通らない。
// 出口側は logger.ts の `redactValues()` が値のパターンで最後の砦になるが、値パターンは
// 「実測で漏れた形」にしか効かない。入口で「PII 名の変数を message に埋め込む」書き方そのものを
// CI で禁止し、可変値は必ず `context` (key 名 redaction が効く) に入れさせる。
//
// route-db-boundary.test.ts と同型の Architecture Fitness Function (ADR-0061 class lock)。
// 検出対象は `logger.(debug|info|warn|error|critical)(` の **第 1 引数** に限る:
//   - テンプレートリテラル内の `${expr}` に PII 名の識別子が含まれる
//   - 文字列連結 `'...' + expr` に PII 名の識別子が含まれる
// PII 名の判定は識別子を camelCase / snake_case のトークンに分解して行う
// (`${code}` は許可 = API error code / `${otpCode}` は拒否 = otp トークンを含む)。
//
// baseline は 0 件で凍結する。新規違反は baseline に足さず、値を context へ移すこと。

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';

// #4085: repo 走査 test。区分は scripts/lib/ci/repo-scan-test-registry.mjs が SSOT。
vi.setConfig({ testTimeout: 60_000 });

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const SRC_DIR = resolve(REPO_ROOT, 'src');

/** message に埋め込んではいけない識別子トークン (小文字比較) */
const PII_TOKENS = new Set([
	'email',
	'mail',
	'pin',
	'password',
	'passwd',
	'secret',
	'token',
	'otp',
	'credential',
	'credentials',
	'cookie',
	'authorization',
	'signature',
]);

/** 2 トークンに割れる複合語 (`apiKey` → ['api','key'])。結合形で判定する */
const PII_COMPOUND_PATTERN = /api_?key/i;

function isPiiIdentifier(identifier: string): boolean {
	return tokens(identifier).some((t) => PII_TOKENS.has(t)) || PII_COMPOUND_PATTERN.test(identifier);
}

const LOGGER_CALL = /\blogger\.(?:debug|info|warn|error|critical)\s*\(/g;

function walk(dir: string, acc: string[]): string[] {
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const full = resolve(dir, entry.name);
		if (entry.isDirectory()) {
			walk(full, acc);
		} else if (/\.(ts|svelte)$/.test(entry.name) && !entry.name.endsWith('.d.ts')) {
			acc.push(full);
		}
	}
	return acc;
}

/**
 * 呼び出し開始位置から第 1 引数のテキストを切り出す。
 * 深さ 0 の `,` か `)` で終わる。文字列 / テンプレートリテラル / `${}` の中は深さに数えない。
 */
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: quote / テンプレート / ${} の状態を 1 つの走査で持ち回る手書き字句解析。関数に割ると状態の受け渡しでかえって追いにくい
function firstArgument(source: string, openParenIndex: number): string {
	let depth = 0;
	let i = openParenIndex + 1;
	let quote: string | null = null;
	let templateBraces = 0;
	const start = i;
	for (; i < source.length; i++) {
		const ch = source[i];
		if (quote) {
			if (ch === '\\') {
				i++;
				continue;
			}
			if (quote === '`' && ch === '$' && source[i + 1] === '{') {
				templateBraces++;
				i++;
				continue;
			}
			if (quote === '`' && templateBraces > 0 && ch === '}') {
				templateBraces--;
				continue;
			}
			if (ch === quote && templateBraces === 0) quote = null;
			continue;
		}
		if (ch === '"' || ch === "'" || ch === '`') {
			quote = ch;
			continue;
		}
		if (ch === '(' || ch === '[' || ch === '{') depth++;
		else if (ch === ')' || ch === ']' || ch === '}') {
			if (depth === 0) return source.slice(start, i);
			depth--;
		} else if (ch === ',' && depth === 0) {
			return source.slice(start, i);
		}
	}
	return source.slice(start);
}

/** `${...}` の中身と、`+` 連結の右辺・左辺の識別子を集める */
function interpolatedIdentifiers(firstArg: string): string[] {
	const ids: string[] = [];
	const template = firstArg.matchAll(/\$\{([^}]*)\}/g);
	for (const m of template) ids.push(...(m[1]?.match(/[A-Za-z_$][A-Za-z0-9_$]*/g) ?? []));
	// 文字列連結: quote の外にある識別子
	const outsideQuotes = firstArg.replace(
		/`(?:\\.|[^`\\])*`|'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"/g,
		' ',
	);
	if (outsideQuotes.includes('+')) {
		ids.push(...(outsideQuotes.match(/[A-Za-z_$][A-Za-z0-9_$]*/g) ?? []));
	}
	return ids;
}

function tokens(identifier: string): string[] {
	return identifier
		.replace(/([a-z0-9])([A-Z])/g, '$1 $2')
		.replace(/[_$]+/g, ' ')
		.toLowerCase()
		.split(/\s+/)
		.filter(Boolean);
}

interface Violation {
	file: string;
	line: number;
	identifier: string;
}

function findViolations(): Violation[] {
	const violations: Violation[] = [];
	for (const file of walk(SRC_DIR, [])) {
		const source = readFileSync(file, 'utf-8');
		for (const m of source.matchAll(LOGGER_CALL)) {
			const openParen = m.index + m[0].length - 1;
			const arg = firstArgument(source, openParen);
			for (const id of interpolatedIdentifiers(arg)) {
				if (isPiiIdentifier(id)) {
					const line = source.slice(0, m.index).split('\n').length;
					violations.push({
						file: relative(REPO_ROOT, file).replace(/\\/g, '/'),
						line,
						identifier: id,
					});
				}
			}
		}
	}
	return violations;
}

describe('#4947 恒久策: logger.* の message に PII 名の変数を埋め込まない (fitness function)', () => {
	it('src を FS 走査できている (sanity)', () => {
		expect(walk(SRC_DIR, []).length).toBeGreaterThan(0);
	});

	it('検出器が template literal / 連結の両方で PII 名の識別子を拾う (self-test)', () => {
		// biome-ignore lint/suspicious/noTemplateCurlyInString: 検出器に食わせる「テンプレートリテラルのソース文字列」そのもの
		expect(interpolatedIdentifiers('`Feedback from ${email} (${tenantId})`')).toContain('email');
		expect(interpolatedIdentifiers("'user=' + replyEmail")).toContain('replyEmail');
		expect(tokens('otpCode')).toEqual(['otp', 'code']);
		expect(tokens('pinCharCodes')).toEqual(['pin', 'char', 'codes']);
		expect(isPiiIdentifier('apiKey')).toBe(true);
		expect(isPiiIdentifier('replyEmail')).toBe(true);
		// API error code / tenantId は PII ではない
		expect(isPiiIdentifier('code')).toBe(false);
		expect(isPiiIdentifier('tenantId')).toBe(false);
		expect(isPiiIdentifier('statusCode')).toBe(false);
	});

	it('logger.* の第 1 引数 (message) に PII 名の変数を埋め込む呼び出しが無い (baseline 0、凍結)', () => {
		const violations = findViolations();
		expect(
			violations,
			`message に PII 名の変数が埋め込まれています:\n${violations
				.map((v) => `  - ${v.file}:${v.line} (${v.identifier})`)
				.join(
					'\n',
				)}\n→ 可変値は message に埋め込まず \`context\` に入れる (出口の key 名 redaction が効く)。` +
				' 参考: src/lib/server/logger.ts の redactValues() は最後の砦であって、入口の代わりではない',
		).toEqual([]);
	});
});
