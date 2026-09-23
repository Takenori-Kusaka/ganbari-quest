// labels 層 (ADR-0045 / #4965): アプリ名・画面タイトル・汎用 UI 語・汎用ボタン・機能名 (2 つ以上の area で使う下層の共有)。置き場所の規則は docs/DESIGN.md §6
import { ADMIN_SCREENS } from '../admin-screens';
import {
	CERTIFICATE_TERMS,
	CHALLENGE_TERMS,
	CHILD_TERMS,
	CTA_TERMS,
	LOGIN_TERMS,
	SIGNUP_TERMS,
	TEMPLATE_TERMS,
	UPGRADE_TERMS,
} from '../terms';

// ============================================================
// アプリ情報 (#1452 Phase B)
// ============================================================

export const APP_LABELS = {
	name: 'がんばりクエスト',
	tagline: `${CHILD_TERMS.honorific}の活動をゲーミフィケーションで動機付けする家庭内Webアプリ`,
	demoName: 'がんばりクエスト デモ',
	pageTitleSuffix: ' - がんばりクエスト',
	demoPageTitleSuffix: ' - がんばりクエスト デモ',
	setupPageTitleSuffix: ' - がんばりクエスト セットアップ',
	errorPageTitlePart: ' エラー - がんばりクエスト',
} as const;

// ============================================================
// ページタイトル（<title> タグ用、#1452 Phase B）
// ============================================================

export const PAGE_TITLES = {
	// ご家族の見守り画面 (#2057, 旧称: 管理画面)
	activities: ADMIN_SCREENS.activities.name,
	activitiesIntroduce: '活動紹介スライド',
	reports: ADMIN_SCREENS.reports.name,
	achievements: ADMIN_SCREENS.challenges.name,
	growth: ADMIN_SCREENS.growthBook.name,
	points: ADMIN_SCREENS.points.name,
	// #2270 (EPIC #2266): 旧 messages 廃止 → cheer (応援機能) に統合
	cheer: ADMIN_SCREENS.cheer.name,
	rewards: ADMIN_SCREENS.rewards.name,
	checklists: ADMIN_SCREENS.checklists.name,
	// #2295 (EPIC #2294 ①): events 削除済 (2026-05-19)
	// #4671 F3 の呼称統一 (旧「きょうだいチャレンジ」) は ADMIN_SCREEN_TERMS.challenges =
	// CHALLENGE_TERMS.canonical として registry 側に吸収済み
	challenges: ADMIN_SCREENS.challenges.name,
	// #4714 / #4715: LP の carousel alt と nav / 見出しが同じ registry から引く
	children: ADMIN_SCREENS.children.name,
	members: ADMIN_SCREENS.members.name,
	settings: ADMIN_SCREENS.settings.name,
	// analytics: 削除 (#2284 EPIC #2283: /admin/analytics 撤去、運用者向け機能は /ops/analytics に移動)
	// #4139: /admin/billing は /admin/subscription に統合済。呼称も統一する (#4715)
	billing: ADMIN_SCREENS.subscription.name,
	certificates: ADMIN_SCREENS.certificates.name,
	license: ADMIN_SCREENS.subscription.name,
	// #4715: 旧「ベンチマーク管理」は画面の中身 (成長レポート) と別物だった
	status: ADMIN_SCREENS.status.name,
	// #2276 / Round 18 Cluster A (ADR-0045): 活動パック → TEMPLATE_TERMS atom 経由化
	packs: TEMPLATE_TERMS.userFacing,
	// 認証
	login: `${LOGIN_TERMS.canonical}`,
	signup: `${SIGNUP_TERMS.canonical}`,
	invite: '招待',
	// #4636: 招待受諾に失敗した人が留まる画面 (membership 未確定状態の正規の着地先)
	join: '家族グループへの参加',
	forgotPassword: 'パスワードリセット',
	// セットアップ
	setup: 'セットアップ',
	// 子供用
	// #2175: 「実績システム」命名残存解消で childAchievements → childChallenges に rename
	childChallenges: 'チャレンジきろく',
	childStatus: 'つよさ',
	childHome: 'ホーム',
	childChecklist: 'もちものチェック',
	// #4921: バトル画面 (`(character)/battle`)。demo 側の demoChildBattle と同値
	childBattle: 'バトル',
	// デモ子供用
	// #2175: demoChildAchievements → demoChildChallenges (本番と同期 rename)
	demoChildChallenges: 'チャレンジきろく',
	demoChildStatus: 'つよさ',
	demoChildBattle: 'バトル',
	demoChildHome: 'ホーム',
	demoChildChecklist: 'もちものチェック (デモ)',
	// デモ ご家族の見守り画面 (#2057)
	demoAdminAchievements: 'チャレンジ履歴（デモ）',
	demoAdminActivities: '活動管理',
	demoAdminChallenges: `${CHALLENGE_TERMS.canonical}（デモ）`,
	demoAdminChecklists: 'もちものチェックリスト',
	demoAdminChildren: `${CHILD_TERMS.honorific}管理`,
	demoAdminEvents: 'イベント管理（デモ）',
	demoAdminLicense: 'プラン・お支払い（デモ）',
	demoAdminMembers: 'メンバー管理',
	demoAdminMessages: 'おうえんメッセージ',
	demoAdminPoints: 'ポイント管理',
	demoAdminReports: '週間レポート（デモ）',
	demoAdminRewards: '特別報酬',
	demoAdminSettings: '設定',
	// デモ
	demo: 'デモ体験',
	demoSignup: 'デモ体験ありがとうございます',
	demoChildHistory: 'きろく',
	// セットアップ完了・各ステップ
	setupComplete: 'ぼうけんのはじまり！',
	setupChildren: `${CHILD_TERMS.honorific}登録`,
	// #4912: 保護者が操作する画面なのに他 setup step と違い title が無かった
	setupQuestionnaire: 'かんたん質問',
	setupFirstAdventure: 'はじめてのぼうけん',
	// Round 18 Cluster A (ADR-0045): 活動パック → TEMPLATE_TERMS atom 経由
	setupPacks: `${TEMPLATE_TERMS.userFacing}を選ぶ`,
	// #2140 MP-5: setup wizard β 採用
	setupRewards: 'ごほうびセット選択',
	setupRules: 'おうちのルール選択',
	// #2298: 家族チャレンジ step
	setupChallenges: '家族チャレンジ選択',
	// #2322: 活動・ポイント初期設定 step
	setupActivitiesDefaults: '活動・ポイント初期設定',
	// ユーザー切替
	switchUser: 'だれがつかう？',
	// その他
	// #2276: TEMPLATE_TERMS atom 参照化
	marketplace: TEMPLATE_TERMS.short,
	consent: '規約への同意',
	consentUpdate: '規約に変更がありました',
	pricing: '料金プラン',
} as const;

