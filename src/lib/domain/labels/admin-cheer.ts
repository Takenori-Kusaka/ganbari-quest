// labels 層 (ADR-0045 / #4965): 親の管理画面 /admin/cheer。置き場所の規則は docs/DESIGN.md §6
import { CHEER_POINTS } from '../constants/cheer-points';
import {
	CHEER_ADMIN_TERMS,
	CHEER_TERMS,
	CHILD_TERMS,
	PLAN_FULL_TERMS,
	REWARD_TERMS,
} from '../terms';

// ============================================================
// おうえんメッセージページ (#1452 Phase B)
// ============================================================

// MESSAGES_LABELS: #2270 (EPIC #2266) で /admin/messages 廃止に伴い削除。
// 応援機能 (/admin/cheer) に統合: CHEER_LABELS を使う。
// 既読/未読表示など共通用途は CHEER_LABELS.msgRead / msgUnread 等で継承。

// ============================================================
// 応援機能 (/admin/cheer) (#2267 / EPIC #2266)
// ============================================================
// PO 報告 (2026-05-19) 「応援 = 任意の理由で直接子供にポイント付与 (運動会一位等)、
// スタンプ/メッセージは P 付与に付随する理由表現」
// #2276: CHEER_TERMS / REWARD_TERMS atom 参照化 (ADR-0045 §3.3)。
// atom 1 行修正で 「応援」「ごほうび」のリブランディング時に全 UI 伝播する。
export const CHEER_LABELS = {
	pageDescTitle: `🎉 ${CHEER_TERMS.canonical}`,
	pageDescText1: `お子さまのがんばりに、理由とポイントで${CHEER_TERMS.canonical}を届けます。`,
	pageDescText2: '「運動会で1位」「むずかしい問題ができた」など、その場で気持ちを形にできます。',
	pageDescHintPrefix: `スタンプやひとことメッセージも添えられます。日常の${REWARD_TERMS.menu}は`,
	pageDescHintLink: REWARD_TERMS.canonical,
	pageDescHintSuffix: 'から行えます',
	// #4716: 呼称は honorific。値は CHEER_ADMIN_TERMS が SSOT (#4659 でページガイドと共有)
	selectChildTitle: CHEER_ADMIN_TERMS.selectChildTitle,
	reasonTitle: `2. ${CHEER_TERMS.action}理由`,
	reasonPlaceholder: CHEER_ADMIN_TERMS.reasonPlaceholder,
	reasonHint: '100文字以内',
	pointsTitle: '3. ボーナスポイント',
	pointsHint: `${CHEER_POINTS.min}〜${CHEER_POINTS.max}の範囲で入力`,
	categoryTitle: '4. カテゴリ',
	iconTitle: '5. アイコン',
	iconHint: '絵文字を入れてください',
	extraTitle: '6. 付随スタンプ / メッセージ（任意）',
	extraDescription: 'いつものスタンプや、ひとことメッセージも一緒に届けられます',
	// #4512: 旧実装は +page.svelte に直書きしていた入力補助文言
	reasonCounterHint: (length: number, maxLength: number, remaining: number) =>
		`${length}/${maxLength}（あと${remaining}文字）`,
	// #4504: 自由テキストは premium 限定 (LP の訴求どおり)。定型スタンプは全プランで使える。
	/** プランゲートのエラー文言 / ロック表示に使う機能名 */
	freeTextFeatureName: 'ひとことメッセージ（自由テキスト）',
	/** premium 以外に出す説明。スタンプは使えることを同時に伝える (全否定しない) */
	freeTextLockedNote: `ひとことメッセージ（自由テキスト）は${PLAN_FULL_TERMS.premium}の機能です。スタンプは今のプランでも送れます。`,
	freeTextPlaceholder: 'ひとことメッセージを足す（任意）',
	confirmTitle: `7. 内容を確認して${CHEER_TERMS.action}`,
	grantButton: CHEER_TERMS.action,
	grantButtonDisabled: '理由とポイントを入力してください',
	grantSuccess: `${CHEER_TERMS.canonical}を送りました！`,
	grantSuccessDesc: (points: number) => `+${points}P をプレゼントしました`,
	historyTitle: `最近の${CHEER_TERMS.canonical}`,
	recentMessagesTitle: '最近のメッセージ（旧履歴含む）',
	msgRead: '既読',
	msgUnread: '未読',
	noChildrenTitle: `まず${CHILD_TERMS.honorific}を登録してください`,
	noChildrenDesc: `「${CHILD_TERMS.honorific}」タブから登録できます`,
	// プリセット理由（よく使う応援の例、 1 タップで reason に流し込む）
	presetTitle: CHEER_ADMIN_TERMS.presetTitle,
	// 日本ローカライズ reason テンプレ (#2300、EPIC #2294 ⑥)
	// 親が現実イベント後に承認する 1 タップ操作（ADR-0012 anti-engagement / 滞在ゼロ）。
	// シーズン期間中の自動配信は不採用、家族コミュニケーション wedge 強化。
	reasonTemplates: [
		{
			reason: 'ひな祭りのお手伝い ありがとう',
			recommendedPoints: 30,
			icon: '🎎',
			category: 'せいかつ',
		},
		{
			reason: 'こどもの日のプロジェクト完成',
			recommendedPoints: 50,
			icon: '🎏',
			category: 'そうぞう',
		},
		{
			reason: '七夕の短冊、ステキだったね',
			recommendedPoints: 20,
			icon: '🎋',
			category: 'そうぞう',
		},
		{
			reason: '敬老の日にじいじ/ばあばへメッセージ ありがとう',
			recommendedPoints: 50,
			icon: '💌',
			category: 'こうりゅう',
		},
	],
	// ボタン操作系
	cheerAgainBack: 'ホームへ戻る',
	// 確認用ラベル
	confirmReasonLabel: '理由',
	confirmPointsLabel: 'ポイント',
	confirmCategoryLabel: 'カテゴリ',
	confirmIconLabel: 'アイコン',
	// エラーメッセージ
	// #4512: 旧実装はここに固定値 (1〜10000 / 100文字) を持ちつつ、実際に表示していたのは
	// +page.server.ts が cheer-service の定数から組み立てた別の文字列だった (二重定義)。
	// 上限値は server 側 (cheer-service.ts) が SSOT なので、labels は引数で受ける形にする。
	errorReasonRequired: `${CHEER_TERMS.canonical}の理由を入力してください`,
	errorReasonTooLong: (maxLength: number) => `理由は${maxLength}文字以内で入力してください`,
	errorPointsRange: (min: number, max: number) =>
		`ポイントは${min}〜${max}の範囲で入力してください`,
	errorCategoryRequired: 'カテゴリを選択してください',
	errorChildRequired: `${CHILD_TERMS.honorific}を選択してください`,
	errorChildNotFound: `${CHILD_TERMS.honorific}が見つかりません`,
	// #4716 item 15: 画面直書きだった顧客可視文言を SSOT へ
	reasonLengthHint: (used: number | string, max: number | string, remaining: number | string) =>
		`${used}/${max}（あと${remaining}文字）`,
	messagePlaceholder: 'ひとことメッセージを足す（任意）',
} as const;
