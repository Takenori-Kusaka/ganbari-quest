/**
 * tests/unit/scripts/check-internal-terms-self-ref.test.ts (#3299)
 *
 * check-internal-terms.mjs の self-ref-change group (UI 文字列への実装変更の自己言及検出) の
 * 検出/非検出境界を回帰固定する。#3259 で導入した lint には Fix 時の一時 probe しか無く、
 * ADR-0061 (guard は test で守る) に沿い永続 unit test を追加する。
 *
 * 検証境界:
 *   - string リテラル行の banlist 語は hit する
 *   - comment 行 (// / * / 行内なし / <!-- -->) の同語は hit しない (開発記録コメントは正当)
 *   - 初版 9 語 + #3299 追加の言い換え語の双方を検出する
 *   - 子供向け内容語 / 正当な成功 toast (まとめました / 変更しました / 改善しました) は誤検出しない
 *   - 完全網羅ではない (言い換えは無限) — regression guard としての境界を固定する
 */

import { describe, expect, it } from 'vitest';
import {
	findSelfRefChangeHits,
	isCommentLine,
	SELF_REF_CHANGE_BANLIST,
} from '../../../scripts/check-internal-terms.mjs';

describe('check-internal-terms self-ref-change group (#3299)', () => {
	describe('findSelfRefChangeHits — string リテラルを検出', () => {
		it('初版 9 語の「整理しました」を string 行で検出する', () => {
			const hits = findSelfRefChangeHits(`const x = '設定をグループ別に整理しました';`);
			expect(hits).toHaveLength(1);
			expect(hits[0]?.pattern).toBe('整理しました');
			expect(hits[0]?.line).toBe(1);
		});

		it('#3299 追加の言い換え語 (見直しました / 分類しました / 再編しました) を検出する', () => {
			for (const phrase of [
				'使いやすく見直しました',
				'カード別に分類しました',
				'画面を再編しました',
			]) {
				const hits = findSelfRefChangeHits(`label: '${phrase}'`);
				expect(hits.length, phrase).toBe(1);
			}
		});

		it('複数行で正しい行番号を返す', () => {
			const text = ['行1: ふつうの文言', `行2: '統合しました'`, '行3: ふつうの文言'].join('\n');
			const hits = findSelfRefChangeHits(text);
			expect(hits).toHaveLength(1);
			expect(hits[0]?.line).toBe(2);
			expect(hits[0]?.pattern).toBe('統合しました');
		});
	});

	describe('findSelfRefChangeHits — comment 行は除外 (開発記録は正当)', () => {
		it('// 行コメント中の banlist 語は hit しない', () => {
			expect(findSelfRefChangeHits('// #3033 で開始導線を整理しました')).toHaveLength(0);
		});

		it('JSDoc (* 始まり) コメント中の語は hit しない', () => {
			expect(findSelfRefChangeHits(' * 旧 LABELS は本 PR で統合しました')).toHaveLength(0);
		});

		it('HTML コメント (<!-- -->) 中の語は hit しない', () => {
			expect(findSelfRefChangeHits('<!-- ここは再編しました -->')).toHaveLength(0);
		});
	});

	describe('findSelfRefChangeHits — 誤検出しない (内容語 / 成功 toast)', () => {
		it('データ要約「がんばりをまとめました」は hit しない (まとめました は非対象語)', () => {
			expect(
				findSelfRefChangeHits(`hint: '1 か月のお子さまのがんばりをまとめました'`),
			).toHaveLength(0);
		});

		it('正当な成功 toast (変更しました / 改善しました) は hit しない (汎用動詞は非対象)', () => {
			expect(findSelfRefChangeHits(`toast: 'ポイントを変更しました'`)).toHaveLength(0);
			expect(findSelfRefChangeHits(`toast: '記録を改善しました'`)).toHaveLength(0);
		});

		it('自己言及のない純粋な操作案内は hit しない', () => {
			expect(
				findSelfRefChangeHits(`hubDesc: '下のカードから設定したい項目を選んでください。'`),
			).toHaveLength(0);
		});
	});

	describe('isCommentLine 境界', () => {
		it('// / * / <!-- 始まりを comment 判定する', () => {
			expect(isCommentLine('// foo')).toBe(true);
			expect(isCommentLine(' * foo')).toBe(true);
			expect(isCommentLine('<!-- foo -->')).toBe(true);
		});
		it('コード行 (string 値を含む) は comment ではない', () => {
			expect(isCommentLine(`label: '整理しました'`)).toBe(false);
		});
	});

	describe('SELF_REF_CHANGE_BANLIST 構成', () => {
		it('初版 9 語 + #3299 追加語を含む', () => {
			// 初版
			expect(SELF_REF_CHANGE_BANLIST).toContain('整理しました');
			expect(SELF_REF_CHANGE_BANLIST).toContain('生まれ変わりました');
			// #3299 追加
			expect(SELF_REF_CHANGE_BANLIST).toContain('見直しました');
			expect(SELF_REF_CHANGE_BANLIST).toContain('分類しました');
			// 汎用動詞は誤検出回避のため意図的に非収録
			expect(SELF_REF_CHANGE_BANLIST).not.toContain('変更しました');
			expect(SELF_REF_CHANGE_BANLIST).not.toContain('改善しました');
			expect(SELF_REF_CHANGE_BANLIST).not.toContain('まとめました');
		});
	});
});
