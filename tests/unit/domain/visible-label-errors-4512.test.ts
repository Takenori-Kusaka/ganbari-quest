// tests/unit/domain/visible-label-errors-4512.test.ts (#4512)
//
// アプリ内の「顧客に見える誤り」を機械検出する。
//
// # 何が壊れていたか（GAMMA 監査 第2ラウンド、アプリ内 60 面の全数走査）
//   1. ページガイドが**実在しないカテゴリ「おてつだい」**を列挙し「こうりゅう」が欠落していた
//      （同じ labels.ts 内の別の箇所は正しく列挙しており、文言どうしが矛盾）
//   3. 月次レポートがカテゴリ名を**漢字で並行実装**（SSOT はひらがな）。カテゴリを増減すると
//      レポートだけ「カテゴリ6」と表示される構造でもあった
//   4. チェックリスト上限エラー 5 箇所が「フリープラン」直書き（SSOT は「無料プラン」）
//
// # なぜ test にするか
// いずれも「文言を直したら終わり」ではなく、**SSOT から作られていないことが原因**。
// 手書きの列挙・複製は、SSOT を変えたときに取り残される。

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { CATEGORIES, CATEGORY_NAME_LIST, CATEGORY_NAMES } from '../../../src/lib/domain/categories';
import { PAGE_GUIDE_LABELS, PLAN_GATE_LABELS } from '../../../src/lib/domain/labels';
import { PLAN_FULL_TERMS } from '../../../src/lib/domain/terms';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoFile = (p: string) => readFileSync(resolve(__dirname, '../../../', p), 'utf-8');

describe('#4512 顧客に見える誤り', () => {
	describe('カテゴリ列挙 (finding 1)', () => {
		it('CATEGORY_NAME_LIST が categories.ts の 5 カテゴリから作られる', () => {
			expect(CATEGORY_NAMES).toHaveLength(5);
			expect(CATEGORY_NAME_LIST).toBe(CATEGORY_NAMES.join('・'));
			expect(CATEGORY_NAME_LIST).toContain('こうりゅう');
		});

		it('ガイド文言に実在しないカテゴリ名が出ない', () => {
			const guides = JSON.stringify(PAGE_GUIDE_LABELS);
			// 「おてつだい」はカテゴリではない (プリセット活動名としては存在しうるので、
			//  カテゴリ列挙の文脈だけを見る)
			expect(guides).not.toContain('うんどう・べんきょう・せいかつ・おてつだい・そうぞう');
		});

		it('ガイド文言のカテゴリ列挙が SSOT と一致する', () => {
			const guides = JSON.stringify(PAGE_GUIDE_LABELS);
			// 列挙している箇所は必ず SSOT 由来の並びになっている
			const enumerations = guides.match(/うんどう[^"]{0,40}そうぞう/g) ?? [];
			expect(enumerations.length).toBeGreaterThan(0);
			for (const e of enumerations) {
				for (const name of CATEGORY_NAMES) {
					expect(e, `カテゴリ列挙に ${name} が無い: ${e}`).toContain(name);
				}
			}
		});
	});

	describe('レポートのカテゴリ名 (finding 3)', () => {
		it('漢字の並行実装テーブルが無い', () => {
			const page = repoFile('src/routes/(parent)/admin/reports/+page.svelte');
			expect(page, 'カテゴリ名を漢字で持つと SSOT を変えてもレポートだけ古くなる').not.toMatch(
				/'1':\s*'運動'/,
			);
			// biome: 文字列内の ${} は意図（page 側の fallback 表記が消えたことを見る）
			expect(page).not.toContain(['カテゴリ$', '{catId}'].join(''));
		});

		it('categories.ts から名前を引いている', () => {
			const page = repoFile('src/routes/(parent)/admin/reports/+page.svelte');
			expect(page).toContain('toCategoryCode');
			expect(page).toContain('CATEGORIES[code].name');
		});

		it('SSOT のカテゴリ名はひらがな (漢字表記が混ざらない)', () => {
			for (const name of CATEGORY_NAMES) {
				expect(name).toMatch(/^[ぁ-ゖー]+$/);
			}
			expect(CATEGORIES.undou.name).toBe('うんどう');
		});
	});

	describe('プラン名の直書き (finding 4)', () => {
		it('checklists の上限エラーが「フリープラン」を直書きしていない', () => {
			const server = repoFile('src/routes/(parent)/admin/checklists/+page.server.ts');
			expect(server).not.toContain('フリープラン');
			expect(server).toContain('PLAN_GATE_LABELS.perChildLimitReached');
		});

		it('上限エラー label が SSOT のプラン名を使う', () => {
			const msg = PLAN_GATE_LABELS.perChildLimitReached(3);
			expect(msg).toContain(PLAN_FULL_TERMS.free);
			expect(msg).toContain(PLAN_FULL_TERMS.standard);
			expect(msg).not.toContain('フリープラン');
		});
	});

	describe('OCR 上限 (finding 2)', () => {
		it('client の事前判定が server 由来の実効値を使う (5MB 固定でない)', () => {
			const page = repoFile('src/routes/(parent)/admin/points/+page.svelte');
			expect(page, '5MB 固定判定は aws-prod の実効上限 (~4.1MB) と食い違う').not.toContain(
				'file.size > 5 * 1024 * 1024',
			);
			expect(page).toContain('data.maxReceiptImageMb');
			// 表示 (note) と判定が同じ値を使っていること
			expect(page).toContain('POINTS_LABELS.receiptImageTooLarge(data.maxReceiptImageMb)');
		});
	});

	describe('view/[token] の hex 直書き (DESIGN.md §2)', () => {
		it('CSS 変数の hex fallback が残っていない', () => {
			const page = repoFile('src/routes/view/[token]/+page.svelte');
			expect(page, 'var(--token, #hex) の fallback は routes での hex 直書き').not.toMatch(
				/var\(--color-[a-z0-9-]+,\s*#[0-9a-fA-F]{3,8}\)/,
			);
		});
	});
});