// ============================================================
// 汎用 UI メッセージ (#1452 Phase B)
// ============================================================

export const UI_LABELS = {
	// #4716: 「この日から」を表す接尾辞。子供画面の週次チャレンジ履歴などで使う。
	dateFromSuffix: '〜',
	redirecting: 'リダイレクト中...',
	back: '戻る',
	backWithArrow: '← 戻る',
	loading: '読み込み中...',
	saving: '保存中...',
	saved: '保存しました',
	deleting: '削除中...',
	deleted: '削除しました',
	adding: '追加中...',
	added: '追加しました',
	error: 'エラー',
	close: '閉じる',
	cancel: 'キャンセル',
	confirm: '確認',
	delete: '削除',
	add: '追加',
	edit: '編集',
	save: '保存',
	update: '更新',
	send: '送信',
	register: '登録',
	next: '次へ',
	prev: '前へ',
	skip: 'スキップ',
	// #1915 (TECH-F 中頻度 D-2): UPGRADE_TERMS atom 経由参照。
	//   admin UI / FAQ 既存「アップグレード」ボタン文言は確立した UX 用語のため UPGRADE_TERMS.actionVerb
	//   (= 'アップグレード') を維持。「プラン変更」canonical 化は別 Issue で段階移行。
	upgrade: `${UPGRADE_TERMS.actionVerb}`,
	points: 'ポイント',
	level: 'レベル',
	status: 'ステータス',
	clear: 'クリア！',
	noData: 'データがありません',
	noStatus: 'ステータスがまだないよ',
	noHistory: 'きろくがまだないよ',
	all: 'すべて',
	required: '必須',
	optional: '任意',
} as const;

// ============================================================
// 機能名
// ============================================================

