// tests/unit/domain/admin-screen-name-ssot-4715.test.ts (#4715)
//
// 「同じ画面が nav / <title> / 画面内見出しで別の名前を持つ」を機械的に止める fitness function。
// 実測 (#4715) の割れ:
//   nav「グロースブック」/ title・見出し「成長記録ブック」/ nav「ポイント」/ title「ポイント管理」/
//   見出し「⭐ ポイント」/ nav「チャレンジ」/ title「きょうだいチャレンジ」/
//   title「ベンチマーク管理」（中身は成長レポート）/ title「ご家族の見守り画面」/ 見出し「管理ダッシュボード」
//
// SSOT は `src/lib/domain/admin-screens.ts` の `ADMIN_SCREENS`。
// 本 test は「registry の name が nav / title / 見出しに実際に伝播しているか」と
// 「旧称が残っていないか」を両方見る。

import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
	ADMIN_SCREENS,
	type AdminScreenKey,
	adminScreenHeading,
} from '../../../src/lib/domain/admin-screens';
import {
	ADMIN_CHECKLISTS_PAGE_LABELS,
	ADMIN_CHILDREN_PAGE_LABELS,
	ADMIN_HOME_LABELS,
	CERTIFICATES_PAGE_LABELS,
	CHALLENGES_LABELS,
	CHILD_NAV_MODE_LABELS,
	GROWTH_BOOK_LABELS,
	NAV_ITEM_LABELS,
	PAGE_TITLES,
	POINTS_LABELS,
	REPORTS_LABELS,
	REWARDS_LABELS,
	STATUS_LABELS,
} from '../../../src/lib/domain/labels';
import { CONCEPT_ICONS } from '../../../src/lib/domain/terms';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const ADMIN_LAYOUT = readFileSync(
	join(REPO_ROOT, 'src/lib/features/admin/components/AdminLayout.svelte'),
	'utf8',
);

/** 画面 key → `<title>` に使われている PAGE_TITLES の値 */
const TITLE_BY_SCREEN: Record<AdminScreenKey, string> = {
	home: ADMIN_HOME_LABELS.pageTitle.replace(/ - .*$/, ''),
	children: PAGE_TITLES.children,
	members: PAGE_TITLES.members,
	activities: PAGE_TITLES.activities,
	checklists: PAGE_TITLES.checklists,
	challenges: PAGE_TITLES.challenges,
	rewards: PAGE_TITLES.rewards,
	cheer: PAGE_TITLES.cheer,
	reports: PAGE_TITLES.reports,
	growthBook: PAGE_TITLES.growth,
	points: PAGE_TITLES.points,
	status: PAGE_TITLES.status,
	certificates: PAGE_TITLES.certificates,
	settings: PAGE_TITLES.settings,
	subscription: PAGE_TITLES.license,
};

/** 画面 key → 画面内の見出しラベル。見出しを持たない画面は null */
const HEADING_BY_SCREEN: Partial<Record<AdminScreenKey, string>> = {
	home: ADMIN_HOME_LABELS.heading,
	children: ADMIN_CHILDREN_PAGE_LABELS.pageTitle,
	checklists: ADMIN_CHECKLISTS_PAGE_LABELS.pageTitle,
	challenges: CHALLENGES_LABELS.sectionTitle,
	rewards: REWARDS_LABELS.sectionTitle,
	reports: REPORTS_LABELS.pageTitle,
	growthBook: GROWTH_BOOK_LABELS.pageHeading,
	points: POINTS_LABELS.pageTitle,
	status: STATUS_LABELS.pageHeading,
	certificates: CERTIFICATES_PAGE_LABELS.pageTitle,
};

/** 画面 key → nav ラベル */
const NAV_BY_SCREEN: Partial<Record<AdminScreenKey, string>> = {
	children: NAV_ITEM_LABELS.children,
	members: NAV_ITEM_LABELS.members,
	activities: NAV_ITEM_LABELS.activities,
	checklists: NAV_ITEM_LABELS.checklists,
	challenges: NAV_ITEM_LABELS.challenges,
	rewards: NAV_ITEM_LABELS.rewards,
	cheer: NAV_ITEM_LABELS.cheer,
	reports: NAV_ITEM_LABELS.reports,
	growthBook: NAV_ITEM_LABELS.growthBook,
	points: NAV_ITEM_LABELS.points,
	status: NAV_ITEM_LABELS.status,
	settings: NAV_ITEM_LABELS.settings,
	subscription: NAV_ITEM_LABELS.license,
};

const screenKeys = Object.keys(ADMIN_SCREENS) as AdminScreenKey[];

