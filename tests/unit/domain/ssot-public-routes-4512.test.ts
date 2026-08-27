// tests/unit/domain/ssot-public-routes-4512.test.ts
// #4512 (GAMMA 監査 第2ラウンド / #4495): setup / view / switch / marketplace の SSOT 逸脱是正を pin する。
//
// この Issue の核心は「labels.ts / categories.ts に定義済みなのに画面側で直書き」であり、
// 直書きは 1 行足すだけで復活する。復活した瞬間に落ちる形で固定する:
//
//   1. 5 カテゴリの手書き列挙 (name / icon) が routes に再出現したら落ちる
//      — view/[token] と setup/packs が categories.ts と独立に 5 件を持つ並行実装だった。
//   2. admin/checklists に native confirm() が復活したら落ちる
//      — #4023 で challenges / settings/rules は Dialog primitive 化済みだった横展開漏れ。
//   3. 本 Issue で参照化した文言が labels.ts 側から消えたら落ちる (label ↔ 画面の対応固定)。

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { CATEGORIES, CATEGORY_CODES } from '../../../src/lib/domain/categories';
import {
	formatAgeKana,
	MARKETPLACE_LABELS,
	SETUP_CHALLENGES_LABELS,
	SETUP_CHILDREN_LABELS,
	SETUP_LABELS,
	SWITCH_PAGE_LABELS,
	VIEW_PAGE_LABELS,
} from '../../../src/lib/domain/labels';
import { CHILD_TERMS } from '../../../src/lib/domain/terms';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const read = (rel: string) => readFileSync(path.join(REPO_ROOT, rel), 'utf8');

/** 本 Issue が SSOT 集約した顧客可視 route (admin 以外)。 */
const PUBLIC_ROUTE_FILES = [
	'src/routes/setup/+layout.svelte',
	'src/routes/setup/children/+page.svelte',
	'src/routes/setup/children/+page.server.ts',
	'src/routes/setup/packs/+page.svelte',
	'src/routes/setup/packs/+page.server.ts',
	'src/routes/setup/rewards/+page.svelte',
	'src/routes/setup/rewards/+page.server.ts',
	'src/routes/setup/rules/+page.svelte',
	'src/routes/setup/rules/+page.server.ts',
	'src/routes/setup/challenges/+page.server.ts',
	'src/routes/setup/first-adventure/+page.server.ts',
	'src/routes/switch/+page.svelte',
	'src/routes/switch/+page.server.ts',
	'src/routes/view/[token]/+page.svelte',
	'src/routes/view/[token]/+page.server.ts',
	'src/routes/marketplace/+page.svelte',
	'src/routes/marketplace/[type]/[itemId]/+page.server.ts',
];

describe('#4512 カテゴリ列挙の並行実装', () => {
	it('顧客可視 route が 5 カテゴリ名を手書きで列挙していない', () => {
		// 「5 件そろって書かれている」= 手書き列挙。単発の語 (活動名の例示等) は誤検出しないよう
		// 全 5 件が同一ファイルに現れることを条件にする。
		const names = CATEGORY_CODES.map((code) => CATEGORIES[code].name);
		expect(names).toHaveLength(5);

		const offenders = PUBLIC_ROUTE_FILES.filter((rel) => {
			const src = read(rel);
			return names.every((name) => src.includes(`'${name}'`) || src.includes(`"${name}"`));
		});
		expect(offenders).toEqual([]);
	});

	it('顧客可視 route が 5 カテゴリアイコンを手書きで列挙していない', () => {
		const icons = CATEGORY_CODES.map((code) => CATEGORIES[code].icon);
		const offenders = PUBLIC_ROUTE_FILES.filter((rel) => {
			const src = read(rel);
			return icons.every((icon) => src.includes(icon));
		});
		expect(offenders).toEqual([]);
	});

	it('view/[token] は categories.ts を SSOT として参照する', () => {
		const src = read('src/routes/view/[token]/+page.svelte');
		expect(src).toContain("from '$lib/domain/categories'");
	});
});

