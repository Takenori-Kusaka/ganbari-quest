// #2057: 「管理画面」 → 「ご家族の見守り画面」 rename atom 参照
import { ADMIN_VIEW_TERMS } from '$lib/domain/terms';
import type { PageGuide } from '$lib/ui/tutorial/page-guide-types';

// #2927 (EPIC #2925 Sub-2): narrative を「①ページ概要 → ②画面の見方 → ③最頻操作」に統一。
// #2319 で設定はハブ + 6 サブグループ (アカウント / 活動・ポイント / 通知 / データ / サポート /
// プラン) に分割済み。旧ガイドはサブページ内の selector (pin-settings 等) を参照していたが、
// ハブページ (/admin/settings) には存在しないため、本ページではハブのカード構成を案内する。
// step 1 は selector 省略で画面中央 modal 表示。② はハブ冒頭の説明カード (小要素)、③ は先頭の
// 設定カード (アカウント、小要素) を target にする。グリッド全体 (settings-hub = mobile で 6 枚
// 縦積み = 縦長) は driver.js が非重複でバブルを置けないため target にしない (#2927: mobile ②
// で縦長グリッドにバブルが重なる exempt を解消)。
export const SETTINGS_GUIDE: PageGuide = {
	pageId: 'admin-settings',
	title: '設定',
	icon: '⚙️',
	steps: [
		// ① ページ概要
		{
			id: 'settings-intro',
			title: 'このページについて',
			what: `${ADMIN_VIEW_TERMS.canonical}の各種設定をまとめたページです。アクセスを守るおやカギ、ポイントの表示単位、データのバックアップなどをここから設定します。`,
			how: '設定はグループ別のカードに整理されています。設定したい項目のカードを選んで、その中の設定画面に進みます。',
			goal: '必要な設定にすぐたどり着けるので、おやカギの変更やバックアップなどの「念のための備え」を迷わず行えます。',
		},
		// ② 画面の見方（ハブ冒頭の説明カードを起点にグループ構成を案内）
		{
			id: 'settings-hub',
			selector: '[data-tutorial="settings-hub-intro"]',
			title: '画面の見方（設定グループ）',
			what: '設定は「アカウント」「活動・ポイント」「通知」「データ」「サポート・アプリ情報」「プラン・課金」のグループに分かれ、この下にカードで並びます。',
			how: '1. 目的のグループのカードをタップします\n2. そのグループの設定画面に移動します',
			goal: '設定項目が多くても、目的のカードを選ぶだけで迷わずたどり着けます。',
			position: 'bottom',
		},
		// ③ 最頻操作（先頭のアカウントカードを起点におやカギ変更を案内）
		{
			id: 'settings-account',
			selector: '[data-tutorial="settings-first-card"]',
			title: 'よく使う操作（アカウント・おやカギ）',
			what: '最初に確認したいのが「アカウント」カードです。ここからおやカギ（4桁の数字）の変更ができ、お子さまが誤って見守り画面に入るのを防げます。',
			how: '1. 「アカウント」カードをタップ\n2. おやカギの変更画面で、現在のコードと新しいコードを入力\n3. 「変更する」をタップ',
			goal: 'おやカギが更新され、次回から新しいコードが必要になります。データのバックアップは「データ」カードから行えます。',
			tips: ['おやカギの初期値や、ポイント表示・通貨設定は各カードの中で変更できます'],
			position: 'bottom',
		},
	],
};
