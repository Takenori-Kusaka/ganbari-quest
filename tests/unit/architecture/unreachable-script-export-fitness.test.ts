// tests/unit/architecture/unreachable-script-export-fitness.test.ts (#4623)
//
// # 何を守るか
//
// `scripts/**` に **export されているが、どの entry / registry / 他モジュールからも呼ばれない
// 判定関数**が残るのを禁止する。
//
// # なぜ機械化するか
//
// 同 class が 4 件連続した (ADR-0061 same-class-N→guard):
//   #4611 `checkPerPrAcMap` / #4614 `checkAcMap` `checkChangeTypeSelection` `checkChangeType`
//   / #4623 `checkTestResults` `detectTestSectionHeading` `detectTestSectionKeyword`
// いずれも「CI job を撤去したときに判定関数だけ置き去りにした」残骸で、**読む人が毎回
// registry / workflow / import を辿らないと生死が分からない**。しかも死んだ判定を善意で
// 配線し直すと、入力側 (テンプレートの節) が既に無いため全 PR が hard-fail する。
//
// knip では捕まらない: unit test が import している限り「使われている」と見えるため、
// **test が生存証明として機能してしまう**。判定関数は本番経路が死んでも test は緑のままになる。
//
// # 判定方法
//
// 文字列 grep ではなく TypeScript の parser で AST を作り、Identifier の出現数で参照を数える。
// grep でコメントを除去しようとすると正規表現リテラル (`/^https?:\/\//i`) の末尾を `//`
// コメントと誤認する — 実測でこれが生きている `isUserAttachmentAssetUrl` を dead と誤検出した。
//
// 参照元 (CONSUMER_ROOTS) に **test を含めない**。含めると上記のとおり検査が無意味になる。
// 「fitness function からしか呼ばれないのが正しい」export は ALLOWLIST に理由付きで載せる。
import { globSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = resolve(import.meta.dirname, '../../..');

/** 検査対象の走査 root (ここに宣言された export function を見る)。 */
const TARGET_ROOTS = ['scripts'];

/**
 * 参照元として数える production コードの走査 root。
 *
 * **test を参照元に入れてはならない** — test からの import を参照と数えると、本番経路が死んで
 * いても「使われている」ことになり、本 gate が守りたいものを守れなくなる。
 *
 * 除外は 2 経路で効いている: `tests/**` は `.ts` なので下の `.mjs` glob に入らない。
 * `scripts/__tests__/**`(node:test) は `.mjs` なので `EXCLUDED_PATH_PARTS` で明示除外する。
 */
const CONSUMER_ROOTS = ['scripts', '.claude/hooks'];

/** 走査から外す path 断片 (test は参照元に数えない、上記参照)。 */
const EXCLUDED_PATH_PARTS = ['__tests__', 'node_modules'];

/**
 * 「到達しないが残してよい」export と、その理由。
 *
 * 理由なし / stub な理由は置かない (理由の非強制を作らない、#3956 教訓)。ここに足すときは
 * **なぜ production から呼ばれないのが正しいのか**を書く。単に「まだ使っていない」は理由に
 * ならない — その場合は削除する。
 */
const ALLOWLIST: Record<string, string> = {
	'scripts/lib/ci/workflow-judgment-registry.mjs#findJudgment':
		'本 registry の consumer は tests/unit/architecture/workflow-judgment-delegation-guard.test.ts (CI unit lane で常時実行される fitness function) であり、それが production consumer そのもの。findJudgment は [D1] no-silent-gap (covered workflow の全 job が registry に宣言されているか) を実装する唯一の経路で、消すと [D1] が表現できなくなる',
};

type Decl = { file: string; name: string; start: number; end: number; nameStart: number };

const norm = (p: string) => p.replace(/\\/g, '/');
const included = (p: string) => !EXCLUDED_PATH_PARTS.some((part) => p.includes(part));

function expandRoots(roots: string[]): string[] {
	const out = new Set<string>();
	for (const root of roots) {
		for (const f of globSync(`${root}/**/*.mjs`, { cwd: REPO_ROOT })) {
			const rel = norm(String(f));
			if (included(rel)) out.add(rel);
		}
	}
	return [...out].sort();
}

function parse(rel: string): ts.SourceFile {
	const text = readFileSync(resolve(REPO_ROOT, rel), 'utf8');
	return ts.createSourceFile(rel, text, ts.ScriptTarget.ESNext, true, ts.ScriptKind.JS);
}

/** top-level の `export function NAME` 宣言を、その本文の範囲つきで返す。 */
function exportedFunctionDecls(rel: string, sf: ts.SourceFile): Decl[] {
	const out: Decl[] = [];
	for (const st of sf.statements) {
		if (!ts.isFunctionDeclaration(st) || !st.name) continue;
		const exported = st.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
		if (!exported) continue;
		out.push({
			file: rel,
			name: st.name.text,
			start: st.getStart(sf),
			end: st.getEnd(),
			nameStart: st.name.getStart(sf),
		});
	}
	return out;
}

/** file 内の全 Identifier 出現 (AST 由来なのでコメント / 文字列は含まれない)。 */
function identifiers(sf: ts.SourceFile): { name: string; pos: number }[] {
	const out: { name: string; pos: number }[] = [];
	const visit = (node: ts.Node) => {
		if (ts.isIdentifier(node)) out.push({ name: node.text, pos: node.getStart(sf) });
		ts.forEachChild(node, visit);
	};
	ts.forEachChild(sf, visit);
	return out;
}

type Index = {
	targets: string[];
	consumers: string[];
	declsOf: Map<string, Decl[]>;
	identsOf: Map<string, { name: string; pos: number }[]>;
};

function buildIndex(): Index {
	const targets = expandRoots(TARGET_ROOTS);
	const consumers = expandRoots(CONSUMER_ROOTS);
	const declsOf = new Map<string, Decl[]>();
	const identsOf = new Map<string, { name: string; pos: number }[]>();
	for (const rel of new Set([...targets, ...consumers])) {
		const sf = parse(rel);
		declsOf.set(rel, exportedFunctionDecls(rel, sf));
		identsOf.set(rel, identifiers(sf));
	}
	return { targets, consumers, declsOf, identsOf };
}

/**
 * `decl` への参照数を数える。
 *
 * すでに死んでいると分かった関数の本体からの参照は数えない (chain 全体が死んでいる場合に、
 * 片端だけ生き残って見えるのを防ぐ)。
 */
function countReferences(index: Index, decl: Decl, dead: Set<string>): number {
	let refs = 0;
	for (const cf of index.consumers) {
		const deadSpans = (index.declsOf.get(cf) ?? []).filter((x) => dead.has(`${cf}#${x.name}`));
		for (const id of index.identsOf.get(cf) ?? []) {
			if (id.name !== decl.name) continue;
			if (cf === decl.file && id.pos === decl.nameStart) continue; // 宣言そのもの
			if (deadSpans.some((s) => id.pos >= s.start && id.pos < s.end)) continue;
			refs += 1;
		}
	}
	return refs;
}

/** 到達不能な export を `<file>#<name>` の形で返す (収束するまで繰り返す)。 */
function findUnreachable(): string[] {
	const index = buildIndex();
	const dead = new Set<string>();
	for (let round = 0; round < 20; round += 1) {
		let changed = false;
		for (const file of index.targets) {
			for (const decl of index.declsOf.get(file) ?? []) {
				const key = `${file}#${decl.name}`;
				if (dead.has(key)) continue;
				if (countReferences(index, decl, dead) > 0) continue;
				dead.add(key);
				changed = true;
			}
		}
		if (!changed) break;
	}
	return [...dead].sort();
}

describe('#4623 scripts/ の export された判定関数は entry / registry から到達できる', () => {
	it('到達不能な export は ALLOWLIST に理由付きで載っているものだけ', () => {
		const unreachable = findUnreachable();
		const undeclared = unreachable.filter((key) => !(key in ALLOWLIST));

		expect(
			undeclared,
			[
				'export されているが、どの entry / registry / 他モジュールからも呼ばれない判定関数を検出しました (#4623)。',
				'',
				'次のどれかを行ってください:',
				'  (a) 削除する — 配線 (workflow job / registry 登録 / テンプレート節) ごと消えているなら、判定関数だけ残さない',
				'  (b) 配線し直す — 入力側 (テンプレートの節 / workflow の invoke) が実在することを確認してから registry に載せる',
				'  (c) ALLOWLIST に載せる — 「production から呼ばれないのが正しい」理由を書く。「まだ使っていない」は理由になりません',
				'',
				`検出: ${undeclared.join(', ')}`,
			].join('\n'),
		).toEqual([]);
	}, 60_000);

	it('ALLOWLIST に stale なエントリが無い（到達するようになったら宣言を消す）', () => {
		const unreachable = new Set(findUnreachable());
		const stale = Object.keys(ALLOWLIST).filter((key) => !unreachable.has(key));

		expect(
			stale,
			[
				'ALLOWLIST のエントリが到達可能になっている / 対象が消えています (#4623)。',
				'宣言を残したままにすると、次に同じ名前が死んだときに黙って見逃します。該当行を削除してください。',
				'',
				`stale: ${stale.join(', ')}`,
			].join('\n'),
		).toEqual([]);
	}, 60_000);

	// 現時点では「scripts/__tests__ からしか参照されない export」が存在しないため、除外を外しても
	// 検出結果は変わらない (実測)。つまり除外の効きは検出結果からは確認できない。効かなくなった
	// ことに後から気づけるよう、参照元集合そのものを直接 assert する。
	it('参照元集合に test は 1 件も入っていない（test を生存証明にしない）', () => {
		const consumers = expandRoots(CONSUMER_ROOTS);
		expect(consumers.length, '参照元が 0 件 = 全 export が dead 判定される').toBeGreaterThan(0);
		expect(consumers.filter((f) => f.includes('__tests__') || /\.test\.mjs$/.test(f))).toEqual([]);
	});

	it('ALLOWLIST の理由は stub でない', () => {
		for (const [key, reason] of Object.entries(ALLOWLIST)) {
			expect(reason.trim().length, `${key} の理由が短すぎます`).toBeGreaterThanOrEqual(30);
			expect(reason, `${key} の理由が定型 stub です`).not.toMatch(/^(TODO|n\/a|なし|未定)$/i);
		}
	});
});
