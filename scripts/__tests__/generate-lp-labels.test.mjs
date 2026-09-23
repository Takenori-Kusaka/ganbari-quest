/**
 * scripts/__tests__/generate-lp-labels.test.mjs
 *
 * generate-lp-labels.mjs の template literal 対応 (#1917) のユニットテスト。
 * Phase 1 B1: terms.ts → labels.ts の SSOT 2 階層化を支える parser の単体検証。
 *
 * 実行: node --test scripts/__tests__/generate-lp-labels.test.mjs
 *
 * AC マッピング:
 *   - AC1: parseBlockLine が template literal 形式をマッチ
 *   - AC2: parseBlock + resolveAllTemplates で interpolation を解決
 *   - AC3: 解決失敗時は Unresolved ${ns}.${key} で throw
 *   - AC4: --check モード対応 (本テストは parser 単体、--check は CI 全体側で検証)
 *   - AC5: shared-labels.js 出力差分ゼロは fixture テストで検証
 *   - AC6: simple / nested / unresolved / multi-line を全パターン網羅
 *
 * 注: 本ファイルは fixture として literal な "${NS.key}" を文字列内に多数含むため、
 *     biome の noTemplateCurlyInString を file 全体で抑制する (intentional fixture)。
 */
/* biome-ignore-all lint/suspicious/noTemplateCurlyInString: fixture には literal "${NS.key}" を文字列として含む */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import {
	isTemplateLiteral,
	LOCAL_CONSTS_NS,
	parseAllNamespacesResolved,
	parseBlock,
	parseBlockLine,
	parseLabelsLocalConsts,
	resolveAllTemplates,
	resolveTemplateLiteralValue,
} from '../generate-lp-labels.mjs';
import {
	isLabelsLayerPath,
	LABELS_DIR,
	LABELS_ENTRY,
	labelSourceFiles,
	readLabelsSource,
} from '../lib/parse-labels-ts.mjs';

// ---------------------------------------------------------------------------
// AC1: parseBlockLine が template literal 形式をマッチ
// ---------------------------------------------------------------------------
describe('parseBlockLine — template literal 対応 (#1917 AC1)', () => {
	it('single quote 形式は従来どおり文字列として保持される', () => {
		/** @type {Record<string, string | { __template: true; raw: string }>} */
		const result = {};
		const pending = parseBlockLine("greeting: 'Hello world',", result, null);
		assert.equal(pending, null);
		assert.equal(result.greeting, 'Hello world');
		assert.equal(typeof result.greeting, 'string');
	});

	it('template literal (interpolation 1+) は __template: true マーカーで保持', () => {
		/** @type {Record<string, string | { __template: true; raw: string }>} */
		const result = {};
		const pending = parseBlockLine('greeting: `Hello ${WORLD.name}`,', result, null);
		assert.equal(pending, null);
		const value = result.greeting;
		assert.ok(isTemplateLiteral(value), 'template literal value should be marked');
		// raw はバッククォート内側をそのまま保持
		if (isTemplateLiteral(value)) {
			assert.equal(value.raw, 'Hello ${WORLD.name}');
		}
	});

	it('template literal で interpolation を含まないものも __template マーカーで保持', () => {
		/** @type {Record<string, string | { __template: true; raw: string }>} */
		const result = {};
		const pending = parseBlockLine('label: `static text`,', result, null);
		assert.equal(pending, null);
		const value = result.label;
		assert.ok(isTemplateLiteral(value));
		if (isTemplateLiteral(value)) {
			assert.equal(value.raw, 'static text');
		}
	});

	it('multi-line template literal: key: のみ → 次行 `value`,', () => {
		/** @type {Record<string, string | { __template: true; raw: string }>} */
		const result = {};
		const after1 = parseBlockLine('greeting:', result, null);
		assert.equal(after1, 'greeting');
		const after2 = parseBlockLine('`Hello ${WORLD.name}`,', result, after1);
		assert.equal(after2, null);
		const value = result.greeting;
		assert.ok(isTemplateLiteral(value));
		if (isTemplateLiteral(value)) {
			assert.equal(value.raw, 'Hello ${WORLD.name}');
		}
	});

	it('既存 single quote の multi-line も維持される', () => {
		/** @type {Record<string, string | { __template: true; raw: string }>} */
		const result = {};
		const after1 = parseBlockLine('greeting:', result, null);
		assert.equal(after1, 'greeting');
		const after2 = parseBlockLine("'Hello world',", result, after1);
		assert.equal(after2, null);
		assert.equal(result.greeting, 'Hello world');
	});
});

