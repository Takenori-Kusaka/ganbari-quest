/**
 * tests/unit/scripts/check-pr-template-sections-sync.test.ts (#2060)
 *
 * scripts/check-pr-template-sections-sync.mjs の純粋関数 unit test。
 * `.github/PULL_REQUEST_TEMPLATE.md` (template) と
 * `.github/PR_TEMPLATE_SECTIONS.json` (SSOT JSON) の drift 検出ロジックを検証する。
 *
 * 設計背景: PR #2039 / #2043 で「必須セクション 12 件全欠落」が連続再発した教訓に基づき、
 * SSOT JSON と template の同期を CI gate 化する drift 検出機構。
 */

import { describe, expect, it } from 'vitest';

import {
	diffSections,
	extractJsonSections,
	extractTemplateSections,
} from '../../../scripts/check-pr-template-sections-sync.mjs';

describe('extractTemplateSections', () => {
	it('## 見出しのみを抽出する (### / #### は除外)', () => {
		const tpl = [
			'## 顧客価値・目的',
			'',
			'本文',
			'',
			'### サブ見出し',
			'',
			'## 関連 Issue',
			'',
			'本文 2',
			'',
			'#### 孫見出し',
			'',
			'## AC 検証マップ (ADR-0004)',
			'',
		].join('\n');
		expect(extractTemplateSections(tpl)).toEqual([
			'## 顧客価値・目的',
			'## 関連 Issue',
			'## AC 検証マップ (ADR-0004)',
		]);
	});

	it('## が無いテンプレートは空配列', () => {
		expect(extractTemplateSections('# Top\nbody\n')).toEqual([]);
	});

	it('末尾空白は trim される', () => {
		const tpl = '## 顧客価値・目的   \n本文\n## 関連 Issue  \n';
		expect(extractTemplateSections(tpl)).toEqual(['## 顧客価値・目的', '## 関連 Issue']);
	});
});

describe('extractJsonSections', () => {
	it('sections 配列を文字列化して返す', () => {
		const json = JSON.stringify({
			sections: ['## A', '## B', '## C'],
		});
		expect(extractJsonSections(json)).toEqual(['## A', '## B', '## C']);
	});

	it('sections が無い JSON は throw', () => {
		expect(() => extractJsonSections('{}')).toThrow(/sections.*array/);
	});

	it('sections が array でない場合 throw', () => {
		expect(() => extractJsonSections(JSON.stringify({ sections: 'not-array' }))).toThrow(
			/sections.*array/,
		);
	});

	it('JSON parse 失敗時は throw', () => {
		expect(() => extractJsonSections('not-json')).toThrow();
	});
});

describe('diffSections', () => {
	it('完全一致は missingInJson / extraInJson が空 + orderMismatch false', () => {
		const r = diffSections(['## A', '## B', '## C'], ['## A', '## B', '## C']);
		expect(r.missingInJson).toEqual([]);
		expect(r.extraInJson).toEqual([]);
		expect(r.orderMismatch).toBe(false);
	});

	it('template に在るが JSON に無い見出しを missingInJson に挙げる', () => {
		const r = diffSections(['## A', '## B', '## C'], ['## A', '## C']);
		expect(r.missingInJson).toEqual(['## B']);
		expect(r.extraInJson).toEqual([]);
	});

	it('JSON に在るが template に無い見出しを extraInJson に挙げる', () => {
		const r = diffSections(['## A', '## B'], ['## A', '## B', '## C']);
		expect(r.missingInJson).toEqual([]);
		expect(r.extraInJson).toEqual(['## C']);
	});

	it('同要素でも順序違いを orderMismatch で検出 (template 順序が SSOT)', () => {
		const r = diffSections(['## A', '## B', '## C'], ['## A', '## C', '## B']);
		expect(r.missingInJson).toEqual([]);
		expect(r.extraInJson).toEqual([]);
		expect(r.orderMismatch).toBe(true);
	});

	it('missing がある場合は orderMismatch を立てない (重複報告を避ける)', () => {
		const r = diffSections(['## A', '## B'], ['## A']);
		expect(r.missingInJson).toEqual(['## B']);
		expect(r.orderMismatch).toBe(false);
	});

	it('#2060 reproduction: 13 件 SSOT 全件一致パターン (PULL_REQUEST_TEMPLATE.md 現状)', () => {
		const sections = [
			'## 顧客価値・目的',
			'## 関連 Issue',
			'## AC 検証マップ (ADR-0004)',
			'## 変更タイプ',
			'## 影響範囲・変更コンポーネント',
			'## テスト & 安全装置セルフチェック',
			'## スクリーンショット / ビジュアルデモ',
			'## コード品質セルフレビュー (#1481)',
			'## 横展開・影響波及チェック',
			'## レビュー依頼事項・破壊的変更',
			'## 配布済み env / secret (ADR-0006)',
			'## Ready for Review チェックリスト',
			'## QM レビュー結果',
		];
		const r = diffSections(sections, sections);
		expect(r.missingInJson).toEqual([]);
		expect(r.extraInJson).toEqual([]);
		expect(r.orderMismatch).toBe(false);
	});

	it('#2060 reproduction: PR #2039 / #2043 で 12 件全欠落のシナリオ (JSON 完全空)', () => {
		const tplSections = ['## 顧客価値・目的', '## 関連 Issue', '## AC 検証マップ (ADR-0004)'];
		const r = diffSections(tplSections, []);
		expect(r.missingInJson).toEqual(tplSections);
		expect(r.extraInJson).toEqual([]);
	});
});
