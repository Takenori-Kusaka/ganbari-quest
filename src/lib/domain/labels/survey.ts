// labels 層 (ADR-0045 / #4965): PMF アンケート (src/routes/survey)。置き場所の規則は docs/DESIGN.md §6
import { CHILD_TERMS } from '../terms';

// ============================================================
// PMF 判定アンケート（#1598 / ADR-0023 §3.6 §5 I7）
// ============================================================

/**
 * PMF 判定アンケート (Sean Ellis Test) の文言 SSOT。
 *
 * 半年に 1 度 (年 2 回) 親宛に配信し、以下 4 問で PMF 達成度を測る:
 *   Q1: 利用できなくなったらどう感じるか (4択 + N/A) ← Sean Ellis Score の指標
 *   Q2: 主要なベネフィット (自由記述)
 *   Q3: 認知経路 (6択)
 *   Q4: 使わなかった理由 (任意・自由記述)
 *
 * Anti-engagement 整合: 親宛のみ + 年 6 回上限 (#1601 lifecycle-emails と共有カウンタ) +
 * 「ぜひお答えください！」等の煽り表現は使わない。中立トーン。
 */
export const PMF_SURVEY_LABELS = {
	// ---- メール ----
	emailSubject: 'がんばりクエストに関するアンケートのお願い',
	emailHeading: 'アンケートのお願い',
	emailGreeting: (ownerName: string) => `${ownerName} 様`,
	emailIntro: 'いつも がんばりクエスト をご利用いただきありがとうございます。',
	emailBody:
		'サービス改善のため、半年に 1 度ご利用状況についてお伺いしております。回答は任意で、所要時間は 1〜2 分です。',
	emailRoundLabel: (round: string) => `今回のアンケート: ${round}`,
	emailCtaLabel: 'アンケートに回答する',
	emailNote: '回答内容は統計目的でのみ利用し、個別のお問い合わせには使用しません。',

	// ---- 回答ページ ----
	pageTitle: 'PMF 判定アンケート',
	pageHeading: 'がんばりクエストに関するアンケート',
	pageIntro:
		'下記の質問にご回答ください。所要時間は 1〜2 分です。回答内容は統計目的でのみ利用します。',
	requiredMark: '必須',
	optionalMark: '任意',

	q1Label: 'Q1. がんばりクエストが使えなくなったら、どう感じますか？',
	q1Options: {
		very: 'とても残念',
		somewhat: 'やや残念',
		not: '残念ではない',
		na: '使ったことがない／関係ない',
	},

	q2Label: 'Q2. このサービスから得られている、主なメリットは何ですか？',
	q2Placeholder: `例: ${CHILD_TERMS.honorific}が自分から記録するようになった など`,

	q3Label: 'Q3. このサービスをどこで知りましたか？',
	q3Options: {
		lp: '公式サイト（検索）',
		media: '育児関連メディア',
		friend: 'ママ友・パパ友からの紹介',
		google: 'Google 検索',
		sns: 'SNS（X / Instagram など）',
		other: 'その他',
	},

	q4Label: 'Q4. もし使わなくなったとしたら、どんな理由が考えられますか？',
	q4Placeholder: '記入は任意です',

	submitCta: '回答を送信する',
	submitting: '送信中…',

	// ---- 完了画面 ----
	thanksHeading: 'ご回答ありがとうございました',
	thanksBody: 'いただいたフィードバックは、サービス改善に活かしてまいります。',
	closeCta: '閉じる',

	// ---- エラー画面 ----
	invalidTitle: '無効なリンクです',
	invalidBody:
		'このリンクは無効か、すでに使用済みです。メール本文に記載されたリンクを再度ご確認ください。',
	alreadyAnsweredTitle: '回答済みです',
	alreadyAnsweredBody: 'この回の PMF 判定アンケートには既にご回答いただいています。',

	// ---- ops 画面 ----
	opsPageTitle: 'PMF 判定アンケート結果',
	opsHeading: 'PMF 判定アンケート結果（Sean Ellis Score）',
	opsDescription:
		'年 2 回親宛に配信した PMF 判定アンケート (Sean Ellis Test) の集計。「とても残念」が 40% を超えれば PMF 達成と判定する（ADR-0023 §3.6）。',
	opsThresholdLabel: 'PMF 判定ライン (40%)',
	opsRoundLabel: '対象ラウンド',
	opsTotalLabel: '回答総数',
	opsScoreLabel: 'Sean Ellis Score',
	opsAchievedLabel: 'PMF 達成',
	opsNotAchievedLabel: 'PMF 未達',
	opsNoDataLabel: 'まだ回答がありません',

	opsBreakdownHeading: '回答の内訳',
	opsBreakdownBars: {
		very: 'とても残念',
		somewhat: 'やや残念',
		not: '残念ではない',
		na: '関係ない',
	},

	opsAcquisitionHeading: '認知経路の内訳',
	opsAcquisitionTableChannel: '経路',
	opsAcquisitionTableCount: '回答数',
	opsAcquisitionTableShare: '割合',
	opsBenefitsHeading: '主なベネフィット (自由記述)',
	opsDisappointmentHeading: '離脱要因 (自由記述)',
	opsResponseEmpty: '回答なし',
	opsResponseTenantLabel: 'テナント',
	opsResponseDateLabel: '回答日時',

	// 自由記述検索 (AC12, PO 承認 2026-04-29)
	opsSearchHeading: '自由記述キーワード検索',
	opsSearchLabel: '検索キーワード',
	opsSearchPlaceholder: '例: 記録 / 続かない / テナント ID 先頭',
	opsSearchHint: 'Q2 ベネフィット・Q4 離脱要因の本文とテナント ID を対象に部分一致検索します。',
	opsSearchSubmitLabel: '検索',
	opsSearchClearLabel: 'クリア',
	opsSearchActiveLabel: (q: string) => `「${q}」で絞り込み中`,
	opsSearchResultCount: (matched: number, total: number) => `${total} 件中 ${matched} 件表示`,
	opsSearchNoMatch: '該当する回答がありません',
} as const;

/** PMF 判定アンケートの Q1 選択肢キー */
export type PmfSurveyQ1 = keyof typeof PMF_SURVEY_LABELS.q1Options;

/** PMF 判定アンケートの Q3 選択肢キー */
export type PmfSurveyQ3 = keyof typeof PMF_SURVEY_LABELS.q3Options;
