// tests/unit/domain/parent-wording-hygiene-4716.test.ts (#4716)
//
// 保護者画面の文言衛生を機械検証する。#4716 の実測:
//   - 「お子さま」「子供」「こども」が同一画面で混在 (例 /admin/cheer)
//   - 英語の節見出し (Pending / History) / 内部語 (Danger Zone / shop)
//   - 生パス (「/admin/cheer をご利用ください」「ホーム画面（/）」)
//   - 同じ操作が 3 表記 (別のお子さまからコピー / 他の子供から copy / 他のお子さまから取り込む)
//   - 存在しない機能名 (キャリアプラン / 誕生日振り返り)
//
// 用語の割れは「1 回直しても、次の変更で片方だけ動く」ので、値の一致ではなく
// **禁止パターンの不在** を assert する (再混入したら落ちる形)。

import { describe, expect, it } from 'vitest';
import * as labels from '../../../src/lib/domain/labels';
import {
	ADMIN_CHALLENGES_PAGE_LABELS,
	ADMIN_CHECKLISTS_PAGE_LABELS,
	ADMIN_REWARDS_PAGE_LABELS,
	ADMIN_REWARDS_REQUESTS_LABELS,
	COPY_FROM_CHILD_LABELS,
	formatChildDate,
	formatJstDate,
	SETTINGS_LABELS,
} from '../../../src/lib/domain/labels';
import { CHILD_TERMS } from '../../../src/lib/domain/terms';

/**
 * 保護者向け namespace（子供画面 / LP / Storybook を除く）。
 * LP は DESIGN.md §6 で「機能説明は CHILD_TERMS.neutral（子供）」を許容しているため対象外。
 * 子供画面はひらがな文体が正なので対象外。
 */
const PARENT_NAMESPACES = [
	'SETTINGS_LABELS',
	'PAGE_GUIDE_LABELS',
	'CHEER_LABELS',
	'MARKETPLACE_LABELS',
	'ACTIVITY_FORM_LABELS',
	'ADMIN_HOME_LABELS',
	'STATUS_LABELS',
	'PAGE_TITLES',
	'SUBSCRIPTION_PAGE_LABELS',
	'ADMIN_REWARDS_PAGE_LABELS',
	'ADMIN_REWARDS_REQUESTS_LABELS',
	'CHILD_PROFILE_CARD_LABELS',
	'ADMIN_CHILDREN_PAGE_LABELS',
	'UNIFIED_IMPORT_HUB_LABELS',
	'UNIFIED_EMPTY_STATE_LABELS',
	'MEMBERS_LABELS',
	'GROWTH_BOOK_LABELS',
	'REWARDS_LABELS',
	'ADMIN_CHILDREN_LABELS',
	'SETUP_CHILDREN_LABELS',
	'TUTORIAL_CHAPTER_LABELS',
	'POINTS_LABELS',
	'ADMIN_CHECKLISTS_PAGE_LABELS',
	'ADMIN_CHALLENGES_PAGE_LABELS',
] as const;

/** namespace を再帰的に辿って、表示文字列だけを集める（関数は代表引数で 1 回評価する）。 */
function collectStrings(value: unknown, out: string[], depth = 0): void {
	if (depth > 6) return;
	if (typeof value === 'string') {
		out.push(value);
		return;
	}
	if (typeof value === 'function') {
		// ラベル関数は (number) / (string) / (string, string) の 3 形が大半。
		// 引数の型が合わなくても throw しない限り評価結果を見る。
		for (const args of [[1], ['x'], ['x', 'y'], [1, 'x'], []]) {
			try {
				const r = (value as (...a: unknown[]) => unknown)(...args);
				if (typeof r === 'string') {
					out.push(r);
					return;
				}
			} catch {
				// この引数形では評価できない → 次を試す
			}
		}
		return;
	}
	if (value && typeof value === 'object') {
		for (const v of Object.values(value)) collectStrings(v, out, depth + 1);
	}
}

const parentStrings: { ns: string; text: string }[] = [];
for (const ns of PARENT_NAMESPACES) {
	const value = (labels as unknown as Record<string, unknown>)[ns];
	expect(value, `${ns} が labels.ts に存在しない (namespace rename?)`).toBeDefined();
	const out: string[] = [];
	collectStrings(value, out);
	for (const text of out) parentStrings.push({ ns, text });
}

function violations(pattern: RegExp): string[] {
	return parentStrings
		.filter(({ text }) => pattern.test(text))
		.map(({ ns, text }) => `${ns}: ${text.slice(0, 80)}`);
}