describe('#4715 admin 画面名は nav = title = 見出し (絵文字差を除く)', () => {
	it.each(screenKeys)('%s: <title> が registry の画面名と一致する', (key) => {
		expect(TITLE_BY_SCREEN[key]).toBe(ADMIN_SCREENS[key].name);
	});

	it.each(
		Object.keys(NAV_BY_SCREEN) as AdminScreenKey[],
	)('%s: nav ラベルが registry の画面名と一致する', (key) => {
		expect(NAV_BY_SCREEN[key]).toBe(ADMIN_SCREENS[key].name);
	});

	it.each(
		Object.keys(HEADING_BY_SCREEN) as AdminScreenKey[],
	)('%s: 画面内見出しが「アイコン + 画面名」か画面名そのものである', (key) => {
		const heading = HEADING_BY_SCREEN[key];
		expect([adminScreenHeading(key), ADMIN_SCREENS[key].name]).toContain(heading);
	});
});

describe('#4715 AdminLayout の nav が registry を参照している', () => {
	// home はグローバルナビの「ホーム」タブ、certificates はグローバルナビ非掲載
	// (レポート / 成長記録ブックからの導線のみ) のため対象外。
	const navScreenKeys = screenKeys.filter((k) => k !== 'home' && k !== 'certificates');

	it.each(navScreenKeys)('%s の nav 項目が registry 経由である', (key) => {
		expect(ADMIN_LAYOUT).toContain(`ADMIN_SCREENS.${key}.name`);
		expect(ADMIN_LAYOUT).toContain(`ADMIN_SCREENS.${key}.icon`);
	});

	it('nav 項目に絵文字の直書きが残っていない', () => {
		// `icon: '📋'` のような直書きを禁止する (registry / CONCEPT_ICONS 経由に限る)
		const literalIcons = [...ADMIN_LAYOUT.matchAll(/icon:\s*'([^']+)'/g)].map((m) => m[1]);
		expect(literalIcons).toEqual([]);
	});
});

describe('#4715 概念を持つ画面のアイコンが CONCEPT_ICONS と一致する', () => {
	it('活動 / チェックリスト / ごほうび / チャレンジ', () => {
		expect(ADMIN_SCREENS.activities.icon).toBe(CONCEPT_ICONS.activity);
		expect(ADMIN_SCREENS.checklists.icon).toBe(CONCEPT_ICONS.checklist);
		expect(ADMIN_SCREENS.rewards.icon).toBe(CONCEPT_ICONS.reward);
		expect(ADMIN_SCREENS.challenges.icon).toBe(CONCEPT_ICONS.challenge);
	});

	it('DESIGN.md が不採用とした ✅ (activity との混同) を使っていない', () => {
		expect(Object.values(ADMIN_SCREENS).map((s) => s.icon)).not.toContain('✅');
	});

	it('同一アイコンを 2 画面が共有していない (nav 内の識別が壊れる)', () => {
		const icons = Object.values(ADMIN_SCREENS).map((s) => s.icon);
		expect(new Set(icons).size).toBe(icons.length);
	});
});

describe('#4715 旧称が残っていない', () => {
	const values = [
		...Object.values(PAGE_TITLES),
		...Object.values(NAV_ITEM_LABELS),
		...Object.values(HEADING_BY_SCREEN),
	]
		.filter((v): v is string => typeof v === 'string')
		.join('\n');

	it.each([
		['グロースブック'],
		['ベンチマーク管理'],
		['管理ダッシュボード'],
		['プラン・課金'],
	])('%s が nav / title / 見出しに残っていない', (old) => {
		expect(values).not.toContain(old);
	});
});

describe('#4715 子供ナビの呼称', () => {
	it('junior / senior の家族切替が親の「メンバー管理」と別語になっている', () => {
		for (const mode of ['junior', 'senior'] as const) {
			expect(CHILD_NAV_MODE_LABELS[mode].switch).not.toBe('メンバー');
			expect(ADMIN_SCREENS.members.name).not.toBe(CHILD_NAV_MODE_LABELS[mode].switch);
		}
	});

	it('チェックリストの呼称が全年齢帯で 1 つに揃っている', () => {
		const names = new Set(Object.values(CHILD_NAV_MODE_LABELS).map((m) => m.checklist));
		expect(names.size).toBe(1);
	});

	it('チェックリストの呼称が親画面の画面名と同じ語幹である', () => {
		const childName = CHILD_NAV_MODE_LABELS.elementary.checklist;
		expect(ADMIN_SCREENS.checklists.name.startsWith(childName)).toBe(true);
	});
});