export const FEATURE_LABELS = {
	report: ADMIN_SCREENS.reports.name,
	// #4715: 画面名 registry (nav = title = 見出し) に合わせる
	growthBook: ADMIN_SCREENS.growthBook.name,
	message: ADMIN_SCREENS.cheer.name,
	reward: 'ごほうび',
	// #1168: チェックリストを「持ち物」「ルーティン」に分離
	checklistItem: '持ち物チェックリスト',
	checklistRoutine: 'ルーティン',
	activity: '活動',
	points: 'ポイント',
	loginBonus: 'ログインボーナス',
	challenge: 'チャレンジ',
	event: 'イベント',
	certificate: CERTIFICATE_TERMS.full,
	stamp: 'スタンプ',
	// #1311: 「シールガチャ」語彙を撤回、実装実体 (日 1 回 cap login omikuji + 週次 stamp card) に合わせた SSOT
	// 旧: 'シールガチャ' → 新: 'おみくじ' + 'スタンプカード' の 2 mechanic 分離 (ADR-0012 / ADR-0013 準拠)
	omikuji: 'おみくじ',
	stampCard: 'スタンプカード',
	levelUp: 'レベルアップ',
	// #1912 (F-15): 「RPG バトル」→「ボスバトル」へ統一。LP machine-tour ②「冒険のクライマックス」
	//   と語彙整合（hero / growth-roadmap が「冒険」を主訴求とする中、「RPG」は外部 IT/ゲーム業界用語のため
	//   IT リテラシーなし親 P1 が認知ジャンプを起こす）。battle 機構の内部識別子 (battle-types.ts 等) は
	//   feature 識別子として scope 外。
	rpgBattle: 'ボスバトル',
	plan: 'プラン',
	members: 'メンバー',
	dataExport: 'データエクスポート',
	// #4767 PO 回答 #4: プラン制限 403 の機能名 (planLimitError に渡す)。route に直書きしない。
	cloudExport: 'クラウドエクスポート',
	archiveRestore: 'アーカイブしたデータの復元',
	// #1660 R53: 実装は activities / special-rewards / checklists の 3 endpoint で family-only gate 完備のため
	// 内部 SSOT も外部訴求 (pricing.html / plan-features.ts) と並列に「活動・ごほうび・チェックリスト」を明示
	aiActivitySuggest: 'AI による活動・ごほうび・チェックリスト提案',
} as const;

// ============================================================
// UI アクション共通ラベル（一括置換容易化のための SSOT）
// ============================================================

/**
 * UI アクションで頻出する動詞・CTA 文言の SSOT。
 * 「アップグレード」「プランを見る」「あとで」「無料体験」等、
 * プロダクト全体で一貫させたい用語をここに集約する。
 *
 * labels.ts 内でもハードコードせず ACTION_LABELS を参照することで、
 * 将来「アップグレード → プラン変更」等の一括置換がこのファイル 1 行の
 * 変更で済むようにする（#1166 + #1174）。
 */
// #1958 Phase 7 H1: freeTrial / freeTrialWord / freeTrialDesc は CTA atom (terms.ts CTA_TERMS) を参照。
// upgrade / viewPlans / later / submitting / viewDetail は本 Issue scope 外 (動詞 atom が未確立のため留保)。
// #1915 (TECH-F 中頻度 D-2): upgrade を UPGRADE_TERMS.actionVerb 経由参照に変更。
//   admin UI / FAQ 既存ボタン文言は確立 UX 用語のため「アップグレード」表記維持、canonical
//   「プラン変更」化は別 Issue で段階移行。
export const ACTION_LABELS = {
	upgrade: `${UPGRADE_TERMS.actionVerb}`,
	viewPlans: 'プランを見る',
	later: 'あとで',
	freeTrial: CTA_TERMS.freeTrialNoun,
	freeTrialWord: CTA_TERMS.freeTrialVerb,
	// #1383: タイトル文脈用の可能形 (「7日間、全機能を無料で試せます」)。
	// freeTrialWord (終止形) を「〜ます」に連結すると「試すます」と非文法になるため、
	// 完全活用済みの文言を個別定数化する。
	freeTrialDesc: CTA_TERMS.freeTrialDesc,
	submitting: '開始中...',
	// #1167: 詳細ページへの誘導 CTA。活動パック / マーケット一覧の「中身を確認する」導線に使用
	viewDetail: 'くわしく見る',
} as const;