describe('#4716 AC2: 保護者画面に「子供」「こども」が出ない', () => {
	it('CHILD_TERMS.neutral / hiragana の呼称が残っていない', () => {
		// 「こどもの日」(祝日の固有名詞) は AC の除外対象なので落とす
		const hits = violations(/子供|こども/).filter((v) => !v.includes('こどもの日'));
		expect(hits).toEqual([]);
	});

	it('honorific 自体は使われている (置換で語ごと消えていないことの確認)', () => {
		expect(parentStrings.some(({ text }) => text.includes(CHILD_TERMS.honorific))).toBe(true);
	});
});

describe('#4716 AC2: 英語見出し / 内部語 / 生パスが出ない', () => {
	it('英語の節見出しが残っていない', () => {
		expect(violations(/\bPending\b|\bHistory\b|Danger Zone/)).toEqual([]);
	});

	it('内部語 shop が残っていない (画面名はごほうびショップ)', () => {
		expect(violations(/\bshop\b/)).toEqual([]);
	});

	it('生パス (/admin/... や 「（/）」) が本文に出ない', () => {
		expect(violations(/\/admin\/|ホーム画面（\/）/)).toEqual([]);
	});

	it('存在しない機能名が残っていない', () => {
		expect(violations(/キャリアプラン|誕生日振り返り/)).toEqual([]);
	});
});

describe('#4716: 同じ操作は 1 つの呼称に寄っている', () => {
	it('活動 / ごほうび / チェックリスト / チャレンジが同じ呼称を共有している', () => {
		expect(ADMIN_REWARDS_PAGE_LABELS.copyFromChildButton).toBe(COPY_FROM_CHILD_LABELS.action);
		expect(ADMIN_CHECKLISTS_PAGE_LABELS.copyFromChildMenuLabel).toBe(COPY_FROM_CHILD_LABELS.action);
		expect(ADMIN_CHALLENGES_PAGE_LABELS.copyFromOtherChildAction).toBe(
			COPY_FROM_CHILD_LABELS.action,
		);
	});

	it('旧表記 (他の子供から copy / 他のお子さまから取り込む) が残っていない', () => {
		// 「みんなのテンプレートから取り込む」は marketplace 取込で別操作なので対象外
		expect(violations(/から copy|さまから取り込む|子供から取り込む/)).toEqual([]);
	});
});

describe('#4716 item 1: 申請承認画面の見出し', () => {
	it('日本語の節見出しになっている', () => {
		expect(ADMIN_REWARDS_REQUESTS_LABELS.pendingSectionTitle).toBe('承認待ち');
		expect(ADMIN_REWARDS_REQUESTS_LABELS.historySectionTitle).toContain('これまでの申請');
	});

	it('title に絵文字が入っていない (他の admin title と揃える)', () => {
		expect(ADMIN_REWARDS_REQUESTS_LABELS.pageTitle).not.toMatch(/[\u{1F300}-\u{1FAFF}]/u);
	});

	it('時刻を出していないのに「日時」を名乗っていない', () => {
		expect(ADMIN_REWARDS_REQUESTS_LABELS.requestedAtLabel).toBe('申請日');
	});
});

describe('#4716 item 7: バックアップ用語が BACKUP_TERMS に寄っている', () => {
	it('「インポート」「データクリア」が画面文言に残っていない', () => {
		const texts = Object.values(SETTINGS_LABELS)
			.filter((v): v is string => typeof v === 'string')
			.join('\n');
		expect(texts).not.toContain('インポートモード');
		expect(texts).not.toContain('データクリア');
	});
});

describe('#4716 item 13: 日付書式が SSOT に寄っている', () => {
	it('保護者画面は YYYY/MM/DD (ゼロ埋め) で揃う', () => {
		expect(formatJstDate('2026-08-07')).toBe('2026/08/07');
		// epoch ミリ秒 (JST 正午) でも同じ書式になる
		expect(formatJstDate(Date.UTC(2026, 7, 7, 3, 0, 0))).toBe('2026/08/07');
	});

	it('子供画面に ISO 日付が出ない (年齢帯で文体が変わる)', () => {
		expect(formatChildDate('2026-08-07', 'preschool')).toBe('8がつ7にち');
		expect(formatChildDate('2026-08-07', 'junior')).toBe('8月7日');
		for (const tier of ['baby', 'preschool', 'elementary', 'junior', 'senior']) {
			expect(formatChildDate('2026-08-07', tier)).not.toMatch(/\d{4}-\d{2}-\d{2}/);
		}
	});
});