// ---------------------------------------------------------------------------
// AC2: parseBlock + resolveAllTemplates が template literal を文字列に解決
// ---------------------------------------------------------------------------
describe('resolveAllTemplates — interpolation 解決 (#1917 AC2)', () => {
	it('simple template literal: ${NS.key} 1 個', () => {
		/** @type {Record<string, Record<string, string | { __template: true; raw: string }>>} */
		const namespaces = {
			WORLD: { name: 'World' },
			GREETING: { hello: { __template: true, raw: 'Hello ${WORLD.name}' } },
		};
		const resolved = resolveAllTemplates(namespaces);
		assert.equal(resolved.GREETING.hello, 'Hello World');
		assert.equal(resolved.WORLD.name, 'World');
	});

	it('multiple interpolation in single template', () => {
		/** @type {Record<string, Record<string, string | { __template: true; raw: string }>>} */
		const namespaces = {
			PRICE: { currency: '¥', amount: '500' },
			LABEL: { full: { __template: true, raw: '${PRICE.currency}${PRICE.amount}/月' } },
		};
		const resolved = resolveAllTemplates(namespaces);
		assert.equal(resolved.LABEL.full, '¥500/月');
	});

	it('nested reference: TERMS_B → TERMS_A → 文字列', () => {
		/** @type {Record<string, Record<string, string | { __template: true; raw: string }>>} */
		const namespaces = {
			TERMS_A: { atom: 'スタンダード' },
			TERMS_B: { compound: { __template: true, raw: '${TERMS_A.atom}プラン' } },
			TERMS_C: { final: { __template: true, raw: '${TERMS_B.compound}は人気' } },
		};
		const resolved = resolveAllTemplates(namespaces);
		assert.equal(resolved.TERMS_A.atom, 'スタンダード');
		assert.equal(resolved.TERMS_B.compound, 'スタンダードプラン');
		assert.equal(resolved.TERMS_C.final, 'スタンダードプランは人気');
	});

	it('bracket notation: ${NS["key"]} と ${NS[\'key\']} 両方サポート', () => {
		/** @type {Record<string, Record<string, string | { __template: true; raw: string }>>} */
		const namespaces = {
			TERMS: { 'multi-word': 'value-A' },
			REF: {
				doubleQuote: { __template: true, raw: '${TERMS["multi-word"]}' },
				singleQuote: { __template: true, raw: "${TERMS['multi-word']}" },
			},
		};
		const resolved = resolveAllTemplates(namespaces);
		assert.equal(resolved.REF.doubleQuote, 'value-A');
		assert.equal(resolved.REF.singleQuote, 'value-A');
	});

	it('文字列値はそのまま (template literal 不在 namespace)', () => {
		/** @type {Record<string, Record<string, string | { __template: true; raw: string }>>} */
		const namespaces = {
			SIMPLE: { a: 'A', b: 'B' },
		};
		const resolved = resolveAllTemplates(namespaces);
		assert.deepEqual(resolved.SIMPLE, { a: 'A', b: 'B' });
	});
});

