#!/usr/bin/env node
/**
 * scripts/check-no-waitfortimeout.mjs (#1208)
 *
 * scripts/ 配下の `.mjs` / `.js` / `.cjs` に対し、`page.waitForTimeout(N)` / `.waitForTimeout(N)`
 * の実呼び出しを禁止する lint。`scripts/lib/screenshot-helpers.mjs` の `waitForStablePage()`
 * などに置き換える (ADR-0020 と同方針)。
 *
 * 許容: コメント / doc 内の文字列参照 (このファイル自身を含む)
 * 禁止: `.waitForTimeout(...)` メソッド呼び出し
 *
 * 終了コード: 違反なし=0 / 違反あり=1
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve('scripts');
const EXT = new Set(['.mjs', '.js', '.cjs']);
const violations = [];

function walk(dir) {
	for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
		const p = path.join(dir, ent.name);
		if (ent.isDirectory()) {
			if (ent.name === 'node_modules' || ent.name.startsWith('.')) continue;
			walk(p);
		} else if (EXT.has(path.extname(ent.name))) {
			check(p);
		}
	}
}

function check(file) {
	const src = fs.readFileSync(file, 'utf8');
	const lines = src.split(/\r?\n/);
	let inBlockComment = false;
	for (let i = 0; i < lines.length; i++) {
		let line = lines[i];
		// 複数行ブロックコメント (/** ... */) のトラッキング
		if (inBlockComment) {
			const endIdx = line.indexOf('*/');
			if (endIdx === -1) continue;
			line = line.slice(endIdx + 2);
			inBlockComment = false;
		}
		// 同一行内ブロックコメント除去
		line = line.replace(/\/\*[\s\S]*?\*\//g, '');
		// ブロックコメント開始 (閉じ無し)
		const startIdx = line.indexOf('/*');
		if (startIdx !== -1 && line.indexOf('*/', startIdx) === -1) {
			inBlockComment = true;
			line = line.slice(0, startIdx);
		}
		// 行コメント除去 + 文字列リテラル内は誤検知避けのためそのまま照合
		const stripped = line.replace(/\/\/.*$/, '');
		// バックティック / 引用符内の記述はスキップ (\`...waitForTimeout...\`)
		const inStringMatch = /['"`][^'"`]*\.waitForTimeout\s*\(/.test(stripped);
		if (!inStringMatch && /(\w|\))\.waitForTimeout\s*\(/.test(stripped)) {
			violations.push({ file, line: i + 1, text: line.trim() });
		}
	}
}

walk(ROOT);

if (violations.length > 0) {
	console.error('❌ scripts/ 配下で禁止された waitForTimeout 呼び出しが見つかりました (#1208)');
	for (const v of violations) {
		console.error(`  ${v.file}:${v.line}  ${v.text}`);
	}
	console.error(
		'\nscripts/lib/screenshot-helpers.mjs の waitForStablePage() 等に置き換えてください。',
	);
	process.exit(1);
}

console.log(`✅ scripts/ 配下に waitForTimeout の呼び出しなし (検査対象: ${ROOT})`);