describe('#4512 / #4023 横展開: native confirm() の追放', () => {
	// #4023 で admin/challenges と admin/settings/rules は Dialog primitive に移行済み。
	// checklists だけ native confirm() が残っていた (見た目・文言・機構が 3 画面で不一致)。
	const DIALOG_CONFIRM_PAGES = [
		'src/routes/(parent)/admin/checklists/+page.svelte',
		'src/routes/(parent)/admin/challenges/+page.svelte',
	];

	// コメント行は除外する。「native confirm() から Dialog に置換した」という説明自体が
	// 検出対象に見えてしまい、説明を消すインセンティブが生まれるため (assertion は残す)。
	const isComment = (line: string) => /^(\/\/|\/\*|\*|<!--)/.test(line.trim());

	it.each(DIALOG_CONFIRM_PAGES)('%s が native confirm() を使っていない', (rel) => {
		const offenders = read(rel)
			.split(/\r?\n/)
			.map((line, i) => ({ line, no: i + 1 }))
			.filter(({ line }) => !isComment(line) && /(?<![\w.])confirm\s*\(/.test(line))
			.map(({ line, no }) => `${rel}:${no}: ${line.trim()}`);
		expect(offenders).toEqual([]);
	});

	it('checklists の削除は use:enhance の cancel() で止める (preventDefault ではない)', () => {
		// onsubmit + preventDefault では use:enhance の submit listener が defaultPrevented を
		// 見ないため、キャンセルしても action が走る (#4023 の実害 2 件)。同じ罠に戻さない。
		const src = read('src/routes/(parent)/admin/checklists/+page.svelte');
		expect(src).toContain('use:enhance={({ formElement, cancel }) => {');
		expect(src).toContain('cancel();');
		expect(src).toContain('data-testid="admin-checklists-confirm-accept"');
		expect(src).toContain('data-testid="admin-checklists-confirm-cancel"');
	});
});

describe('#4512 SSOT 集約した文言が labels.ts 側に存在する', () => {
	it('setup wizard の step 名とプレビュー開閉が SETUP_LABELS にある', () => {
		expect(SETUP_LABELS.stepChildren).toBe('子供登録');
		expect(SETUP_LABELS.stepComplete).toBe('冒険の始まり');
		expect(SETUP_LABELS.previewToggleOpen).toBe('▼ なかみ');
		expect(SETUP_LABELS.previewToggleClose).toBe('▲ とじる');
	});

	it('challenges の開閉トグルは SETUP_LABELS と同値 (4 step で二重定義しない)', () => {
		expect(SETUP_CHALLENGES_LABELS.previewToggleOpen).toBe(SETUP_LABELS.previewToggleOpen);
		expect(SETUP_CHALLENGES_LABELS.previewToggleClose).toBe(SETUP_LABELS.previewToggleClose);
	});

	it('setup/switch/view/marketplace の server エラー文言が labels.ts 経由', () => {
		expect(SETUP_CHILDREN_LABELS.errorNicknameRequired).toBe('ニックネームを入力してください');
		// #4716: 保護者画面の呼称は CHILD_TERMS.honorific (DESIGN.md §6)。literal を pin すると
		// atom を変えたとき label だけ追随して test が取り残されるため atom 経由で突き合わせる。
		expect(SETUP_CHILDREN_LABELS.errorNoChildren).toBe(`1人以上の${CHILD_TERMS.honorific}を登録してください`);
		expect(SWITCH_PAGE_LABELS.errorChildRequired).toBe('こどもをえらんでね');
		// #4703 が同一文言を invalidTokenTitle として先に SSOT 化したため、そちらへ寄せる
		// (重複 atom を作らない)。#4512 の意図 = server 側が直書きしないこと は不変。
		expect(VIEW_PAGE_LABELS.invalidTokenTitle).toBe('このリンクは無効か、期限切れです');
		expect(MARKETPLACE_LABELS.errorInvalidType).toBe('コンテンツタイプが不正です');
		expect(MARKETPLACE_LABELS.errorItemNotFound).toBe('コンテンツが見つかりません');
	});

	it('ひらがな年齢表記が helper 化されている (子供・来訪者向け画面)', () => {
		expect(formatAgeKana(7)).toBe('7さい');
		for (const rel of ['src/routes/switch/+page.svelte', 'src/routes/view/[token]/+page.svelte']) {
			expect(read(rel)).toContain('formatAgeKana(');
		}
	});

	it('marketplace の type 件数表記が定義済みラベルを参照する (二重定義しない)', () => {
		// `typeCountSuffix` は labels.ts に定義済みだったのに画面側が '種' を直書きしていた。
		expect(MARKETPLACE_LABELS.typeCountSuffix).toBe('種');
		expect(read('src/routes/marketplace/+page.svelte')).toContain(
			'MARKETPLACE_LABELS.typeCountSuffix',
		);
	});
});
