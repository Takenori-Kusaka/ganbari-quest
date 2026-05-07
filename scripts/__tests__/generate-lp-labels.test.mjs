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
import { describe, it } from 'node:test';
import {
	isTemplateLiteral,
	parseBlock,
	parseBlockLine,
	resolveAllTemplates,
	resolveTemplateLiteralValue,
} from '../generate-lp-labels.mjs';

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
	family: 'ファミリー',
};

export const LP_PLAN_LABELS = {
	standardLabel: \`\${PLAN_TERMS.standard}プラン\`,
	familyLabel: \`\${PLAN_TERMS.family}プラン\`,
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
		assert.equal(resolved.LP_PLAN_LABELS.familyLabel, 'ファミリープラン');
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
// AC5: shared-labels.js 出力差分ゼロ（本 PR 単独では terms.ts 未導入のため、
//      既存 labels.ts に template literal が混入していないことを確認）
// ---------------------------------------------------------------------------
describe('既存 labels.ts は template literal を含まない (#1917 AC5)', () => {
	it('parseBlock の戻り値は string のみ (TemplateLiteralValue 不在)', async () => {
		// 実 labels.ts を読み込んで全 namespace を検査
		const fs = await import('node:fs');
		const path = await import('node:path');
		const url = await import('node:url');
		const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
		const labelsTs = path.resolve(__dirname, '../../src/lib/domain/labels.ts');
		const src = fs.readFileSync(labelsTs, 'utf-8');

		// ランダム抽出: 主要 LP namespace を 5 件チェック
		const samples = [
			'LP_RETENTION_LABELS',
			'LP_CORELOOP_LABELS',
			'LP_NAV_LABELS',
			'LP_PRICING_LABELS',
			'LP_FAQ_LABELS',
		];
		for (const name of samples) {
			const block = parseBlock(src, name);
			for (const [key, value] of Object.entries(block)) {
				assert.equal(
					typeof value,
					'string',
					`labels.ts ${name}.${key} should be plain string (not template literal yet — #1916 で導入予定)`,
				);
			}
		}
	});
});