// ---------------------------------------------------------------------------
// AC3: 解決失敗時は throw + 詳細表示
// ---------------------------------------------------------------------------
describe('resolveTemplateLiteralValue — エラー表示 (#1917 AC3)', () => {
	it('namespace 不在: "Unresolved UNKNOWN_NS.foo in OWNER" で throw', () => {
		const namespaces = { TERMS: { atom: 'X' } };
		assert.throws(
			() =>
				resolveTemplateLiteralValue(
					'Hello ${UNKNOWN_NS.foo}',
					namespaces,
					'LP_HERO_PRICE_BAND_LABELS.itemFree',
				),
			(err) => {
				assert.ok(err instanceof Error);
				assert.match(err.message, /Unresolved UNKNOWN_NS\.foo/);
				assert.match(err.message, /LP_HERO_PRICE_BAND_LABELS\.itemFree/);
				return true;
			},
		);
	});

	it('key 不在: "Unresolved TERMS.unknownKey" で throw', () => {
		const namespaces = { TERMS: { atom: 'X' } };
		assert.throws(
			() =>
				resolveTemplateLiteralValue(
					'Hello ${TERMS.unknownKey}',
					namespaces,
					'LP_HERO_PRICE_BAND_LABELS.itemFree',
				),
			/Unresolved TERMS\.unknownKey in LP_HERO_PRICE_BAND_LABELS\.itemFree/,
		);
	});

	it('nested resolution での不在も同形式で throw', () => {
		/** @type {Record<string, Record<string, string | { __template: true; raw: string }>>} */
		const namespaces = {
			A: { foo: { __template: true, raw: '${B.bar}' } },
			B: {}, // bar が無い
		};
		assert.throws(() => resolveAllTemplates(namespaces), /Unresolved B\.bar in A\.foo/);
	});

	it('循環参照: max depth 超過で throw', () => {
		/** @type {Record<string, Record<string, string | { __template: true; raw: string }>>} */
		const namespaces = {
			A: { x: { __template: true, raw: '${B.y}' } },
			B: { y: { __template: true, raw: '${A.x}' } },
		};
		assert.throws(
			() => resolveAllTemplates(namespaces),
			/Template literal resolution exceeded max depth/,
		);
	});

	it('未サポートな式 (関数呼出など) は throw', () => {
		const namespaces = { TERMS: { atom: 'X' } };
		assert.throws(
			() => resolveTemplateLiteralValue('Hello ${getName()}', namespaces, 'LP_TEST.key'),
			/Unsupported template literal expression/,
		);
	});
});

// ---------------------------------------------------------------------------
// AC6: parseBlock 統合テスト (template literal を含む namespace)
// ---------------------------------------------------------------------------
describe('parseBlock — template literal 統合 (#1917 AC6)', () => {
	it('mixed (single quote + template literal) を一括パース、resolveAllTemplates で解決', () => {
		const fixture = `
export const PLAN_TERMS = {
	standard: 'スタンダード',
	premium: 'プレミアム',
};

export const LP_PLAN_LABELS = {
	standardLabel: \`\${PLAN_TERMS.standard}プラン\`,
	premiumLabel: \`\${PLAN_TERMS.premium}プラン\`,
	mixedNote: 'これは静的テキスト',
};
`;
		const planTerms = parseBlock(fixture, 'PLAN_TERMS');
		const lpPlanLabels = parseBlock(fixture, 'LP_PLAN_LABELS');

		const resolved = resolveAllTemplates({
			PLAN_TERMS: planTerms,
			LP_PLAN_LABELS: lpPlanLabels,
		});

		assert.equal(resolved.PLAN_TERMS.standard, 'スタンダード');
		assert.equal(resolved.LP_PLAN_LABELS.standardLabel, 'スタンダードプラン');
		assert.equal(resolved.LP_PLAN_LABELS.premiumLabel, 'プレミアムプラン');
		assert.equal(resolved.LP_PLAN_LABELS.mixedNote, 'これは静的テキスト');
	});

	it('multi-line template literal (Biome 改行整形) も解決される', () => {
		const fixture = `
export const X = {
	atom: 'value-A',
};

export const Y = {
	compound:
		\`prefix \${X.atom} suffix\`,
};
`;
		const x = parseBlock(fixture, 'X');
		const y = parseBlock(fixture, 'Y');
		const resolved = resolveAllTemplates({ X: x, Y: y });
		assert.equal(resolved.Y.compound, 'prefix value-A suffix');
	});

	it('実 Issue #1917 例: PLAN_TERMS.standard + PRICE_TERMS.standard の interpolation', () => {
		const fixture = `
export const PLAN_TERMS = {
	standard: 'スタンダード',
};

export const PRICE_TERMS = {
	monthlyPrefix: '月額',
	standard: '500円',
};

export const LP_HERO_PRICE_BAND_LABELS = {
	itemStandard: \`\${PLAN_TERMS.standard}は\${PRICE_TERMS.monthlyPrefix}\${PRICE_TERMS.standard}\`,
};
`;
		const planTerms = parseBlock(fixture, 'PLAN_TERMS');
		const priceTerms = parseBlock(fixture, 'PRICE_TERMS');
		const heroLabels = parseBlock(fixture, 'LP_HERO_PRICE_BAND_LABELS');

		const resolved = resolveAllTemplates({
			PLAN_TERMS: planTerms,
			PRICE_TERMS: priceTerms,
			LP_HERO_PRICE_BAND_LABELS: heroLabels,
		});

		assert.equal(resolved.LP_HERO_PRICE_BAND_LABELS.itemStandard, 'スタンダードは月額500円');
	});
});

