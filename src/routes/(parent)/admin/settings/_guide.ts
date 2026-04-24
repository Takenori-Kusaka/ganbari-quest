import { OYAKAGI_LABELS } from '$lib/domain/labels';
import type { PageGuide } from '$lib/ui/tutorial/page-guide-types';

export const SETTINGS_GUIDE: PageGuide = {
	pageId: 'admin-settings',
	title: '設定',
	icon: '⚙️',
	steps: [
		{
			id: 'settings-pin',
			selector: '[data-tutorial="pin-settings"]',
			title: OYAKAGI_LABELS.sectionTitle,
			what: `管理画面へのアクセスを保護する${OYAKAGI_LABELS.name}（4桁の数字）を変更できます。お子さまが誤って管理画面に入るのを防ぎます。${OYAKAGI_LABELS.defaultValueHint}。`,
			how: `1. 現在の${OYAKAGI_LABELS.name}を入力\n2. 新しい${OYAKAGI_LABELS.name}（4桁）を入力\n3. 確認のためもう一度入力\n4. 「変更する」をタップ`,
			goal: `${OYAKAGI_LABELS.name}が更新され、次回のログインから新しいコードが必要になります。`,
			tips: [
				`${OYAKAGI_LABELS.name}を忘れた場合は、ブラウザのCookieをクリアすると再設定できます（ローカル版の場合）`,
			],
			position: 'bottom',
		},
		{
			id: 'settings-points',
			title: 'ポイント表示設定',
			what: 'ポイントの表示単位を「ポイント」「円」「ドル」などに変更できます。交換レートも設定できるので、実際のおこづかい額と連動させられます。',
			how: '1. 「ポイント設定」セクションを見つけます\n2. 表示モード（ポイント/通貨）を選択\n3. 通貨モードの場合: 通貨とレートを設定（例: 1ポイント = 1円）\n4. プレビューで表示を確認\n5. 「保存」をタップ',
			goal: 'すべての画面でポイントが指定した通貨で表示されます。「100円ぶん貯まったよ！」とお子さまに伝えられるので、お金の感覚も育ちます。',
			position: 'bottom',
		},
		{
			id: 'settings-export',
			title: 'データのバックアップ',
			what: 'すべてのデータ（お子さま・活動・記録・ポイント）をファイルに書き出せます。機種変更時のデータ移行や、万が一の備えに使えます。',
			how: '1. 「データの入出力」セクションを見つけます\n2. 「エクスポート」をタップ\n3. ファイル形式を選択（JSON）\n4. ダウンロードされたファイルを安全な場所に保管\n5. 復元時は「インポート」からファイルを選択',
			goal: 'お子さまの頑張りの記録が安全にバックアップされます。新しいデバイスでもデータを復元できるので、記録が失われる心配がありません。',
			tips: [
				'月に1回のバックアップをおすすめします',
				'クラウドエクスポート機能（共有コードで別端末と共有）も利用できます',
			],
			position: 'bottom',
		},
		{
			id: 'settings-feedback',
			selector: '[data-tutorial="feedback-section"]',
			title: 'フィードバック・サポート',
			what: '使い方で困ったことや改善要望を開発チームに直接伝えられます。バグ報告もここから行えます。',
			how: '1. 「フィードバック」セクションを見つけます\n2. お問い合わせの種類を選択\n3. 内容を入力して送信',
			goal: '開発チームにフィードバックが届き、今後のアップデートに反映されます。「この機能がほしい」「ここが使いにくい」など、お気軽にお伝えください。',
			position: 'top',
		},
	],
};
