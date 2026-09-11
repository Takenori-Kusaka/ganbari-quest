// src/lib/domain/admin-screens.ts
// 保護者画面（/admin 配下）の「画面名 + アイコン + パス」レジストリ (#4715)。
//
// 背景:
//   同じ画面が nav / `<title>` / 画面内見出しでそれぞれ別の名前で呼ばれていた。実測 (#4715):
//     - nav「グロースブック」 / title・見出し「成長記録ブック」
//     - nav「ポイント」 / title「ポイント管理」 / 見出し「⭐ ポイント」
//     - nav「チャレンジ」 / title「きょうだいチャレンジ」
//     - title「ベンチマーク管理」 / 画面の中身は成長レポート
//     - title「ご家族の見守り画面」 / 見出し「管理ダッシュボード」
//   顧客は nav で見た名前を頼りに画面を探すため、3 つが割れていると「さっきの画面」に戻れない。
//
// 設計:
//   画面名の実体は `terms.ts` の `ADMIN_SCREEN_TERMS`（atom）。本ファイルはそれに
//   「どのパスか」「どのアイコンか」を結び付けるだけの薄いレジストリで、
//   `PAGE_TITLES` / `NAV_ITEM_LABELS` / 各画面の見出しラベルが**すべてここから引く**。
//   概念を持つ画面のアイコンは `CONCEPT_ICONS`（docs/DESIGN.md §6 概念アイコン SSOT）を参照する。
//
//   nav = title = 見出し（絵文字差を除く）が成立していることは
//   `tests/unit/domain/admin-screen-name-ssot-4715.test.ts` が機械検証する。
//
// 対象外:
//   - `/admin/packs`（別 PR で撤去進行中のため触らない）
//   - `/admin/settings/*` のサブページ（設定ハブ内の節であって独立画面ではない）
//   - `/marketplace`（/admin 配下ではない。名前の SSOT は `TEMPLATE_TERMS`）

import { ADMIN_SCREEN_TERMS, CONCEPT_ICONS } from './terms';

export interface AdminScreen {
	/** ルーティングのパス（basePath を除いた `/admin` 起点の絶対パス） */
	readonly path: string;
	/** 画面名。nav ラベル / `<title>` / 画面内見出しが共有する唯一の表記 */
	readonly name: string;
	/** 見出し・nav に付ける絵文字（名前には含めない） */
	readonly icon: string;
}

export const ADMIN_SCREENS = {
	home: { path: '/admin', name: ADMIN_SCREEN_TERMS.home, icon: '🏠' },
	children: { path: '/admin/children', name: ADMIN_SCREEN_TERMS.children, icon: '👧' },
	members: { path: '/admin/members', name: ADMIN_SCREEN_TERMS.members, icon: '👥' },
	activities: {
		path: '/admin/activities',
		name: ADMIN_SCREEN_TERMS.activities,
		icon: CONCEPT_ICONS.activity,
	},
	checklists: {
		path: '/admin/checklists',
		name: ADMIN_SCREEN_TERMS.checklists,
		icon: CONCEPT_ICONS.checklist,
	},
	challenges: {
		path: '/admin/challenges',
		name: ADMIN_SCREEN_TERMS.challenges,
		icon: CONCEPT_ICONS.challenge,
	},
	rewards: { path: '/admin/rewards', name: ADMIN_SCREEN_TERMS.rewards, icon: CONCEPT_ICONS.reward },
	cheer: { path: '/admin/cheer', name: ADMIN_SCREEN_TERMS.cheer, icon: '🎉' },
	reports: { path: '/admin/reports', name: ADMIN_SCREEN_TERMS.reports, icon: '📊' },
	growthBook: { path: '/admin/growth-book', name: ADMIN_SCREEN_TERMS.growthBook, icon: '📖' },
	points: { path: '/admin/points', name: ADMIN_SCREEN_TERMS.points, icon: '⭐' },
	status: { path: '/admin/status', name: ADMIN_SCREEN_TERMS.status, icon: '📈' },
	certificates: {
		path: '/admin/certificates',
		name: ADMIN_SCREEN_TERMS.certificates,
		icon: '📜',
	},
	settings: { path: '/admin/settings', name: ADMIN_SCREEN_TERMS.settings, icon: '⚙️' },
	subscription: {
		path: '/admin/subscription',
		name: ADMIN_SCREEN_TERMS.subscription,
		icon: '💎',
	},
} as const satisfies Record<string, AdminScreen>;

export type AdminScreenKey = keyof typeof ADMIN_SCREENS;

/** 見出し用の「アイコン + 画面名」。画面内 `<h1>` / `<h2>` はこの形で表示する。 */
export function adminScreenHeading(key: AdminScreenKey): string {
	const s = ADMIN_SCREENS[key];
	return `${s.icon} ${s.name}`;
}