// ---------------------------------------------------------------------------
// 実 labels.ts / terms.ts を通した解決 (旧 #1917 AC5 の再照準)
//
// 旧 test は「labels.ts に template literal が混入していないこと」を assert していた。これは
// terms.ts 導入前 (#1916 の前) の過渡状態を固定したもので、#1916 / ADR-0045 で labels.ts が
// terms.ts atom を interpolation 参照する compound になった時点で意味が反転している
// (今は template literal があるのが正しい)。本 file は CI で実行されていなかったため
// 反転に気づけないまま残っていた。
//
// 実装を古い仕様に戻すのではなく、今守るべき不変条件に照準し直す:
//   1. 実 labels.ts の LP namespace に template literal が現に存在する (ADR-0045 の atom 参照が
//      効いている = 「全部 plain string に戻した」退行を検出する)
//   2. 実 labels.ts + terms.ts を通したとき、全 namespace の全 value が解決済みの string になる
//      (未解決の interpolation が LP へ配信されない)
// ---------------------------------------------------------------------------
describe('実 labels.ts / terms.ts は template literal を含み、かつ全て解決できる (ADR-0045)', () => {
	it('LP namespace に template literal が現に存在する (atom 参照が生きている)', () => {
		// #4965: labels 層 (入口 labels.ts + labels/*.ts) の連結本文を生成器と同じ経路で読む
		const src = readLabelsSource();

		const samples = [
			'LP_RETENTION_LABELS',
			'LP_CORELOOP_LABELS',
			'LP_NAV_LABELS',
			'LP_PRICING_LABELS',
			// #4866 系: 配信されていない LP_FAQ_LABELS は削除済み。
			// **実際に配信されている** faqB 側を sample にする (死んだ namespace を見張っても意味が無い)。
			'LP_FAQ_PHASEB_LABELS',
		];
		let templateCount = 0;
		for (const name of samples) {
			const block = parseBlock(src, name);
			assert.ok(Object.keys(block).length > 0, `${name} が parseBlock で読めていない`);
			for (const value of Object.values(block)) {
				if (isTemplateLiteral(value)) templateCount += 1;
			}
		}
		assert.ok(
			templateCount > 0,
			'LP namespace に template literal が 1 件も無い。terms.ts atom 参照 (ADR-0045) が文字列直書きへ退行した可能性がある',
		);
	});

	it('parseAllNamespacesResolved の結果は全て解決済み string (未解決の interpolation が残らない)', () => {
		const resolved = parseAllNamespacesResolved();
		assert.ok(Object.keys(resolved).length > 0, 'namespace が 1 件も解決されていない');
		const unresolvedPattern = /\$\{/;
		for (const [ns, block] of Object.entries(resolved)) {
			for (const [key, value] of Object.entries(block)) {
				assert.equal(typeof value, 'string', `${ns}.${key} が解決後も string になっていない`);
				assert.ok(
					!unresolvedPattern.test(String(value)),
					`${ns}.${key} に未解決の interpolation が残っている: ${value}`,
				);
			}
		}
	});
});

// ---------------------------------------------------------------------------
// #4619: labels.ts の module-local 共有 const を値にした key を無言で捨てない
// ---------------------------------------------------------------------------
describe('module-local 共有 const 参照 (#4619)', () => {
	it('parseLabelsLocalConsts が module-level const を拾う (関数内ローカルは拾わない)', () => {
		const fixture = [
			"const SHARED_PLAIN = 'そのままの文';",
			'const SHARED_TEMPLATE = `${PLAN_TERMS.standard}は継続できます`;',
			'function f() {',
			"\tconst INNER_LOCAL = 'これは対象外';",
			'\treturn INNER_LOCAL;',
			'}',
		].join('\n');
		const locals = parseLabelsLocalConsts(fixture);
		assert.equal(locals.SHARED_PLAIN, 'そのままの文');
		assert.ok(isTemplateLiteral(locals.SHARED_TEMPLATE));
		assert.equal(locals.INNER_LOCAL, undefined);
	});

	it('key: SHARED_CONST 形式が捨てられず、共有 const の値に解決される', () => {
		/** @type {Record<string, string | { __template: true; raw: string }>} */
		const result = {};
		const pending = parseBlockLine('k20: WRITES_CONTINUE_ASSURANCE,', result, null);
		assert.equal(pending, null);
		assert.ok(isTemplateLiteral(result.k20), 'bare identifier が template として保持されていない');

		const namespaces = {
			[LOCAL_CONSTS_NS]: { WRITES_CONTINUE_ASSURANCE: '記録は続けられます。' },
			LP_TEST: result,
		};
		assert.equal(resolveAllTemplates(namespaces).LP_TEST.k20, '記録は続けられます。');
	});

	it('存在しない共有 const 参照は無言で落ちず throw する', () => {
		assert.throws(
			() =>
				resolveTemplateLiteralValue('${NO_SUCH_CONST}', { [LOCAL_CONSTS_NS]: {} }, 'LP_TEST.key'),
			/Unresolved local const NO_SUCH_CONST/,
		);
	});

	it('実 labels.ts: 解約 FAQ の 5 key が shared-labels 生成対象に残っている', () => {
		// k20 / k21 は共有 const を値に持つ。parser が捨てると LP は古い fallback を出し続ける。
		const faqB = parseAllNamespacesResolved().LP_FAQ_PHASEB_LABELS;
		for (const key of ['k19', 'k20', 'k21', 'k22', 'k124']) {
			assert.ok(faqB[key], `LP_FAQ_PHASEB_LABELS.${key} が解決結果から欠落している`);
		}
	});
});

// ---------------------------------------------------------------------------
// #4965: labels 層はファイルに分かれる (入口 labels.ts + labels/*.ts)
// ---------------------------------------------------------------------------
describe('labels 層の複数ファイル対応 (#4965)', () => {
	it('別ファイルから使う共有 const (`export const`) も共有 const として拾う', () => {
		const fixture = [
			'export const SHARED_EXPORTED = `${PLAN_TERMS.standard}は継続できます`;',
			"export const SHARED_PLAIN = 'そのままの文';",
			"export const NOT_SHARED = 'as const は対象外' as const;",
		].join('\n');
		const locals = parseLabelsLocalConsts(fixture);
		assert.ok(isTemplateLiteral(locals.SHARED_EXPORTED));
		assert.equal(locals.SHARED_PLAIN, 'そのままの文');
		assert.equal(locals.NOT_SHARED, undefined);
	});

	it('同じ名前の共有 const が 2 つあれば throw する (連結順で値が変わるのを許さない)', () => {
		const fixture = ["const DUP = 'a';", "export const DUP = 'b';"].join('\n');
		assert.throws(() => parseLabelsLocalConsts(fixture), /DUP/);
	});

	it('parseBlock は名前の前方一致で別の namespace を拾わない', () => {
		const fixture = [
			'export const LP_PRICING_PHASEB_LABELS = {',
			"\tk1: 'phaseB',",
			'} as const;',
			'export const LP_PRICING = {',
			"\tk1: 'exact',",
			'} as const;',
		].join('\n');
		assert.deepEqual(parseBlock(fixture, 'LP_PRICING'), { k1: 'exact' });
	});
});

describe('parse-labels-ts: labels 層のファイル一覧と本文 (#4965)', () => {
	/** @param {Record<string, string>} files repo 相対パス → 本文 */
	function makeRepo(files) {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), 'labels-layer-'));
		for (const [rel, text] of Object.entries(files)) {
			fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
			fs.writeFileSync(path.join(root, rel), text);
		}
		return root;
	}

	it('labels/ が無ければ入口だけを返す', () => {
		const root = makeRepo({ 'src/lib/domain/labels.ts': "export const A = { k: 'a' };\n" });
		assert.deepEqual(labelSourceFiles(root), [LABELS_ENTRY]);
		assert.equal(readLabelsSource(root), "export const A = { k: 'a' };\n");
	});

	it('入口 → labels/*.ts (名前順) の順に並べ、test file と .ts 以外は含めない', () => {
		const root = makeRepo({
			'src/lib/domain/labels.ts': "export * from './labels/b';\n",
			'src/lib/domain/labels/b.ts': "export const B = { k: 'b' };\n",
			'src/lib/domain/labels/a.ts': "export const A = { k: 'a' };\n",
			'src/lib/domain/labels/a.test.ts': "const X = 'test';\n",
			'src/lib/domain/labels/README.md': '# memo\n',
		});
		assert.deepEqual(labelSourceFiles(root), [
			LABELS_ENTRY,
			`${LABELS_DIR}/a.ts`,
			`${LABELS_DIR}/b.ts`,
		]);
		const src = readLabelsSource(root);
		assert.ok(src.indexOf('export const A') < src.indexOf('export const B'));
		assert.ok(!src.includes("'test'"));
	});

	it('入口に export * を書き忘れたファイルも一覧に入る (テキスト検査から漏らさない)', () => {
		const root = makeRepo({
			'src/lib/domain/labels.ts': '',
			'src/lib/domain/labels/lp.ts': "export const LP_X_LABELS = { k: 'x' };\n",
		});
		assert.ok(labelSourceFiles(root).includes(`${LABELS_DIR}/lp.ts`));
	});

	it('labels/ にサブディレクトリがあれば throw する (フラット構成の前提)', () => {
		const root = makeRepo({
			'src/lib/domain/labels.ts': '',
			'src/lib/domain/labels/admin/rewards.ts': "export const R = { k: 'r' };\n",
		});
		assert.throws(() => labelSourceFiles(root), /サブディレクトリ/);
	});

	it('isLabelsLayerPath は入口と labels/ 直下の .ts だけを labels 層とみなす', () => {
		assert.equal(isLabelsLayerPath('src/lib/domain/labels.ts'), true);
		assert.equal(isLabelsLayerPath('src/lib/domain/labels/lp.ts'), true);
		assert.equal(isLabelsLayerPath('src\\lib\\domain\\labels\\lp.ts'), true);
		assert.equal(isLabelsLayerPath('src/lib/domain/labels/sub/x.ts'), false);
		// labelSourceFiles() と同じく、labels/ 直下の test / spec は labels 層のソースではない
		assert.equal(isLabelsLayerPath('src/lib/domain/labels/foo.test.ts'), false);
		assert.equal(isLabelsLayerPath('src/lib/domain/labels/foo.spec.ts'), false);
		assert.equal(isLabelsLayerPath('src/lib/domain/labels-extra.ts'), false);
		assert.equal(isLabelsLayerPath('src/lib/domain/terms.ts'), false);
	});
});
