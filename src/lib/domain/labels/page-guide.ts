// labels 層 (ADR-0045 / #4965): 親の ❓ ページガイド (PAGE_GUIDE_LABELS.<画面>)。置き場所の規則は docs/DESIGN.md §6
import { ADMIN_SCREENS } from '../admin-screens';
import { CATEGORIES, CATEGORY_NAME_LIST } from '../categories';
import { CHEER_POINTS } from '../constants/cheer-points';
import {
	CERTIFICATE_LEVEL_MILESTONES,
	MONTHLY_HABIT_DAYS_THRESHOLD,
	STREAK_MILESTONE_DAYS,
} from '../constants/habit-milestones';
// #4664: 通知の配信量 (1 日の上限 / サイレント時間帯の既定) は domain 定数が SSOT。
import {
	DEFAULT_QUIET_END,
	DEFAULT_QUIET_START,
	MAX_DAILY_NOTIFICATIONS,
} from '../constants/notification';
import { FREE_PLAN_QUOTA } from '../constants/plan-quota';
import {
	REWARD_REJECT_NOTE_MAX_LENGTH,
	REWARD_REQUEST_HISTORY_LIMIT,
} from '../constants/redemption-status';
import {
	ACTIVITY_ADMIN_TERMS,
	ADD_MENU_TERMS,
	ADMIN_HOME_TERMS,
	ADMIN_SCREEN_TERMS,
	ADMIN_VIEW_TERMS,
	ADVENTURE_TERMS,
	BACKUP_TERMS,
	CANCEL_TERMS,
	CERTIFICATE_TERMS,
	CHALLENGE_TERMS,
	CHECKLIST_ADMIN_TERMS,
	CHEER_ADMIN_TERMS,
	CHEER_TERMS,
	CHILD_ADMIN_TERMS,
	CHILD_TERMS,
	DELETION_GRACE_TERMS,
	GROWTH_BOOK_TERMS,
	NUC_EDITION_TERMS,
	OVERFLOW_MENU_TERMS,
	OYAKAGI_TERMS,
	PARENT_TERMS,
	PLAN_CHANGE_TERMS,
	PLAN_FULL_TERMS,
	PLAN_TERMS,
	POINTS_ADMIN_TERMS,
	REWARD_ADMIN_TERMS,
	REWARD_TERMS,
	RULES_TERMS,
	STRIPE_PORTAL_TERMS,
	TEMPLATE_TERMS,
	TRIAL_TERMS,
	VIEWER_LINK_TERMS,
} from '../terms';
import { CERTIFICATE_DETAIL_LABELS } from './admin-certificates';
import { ADMIN_REWARDS_REQUESTS_LABELS } from './admin-rewards';
import { ADMIN_RULES_PAGE_LABELS } from './admin-settings';
import { PAGE_TITLES, UI_LABELS } from './common';
import { MARKETPLACE_FILTER_LABELS } from './marketplace';
import { MEMBERS_LABELS } from './members';
import { NAV_CATEGORIES, NAV_ITEM_LABELS } from './nav';
import { PAID_PLAN_LABEL, PLAN_GATE_LABELS } from './plan';

// ============================================================
// ページ別オンデマンドガイド（PageGuide）の表示文言 SSOT
// #3264 (EPIC #3260 F3): 各 `_guide.ts` (admin 11 ページ) にインライン直書きしていた
// 表示文言 (title / what / how / goal / tips) を本 compound に集約。
// `_guide.ts` は本定数を参照するだけにし、構造フィールド (pageId / icon / selector /
// position / requiredTier / step id) は `_guide.ts` 側に残す（表示文言ではないため）。
// 構造は page → step → field のネスト（ADR-0045 compound 層）。
// 本定数の文言を検査する linter は無い（機械強制は無い。レビューで担保する）。
// ============================================================

export const PAGE_GUIDE_LABELS = {
	// #4653: /admin ホームのガイド。画面の上から下の順 (承認待ちバナー → 上部カード → 今月のがんばり →
	// こども一覧 → 子供画面へ切替 → 各機能へ移動) に並べ、要素名は描画側と同じ atom
	// (ADMIN_HOME_TERMS / NAV_CATEGORIES / NAV_ITEM_LABELS) を参照する。条件付き要素 (承認待ちバナー /
	// 今月のがんばり) の step は `optional: true` で宣言し、対象が描画されているときだけ出る
	// (filterGuideStepsByPresence #4668 / #4677 → filterGuideStepsByTargetPresence #4653 の直列適用)。
	// 'home-nav' は desktop (header 下の nav) と mobile (画面下部の nav) の 2 step が同じ文言を共有する。
	adminHome: {
		title: NAV_ITEM_LABELS.home,
		steps: {
			'home-intro': {
				title: 'このページについて',
				what: `${ADMIN_VIEW_TERMS.canonical}の${NAV_ITEM_LABELS.home}です。今月のがんばり・${ADMIN_HOME_TERMS.childrenSection}・各機能への入り口がここに集まっています。`,
				how: `上から順に、${ADMIN_HOME_TERMS.pendingApproval}のお知らせ（あるとき）→ 上部カード → 今月のがんばり → ${ADMIN_HOME_TERMS.childrenSection} と並びます。このあと順番にご案内します。`,
				goal: '朝・夜のすきま時間にここを開けば、家族みんなの今月のがんばりと残高を 10 秒で把握でき、声かけのきっかけが見つかります。',
				tips: [
					`${REWARD_TERMS.canonical}の交換申請があると、いちばん上に「${ADMIN_HOME_TERMS.pendingApproval}」のお知らせが出ます。押すと承認画面に移動します`,
				],
				relatedLinks: [
					{
						label: `${REWARD_TERMS.canonical}の交換申請を確認する`,
						href: '/admin/rewards/requests',
					},
				],
			},
			'home-pending': {
				title: `${ADMIN_HOME_TERMS.pendingApproval}のお知らせ`,
				what: `お子さまが${REWARD_TERMS.canonical}の交換を申請すると、ここに${ADMIN_HOME_TERMS.pendingApproval}の件数が出ます。`,
				how: '1. このお知らせを押します\n2. 承認画面で申請を確認し、承認または却下します',
				goal: `申請を見落とさずに受け渡しができ、お子さまは「${REWARD_TERMS.canonical}がちゃんと届く」と実感できます。`,
			},
			'home-summary': {
				title: '画面の見方（上部カード）',
				what: `上部のカードは「${ADMIN_HOME_TERMS.childrenCountCard}」と「${ADMIN_HOME_TERMS.totalCard}」の 2 枚です。${ADMIN_HOME_TERMS.totalCard}はお子さま全員のポイント残高を足した数で、今日の獲得分ではありません。`,
				how: `1. 上部カードで人数と残高${ADMIN_HOME_TERMS.totalCard}を確認\n2. 下の「今月のがんばり」で、お子さまごとの活動回数・レベル・実績を見ます\n3. 「${ADMIN_HOME_TERMS.monthlyDetailsLink}」で月次レポートへ`,
				goal: '「みんなで 1,200 ポイント貯まったね」のように、家族全体の残高と今月の動きを開いた瞬間に把握できます。',
			},
			'home-monthly': {
				title: '画面の見方（今月のがんばり）',
				what: `「📊 今月${ADMIN_HOME_TERMS.monthlySuffix}」には、お子さまごとの今月の活動回数・レベル・実績が並びます。`,
				how: `1. お子さまごとのカードで活動回数・レベル・実績を確認\n2. 右上の「${ADMIN_HOME_TERMS.monthlyDetailsLink}」を押すと月次レポートが開きます`,
				goal: '「今月はうんどうを 20 回がんばったね」と、具体的な数字でお子さまをほめられます。',
				tips: [
					'お子さまが画面を開くと、その下に「⏱️ 本日の使用時間」（1 日 15 分が目安）と「📈 今週の使用時間」も表示されます',
				],
				relatedLinks: [{ label: `${NAV_ITEM_LABELS.reports}を見る`, href: '/admin/reports' }],
			},
			'home-children': {
				title: `画面の見方（${ADMIN_HOME_TERMS.childrenSection}）`,
				what: `登録済みのお子さまがカードで並びます。カードにはニックネーム・年齢・テーマ・ポイント残高が出ます。`,
				how: `1. お子さまのカードを押します\n2. ${NAV_ITEM_LABELS.children}管理の詳細が開き、プロフィールの編集やボイスの設定ができます`,
				goal: `お子さまごとの残高と設定にここから直接たどり着けます。`,
				relatedLinks: [{ label: `${NAV_ITEM_LABELS.children}を管理する`, href: '/admin/children' }],
			},
			'home-switch': {
				title: `よく使う操作（${ADMIN_HOME_TERMS.switchToChild}）`,
				what: `画面右上の「← ${ADMIN_HOME_TERMS.switchToChild}」で、お子さまが使う画面に切り替えます。`,
				how: `1. 「← ${ADMIN_HOME_TERMS.switchToChild}」を押します\n2. お子さまを選ぶと、その子の画面が開きます`,
				goal: `${ADMIN_VIEW_TERMS.short}とお子さまの画面を 1 台の端末で行き来でき、設定した活動をその場でお子さまに見せられます。`,
			},
			'home-nav': {
				title: 'よく使う操作（各機能へ移動）',
				what: `各機能へは「${NAV_CATEGORIES.family.label}」「${NAV_CATEGORIES.activity.label}」「${NAV_CATEGORIES.record.label}」「${NAV_CATEGORIES.settings.label}」の 4 つと「${NAV_ITEM_LABELS.home}」から移動します。スマホでは画面下部、パソコンでは画面上部のメニューです。`,
				how: `1. 目的のカテゴリ（${NAV_CATEGORIES.family.label} / ${NAV_CATEGORIES.activity.label} / ${NAV_CATEGORIES.record.label} / ${NAV_CATEGORIES.settings.label}）を押します\n2. 開いたメニューから画面を選びます（${NAV_ITEM_LABELS.home}はそのまま移動します）`,
				goal: 'どの画面からでも 2 タップ以内で目的の機能にたどり着けます。',
			},
		},
	},
	// #4655: /admin/activities のガイド。画面の上から下 (+ 追加 → ︙ → お子さまタブ → フィルタと検索 →
	// 一覧カード → 非表示の活動) の順に主要操作を網羅し、ボタン名 / カテゴリ名 / 上限は描画側と同じ atom
	// (ADD_MENU_TERMS / OVERFLOW_MENU_TERMS / ACTIVITY_ADMIN_TERMS / CATEGORIES / FREE_PLAN_QUOTA) を参照する。
	// お子さまタブ (0 人で非表示) と 非表示の活動 (0 件で非表示) は filterGuideStepsByTargetPresence で描画時のみ出る。
	adminActivities: {
		title: NAV_ITEM_LABELS.activities,
		steps: {
			'activities-intro': {
				title: 'このページについて',
				what: 'お子さまが記録する「活動」を管理するページです。習い事・お手伝い・家庭ルールなど、ご家庭オリジナルのがんばりをポイント化できます。',
				how: `上から順に、右上の「${ADD_MENU_TERMS.trigger}」と「︙」→ お子さまのタブ → カテゴリのフィルタと検索 → 活動の一覧（その下に${ACTIVITY_ADMIN_TERMS.hiddenSection}）と並びます。設定した活動はお子さまの画面にカードとして並びます。`,
				goal: 'お子さまがタップして記録するたびにポイントが貯まり、「今月ピアノを何回練習したか」までレポートで見えるようになります。',
			},
			'activities-add': {
				title: `よく使う操作（${ADD_MENU_TERMS.trigger}）`,
				what: `右上の「${ADD_MENU_TERMS.trigger}」を押すと、${ADD_MENU_TERMS.manual} / ${ADD_MENU_TERMS.ai} / ${ADD_MENU_TERMS.browse} / ${ADD_MENU_TERMS.copyFromChild}（お子さまが 2 人以上のとき）/ ${ADD_MENU_TERMS.bulk} から選べます。`,
				how: `1. 「${ADD_MENU_TERMS.trigger}」を押す\n2. 追加のしかたを選ぶ\n3. 「${ADD_MENU_TERMS.manual}」では活動名・カテゴリ・アイコン・ポイント・1日の上限回数を入力\n4. フォーム下の「〇〇${ACTIVITY_ADMIN_TERMS.submitSuffix}」を押す`,
				goal: '選んでいるお子さまの画面に新しい活動カードが表示され、記録するとポイントが貯まり、月次レポートにも反映されます。',
				tips: [
					`${PLAN_FULL_TERMS.free}では自分で追加できる活動は ${FREE_PLAN_QUOTA.maxActivities} 件までです（上限に達すると「${ADD_MENU_TERMS.manual}」に鍵マークが付き、プラン画面に案内します）`,
					PLAN_GATE_LABELS.familyOnlyFor(`「${ADD_MENU_TERMS.ai}」`),
					'ポイントは初期活動とのバランスを見て設定しましょう（高すぎるとインフレします）。1日上限回数を設定すると連打を防げます',
				],
			},
			'activities-overflow': {
				title: '画面の見方（︙ メニュー）',
				what: `右端の「︙」には ${OVERFLOW_MENU_TERMS.itemRestore} / ${OVERFLOW_MENU_TERMS.itemExport} / ${OVERFLOW_MENU_TERMS.itemClearAll} が入っています。`,
				how: `1. 「︙」を押す\n2. 「${OVERFLOW_MENU_TERMS.itemExport}」で活動をファイルに保存、「${OVERFLOW_MENU_TERMS.itemRestore}」でそのファイルから戻せます`,
				goal: '機種変更や設定し直しのときも、活動の設定をまるごと持ち運べます。',
				tips: [
					`「${OVERFLOW_MENU_TERMS.itemClearAll}」は確認のうえ全活動を消します。やり直したいときだけ使います`,
				],
			},
			'activities-child-tabs': {
				title: '画面の見方（お子さまのタブ）',
				what: '活動はお子さまごとに持ちます。タブで選んだお子さまの活動だけが下に表示され、追加もそのお子さまに入ります。カッコ内はその子の活動数です。',
				how: `1. 表示したいお子さまのタブを押す\n2. 兄弟に同じ活動を入れたいときは「${ADD_MENU_TERMS.trigger}」の「${ADD_MENU_TERMS.copyFromChild}」または「${ADD_MENU_TERMS.bulk}」を使う`,
				goal: '兄弟それぞれの年齢や興味に合わせて活動を分けつつ、共通の活動はまとめて入れられます。',
			},
			'activities-filter': {
				title: '画面の見方（カテゴリのフィルタと検索）',
				what: `活動は ${CATEGORIES.undou.name}・${CATEGORIES.benkyou.name}・${CATEGORIES.seikatsu.name}・${CATEGORIES.kouryuu.name}・${CATEGORIES.souzou.name} の 5 カテゴリに分かれています。一覧の上のボタンで表示を絞り込み、その下の「${ACTIVITY_ADMIN_TERMS.search}」で名前からも探せます。`,
				how: `1. カテゴリのボタンを押して絞り込む\n2. 「${UI_LABELS.all}」を押すと絞り込みを解除する\n3. 「${ACTIVITY_ADMIN_TERMS.search}」に活動名の一部を入れると一覧が絞られる`,
				goal: `活動が増えても「${CATEGORIES.undou.name}だけ表示」のように、目的の活動を素早く見つけられます。`,
			},
			'activities-list': {
				title: '画面の見方（活動の一覧）',
				what: `各カードに「${ACTIVITY_ADMIN_TERMS.edit}」「${ACTIVITY_ADMIN_TERMS.visible}／${ACTIVITY_ADMIN_TERMS.hidden}」「${ACTIVITY_ADMIN_TERMS.mainQuestEnable}」「${ACTIVITY_ADMIN_TERMS.delete}」のボタンがあります。${ADVENTURE_TERMS.mainQuest}にするとお子さまの画面で目立ち、ポイントが 2 倍になります（最大 3 件）。`,
				how: `1. 「${ACTIVITY_ADMIN_TERMS.edit}」で名前やポイントを変える\n2. 「${ACTIVITY_ADMIN_TERMS.visible}」を押すと${ACTIVITY_ADMIN_TERMS.hidden}になり、お子さまの画面から消える（記録は残る）\n3. 「${ACTIVITY_ADMIN_TERMS.mainQuestEnable}」で${ADVENTURE_TERMS.mainQuest}にする（「${ACTIVITY_ADMIN_TERMS.mainQuestDisable}」で戻す）\n4. 「${ACTIVITY_ADMIN_TERMS.delete}」は確認のうえ活動を消す`,
				goal: '季節やお子さまの成長に合わせて、活動を消さずに出し入れしながら、今がんばってほしいものを目立たせられます。',
			},
			'activities-hidden': {
				title: `画面の見方（${ACTIVITY_ADMIN_TERMS.hiddenSection}）`,
				what: `${ACTIVITY_ADMIN_TERMS.hidden}にした活動は一覧の下の「${ACTIVITY_ADMIN_TERMS.hiddenSection}」にまとまります。記録はそのまま残っています。`,
				how: `1. 「${ACTIVITY_ADMIN_TERMS.hiddenSection}」を押して開く\n2. 「${ACTIVITY_ADMIN_TERMS.restore}」でお子さまの画面に戻す\n3. 「${ACTIVITY_ADMIN_TERMS.permanentDelete}」は記録ごと消す（元に戻せません）`,
				goal: `「${ACTIVITY_ADMIN_TERMS.hidden}」と「${ACTIVITY_ADMIN_TERMS.delete}」の違いが分かり、夏だけの活動なども安心して休ませられます。`,
			},
		},
	},
	adminChallenges: {
		title: CHALLENGE_TERMS.canonical,
		// #4671 (EPIC #4650): 全 step が中央 modal で何も光らなかったため、画面の DOM 順
		// (家族ストリーク → お子さまタブ → 今週のカード → 削除) に anchor を張り直す。
		// 削除の説明は実装の事実 (同じ週のうちは再び用意され進捗は 0 に戻る) を正とする (PO 判断)。
		steps: {
			'challenges-intro': {
				title: 'このページについて',
				what: `${CHALLENGE_TERMS.canonical}は、日々の活動とは別の「中期的なゴール」です。アプリが毎週、お子さまの記録の傾向にあわせて、苦手なことや得意なことを伸ばす目標を自動で用意します。このページでは、その${CHALLENGE_TERMS.canonical}を保護者が一覧で見守れます。`,
				how: `設定や作成は不要です。お子さまがアプリを開くと今週の${CHALLENGE_TERMS.canonical}が自動で用意され、ここに表示されます。すべてのプランでご利用いただけます。`,
				goal: 'お子さまの画面に進捗バーが表示され、達成に近づく様子が見えます。期間内に達成すると特別な演出でお祝いされます。',
			},
			// ② 家族ストリーク (誰かが記録した日が続くと表示される。0 日の日は描画されない → optional)
			'challenges-family-streak': {
				title: '画面の見方（家族ストリーク）',
				what: `一番上の「🔥 家族ストリーク」は、ご家族の誰かが記録した日が何日続いているかを表します。その下に今日すでに記録した人数が出ます。${CHALLENGE_TERMS.canonical}とは別の「家族全体の連続記録」です。`,
				how: `1. 「家族ストリーク: N日」で連続日数を確認します\n2. 「今日は N人が記録済み」で今日の状況を確認します（誰も記録していない日はその旨が出ます）`,
				goal: '「あと 1 人記録すれば今日も続くね」と、家族で声をかけ合うきっかけになります。',
			},
			// ③ お子さまタブ (子供 2 人以上のときだけ描画 → optional)
			'challenges-child-tabs': {
				title: '画面の見方（お子さまで絞り込む）',
				what: `お子さまが 2 人以上のとき、上のタブで表示する子を切り替えられます。お子さまが 1 人のご家庭ではタブは出ず、その子の${CHALLENGE_TERMS.canonical}がそのまま並びます。`,
				how: `1. 「すべて」を押すと全員分が並びます\n2. お子さまの名前のタブを押すと、その子の${CHALLENGE_TERMS.canonical}だけが表示されます`,
				goal: '見たいお子さまの取り組みだけを表示して、進み具合を確認できます。',
			},
			// ④ 今週のカードの見方 (1 件以上あるときだけ描画 → optional)
			'challenges-card': {
				title: '画面の見方（今週のカード）',
				what: `上に今週の${CHALLENGE_TERMS.canonical}、その下に過去の履歴が並びます。カードには期間中を表す「開催中」、全員が達成した「全員クリア！」のしるしと、達成でもらえる「報酬 N P」（P はポイント）が表示されます。同じ週の${CHALLENGE_TERMS.canonical}は、お子さまごとの進捗が 1 枚のカードに並びます。`,
				how: `1. 進捗バーで達成までの距離を確認します\n2. 「報酬 N P」で達成時にもらえるポイントを確認します\n3. ポイントはお子さまが自分のホーム画面で受け取ります（保護者の操作は不要です）`,
				goal: 'どのお子さまが何にどれくらい取り組んでいるかを、設定の手間なく見守れます。',
			},
			// ⑤ 削除 (カードが 1 件以上あるときだけ描画 → optional)
			'challenges-delete': {
				title: 'よく使う操作（削除）',
				what: `お子さまに合わない${CHALLENGE_TERMS.canonical}は、カードから取り除けます。消えるのは押したお子さまの分だけです。`,
				how: `1. カード右下の「削除」（きょうだいのカードでは「<お名前> を削除」）を押します\n2. 確認画面で「削除」を選びます`,
				goal: `そのお子さまの今週の進捗は消えます。同じ週のうちは、次にお子さまがアプリを開くと今週分が改めて用意されます（進捗は 0 からになります）。翌週は新しい${CHALLENGE_TERMS.canonical}が届きます。`,
				tips: [
					`${CHALLENGE_TERMS.canonical}はアプリが自動で用意するので、保護者が目標を作る必要はありません`,
				],
			},
		},
	},
	// #4657: /admin/checklists のガイド。画面の上から下 (+ 追加 → ︙ → お子さまタブと検索 → 一覧カードの調整 →
	// 本日のワンオフ) の順に主要操作を網羅し、ボタン名は描画側と同じ atom (ADD_MENU_TERMS /
	// CHECKLIST_ADMIN_TERMS / OVERFLOW_MENU_TERMS)、上限は FREE_PLAN_QUOTA を参照する。
	// 条件付き要素 (お子さまタブ / 一覧カード / 本日のワンオフ) は filterGuideStepsByTargetPresence で描画時のみ出る。
	adminChecklists: {
		title: CHECKLIST_ADMIN_TERMS.pageTitle,
		steps: {
			'checklists-intro': {
				title: 'このページについて',
				what: 'お子さまが「学校の準備」「習い事の持ち物」「寝る前のしたく」などを自分で確認できるチェックリストを用意するページです。',
				how: `上から順に、右上の「${ADD_MENU_TERMS.trigger}」と「︙」→ お子さまのタブと${CHECKLIST_ADMIN_TERMS.search} → チェックリストの一覧 → ${CHECKLIST_ADMIN_TERMS.todayOverride} と並びます。`,
				goal: 'お子さまが自分でタップして「できた！」を確認できるようになり、「ハンカチ持った？」と毎朝聞く必要がなくなります。',
				tips: [
					`${PLAN_FULL_TERMS.free}ではお子さま 1 人あたり ${FREE_PLAN_QUOTA.maxChecklistTemplates} 件までです（上限に達すると「${ADD_MENU_TERMS.manual}」に鍵マークが付き、プラン画面に案内します）`,
					PLAN_GATE_LABELS.familyOnlyFor(`「${ADD_MENU_TERMS.ai}」`),
				],
			},
			'checklists-add': {
				title: `よく使う操作（${ADD_MENU_TERMS.trigger}）`,
				what: `右上の「${ADD_MENU_TERMS.trigger}」を押すと、${ADD_MENU_TERMS.manual} / ${ADD_MENU_TERMS.ai} / ${ADD_MENU_TERMS.browse} / ${CHECKLIST_ADMIN_TERMS.addOverride} / ${CHECKLIST_ADMIN_TERMS.copyFromChild}（お子さまが 2 人以上のとき）から選べます。`,
				how: `1. 「${ADD_MENU_TERMS.trigger}」を押す\n2. はじめてなら「${ADD_MENU_TERMS.browse}」で ${TEMPLATE_TERMS.userFacing} を開き、使いたいチェックリストの「${CHECKLIST_ADMIN_TERMS.marketplaceImportCta}」で取り込む\n3. 自分で作るときは「${ADD_MENU_TERMS.manual}」で名前とアイコンを決める\n4. 今日だけ足したいものは「${CHECKLIST_ADMIN_TERMS.addOverride}」`,
				goal: '取り込んだチェックリストがそのまま使え、ご家庭に合わせて項目を足したり消したりして調整できます。',
			},
			'checklists-overflow': {
				title: '画面の見方（︙ メニュー）',
				what: `右端の「︙」には ${OVERFLOW_MENU_TERMS.itemMarketplace} / ${OVERFLOW_MENU_TERMS.itemRestore} / ${OVERFLOW_MENU_TERMS.itemExport} / ${OVERFLOW_MENU_TERMS.itemHelp} が入っています。`,
				how: `1. 「︙」を押す\n2. 「${OVERFLOW_MENU_TERMS.itemExport}」で 1 つのチェックリストをファイルに保存、「${OVERFLOW_MENU_TERMS.itemRestore}」でそのファイルから戻せます`,
				goal: '作り込んだチェックリストを保存しておけるので、機種変更やお子さまの進級のときも作り直さずに済みます。',
			},
			'checklists-child-tabs': {
				title: '画面の見方（お子さまのタブと検索）',
				what: 'タブで選んだお子さまに配られているチェックリストが下に表示されます。その下の検索欄で名前から絞り込めます。',
				how: `1. 表示したいお子さまのタブを押す\n2. 「${CHECKLIST_ADMIN_TERMS.search}」に名前の一部を入れて絞り込む\n3. 兄弟に同じリストを配るときは「${ADD_MENU_TERMS.trigger}」の「${CHECKLIST_ADMIN_TERMS.copyFromChild}」を使う`,
				goal: 'お子さまごとに違うリストにも、兄弟で同じリストにもできます。',
			},
			'checklists-card': {
				title: '画面の見方（カードの調整）',
				what: `各カードで、${CHECKLIST_ADMIN_TERMS.timeSlot}の切り替え・項目の追加と削除・${CHECKLIST_ADMIN_TERMS.configureDistribution}・${CHECKLIST_ADMIN_TERMS.perChildProgress}の確認ができます。`,
				how: `1. 「${CHECKLIST_ADMIN_TERMS.addItem}」で持ち物ややることを足す（各項目の ✕ で消す）\n2. ${CHECKLIST_ADMIN_TERMS.timeSlot}のボタンで朝・夜などを切り替える\n3. 「${CHECKLIST_ADMIN_TERMS.configureDistribution}」で、このリストを表示するお子さまを選ぶ\n4. 「${CHECKLIST_ADMIN_TERMS.delete}」で不要になったリストを消す`,
				goal: `${CHECKLIST_ADMIN_TERMS.distributionSection}の下に「${CHECKLIST_ADMIN_TERMS.perChildProgress}」が出るので、今日どこまで終わったかが親の画面で分かります。`,
				tips: [
					`「${CHECKLIST_ADMIN_TERMS.inactiveBadge}」と付いたリストはお子さまの画面に出ません`,
				],
			},
			'checklists-override': {
				title: `画面の見方（${CHECKLIST_ADMIN_TERMS.todayOverride}）`,
				what: '遠足やプールの日など、今日だけ足したもの・外したものが一覧の下にまとまります。',
				how: `1. 「${ADD_MENU_TERMS.trigger}」の「${CHECKLIST_ADMIN_TERMS.addOverride}」で今日だけの持ち物を足す\n2. ここに出た項目は当日限りで、明日には元のリストに戻ります`,
				goal: '特別な日のためにリスト本体を書き換えずに済み、翌日に戻し忘れる心配がありません。',
			},
		},
	},
	// #4659: /admin/cheer のガイド。画面の上から下 (送り先 → よくある応援 → 理由とポイント → 応援する →
	// 履歴) の順に、実際に押す要素を spotlight する (旧ガイドは見出し 1 行だけを光らせていた)。
	// P の範囲・既定値は CHEER_POINTS (domain/constants、cheer-service と同一定数)、例文は
	// CHEER_LABELS.reasonPlaceholder を参照する。子供 0 人 / 履歴 0 件では該当 step が出ない。
	adminCheer: {
		title: CHEER_TERMS.canonical,
		steps: {
			'cheer-intro': {
				title: 'このページについて',
				what: `お子さまのがんばりに、その場で${CHEER_TERMS.canonical}を届けるページです。理由と任意のボーナスポイント（${CHEER_POINTS.min}〜${CHEER_POINTS.max}P、はじめは ${CHEER_POINTS.default}P）を添えて、すぐに気持ちを伝えられます。`,
				how: `上から順に、送り先のお子さま → 「${CHEER_ADMIN_TERMS.presetTitle}」 → 理由・ポイント・カテゴリ・アイコン → 「${CHEER_TERMS.action}」 と並びます。毎日の活動ポイントは${NAV_ITEM_LABELS.activities}から、その場でひと押ししたい${CHEER_TERMS.canonical}はこちらから。`,
				goal: '「親が見ていて、すぐに認めてくれる」体験になり、お子さまの継続のモチベーションを支えます。',
			},
			'cheer-select': {
				title: '画面の見方（送り先を選ぶ）',
				what: `まず「${CHEER_ADMIN_TERMS.selectChildTitle}」で、${CHEER_TERMS.canonical}を送るお子さまを選びます。選んだお子さま宛てに届きます。`,
				how: '1. お子さまの名前のボタンを押す\n2. 選ばれたボタンの色が変わります',
				goal: '兄弟姉妹がいても、送りたいお子さまを取り違えずに選べます。',
			},
			'cheer-templates': {
				title: `よく使う操作（${CHEER_ADMIN_TERMS.presetTitle}）`,
				what: `「${CHEER_ADMIN_TERMS.presetTitle}」のチップを 1 回押すだけで、理由・ポイント・カテゴリ・アイコンがまとめて入ります。`,
				how: '1. あてはまるチップを押す\n2. 入った内容はそのまま直せます（ポイントだけ増やす等）',
				goal: '毎回 7 段の入力をしなくても、数タップで応援を送れます。',
			},
			'cheer-reason': {
				title: '画面の見方（理由とポイントを整える）',
				what: `理由（例:「${CHEER_ADMIN_TERMS.reasonPlaceholder}」）と、ボーナスポイント・カテゴリ・アイコン・付随スタンプを決めます。`,
				how: `1. 理由を入力する（チップを使ったときは入力済み）\n2. ポイントを ${CHEER_POINTS.min}〜${CHEER_POINTS.max} の範囲で決める（はじめは ${CHEER_POINTS.default}P）\n3. カテゴリを選ぶ（お子さまのカテゴリ別のがんばりに積まれます）\n4. アイコンとスタンプを選ぶ（お子さまの画面と履歴に出ます）`,
				goal: 'すごい瞬間にはポイント多め、日常のがんばりには少なめ、と使い分けると価値が伝わります。',
			},
			'cheer-submit': {
				title: `よく使う操作（${CHEER_TERMS.action}）`,
				what: `いちばん下で内容を確認し、「${CHEER_TERMS.action}」を押すと送信されます。`,
				how: `1. 理由・ポイント・カテゴリ・アイコンの確認欄を見る\n2. 「${CHEER_TERMS.action}」を押す（理由とポイントが未入力のうちは押せません）`,
				goal: 'お子さまの画面にメッセージとポイントが届き、送信後は入力欄が空に戻ります。具体的に褒めると効果が高まります。',
			},
			'cheer-history': {
				title: `画面の見方（最近の${CHEER_TERMS.canonical}）`,
				what: `選んでいるお子さまに送った${CHEER_TERMS.canonical}が下に並びます。お子さまが読んだかどうかも分かります。`,
				how: '1. 送った内容とポイントを確認する\n2. 他のお子さまの履歴は、上でそのお子さまを選ぶと表示されます',
				goal: '「先週も同じことで応援した」と分かるので、ほめる場面が偏らずに済みます。',
			},
		},
	},
	// #4660: /admin/children のガイド。上から下 (追加する → お子さま一覧 → 詳細カード) の順に、
	// 実際に押す要素を spotlight する (旧 step ② は一覧ではなく追加ボタン行を光らせ ③ と重複していた)。
	// ボタン名 / タブ名は描画側と同じ atom (CHILD_ADMIN_TERMS)、上限人数は FREE_PLAN_QUOTA を参照。
	// 詳細カードはお子さま選択時のみ描画されるため filterGuideStepsByTargetPresence で出し分ける。
	adminChildren: {
		title: NAV_ITEM_LABELS.children,
		steps: {
			'children-intro': {
				title: 'このページについて',
				what: 'お子さまを登録・管理するページです。お子さまごとに専用の画面が作られ、活動・ポイント・レベルが個別に記録されます。',
				how: `まずはお子さまを 1 人登録するところから始めます。登録後は画面右上の「← ${ADMIN_HOME_TERMS.switchToChild}」からその子の画面を開けます。`,
				goal: '兄弟姉妹それぞれの専用画面ができ、テーマカラーで取り違えることなく一人ひとりの成長を見守れます。',
				relatedLinks: [{ label: ADMIN_HOME_TERMS.switchToChild, href: '/switch' }],
			},
			'children-add': {
				title: `よく使う操作（お子さまの登録）`,
				what: `いちばん最初に行うのがお子さまの登録です。「${CHILD_ADMIN_TERMS.addButton}」を押すとフォームが開きます。`,
				how: `1. 「${CHILD_ADMIN_TERMS.addButton}」を押す（もう一度押すと閉じます）\n2. ${CHILD_ADMIN_TERMS.nickname}を入力（ひらがな推奨）\n3. 誕生日を選ぶ（分からないときは${CHILD_ADMIN_TERMS.age}だけでも登録できます）\n4. ${CHILD_ADMIN_TERMS.themeColor}を選ぶ\n5. フォーム下の「${CHILD_ADMIN_TERMS.addButton}」で確定`,
				goal: 'お子さま専用の画面が作られ、活動の記録・ポイント・レベルアップが個別に追跡されます。',
				tips: [
					`${PLAN_FULL_TERMS.free}で登録できるお子さまは ${FREE_PLAN_QUOTA.maxChildren} 人までです。上限に達すると「${CHILD_ADMIN_TERMS.limitReachedButton}」と表示され、上の案内からプランを変更できます`,
					'誕生日を入れておくと、年齢に合わせて画面の文字表現が自動で変わります（3 歳 → 全部ひらがな、小学生 → 漢字まじり）',
				],
				relatedLinks: [{ label: 'プランを見る', href: '/admin/subscription' }],
			},
			'children-list': {
				title: '画面の見方（お子さま一覧）',
				what: `登録済みのお子さまのカードが並びます。カードには${CHILD_ADMIN_TERMS.nickname}・${CHILD_ADMIN_TERMS.age}・区分・テーマ・誕生日・ポイント残高が出ます。`,
				how: '1. お子さまのカードを押す\n2. 下にそのお子さまの詳細が開きます',
				goal: '兄弟姉妹の残高や設定を、このページだけで見比べられます。',
			},
			'children-detail': {
				title: '画面の見方（詳細カード）',
				what: `カードを押すと開く詳細に、${CHILD_ADMIN_TERMS.tabInfo} / ${CHILD_ADMIN_TERMS.tabStatus} / ${CHILD_ADMIN_TERMS.tabLogs} / ${CHILD_ADMIN_TERMS.tabAchievements} / ${CHILD_ADMIN_TERMS.tabVoice} の 5 つのタブがあります。`,
				how: `1. タブを押して見たい内容に切り替える\n2. 「${CHILD_ADMIN_TERMS.editButton}」で${CHILD_ADMIN_TERMS.nickname}・誕生日・${CHILD_ADMIN_TERMS.themeColor}・写真・おたんじょうびボーナスを変える\n3. 登録をやめるときは同じ詳細の下にある「${CHILD_ADMIN_TERMS.deleteButton}」から（2 段階の確認があります）`,
				goal: '名前やテーマを後から変えられ、活動の記録や実績もお子さまごとに振り返れます。',
				tips: [
					`「${CHILD_ADMIN_TERMS.tabVoice}」では、活動を記録したときに再生される親の声（最大 10 秒）を録音・登録できます`,
				],
			},
		},
	},
	adminPoints: {
		title: NAV_ITEM_LABELS.points,
		steps: {
			'points-intro': {
				title: 'このページについて',
				what: `お子さまが活動で貯めたポイントを、おこづかい（現金）に${POINTS_ADMIN_TERMS.convertVerb}ページです。ポイントの「使い道」を見せることが、貯めるモチベーションになります。`,
				how: `1. お子さまの残高カードを押す\n2. 下に開く${POINTS_ADMIN_TERMS.convert}フォームで金額を決めて確定する`,
				goal: '「500ポイント貯めたらおこづかいにしようね」という約束が実現でき、お子さまにお金の感覚も育ちます。',
				tips: [
					`${REWARD_TERMS.canonical}との交換はこのページではなく、お子さまの画面の${REWARD_TERMS.shop}で行います（用意は${REWARD_TERMS.menu}から）`,
					'円で表示したいときや 1P あたりの金額を変えたいときは、設定 > 活動・ポイント の「ポイント表示設定」から変更します（はじめは 1P = 1円）',
				],
				relatedLinks: [
					{ label: 'ポイント表示設定を開く', href: '/admin/settings/activities#point-settings' },
					{ label: `${REWARD_TERMS.menu}を開く`, href: '/admin/rewards' },
				],
			},
			'points-balances': {
				title: '画面の見方（残高の一覧）',
				what: `お子さまごとのカードに「残高」と「${POINTS_ADMIN_TERMS.convertable}」が出ます。${POINTS_ADMIN_TERMS.convertable}は残高を ${POINTS_ADMIN_TERMS.presetUnit}P 単位に切り捨てた額で、「${POINTS_ADMIN_TERMS.tabPreset}」で選べる上限です。`,
				how: `1. カードで残高と${POINTS_ADMIN_TERMS.convertable}を見比べる\n2. 端数まで${POINTS_ADMIN_TERMS.convertVerb}ときは「${POINTS_ADMIN_TERMS.tabManual}」を使う（1P 単位）`,
				goal: '誰がどれだけ貯めているかをひと目で把握でき、いくらまで渡せるかがすぐ分かります。',
				tips: [
					`残高が ${POINTS_ADMIN_TERMS.presetUnit}P に満たないお子さまはカードを押しても${POINTS_ADMIN_TERMS.convert}できる分がありません`,
				],
			},
			'points-convert': {
				title: `よく使う操作（おこづかいへの${POINTS_ADMIN_TERMS.convert}）`,
				what: `残高カードを押すと、その下に${POINTS_ADMIN_TERMS.convert}フォームと「${POINTS_ADMIN_TERMS.historyTitle}」が開きます。`,
				how: `1. ${POINTS_ADMIN_TERMS.convertVerb}お子さまのカードを押す\n2. 「${POINTS_ADMIN_TERMS.tabPreset}」「${POINTS_ADMIN_TERMS.tabManual}」「${POINTS_ADMIN_TERMS.tabReceipt}」から入力方法を選ぶ\n3. 金額を決めて、下の「〇〇 を${POINTS_ADMIN_TERMS.convertVerb}」（円で表示しているときは「〇〇 を渡す」）を押す`,
				goal: 'お子さまの残高から その分が引かれ、りれきに記録されます。',
				tips: ['円で表示しているときは、画面の案内どおり実際のお金をお子さまにお渡しください'],
			},
			'points-modes': {
				title: `画面の見方（3 つの入力方法）`,
				what: `「${POINTS_ADMIN_TERMS.tabPreset}」は ${POINTS_ADMIN_TERMS.presetUnit}P 単位のボタンから選ぶ方法、「${POINTS_ADMIN_TERMS.tabManual}」は 1P 単位で自分で入れる方法、「${POINTS_ADMIN_TERMS.tabReceipt}」は買ったものの領収書を撮って金額を読み取る方法です。`,
				how: `1. 「${POINTS_ADMIN_TERMS.tabPreset}」— ${POINTS_ADMIN_TERMS.convertable}を超える金額のボタンは出ません\n2. 「${POINTS_ADMIN_TERMS.tabManual}」— 残高を超えると「残高を超えています」と出ます。「${POINTS_ADMIN_TERMS.maxButton}」で残高いっぱいまで入ります\n3. 「${POINTS_ADMIN_TERMS.tabReceipt}」— 撮影 → 読み取り → 金額を直して確定します`,
				goal: '「1,000 円ぴったり渡す」「本を買った分だけ引く」など、ご家庭の渡し方に合わせて選べます。',
			},
			'points-history': {
				title: `画面の見方（${POINTS_ADMIN_TERMS.historyTitle}）`,
				what: `選んでいるお子さまの${POINTS_ADMIN_TERMS.convert}記録が下にまとまります。「今月の合計」「累計」と、${POINTS_ADMIN_TERMS.historyFilterThisMonth} / ${POINTS_ADMIN_TERMS.historyFilterLastMonth} / ${POINTS_ADMIN_TERMS.historyFilterAll} の切り替えがあります。`,
				how: `1. ${POINTS_ADMIN_TERMS.historyFilterThisMonth} / ${POINTS_ADMIN_TERMS.historyFilterLastMonth} / ${POINTS_ADMIN_TERMS.historyFilterAll} を押して期間を切り替える\n2. 他のお子さまの記録は、上のカードでそのお子さまを選ぶと表示されます`,
				goal: '「今月はいくら渡したか」を後から確認でき、渡し忘れ・二重渡しを防げます。',
			},
		},
	},
	adminReports: {
		title: 'レポート',
		// #4670 (EPIC #4650): step は画面の DOM 順 (右上リンク → upsell → タブ → 月の移動 → 週次設定 →
		// きょうだいランキング)。呼称はリンク実表示 (CERTIFICATE_TERMS / GROWTH_BOOK_TERMS canonical) と
		// タブ実表示 (REPORTS_LABELS.tabMonthly / tabWeekly と同文) に合わせ、週次に無い「曜日別」は書かない。
		steps: {
			'reports-intro': {
				title: 'このページについて',
				what: 'お子さまのがんばりを、月ごと・週ごとにまとめて振り返るページです。活動回数・ポイント・レベル・カテゴリ別の内訳がひと目でわかります。',
				how: '上から順に、証明書・記録ブックへのリンク、「月次レポート」「週次レポート」のタブ、レポート本体が並びます。週次レポートのメール配信設定ときょうだいランキングは週次タブ / ページ下部にあります。',
				goal: '「今月はうんどうを20回頑張ったね！先月より5回多いよ」と、具体的な数字でお子さまを褒められます。',
			},
			// ② 右上の証明書 / 記録ブック リンク (2 本を包む要素を spotlight)
			'reports-links': {
				title: `画面の見方（${CERTIFICATE_TERMS.canonical}・${GROWTH_BOOK_TERMS.canonical}）`,
				what: `右上の 2 つのリンクから、がんばりの節目ごとに発行される「${CERTIFICATE_TERMS.canonical}」と、長期的な成長をまとめた「${GROWTH_BOOK_TERMS.canonical}」のページを開けます。`,
				how: `1. 「📜 ${CERTIFICATE_TERMS.canonical}」を押すと${CERTIFICATE_TERMS.full}の一覧を開きます\n2. 「📖 ${GROWTH_BOOK_TERMS.canonical}」を押すと${GROWTH_BOOK_TERMS.full}を開きます\n3. どちらも画面で閲覧でき、印刷や PDF 保存はそれぞれのページから行います`,
				goal: 'がんばりを形に残せるので、お子さまの達成感が大きくなり、次の目標への意欲につながります。',
				tips: [`PDF 保存・印刷は${PAID_PLAN_LABEL}で利用できます（閲覧はどのプランでもできます）`],
				relatedLinks: [
					{ label: CERTIFICATE_TERMS.full, href: '/admin/certificates' },
					{ label: GROWTH_BOOK_TERMS.full, href: '/admin/growth-book' },
				],
			},
			// ③ 無料プラン向け upsell バナー (free のときだけ描画、optional)
			'reports-weekly-upsell': {
				title: '画面の見方（週次メールレポートのご案内）',
				what: `週次レポートを毎週メールで受け取る機能は${PAID_PLAN_LABEL}の特典です。${PLAN_FULL_TERMS.free}では、このお知らせと「週次レポート」タブのプレビューが表示されます。`,
				how: `1. メールで受け取りたいときは「プランを見る →」からプランを確認します\n2. 今のプランのままでも、「週次レポート」タブで今週のまとめを画面で見られます`,
				goal: 'メール配信を使うかどうかを、内容をプレビューで確かめてから決められます。',
			},
			'reports-tabs': {
				title: '画面の見方（月次レポート／週次レポートの切り替え）',
				what: 'タブで「月次レポート」と「週次レポート」を切り替えます。月次は 1 か月の総まとめ（先月との比較つき）、週次は今週のカテゴリ別の活動数・ハイライト・新しい実績・アドバイスです。',
				how: '1. 「月次レポート」「週次レポート」のタブを押して切り替えます\n2. 週次レポートタブの上部には「⚙️ レポート設定」（メール配信の有効化・配信曜日）があります',
				goal: '「今週はうんどうが多かった」「今月は先月より活動が増えた」のように、期間ごとの傾向に気づけ、次の声かけのヒントになります。',
			},
			// ⑤ 月の移動と先月比 (月次タブのときだけ描画、optional)
			'reports-month-nav': {
				title: 'よく使う操作（月の移動と先月比）',
				what: '◀ ▶ で見たい月に移動します。月次レポートの数字には先月との差が色付きで表示されます（緑＝増加、赤＝減少）。',
				how: '1. ◀ で前の月、▶ で次の月に移動します\n2. 各数字の下の「先月比」で増減を確認します',
				goal: '「先月より 5 回多いよ」と根拠のある声かけができ、月ごとの伸びを追えます。',
			},
			// ⑥ 週次メール配信設定 (週次タブのときだけ描画、optional)
			'reports-weekly-settings': {
				title: 'よく使う操作（週次レポートのメール配信設定）',
				what: `「⚙️ レポート設定」で、週次レポートをメールで受け取るかどうかと配信曜日を設定します。メール配信は${PAID_PLAN_LABEL}で利用できます。`,
				how: '1. 「週次レポートを有効にする」にチェックを入れます\n2. 「配信曜日」を選びます\n3. 「保存」を押します',
				goal: '毎週決まった曜日に、お子さまのがんばりのまとめが保護者のメールに届きます。',
			},
			// ⑦ きょうだいランキング (プレミアム + ランキング ON + 子 2 人以上のときだけ描画、optional)
			'reports-sibling-ranking': {
				title: '画面の見方（きょうだいランキング）',
				what: `きょうだいの今週の活動数をくらべる「👫 きょうだいランキング」です。${PLAN_FULL_TERMS.premium}で、設定の「きょうだいランキング」が ON、かつお子さまが 2 人以上のときに表示されます。`,
				how: '1. 「今週のまとめ」でもっとも活発だったお子さまを確認します\n2. 「週別 活動数のうつりかわり」「カテゴリ別くらべっこ」のグラフで推移と得意分野をくらべます',
				goal: 'きょうだいそれぞれの得意・がんばりどころが分かり、比べて責めるのではなく、それぞれを認める声かけに使えます。',
				tips: [
					'表示されないときは、プラン・設定の「きょうだいランキング」・お子さまの人数を確認してください',
				],
			},
		},
	},
	// #4656: /admin/rewards のガイド。画面の上から下 (+ 追加 → ︙ → お子さまタブ → 一覧カード) の順に主要操作を
	// 網羅し、ボタン名は描画側と同じ atom (ADD_MENU_TERMS / REWARD_ADMIN_TERMS / OVERFLOW_MENU_TERMS / REWARD_TERMS)
	// を参照する。お子さまタブ (0 人) / 一覧カード (0 件) は filterGuideStepsByTargetPresence で描画時のみ出る。
	adminRewards: {
		title: REWARD_TERMS.menu,
		steps: {
			'rewards-intro': {
				title: 'このページについて',
				what: `お子さまの${REWARD_TERMS.shop}に並べる${REWARD_TERMS.canonical}（おこづかい・ゲーム時間・おやつなど）を管理するページです。`,
				how: `右上の「${ADD_MENU_TERMS.trigger}」から始めます。上から順に、「${ADD_MENU_TERMS.trigger}」と「︙」→ お子さまのタブ → ${REWARD_ADMIN_TERMS.search} → ${REWARD_TERMS.canonical}の一覧 と並びます。その場でひと押ししたい${CHEER_TERMS.canonical}は${CHEER_TERMS.canonical}ページから送ります。`,
				goal: `お子さまが貯めたポイントで${REWARD_TERMS.canonical}と交換できるようになり、「がんばれば叶う」体験がモチベーションを支えます。`,
				tips: [
					// #4928: テンプレートの取込は全プラン可。有料なのはオリジナル作成と編集だけ
					// #4992: 無料プランでは一覧カードの「編集」にも鍵マークが付く (押す前に一覧の上の注記で理由が読める)
					`${PLAN_GATE_LABELS.standardOrAboveFor(PLAN_GATE_LABELS.rewardCustomizeFeature)}。${PLAN_FULL_TERMS.free}では「${ADD_MENU_TERMS.manual}」と各カードの「${REWARD_ADMIN_TERMS.edit}」に鍵マークが付き、押すとプランの案内が出ます。「${ADD_MENU_TERMS.browse}」からの取込と「${REWARD_ADMIN_TERMS.delete}」は${PLAN_FULL_TERMS.free}でも使えます`,
				],
				relatedLinks: [{ label: `${CHEER_TERMS.canonical}を送る`, href: '/admin/cheer' }],
			},
			'rewards-add': {
				title: `よく使う操作（${ADD_MENU_TERMS.trigger}）`,
				what: `右上の「${ADD_MENU_TERMS.trigger}」を押すと、${ADD_MENU_TERMS.manual} / ${ADD_MENU_TERMS.ai} / ${ADD_MENU_TERMS.browse} から選べます。`,
				how: `1. 「${ADD_MENU_TERMS.trigger}」を押す\n2. 「${ADD_MENU_TERMS.manual}」を選ぶ\n3. ${REWARD_ADMIN_TERMS.formTitle}・${REWARD_ADMIN_TERMS.formPoints}・${REWARD_ADMIN_TERMS.formIcon}・${REWARD_ADMIN_TERMS.shopCategory}を入力\n4. 下の「〇〇 (ポイント)${REWARD_ADMIN_TERMS.submitSuffix}」を押す`,
				goal: `選んでいるお子さまの${REWARD_TERMS.shop}に${REWARD_TERMS.canonical}が並び、貯めたポイントで交換できるようになります。`,
				tips: ['ポイントは通常の活動の 10〜50 回分くらいが目安です（多すぎるとインフレします）'],
			},
			'rewards-overflow': {
				title: `画面の見方（︙ メニュー・${REWARD_ADMIN_TERMS.requestsMenu}）`,
				what: `右端の「︙」には ${REWARD_ADMIN_TERMS.requestsMenu} / ${OVERFLOW_MENU_TERMS.itemRestore} / ${OVERFLOW_MENU_TERMS.itemExport} が入っています。お子さまが交換を申請すると「${ADD_MENU_TERMS.trigger}」の左に件数の赤いバッジが出ます。`,
				how: `1. 「︙」を押す\n2. 「${REWARD_ADMIN_TERMS.requestsMenu}」で申請を確認し、承認して受け渡す\n3. 「${OVERFLOW_MENU_TERMS.itemExport}」で保存、「${OVERFLOW_MENU_TERMS.itemRestore}」でそのファイルから戻せます`,
				goal: `お子さまの交換申請を見落とさず、${REWARD_TERMS.canonical}の設定は機種変更のときも持ち運べます。`,
				relatedLinks: [
					{
						label: `${REWARD_ADMIN_TERMS.requestsMenu}の画面を開く`,
						href: '/admin/rewards/requests',
					},
				],
			},
			'rewards-child-tabs': {
				title: '画面の見方（お子さまの切り替え）',
				what: `${REWARD_TERMS.canonical}はお子さまごとに持ちます。タブで選んだお子さまの${REWARD_TERMS.canonical}だけが下に表示され、追加もそのお子さまに入ります。タブの数字は登録済みの件数です。`,
				// #4716: コピー操作は子供タブ行の右端ボタンから header 「+ 追加」dropdown に移動した
				how: `1. お子さまのタブを押す\n2. 兄弟に同じ${REWARD_TERMS.canonical}を用意するときは、右上の「${ADD_MENU_TERMS.trigger}」→「${REWARD_ADMIN_TERMS.copyFromChild}」でまとめてコピーする（お子さまが 2 人以上のとき）`,
				goal: `お子さまごとに別々の${REWARD_TERMS.canonical}を用意できるので、年齢や興味に合わせた応援ができます。`,
			},
			'rewards-list': {
				title: `画面の見方（${REWARD_TERMS.canonical}の一覧）`,
				what: `各カードに「${REWARD_ADMIN_TERMS.edit}」「${REWARD_ADMIN_TERMS.delete}」があります。お子さまが交換を申請中のカードには「${REWARD_ADMIN_TERMS.pendingBadge}」と出ます。上の「${REWARD_ADMIN_TERMS.search}」で名前から絞り込めます。`,
				how: `1. 「${REWARD_ADMIN_TERMS.edit}」でタイトルやポイントを変える（申請済みの交換は申請時点の内容で処理されます）\n2. 「${REWARD_ADMIN_TERMS.delete}」は確認のうえ消す（「${REWARD_ADMIN_TERMS.pendingBadge}」があるときは先に申請を処理します）`,
				goal: `${REWARD_TERMS.canonical}を直したり整理したりしても、お子さまが申請済みの交換は壊れません。`,
				// #4992: 手順 1 の「編集」は無料プランでは押せない。手順どおりに進めて行き止まらないよう明示する
				tips: [
					`「${REWARD_ADMIN_TERMS.edit}」は${PLAN_FULL_TERMS.standard}以上の機能です（取り込んだ${REWARD_TERMS.canonical}も含みます）。「${REWARD_ADMIN_TERMS.delete}」はどのプランでも使えます`,
				],
			},
		},
	},
	adminSettings: {
		title: '設定',
		steps: {
			'settings-intro': {
				title: 'このページについて',
				what: `${ADMIN_VIEW_TERMS.canonical}の各種設定をまとめたページです。アクセスを守る${OYAKAGI_TERMS.shortName}、ポイントの表示単位、データのバックアップなどをここから設定します。`,
				// #4661: 「お子さまの年齢モード / お名前 / 追加」を探して設定に来る保護者が多いが、
				// hub の 7 カードに子供設定は無く、ガイドにも橋渡しが無かった (relatedLinks 0 件)。
				how: `設定したい項目のカードを選んで、その中の設定画面に進みます。お子さまごとの設定 (お名前・年齢モード・お子さまの追加) はこのページには無く、メニューの「${NAV_ITEM_LABELS.children}」から行います。`,
				goal: `必要な設定にすぐたどり着けるので、${OYAKAGI_TERMS.shortName}の変更やバックアップなどの「念のための備え」を迷わず行えます。`,
			},
			// #3954: hub のカードが 6→7 枚になったため、件数と「上から順に」の並びを実装に合わせる。
			// ここが古いと、ガイドに従う保護者は列挙された 6 件の中に ごほうび・ボーナスルール を
			// 見つけられず、カードを追加しても到達できない (#2905 と同じ形)。
			// 件数と列挙数の一致は tests/unit/routes/settings-hub-coverage.test.ts [S5] / [S6] で gate 化。
			'settings-hub': {
				title: '画面の見方（7つの設定グループ）',
				what: '設定は目的別に7つのカードに分かれ、上から順に並びます。それぞれで何ができるかを上から見ていきます。',
				how: `上から順に:\n1. アカウント — ${OYAKAGI_TERMS.shortName}の変更や${CANCEL_TERMS.account}\n2. 活動・ポイント — やる気が続く設定\n3. 通知 — お知らせの受け取り\n4. データ — ${BACKUP_TERMS.exportNoun}と${BACKUP_TERMS.restoreVerb}\n5. ごほうび・ボーナスルール — 交換の承認要否とボーナス\n6. サポート・アプリ情報 — 感想・要望や規約\n7. ${ADMIN_SCREENS.subscription.name} — 契約と支払い（別ページに移動します）`,
				goal: '設定項目が多くても、目的のカードを1枚選ぶだけで迷わずたどり着けます。',
				tips: [
					// #4661 F4: 支払いの確認が取れていない間だけ、カード群の上に赤いお知らせが出る。
					'お支払いの確認が取れていないときは、カードの上に赤いお知らせが出ます。その中のボタンからプラン・お支払いの画面に進めます',
				],
			},
			'settings-account': {
				title: 'よく使う操作と詳しいガイド',
				// #4661 M1: 桁数は実装が受け付ける範囲 (OYAKAGI_TERMS.digitRange) を正とする。
				// 以前は「4桁の数字」と断定しており、入力ラベルの「4〜8桁」と食い違っていた。
				what: `最初に確認したいのはアカウントカードです。${OYAKAGI_TERMS.name}（${OYAKAGI_TERMS.digitRange}の数字）を変えられ、お子さまが誤って${ADMIN_VIEW_TERMS.short}に入るのを防げます。`,
				how: '1. 目的のカードをタップして開きます\n2. 各ページの「?」を押すと、そのページ専用の詳しい操作ガイドが見られます',
				goal: 'よく使う操作にすぐ進め、各ページのガイドで迷わず設定できます。',
				// #4661 M2: 変えられるのは「今の おやカギコード」。初期値 (DEFAULT_PIN) は定数で変更対象ではない。
				tips: [`${OYAKAGI_TERMS.name}の変更やポイント表示は各カードの中で行えます`],
				relatedLinks: [{ label: NAV_ITEM_LABELS.children, href: '/admin/children' }],
			},
		},
	},
	// #3266 (EPIC #3260 C2): 設定サブ 6 ページの個別ガイド文言。親 adminSettings (ハブ) とは別に、
	// 各サブページの実セクションを上→下順に説明する (F0 guide-copy-rules 準拠、≤5 step / 3 部構成)。
	// #4662 (EPIC #4650): 旧 3 step は同じ `pin-settings` カードを 2 回続けて光らせ、内容もほぼ
	//   同じで実質 1 枚分の情報しか無かった。手順には「新しいおやカギコード（確認）」欄の再入力が
	//   抜けており、そのとおり操作すると必ず required エラーになる。ページ下部の ログアウト /
	//   アカウント削除（最も不可逆な操作）は step が無かった。見方と操作を 1 step に統合し、
	//   空いた枠を ログアウト / アカウント削除 に充てる。呼称は OYAKAGI_TERMS 経由に統一。
	adminSettingsAccount: {
		title: 'アカウント',
		steps: {
			'settings-account-intro': {
				title: 'このページについて',
				// #4662: ログアウト / アカウント削除の step は saas かつ実描画時のみ出る
				//   (requiredRuntime + optional) ため、概要側にも「ご利用環境によっては」を残す。
				what: `${ADMIN_VIEW_TERMS.short}を守る${OYAKAGI_TERMS.name}を変更できるページです。ご利用環境によっては、ログアウトやアカウントの削除（${CANCEL_TERMS.account}）もここから行えます。`,
				how: `上から順に、${OYAKAGI_TERMS.shortName}を変更するカードが表示されます。その下に、ご利用環境によってログアウトとアカウント削除のカードが並びます。`,
				goal: `${OYAKAGI_TERMS.shortName}をこまめに変えて、お子さまが誤って${ADMIN_VIEW_TERMS.short}に入るのを防げます。`,
			},
			// ② 見方 + 操作を統合 (旧 settings-account-pin / -pin-change は同一 selector で重複)。
			//   手順は実フォームの 3 入力欄 + ボタン名に一致させる (確認欄の再入力が抜けていた)。
			'settings-account-pin': {
				title: `よく使う操作（${OYAKAGI_TERMS.shortName}を変える）`,
				// #4661: 桁数は OYAKAGI_TERMS.digitRange (実装の受付範囲) を引く。「4桁」断定は誤り。
				what: `${OYAKAGI_TERMS.name}は${ADMIN_VIEW_TERMS.short}を開くときの${OYAKAGI_TERMS.digitRange}の数字です。このカードには「現在の${OYAKAGI_TERMS.name}」「新しい${OYAKAGI_TERMS.name}（${OYAKAGI_TERMS.digitRange}）」「新しい${OYAKAGI_TERMS.name}（確認）」の 3 つの入力欄と、変更ボタンが縦に並びます。入力した数字は伏せ字で表示されるため、いまのコードそのものは画面に出ません。`,
				how: `1. 「現在の${OYAKAGI_TERMS.name}」に、いま使っている数字を入力します\n2. 「新しい${OYAKAGI_TERMS.name}（${OYAKAGI_TERMS.digitRange}）」に新しい数字を入力します\n3. 「新しい${OYAKAGI_TERMS.name}（確認）」に、同じ数字をもう一度入力します（打ち間違い防止のため 3 つ目の欄も必須です）\n4. 「${OYAKAGI_TERMS.shortName}を変更」を押します`,
				goal: `「${OYAKAGI_TERMS.name}を変更しました」と表示され、次に${ADMIN_VIEW_TERMS.short}を開くときから新しい数字が必要になります。`,
				tips: [
					// #4698 (PO 判断): 既定値 (旧「初期 5086」) は顧客可視 UI に出さない。#2992 以降は
					//   初回に親ゲートで**自分で作成する**フローのため既定値は存在せず、案内すると
					//   「5086 を入れたのに現在のコードが違うと言われる」誤案内になる。加えて子供が
					//   同じ端末で読める場所に既定値を書くこと自体が #2353 で塞いだ脆弱性に戻る。
					`忘れてしまったときは、${ADMIN_VIEW_TERMS.short}に入るときの入力画面から、ご本人確認のうえ作り直せます`,
				],
			},
			// ③ ログアウト (cognito 環境のカード。requiredRuntime='saas' + optional)
			'settings-account-logout': {
				title: 'ログアウト',
				what: `この端末からアカウントをログアウトします。共有のパソコンやタブレットを使い終わるときに使います。お子さまの記録や設定は消えません。`,
				how: `1. 「アカウントからログアウト」を押します\n2. ログイン画面に戻ります`,
				goal: '次に使うときは、メールアドレスとパスワードでのログインが必要になります。',
			},
			// ④ アカウント削除 (Danger Zone。requiredRuntime='saas' + optional)
			'settings-account-delete': {
				title: `アカウント削除（${CANCEL_TERMS.account}）`,
				what: `ページの一番下は「危険な操作」の区画です。${CANCEL_TERMS.account}すると、お子さまのプロフィール・活動記録・ポイント履歴・アバター画像や音声・設定・チェックリスト・メンバーシップが削除されます。ご家族に他のメンバーがいる場合は、オーナー権限を引き継いでもらうか、家族グループごと削除するかを選びます。`,
				how: `1. 先にデータを持ち出せます（「${CANCEL_TERMS.account}する前にデータを持ち出す」の「データをダウンロード」。どのプランでも使えます）\n2. 確認テキストの入力 → 同意チェック → 実行ボタン の 3 手順で進みます\n3. 実行するとお申し込みが完了します`,
				goal: `猶予期間はプランで異なります（${PLAN_FULL_TERMS.free}は猶予${DELETION_GRACE_TERMS.free}＝お申し込みと同時に削除され取り消せません／${PLAN_FULL_TERMS.standard}は${DELETION_GRACE_TERMS.standard}／${PLAN_FULL_TERMS.family}は${DELETION_GRACE_TERMS.premium}）。猶予があるプランでは、その間このページの上部に案内と「復元」ボタンが出るので、押せば取り消せます。猶予を過ぎるとデータは復旧できません。`,
				tips: [
					`データの持ち出しはお申し込みの**前**に行ってください（猶予のないプランでは、申し込んだ時点で取り出せなくなります）`,
				],
			},
		},
	},
	// #4663 (EPIC #4650): 旧 3 step は「段階を選ぶ → すぐに反映されます」「単位を選ぶ → 子供の
	//   画面に反映されます」と案内していたが、実装はどちらも保存ボタンを押さないと反映されない。
	//   ガイドどおりに操作した保護者は設定が変わらないまま離れる。手順を実ボタン名で書き直し、
	//   step が届いていなかったページ後半 (既定の子供 / きょうだいランキング) も追加する。
	//   ボタン名 / 選択肢名は SETTINGS_LABELS と同一文字列にし、一致は
	//   tests/unit/routes/settings-activities-guide.test.ts が機械照合する。
	adminSettingsActivities: {
		title: '活動・ポイント',
		steps: {
			'settings-activities-intro': {
				title: 'このページについて',
				what: 'お子さまの活動にまつわる設定をまとめたページです。やる気が続く仕組みや、ポイントの見せ方をここで調整します。',
				how: `上から順に、ステータス減少・ポイント表示・既定の${CHILD_TERMS.honorific}（お子さまが 2 人以上のとき）・きょうだいチャレンジ設定 が並びます。`,
				goal: 'ご家庭に合わせて、活動の続けやすさやポイントの見せ方を整えられます。',
				tips: [
					// #4663 F1 / F2: このページのカードはどれも「選ぶ」だけでは保存されない。
					'どのカードも、選んだあとに一番下の保存ボタンを押すまで反映されません',
				],
			},
			// ② ステータス減少 (常設カード)
			'settings-activities-decay': {
				title: '画面の見方（ステータス減少）',
				what: '何日か活動しないと、お子さまのステータスが少しずつ下がる仕組みです。下がる強さを「なし」「ゆるやか」「ふつう」「きびしめ」の 4 段階から選べます。どの段階でも、活動をお休みした最初の 2 日間は下がりません。',
				how: '1. 4 つの選択肢から 1 つを選びます（「なし」= 下がらない／「ゆるやか」= 通常の半分／「ふつう」= 猶予 2 日後にゆるやかに／「きびしめ」= 1.5 倍の速さ）\n2. カードの一番下の「設定を保存」を押します\n3. 「ステータス減少設定を保存しました」と出れば完了です',
				goal: '毎日コツコツ続ける動機づけを、ご家庭の方針に合わせて調整できます。',
				tips: [
					'始めたばかりのときは「なし」から試すと、お休みした日に下がって落ち込むことがありません',
					'旅行などで数日空くときも、最初の 2 日は下がりません',
				],
			},
			// ③ ポイント表示 (常設カード)
			'settings-activities-point': {
				title: 'よく使う操作（ポイント表示）',
				what: '貯まったポイントを、そのまま「ポイント（P）」で見せるか、円などの通貨に換算して見せるかを選べます。呼び方そのものを変える設定ではありません。',
				how: '1. 「表示モード」で「ポイント（P）」か「通貨で表示」を選びます\n2. 「通貨で表示」を選んだときは、通貨と「レート（1P = ？）」を入力します（レートは必須です）\n3. すぐ下のプレビューで、お子さまの画面にどう出るかを確かめます\n4. 「ポイント設定を保存」を押します',
				goal: 'お子さまの画面のポイント表示が、選んだ見せ方に変わります。金額で見せると「あと何円分」が伝わりやすくなります。',
				tips: ['レートは「1P = 1円なら 1」「1P = 0.01ドルなら 0.01」のように入力します'],
			},
			// ④ 既定のお子さま (お子さま 2 人以上のときだけ描画 → optional)
			//    #4716: カード見出し (SETTINGS_LABELS.defaultChildSectionTitle) と同じ honorific で呼ぶ
			'settings-activities-default-child': {
				title: `画面の見方（既定の${CHILD_TERMS.honorific}）`,
				what: 'ホーム画面を開いたときに、どのお子さまの画面を自動で表示するかを決められます。お子さまが 2 人以上のご家庭だけに出るカードです。',
				how: '1. 「未設定（毎回選択画面を表示）」かお子さまの名前を選びます\n2. 「既定を保存」を押します',
				goal: '次からホーム画面を開くと、選んだお子さまの画面がすぐ出ます。「未設定」に戻せば毎回選ぶ画面に戻ります。',
				tips: ['この設定は端末ごとではなくアカウント全体に効きます（ご家族のどの端末でも同じ）'],
			},
			// ⑤ きょうだいランキング (カード自体は常設。チェックボックスがプランで disabled)
			'settings-activities-sibling': {
				title: 'よく使う操作（きょうだいランキング）',
				what: `きょうだいの記録を並べて見せる「きょうだいランキング」の表示を切り替えます。${PLAN_FULL_TERMS.premium}限定の機能で、それ以外のプランではチェックボックスが押せない状態で表示され、下にご案内が出ます。`,
				how: '1. 「きょうだいランキングを表示する」にチェックを入れます\n2. 「設定を保存」を押します',
				goal: 'お子さまの画面にきょうだいの並びが出て、お互いを意識するきっかけになります。競争が合わないご家庭では、チェックを外して保存すれば表示されません。',
				tips: [
					`チェックが押せない（グレーになっている）ときは、${PLAN_FULL_TERMS.premium}のご契約が必要です`,
				],
			},
		},
	},
	// #4664 (EPIC #4650): 旧ガイドは「お子さま自身が活動を思い出すきっかけ」と書いていたが、
	//   通知が届くのは購読した**保護者のこの端末**。種類も「連続記録のお祝い」と実項目
	//   (ストリーク警告) がずれ、リマインダー時刻 / サイレント時間帯 / 1 日の上限 /
	//   ブロック中の復旧手順に触れていなかった。届く先・種類・条件を画面の事実に合わせる。
	//   リマインダー / ストリーク警告 は配信スケジューラが無く UI ごと外したため、
	//   ガイドからも訴求を落とす (ADR-0013: 届かないものを約束しない)。
	adminSettingsNotifications: {
		title: '通知',
		steps: {
			'settings-notifications-intro': {
				title: 'このページについて',
				what: `お知らせが届くのは、この設定を行った${PARENT_TERMS.honorific}の端末（いま見ているブラウザ）です。お子さまの端末には届きません。`,
				how: '上でこのブラウザの通知をオン・オフし、下で受け取るお知らせの種類・リマインダーの時刻・送らない時間帯を決めます。',
				goal: 'お子さまが記録した瞬間の「できたよ」を、離れていても受け取れます。',
			},
			// ② ブラウザ通知の状態 (常設)
			'settings-notifications-status': {
				title: '画面の見方（通知のオン・オフ）',
				what: 'いまこのブラウザで通知が使える状態かどうかを表します。「オン」なら受け取れます。「ブロック中」はブラウザ側で拒否されている状態で、アプリからはオンに戻せません。',
				how: '1. 「オン」のときは「通知をオフにする」で止められます\n2. 表示が無いときは「通知をオンにする」を押し、ブラウザの確認で「許可」を選びます\n3. 「ブロック中」のときはボタンが出ません。ブラウザのサイト設定で通知を「許可」に変えてから、このページを再読み込みしてください',
				goal: '受け取れない状態のまま気づかずに待つことがなくなります。',
				tips: [
					'お使いのブラウザや端末が通知に対応していないときは、ボタンが押せない状態で表示されます',
				],
			},
			// ③ 受け取るお知らせの種類 (常設。3 種とも配信経路がある — リマインダー / ストリーク警告は
			//    #4706 の notification-delivery cron、達成通知は記録時の同期送信)
			'settings-notifications-types': {
				title: 'よく使う操作（お知らせの種類）',
				what: '受け取るお知らせを 3 つから選べます。「リマインダー通知（毎日の記録を促す）」は決めた時刻に、「ストリーク警告（連続記録が途切れそうな時）」は連続記録が途切れそうな日に、「達成通知（記録完了・レベルアップ時）」はお子さまが記録した直後とレベルが上がったときに届きます。',
				how: '1. 受け取りたいお知らせにチェックを入れます\n2. 下の「通知設定を保存」を押します\n3. リマインダーにチェックを入れて保存すると、その下に「リマインダー時刻」の欄が出ます。時刻を合わせて、もう一度「通知設定を保存」を押してください',
				goal: '選んだお知らせだけが、この端末に届くようになります。',
				tips: [
					// #4664 M: 時刻欄は「チェックした瞬間」ではなく、保存後の再読込で現れる。
					'「リマインダー時刻」の欄は、リマインダーにチェックを入れて保存したあとに出ます',
				],
			},
			// ④ サイレント時間帯 (常設)
			'settings-notifications-quiet': {
				title: '画面の見方（サイレント時間帯）',
				what: `この時間帯は通知を送りません。はじめは ${DEFAULT_QUIET_START} 〜 ${DEFAULT_QUIET_END} になっており、夜間や早朝に鳴らないようにしています。`,
				how: `1. 左の時刻に「送らなくなる時刻」、右の時刻に「また送り始める時刻」を入れます\n2. ${DEFAULT_QUIET_START} 〜 ${DEFAULT_QUIET_END} のように日をまたぐ指定もできます\n3. 「通知設定を保存」を押します`,
				goal: '寝ている間に通知で起こされることがなくなります。',
				tips: [
					`お知らせは 1 日 ${MAX_DAILY_NOTIFICATIONS} 件までにしています（鳴りすぎないための上限です）`,
				],
			},
			// ⑤ 保存 (常設)
			'settings-notifications-save': {
				title: 'よく使う操作（保存）',
				what: 'このページの設定は、保存ボタンを押すまで反映されません。',
				how: '1. 「通知設定を保存」を押します\n2. 「通知設定を保存しました」と表示されれば完了です',
				goal: '選んだ種類と時間帯で、次からお知らせが届くようになります。',
			},
		},
	},
	// #4665 (EPIC #4650): 旧 3 step は全てページ最上部の「データ管理」カード内で完結し、
	//   中段のクラウド共有と末尾の Danger Zone に到達しなかった。さらに「バックアップする
	//   ボタン」は実ボタン名 (バックアップをダウンロード) と違い、復元の既定が
	//   「置換 = 既存データを削除して読み込み」であることを一度も警告していなかった。
	//   カード / セクション単位で step を置き直し、ボタン名は SETTINGS_LABELS と同一にする
	//   (一致は tests/unit/routes/settings-data-guide.test.ts が機械照合)。
	adminSettingsData: {
		title: 'データ',
		steps: {
			'settings-data-intro': {
				title: 'このページについて',
				what: `記録した活動やポイントなどのデータを${BACKUP_TERMS.exportNoun}・${BACKUP_TERMS.restoreVerb}できるページです。`,
				// #3307: 読み込み (復元) は無料プランでも可、保存 (エクスポート) は canExport gate のため
				// PAID_PLAN_LABEL で hedge する (free に export を無条件約束しない、ADR-0013 LP truth / NN/G #1)。
				// #4665 F3: 中段の「クラウド共有」と末尾の「すべてのデータを削除」も並びに含める。
				how: `上から順に、データ管理（${BACKUP_TERMS.exportNoun}と${BACKUP_TERMS.restoreVerb}）・クラウド共有（ご利用環境によって表示）・すべてのデータを削除 が並びます。`,
				goal: `読み込みでの${BACKUP_TERMS.restoreVerb}はどなたでも使え、${BACKUP_TERMS.exportNoun}の保存は${PAID_PLAN_LABEL}で利用できます。`,
			},
			// ② バックアップをダウンロード (エクスポートは canExport gate → requiredTier='standard')
			'settings-data-export': {
				title: `よく使う操作（${BACKUP_TERMS.exportNoun}）`,
				what: `いままでの記録を 1 つのファイルにまとめて手元に保存します。押す前に「画像・音声ファイルも含める」「ファイルサイズを小さくする（圧縮）」の 2 つを選べます。画像・音声を含めないと、${BACKUP_TERMS.restoreVerb}したときにアバター画像とお子さまの声は戻りません。`,
				how: `1. 含めたいものにチェックを入れます（アバター画像や声も残すなら「画像・音声ファイルも含める」）\n2. 「${BACKUP_TERMS.canonical}をダウンロード」を押します\n3. ファイルが手元に保存されます（含まれる項目は枠内の一覧のとおりです）`,
				goal: `機種変更や万一のときも、保存したファイルから${BACKUP_TERMS.restoreVerb}できます。`,
				tips: [
					'画像・音声を含めるとファイルが大きくなります。ブラウザが安全性の確認を求めることがありますが、壊れたファイルではありません',
				],
			},
			// ③ 復元 (インポート)。既定が「置換」= 全削除してから読み込むので必ず警告する
			'settings-data-import': {
				title: `よく使う操作（${BACKUP_TERMS.restoreVerb}）`,
				what: `保存した${BACKUP_TERMS.file}を読み込んで元に戻します。読み込み方は 2 つあり、既定は「${BACKUP_TERMS.importModeReplace}」です。これはいまのお子さま・活動ログ・ポイントをすべて削除してから読み込むため、元に戻せません。残したまま足すなら「${BACKUP_TERMS.importModeAdd}」を選びます。`,
				how: `1. 読み込み方（置換 / 追加）を選びます\n2. 「${BACKUP_TERMS.file}を選択」でファイルを選びます\n3. 中身のプレビューが出るので、件数を確かめてから実行します`,
				goal: `${BACKUP_TERMS.file}の内容が反映されます。置換を選んだ場合、読み込み前のデータは戻せません。`,
				tips: [
					`置き換える前に、いまのデータを「${BACKUP_TERMS.canonical}をダウンロード」で保存しておくと安全です`,
				],
			},
			// ④ クラウド共有 (SaaS のみ描画 → requiredRuntime + optional)
			'settings-data-cloud': {
				title: '画面の見方（クラウド共有）',
				what: `${BACKUP_TERMS.canonical}をクラウドに預け、PINコードで別の端末や他のアカウントに渡せます。画像・音声を含む大きなファイルは、直接ダウンロードよりこちらが確実です。保管できる枠数はプランで決まり、${PLAN_FULL_TERMS.free}では枠が無く、案内と「プランを見る」が表示されます。`,
				how: `1. 預ける中身（テンプレート / フルバックアップ）を選んで「クラウドに保管」を押します\n2. 表示された PINコードを、受け取る側に伝えます\n3. 受け取る側は同じ画面の「PINコードでインポート」に入力して取り込みます`,
				goal: '端末を買い替えたときや、ご家族の別アカウントに移すときに、ファイルの受け渡しをしなくて済みます。',
			},
			// ⑤ すべてのデータを削除 (Danger Zone、常設)
			'settings-data-clear': {
				title: '注意（すべてのデータを削除）',
				what: 'ページの一番下は「危険な操作」の区画です。お子さま・活動ログ・ポイント・ステータスなどのご家族のデータを一括で削除します（活動マスタなどのシステムデータは残ります）。アカウント自体は消えません。',
				how: '1. 確認テキストを入力します\n2. 同意のチェックを入れます\n3. 実行ボタンを押します',
				goal: 'この操作は取り消せません。必要なデータは、実行する前に必ずダウンロードしておいてください。',
			},
		},
	},
	adminSettingsRules: {
		// #3954: 本ページは #3339 で「ごほうび交換の承認要否」を持つようになったが、ガイドは
		// 取り込んだボーナスルールしか案内しておらず、ガイドに従う保護者が承認要否に到達できなかった
		// (hub カード / サブナビと同じ取り落とし。導線を直してもガイドが古いままなら未達)。
		// title は ADMIN_RULES_PAGE_LABELS.pageTitle と同一文字列にする — 定数参照にしないのは
		// ADMIN_RULES_PAGE_LABELS が本定義より後方で宣言されるため。一致は
		// tests/unit/routes/settings-hub-coverage.test.ts [S7] で機械強制する。
		//
		// #4666 (EPIC #4650): ③ がページ先頭の header を光らせていたため、視線が ②承認セクション
		//   から上へ戻り、説明対象の一覧自体は光らなかった。一覧 / 空状態を包む常在ラッパー
		//   (rules-bonus-list) に張り直す。あわせて「みんなのテンプレートから取り込んだ」前提の
		//   文言を撤去する — rule-preset は marketplace の陳列対象 (3 type) に含まれないため、
		//   その入口は画面上に存在しない (ADR-0013: 無い導線を案内しない)。
		title: 'ごほうび・ボーナスルール',
		steps: {
			'settings-rules-intro': {
				title: 'このページについて',
				what: 'ごほうび交換に保護者の承認が必要かどうかと、活動を記録したときに追加ポイントが入る「ボーナスルール」をまとめて決めるページです。',
				how: '上でごほうび交換のしかたを切り替え、下で取り込み済みのボーナスルールを管理します。',
				goal: '交換に承認を挟むかどうかと、効かせるボーナスをここでまとめて決められます。',
				tips: [
					// #4666 F3: 陳列されていないため「探して取り込む」導線は画面に無い。
					//   取込は共有されたルールのページから行う (?import=) という事実だけを述べる。
					'ボーナスルールをこの画面で新しく作ることはできません。共有されたとくべつルールのページから取り込むと、下の一覧に並びます',
				],
			},
			'settings-rules-approval': {
				title: '画面の見方（ごほうび交換のしかた）',
				what: 'お子さまがごほうびショップで交換するとき、保護者の承認を必須にするかを選びます。初期設定は「保護者の承認が必要」です。承認待ちの申請は「ごほうび申請の承認」ページで処理します。',
				how: '1. いまの状態（保護者の承認が必要 / 承認なしで即時交換）がこのカードに出ます\n2. 承認をやめるときは「即時交換にする」を押し、確認ダイアログでもう一度「即時交換にする」を選びます\n3. 元に戻すときは「承認を必須に戻す」を押します',
				goal: '承認必須のままなら、お子さまの交換は「承認待ち」になり、承認したときにポイントが引かれます。即時交換にすると、お子さまがその場で交換でき、ポイントもその場で引かれます。',
				relatedLinks: [{ label: 'ごほうび申請の承認', href: '/admin/rewards/requests' }],
			},
			'settings-rules-list': {
				title: 'よく使う操作（ボーナスルール）',
				what: '取り込み済みのボーナスルールがここに並びます。まだ 1 つも無いときは、その案内が出ます。カードには取込日時と「含まれるルール（件数）」があり、開くとルールごとの加点（+pt）を確認できます。',
				how: '1. 「含まれるルール」を開いて、加点の中身を確かめます\n2. 効かせたいルールは「有効化」、止めたいルールは「無効化」を押します\n3. いらないルールは「削除」を押し、確認ダイアログで「削除」を選びます（削除すると元に戻せません。止めるだけなら「無効化」で十分です）',
				goal: '有効なルールに合う活動をお子さまが記録すると、家族全員のお子さまに追加ポイントが入ります。無効にすると、そのルールの加点だけが止まります。',
			},
		},
	},
	// #4667 (EPIC #4650): 旧 2 step はフォーム全体を 1 枚で「内容を入力 → 送信」とだけ説明し、
	//   先頭の「ご用件」ラジオ (感想・要望 / 相談・困りごと) と、相談を選んだときに返信先メールが
	//   必須になる分岐に触れていなかった。そのため「解約や使い方の相談はどこから？」「返事は来る？」
	//   という、このページで最も多い問いに答えられず、相談したい保護者が「感想・要望（返信は不要）」の
	//   まま送ってしまう。フォームの実順序に沿って説明し、NUC のバックアップ状態カードと
	//   アプリ情報にも step を置く。呼称は画面見出し「サポート・ご意見」に統一する。
	adminSettingsSupport: {
		title: 'サポート・アプリ情報',
		steps: {
			'settings-support-intro': {
				title: 'このページについて',
				what: '感想・要望も、導入や使い方・解約のご相談も、同じ「サポート・ご意見」フォームから送れます。個人開発のため、開発者本人がひとつずつ目を通します。',
				how: '上に「サポート・ご意見」フォーム、下に利用規約やバージョンなどのアプリ情報が並びます。セルフホスト版では、その間に「バックアップの状態」が表示されます。',
				goal: '困ったときの相談先と、サービスの情報にここからたどり着けます。',
			},
			// ② サポート・ご意見フォーム (常設)
			'settings-support-form': {
				title: 'よく使う操作（感想・要望を送る / 相談する）',
				what: 'ひとつのフォームで 2 通りの用件を送れます。「感想・要望を送る（返信は不要）」は開発の参考にさせていただくもの、「相談・困りごと（返信を希望）」は導入・使い方・解約などのご相談で、通常 1〜2 日以内にメールでご返信します。',
				how: '1. 「ご用件」で「感想・要望を送る（返信は不要）」か「相談・困りごと（返信を希望）」を選びます\n2. 感想・要望を選ぶと「種類」（機能要望 / バグ報告 / その他）が出るので選びます。相談を選ぶと「お子さまの年齢（任意）」が出ます\n3. 「内容」に本文を入力します（1000 文字まで）\n4. 「返信先メールアドレス」を確認します（相談のときは返信先が必要です。アカウントのメールが分かっている場合はそこへ返信します）\n5. 「送信する」を押します',
				goal: '送信すると受付番号が表示されます。相談を選んだ場合は、その受付番号の内容を確認のうえメールでご返信します。',
				tips: [
					'不具合のご相談では、下の「アプリ情報」にあるバージョンを本文に添えていただけると原因を特定しやすくなります',
					'フォームの下にメールでの受付先もあります',
				],
			},
			// ③ バックアップの状態 (NUC セルフホストのみ描画 → requiredRuntime='nuc' + optional)
			'settings-support-backup': {
				title: '画面の見方（バックアップの状態）',
				what: 'セルフホスト版でだけ表示されるカードです。毎晩のバックアップがうまくいっているかを、正常 / 確認 / 取れていません / 急いで片づけてください の 4 通りで表します。最後に成功した日時と、続けて失敗した回数も出ます。',
				how: '1. 表示が「正常」なら何もする必要はありません\n2. 「急いで片づけてください」は、バックアップ自体は取れているものの古い控えが増えすぎて自動削除が止まっている状態です。古い控えを別の場所へ移してから、いらないものを消してください\n3. 「取れていません」など、うまくいっていないときは上のフォームから相談してください',
				goal: 'バックアップが静かに止まっていることに気づけて、必要なときに戻せる状態を保てます。',
			},
			// ④ アプリ情報 (常設)
			'settings-support-app-info': {
				title: '画面の見方（アプリ情報）',
				what: '利用規約・プライバシーポリシー・お問い合わせ用のメール・GitHub と、いまお使いのバージョンがまとまっています。',
				how: '1. 読みたいリンクを押すと、それぞれのページが新しいタブで開きます\n2. 「バージョン」はこの画面に表示されている番号です',
				goal: '規約やプライバシーの扱いをいつでも確認でき、不具合のご相談ではバージョンをそのまま伝えられます。',
			},
		},
	},
	adminSubscription: {
		title: ADMIN_SCREENS.subscription.name,
		// #4668 (EPIC #4650): step は SaasLicensePanel / NucLicensePanel の DOM 順に「上から下」で並べ、
		// ボタン名・見出しは画面と同じ atom (TRIAL_TERMS / STRIPE_PORTAL_TERMS / CANCEL_TERMS 等) を引く。
		// 環境依存 UI (Checkout 照合バナー / Portal fallback / 期末解約バナー / 請求履歴カード) は出た
		// ときに画面自身が説明するため step 化しない (ガイドは常設要素だけを扱う)。
		steps: {
			// ① ページ概要（selector 省略で画面中央 modal、全環境で表示）。NUC セルフホスト版では
			// 現在のプラン／プラン管理セクションが無いため、intro は両環境で正しい「契約・プランの
			// 状況を確認するページ」に留める（実装にない操作を案内しない、ADR-0013）。
			'subscription-intro': {
				title: 'このページについて',
				what: '今ご利用中のプランや契約の状況を確認するページです。プランに関する操作の入り口がここに集まっています。',
				how: `上から順に、現在のプラン・利用状況と上限・${PLAN_CHANGE_TERMS.changeNoun}や${STRIPE_PORTAL_TERMS.history}への入り口が並びます。表示される項目はご利用環境やプランによって変わります。`,
				goal: `プランの状況をひと目で把握でき、必要なときに${PLAN_CHANGE_TERMS.changeNoun}や支払いの管理へ迷わず進めます。`,
			},
			// ② 画面の見方（現在のプラン）— SaaS 版のみ。カード全体を spotlight。残り日数はここには出ない
			// (利用状況カードの step で説明する、PO 判断)。
			'subscription-current-plan': {
				title: '画面の見方（現在のプラン）',
				what: 'いま契約中のプランの名前と、ステータス（有効・猶予期間など）・有効期限・家族名・登録日がここに表示されます。',
				how: '1. 「プラン」の行で今のプランを確認します\n2. 「ステータス」と「有効期限」で契約が続いているかを確認します',
				goal: '今どのプランで、いつまで使えるかをすぐに確認できます。',
			},
			// ③ 画面の見方（利用状況と上限）— SaaS 版のみ。PlanStatusCard (上限 / トライアル残り日数 / アップグレード CTA)。
			'subscription-plan-status': {
				title: '画面の見方（利用状況と上限）',
				what: '今のプランで登録できるお子さまの人数・カスタム活動の数・データ保持期間と、現在の使用数が並びます。無料トライアル中なら残り日数もここに表示されます。',
				how: `1. 「${CHILD_TERMS.honorific}」「カスタム活動」の「使用数 / 上限」を見ます\n2. 上限に近づいたら、このカードのアップグレードボタンから上のプランに進めます`,
				goal: 'あと何人・何件まで登録できるかが分かり、足りなくなる前にプランを見直せます。',
			},
			// ④ 最頻操作（無料トライアルを開始する）— 無料プランで未使用のときだけ出るカード (optional)。
			'subscription-trial': {
				title: `よく使う操作（${TRIAL_TERMS.startButton}）`,
				what: `${PLAN_FULL_TERMS.premium}の全機能を${TRIAL_TERMS.duration}無料で試せます。${TRIAL_TERMS.noCreditCard}で、自動で課金されることはありません。`,
				how: `1. 「${TRIAL_TERMS.startButton}」を押します\n2. すぐに${PLAN_FULL_TERMS.premium}の機能が使えるようになり、残り日数が上の利用状況カードに表示されます`,
				goal: `${TRIAL_TERMS.duration}のあいだ上位プランを実際に使ってみてから、続けるかどうかを決められます。`,
			},
			// ⑤ 最頻操作（プラン管理）— SaaS 版 + Stripe 有効時のみ。契約状況で分岐するため両分岐を記述。
			// 契約済み分岐は PIN / 確認フレーズ dialog (+ ダウングレード確認) を省略せず書く (PO 判断)。
			'subscription-plan-management': {
				title: `よく使う操作（${PLAN_CHANGE_TERMS.changeNoun}）`,
				what: `プランの開始・変更をここから行います。まだ有料プランをご契約でないときはプランを選んでお申し込みでき、ご契約済みのときは${STRIPE_PORTAL_TERMS.canonical}での管理に進めます。`,
				how: `・未契約のとき: 1. プランを選びます 2. 「${PLAN_TERMS.standard}プランで始める」など選んだプランのボタンを押し、お支払い手続きに進みます\n・契約済みのとき: 1. 「${STRIPE_PORTAL_TERMS.short}を開く」を押します 2. 上位プランからの変更で使えなくなるデータがある場合は、先に確認画面が出ます 3. ${OYAKAGI_TERMS.shortName}（親 PIN）か確認フレーズを入力します 4. ${STRIPE_PORTAL_TERMS.canonical}でプラン変更や支払い方法を手続きします`,
				goal: `${PLAN_CHANGE_TERMS.changeNoun}が反映され、支払い方法や請求書も${STRIPE_PORTAL_TERMS.short}で管理できます。`,
				tips: [
					`${STRIPE_PORTAL_TERMS.short}を開く前に${OYAKAGI_TERMS.shortName}の入力を求めるのは、お子さまの誤操作で${CANCEL_TERMS.canonical}やダウングレードが起きないようにするためです`,
				],
			},
			// ⑥ 解約の入口 — SaaS 版のみ。ページ末尾の控えめなリンクを spotlight。
			'subscription-cancel': {
				title: `${CANCEL_TERMS.canonical}の入口`,
				what: `${CANCEL_TERMS.anytime}できます。有料プランをやめるときは、ページの一番下にあるこのリンクから進みます。`,
				how: `1. 「${CANCEL_TERMS.canonical}をご検討の方」を押します\n2. 次の画面で${CANCEL_TERMS.canonical}の内容を確認して手続きします`,
				goal: `${CANCEL_TERMS.canonical}の場所を探し回らずに済み、続けるかやめるかをいつでも自分で決められます。`,
			},
			// ②' 画面の見方（ご利用中の版）— NUC セルフホスト版のみ（#3296）。NucLicensePanel の
			// Edition badge を spotlight し、全機能が制限なく使える旨を案内する。
			'subscription-nuc-edition': {
				title: '画面の見方（ご利用中の版）',
				what: `このおうちのサーバーで動かす${NUC_EDITION_TERMS.selfHosted}です。${NUC_EDITION_TERMS.fullAccess}で、お子さまや活動の数に制限はありません。`,
				how: 'ここに版の名前と、使える範囲が表示されます。お申し込みや支払いの手続きは必要ありません。',
				goal: '追加の費用や手続きなしで、すべての機能をそのまま使えることが分かります。',
			},
			// ③' 画面の見方（利用状況）— NUC セルフホスト版のみ（#3296）。利用状況カード全体を spotlight。
			'subscription-nuc-usage': {
				title: '画面の見方（利用状況）',
				what: '今このアプリに登録されているお子さまの人数や、これまでに作った活動の数を確認できます。',
				how: '1. 登録人数や活動数の一覧を見ます\n2. データの保存期間もあわせて確認できます',
				goal: 'どれくらい使っているかをひと目で把握できます。',
			},
			// ④' サポート — NUC セルフホスト版のみ (#4668 F5)。お問い合わせ / ドキュメントへのリンク。
			'subscription-nuc-support': {
				title: '困ったときは（サポート）',
				what: 'セルフホスト版で困ったときの相談先とドキュメントへのリンクがここにまとまっています。',
				how: '1. 使い方や不具合の相談は「お問い合わせ」を押します\n2. 設定やバックアップの手順は「ドキュメント」で確認します',
				goal: '問い合わせ先を探し回らずに、困りごとをすぐ相談できます。',
			},
		},
	},
	// #3268 (EPIC #3260 C4): 家族メンバー / パックページの個別ガイド。常在セクションのみを selector で
	// 指す（保留中の招待 / 閲覧リンク / 展開コンテンツは条件表示のため step 対象外）。
	adminMembers: {
		// #4672 F6: ガイド title はページ表示名 (PAGE_TITLES.members) に揃える
		title: PAGE_TITLES.members,
		// #4672 (EPIC #4650): step を画面の DOM 順 (メンバー一覧 → 招待作成 → 保留中の招待 →
		// 閲覧リンク) に並べ、role / プラン / 件数で描画が変わるカードは `optional` で起動時 DOM 判定する。
		// 招待作成カードは owner 専用のため、保護者ロールでは step ごと消える (旧実装は「作成ボタンを
		// 押す」と案内しながら何も光らなかった)。ボタン名は MEMBERS_LABELS の実表記を引く。
		steps: {
			'members-intro': {
				title: 'このページについて',
				what: `家族で使う人を増やしたり、離れて暮らすご家族に「見るだけ」のリンクを渡したりできるページです。招待リンクの発行と取り消しは${MEMBERS_LABELS.roleOwner}のみ行えます。`,
				how: `上から順に、現在のメンバー・メンバーを招待・保留中の招待・${VIEWER_LINK_TERMS.name}（${PLAN_FULL_TERMS.premium}）が並びます。表示される項目はご自身の権限とプランによって変わります。`,
				goal: '家族みんなで使えるようになり、離れたご家族にも成長を共有できます。',
			},
			'members-list': {
				title: '画面の見方（現在のメンバー）',
				what: `今この家族で使っている人の一覧です。それぞれの権限（${MEMBERS_LABELS.roleOwner} / ${MEMBERS_LABELS.roleParent} / ${MEMBERS_LABELS.roleChild}）もここで分かります。`,
				how: `1. 一覧で今のメンバーと権限を確認します\n2. ${MEMBERS_LABELS.roleOwner}は他のメンバーに「${MEMBERS_LABELS.transferButton}」（${MEMBERS_LABELS.roleOwner}を引き継ぐ）と「${MEMBERS_LABELS.removeButton}」ができます\n3. ${MEMBERS_LABELS.roleParent}は自分だけが「${MEMBERS_LABELS.leaveGroupButton}」で抜けられます`,
				goal: `誰が使っているかをひと目で確認でき、必要なときに${MEMBERS_LABELS.roleOwner}の引き継ぎやメンバーの整理ができます。`,
			},
			// ③ 招待リンクを作る (owner のときだけ描画 → optional)
			'members-invite': {
				title: `よく使う操作（${MEMBERS_LABELS.inviteCreateButton}）`,
				what: '新しく使う人を招くリンクを作れます。リンクや QR コードを渡すだけで参加してもらえます。',
				how: `1. 「${MEMBERS_LABELS.inviteRoleLabel}」で ${MEMBERS_LABELS.roleParent} か ${MEMBERS_LABELS.roleChild} を選びます\n2. 「${MEMBERS_LABELS.inviteEmailLabel}」を入れると、そのメールアドレスのアカウントだけが受諾できます（空欄なら誰でも受諾できます）\n3. 「${MEMBERS_LABELS.inviteChildLabel}」を選ぶと、参加した人をそのお子さまに紐づけます（後からでも設定できます）\n4. 「${MEMBERS_LABELS.inviteCreateButton}」を押し、出てきたリンクか QR コードを渡します`,
				goal: '相手がリンクを開くだけで家族に参加でき、すぐ一緒に使い始められます。',
				tips: [
					`招待リンクは ${TRIAL_TERMS.duration}有効です（期限は下の「${MEMBERS_LABELS.pendingInvitesTitle}」に表示されます）。参加が済むと自動で使えなくなります`,
				],
			},
			// ④ 保留中の招待 (未受諾の招待があるときだけ描画 → optional)
			'members-pending': {
				title: `画面の見方（${MEMBERS_LABELS.pendingInvitesTitle}）`,
				what: `まだ受諾されていない招待がここに並びます。期限と、宛先を指定した場合はその宛先が表示されます。`,
				how: `1. 「${MEMBERS_LABELS.inviteExpiresPrefix.trim()}」で使える期限を確認します\n2. 宛先を間違えたときや不要になったときは「${MEMBERS_LABELS.inviteRevokeButton}」で無効にします（${MEMBERS_LABELS.roleOwner}のみ）`,
				goal: '渡した招待がまだ使われていないかを把握でき、間違えた招待をすぐ取り消せます。',
			},
			// ⑤ 閲覧リンク (プレミアムのときだけ描画 → optional)
			'members-viewer': {
				title: `よく使う操作（${MEMBERS_LABELS.viewerCreateButton}）`,
				what: `${MEMBERS_LABELS.viewerSectionDesc}。${PLAN_FULL_TERMS.premium}でご利用いただけます。アプリへのログインや家族への参加は不要です。`,
				how: `1. 「${MEMBERS_LABELS.viewerLabelField}」に渡す相手が分かる名前を入れます（例: ${MEMBERS_LABELS.viewerLabelPlaceholder.replace('例: ', '')}）\n2. 「${MEMBERS_LABELS.viewerDurationLabel}」を ${MEMBERS_LABELS.viewerDuration7d} / ${MEMBERS_LABELS.viewerDuration30d} / ${MEMBERS_LABELS.viewerDurationUnlimited} から選びます\n3. 「${MEMBERS_LABELS.viewerCreateButton}」を押し、出てきたリンクか QR コードを渡します`,
				goal: '離れて暮らすご家族が、記録を見るだけの画面で成長を見守れます。',
				tips: [
					`渡した後で止めたいときは一覧の「${MEMBERS_LABELS.viewerRevokeButton}」（リンクを使えなくする）、履歴ごと消すときは「${MEMBERS_LABELS.viewerDeleteButton}」を使います`,
				],
			},
		},
	},
	adminStatus: {
		title: '成長レポート',
		// #4669 (EPIC #4650): step は画面の DOM 順 (子供タブ → 編集リンク → チャート → 分析サマリー →
		// 先月からの変化 → レベル称号 → (ops / NUC) ベンチマーク編集)。比較線の呼称は凡例と同じ
		// 「同年齢の平均」(STATUS_LABELS.comparisonLabel) に統一し、「翌月以降のチャートで変化を確認」の
		// 誤案内は「先月からの変化」テーブルへ差し替える (PO 判断)。
		steps: {
			'status-intro': {
				title: 'このページについて',
				// #4512: 5 カテゴリの列挙は CATEGORY_NAME_LIST (categories.ts) が SSOT。手書きしない
				what: `お子さまの活動を「${CATEGORY_NAME_LIST}」の5つの軸で可視化するページです。どの分野が得意で、どこが伸びしろかが分かります。見出しに表示中のお子さまの名前が出ます。`,
				how: '上のタブでお子さまを選ぶと、その子のレーダーチャート・分析サマリー・先月からの変化が表示されます。チャートには同年齢の平均が重ねて表示されるので、平均との比較もできます。',
				goal: '「今月はうんどうが伸びた」「べんきょうが少なめ」といった傾向が数値とグラフで分かり、声かけや活動設計の参考になります。',
			},
			// ② お子さまの切替タブ (子供 1 人以上で表示。0 人時は登録案内カードを指す step に置き換わる)
			'status-child-tabs': {
				title: '画面の見方（お子さまを選ぶ）',
				what: 'きょうだいがいるご家庭では、ここでどのお子さまのレポートを見るかを切り替えます。選んだお子さまの名前が下の見出しに表示されます。',
				how: '1. 見たいお子さまの名前のタブを押します\n2. 下のレポートがそのお子さまの内容に切り替わります',
				goal: 'きょうだい全員の成長を、同じページで順番に確認できます。',
			},
			// ②' 子供 0 人時の登録案内 (optional: 0 人のときだけ描画される)
			'status-empty': {
				title: 'まずお子さまを登録する',
				what: 'お子さまが 1 人も登録されていないため、成長レポートはまだ表示できません。',
				how: `1. 「${ADMIN_SCREEN_TERMS.children}でお子さまを登録する →」を押します\n2. お子さまを登録して活動を記録すると、このページにレポートが表示されます`,
				goal: '登録後は、5 つの軸のバランスと同年齢の平均との比較がここに出ます。',
			},
			// ③ 右上「お子さま管理でステータス編集 →」
			'status-edit-link': {
				title: '画面の見方（数値を手で調整する）',
				what: `各分野の★（ステータス）を手で調整したいときは、このリンクから${ADMIN_SCREEN_TERMS.children}に移動します。`,
				how: `1. 「${ADMIN_SCREEN_TERMS.children}でステータス編集 →」を押します\n2. ${ADMIN_SCREEN_TERMS.children}で対象のお子さまを開き、ステータスを編集します`,
				goal: '記録だけでは反映しきれない頑張りを、保護者の判断で補正できます。',
			},
			'status-radar': {
				title: '画面の見方（バランスチャート）',
				what: '上のレーダーチャートは5軸のポイント配分を面で表します。外側に広がっている軸ほど、よく取り組んでいる分野です。重ねて表示される線は「同年齢の平均」です。',
				how: '1. 外側に広がっている軸 = よく取り組んでいる分野\n2. へこんでいる軸 = 活動が少ない分野\n3. 「同年齢の平均」の線との差を見比べます',
				goal: 'バランスの偏りにひと目で気づけるので、お子さまの今の状態を客観的に把握できます。',
			},
			'status-act': {
				title: '画面の見方（分析サマリーで次の一手を決める）',
				what: '分析サマリーは分野ごとに「特に活発」「平均的」「伸びる余地」の 3 段階でコメントします。コメントは同年齢の平均との比較（偏差値）に基づきます。ここでへこんでいる分野を見つけるのが、このページの使いどころです。',
				how: '1. 分析サマリーで少ない分野（へこんでいる軸）を見つけます\n2. 活動管理ページで、その分野の活動を追加します',
				goal: '「得意をもっと伸ばす」「苦手を少しだけ足す」など、お子さまに合った関わり方を選べます。',
				tips: ['無理に全軸を均等にする必要はありません。得意分野を伸ばす視点も大切です'],
			},
			// ⑤ 先月からの変化 (optional: 先月の記録が無いお子さまでは描画されない)
			'status-monthly-change': {
				title: '画面の見方（先月からの変化）',
				what: '「先月からの変化」は、分野ごとのポイントが先月と比べてどれだけ増減したかを数字と矢印で表します。',
				how: '1. 「+12 ↑」のように増えた分野はそのまま続けます\n2. 「-5 ↓」のように減った分野は、声かけや活動の見直しのきっかけにします',
				goal: '今月の取り組みが先月より増えたか減ったかを、分野ごとに確認できます。',
			},
			// ⑥ レベル称号カスタマイズ (本ページで保護者が操作できる唯一の書き込み機能)
			'status-level-titles': {
				title: 'よく使う操作（レベル称号カスタマイズ）',
				what: 'お子さまのレベル（Lv.1〜10）ごとの称号を、ご家庭オリジナルの言葉に変えられます。お子さまの画面に表示される称号がここで決まります。',
				how: '1. 「▼ 開く」を押してセクションを開きます\n2. 変えたい Lv. の欄に称号を入力して「保存」を押します\n3. 元に戻したいときは「リセット」、全部戻すときは「全ての称号をデフォルトに戻す」を押します',
				goal: '「見習い」「冒険者」などの既定の称号を、お子さまが喜ぶ言葉に変えてやる気につなげられます。',
				tips: ['空欄で保存はできません。既定に戻すときは「リセット」を使います'],
			},
			// ⑦ ベンチマーク編集 (ops / NUC 単一運用者のみ描画。optional で DOM 有無を判定)
			'status-benchmark-edit': {
				title: '画面の見方（同年齢の平均を設定する）',
				what: 'ここでは年齢ごとに「同年齢の平均」の値（平均と SD = ばらつきの大きさ）を設定できます。チャートの比較線と分析サマリーのコメントは、この値をもとに計算されます。',
				how: '1. 年齢を選びます\n2. 分野ごとに平均と SD を入力して「保存」を押します\n3. 目安の範囲は年齢ボタンの下に表示されます',
				goal: 'ご家庭の実態に合った基準で比較できるようになります。',
			},
		},
	},
	// #3263 (EPIC #3260 F2) / #3269 (C5) / #4677 (EPIC #4650): みんなのテンプレート一覧ガイド。
	// AdminLayout 非使用ページのため marketplace/+layout.svelte が独自配線する。
	// 画面の「上から下」順に、公式テンプレートを探して取り込む CUJ を案内する
	// (概要 → 種類 → 年齢自動フィルタ → しぼりこむ → ならべかえ → カード / 0 件)。
	// 陳列物はがんばりクエスト公式 preset のみ (投稿機能は無い) — 「他のご家庭が作った」とは書かない。
	// ボタン名 / 見出し / 並び替え名は画面表記 (MARKETPLACE_FILTER_LABELS 等) と同じ定数を参照する。
	marketplace: {
		title: TEMPLATE_TERMS.userFacing,
		steps: {
			// ① ページ概要（画面中央 modal）
			'marketplace-intro': {
				title: 'このページについて',
				what: `がんばりクエストが用意した公式${TEMPLATE_TERMS.short}（活動セット・ごほうびセット・チェックリスト）を探して、${CHILD_TERMS.honorific}向けに取り込めるページです。ゼロから作らなくても、よくある活動セットをそのまま使えます。`,
				how: `気になる${TEMPLATE_TERMS.short}のカードをタップして詳細を開き、詳細ページの取り込み（一括追加）ボタンから取り込みます。取り込みにはログインと${CHILD_TERMS.honorific}の登録が必要です。`,
				goal: `選んだ${TEMPLATE_TERMS.short}が活動管理・ごほうび管理・チェックリストに追加され、ご家庭に合わせて項目を足したり消したりして調整できます。`,
				tips: [
					`ログイン中は左上の「${ADMIN_VIEW_TERMS.short}へ」で${ADMIN_VIEW_TERMS.canonical}に戻れます`,
					'ログインしていなくても一覧と詳細は見られます。取り込むときにログインを求められます',
				],
			},
			// ② 種類で絞り込む（type filter = 3 種類カード）
			'marketplace-browse': {
				title: '種類で絞り込む',
				what: `上部の 3 つのカードで、${TEMPLATE_TERMS.short}の種類（活動セット・ごほうびセット・チェックリスト）を切り替えられます。数字はその種類の${TEMPLATE_TERMS.short}数です。`,
				how: '1. 見たい種類のカードをタップします\n2. もう一度タップすると絞り込みが外れます',
				goal: '「まずは活動だけ」「ごほうびを足したい」のように、目的の種類だけを一覧にできます。',
			},
			// ③ 年齢に合わせた表示（ログイン + お子さま選択中のみ出る hint バナー、optional）
			'marketplace-age-auto': {
				title: '年齢に合わせた表示',
				what: `選択中の${CHILD_TERMS.honorific}の年齢に合わせて、一覧を自動で絞り込んで表示しています。表示件数が少ないのはこのためです。`,
				how: `1. バナーの「${MARKETPLACE_FILTER_LABELS.clearAgeFilter}」をタップすると絞り込みが外れ、全件が並びます\n2. 別の年齢で見たいときは「${MARKETPLACE_FILTER_LABELS.sectionTitle}」の${MARKETPLACE_FILTER_LABELS.age}から選び直します`,
				goal: `きょうだいの年齢差があっても、今選んでいる${CHILD_TERMS.honorific}にちょうどいい${TEMPLATE_TERMS.short}から探し始められます。`,
			},
			// ④ しぼりこむ（desktop = 左のパネル / mobile = ⚙️ フィルタ ボタン → ダイアログ。可視の方が光る）
			'marketplace-filter': {
				title: `${MARKETPLACE_FILTER_LABELS.sectionTitle}（${MARKETPLACE_FILTER_LABELS.age}・${MARKETPLACE_FILTER_LABELS.gender}・${MARKETPLACE_FILTER_LABELS.tag}）`,
				what: `${MARKETPLACE_FILTER_LABELS.age}・${MARKETPLACE_FILTER_LABELS.gender}・${MARKETPLACE_FILTER_LABELS.tag}で${TEMPLATE_TERMS.short}を絞り込めます。パソコンでは左の「${MARKETPLACE_FILTER_LABELS.sectionTitle}」パネル、スマホでは「⚙️ ${MARKETPLACE_FILTER_LABELS.open}」ボタンを押すと同じ項目が開きます。`,
				how: `1. スマホは「⚙️ ${MARKETPLACE_FILTER_LABELS.open}」をタップしてパネルを開きます（パソコンは左に常に表示）\n2. ${MARKETPLACE_FILTER_LABELS.age}・${MARKETPLACE_FILTER_LABELS.gender}・${MARKETPLACE_FILTER_LABELS.tag}を選びます（もう一度タップで解除）\n3. 「${MARKETPLACE_FILTER_LABELS.reset}」で全部外せます`,
				goal: `たくさんの${TEMPLATE_TERMS.short}の中から、${CHILD_TERMS.honorific}の年齢や興味にぴったりのものを素早く見つけられます。`,
				tips: [
					`${MARKETPLACE_FILTER_LABELS.tag}は人気の 8 件だけ表示され、「もっと見る」で全部出せます`,
				],
			},
			// ⑤ ならべかえ
			'marketplace-sort': {
				title: MARKETPLACE_FILTER_LABELS.sort,
				what: `一覧の並び順を「${MARKETPLACE_FILTER_LABELS.sortOptions.popularity}」「${MARKETPLACE_FILTER_LABELS.sortOptions.newest}」「${MARKETPLACE_FILTER_LABELS.sortOptions.ageFit}」から選べます。`,
				how: `1. 並び替えメニューを開きます\n2. ${MARKETPLACE_FILTER_LABELS.sortOptions.popularity}（まずはこれ）/ ${MARKETPLACE_FILTER_LABELS.sortOptions.newest} / ${MARKETPLACE_FILTER_LABELS.sortOptions.ageFit}（対象年齢が低い順）から選びます`,
				goal: '迷ったら人気順、幼児向けから探したいときは年齢順、と目的に合わせて一覧を並べ替えられます。',
			},
			// ⑥ テンプレートを開く（先頭カード。一覧 0 件時は出ない = optional）
			'marketplace-open': {
				title: `${TEMPLATE_TERMS.short}を開く`,
				what: `最もよく使うのが、${TEMPLATE_TERMS.short}のカードをタップして詳細を開く操作です。詳細ページで中身を確認してから取り込めます。`,
				how: `1. 一覧の${TEMPLATE_TERMS.short}のカードをタップします\n2. 詳細ページで含まれる内容を確認します\n3. 詳細ページの取り込み（一括追加）ボタンから、追加する${CHILD_TERMS.honorific}を選びます`,
				goal: '中身を確かめたうえで取り込めるので、「思っていたものと違った」を防げます。',
				tips: [
					`まずは${TEMPLATE_TERMS.short}を取り込んで、ご家庭に合わせて調整するのが近道です`,
					`取り込みにはログインと${CHILD_TERMS.honorific}の登録が必要です`,
				],
			},
			// ⑥' 0 件のとき（フィルタ不一致。カードが無いので empty state を案内）
			'marketplace-empty': {
				title: `${TEMPLATE_TERMS.short}が見つからないとき`,
				what: `今の絞り込み条件に合う${TEMPLATE_TERMS.short}がありません。条件を外すと一覧が戻ります。`,
				how: `1. 「${MARKETPLACE_FILTER_LABELS.reset}」をタップして条件を全部外します\n2. 年齢や種類を 1 つずつ選び直します`,
				goal: `条件を緩めれば、公式${TEMPLATE_TERMS.short}の全件から改めて探せます。`,
			},
		},
	},
	// #3269 (EPIC #3260 C5) / #4678 (EPIC #4650): みんなのテンプレート詳細ガイド（取込 CTA ページ）。
	// 一覧から開いた 1 件の詳細。概要 → 中身の一覧 → (活動セットの取り込む項目選択) → 取り込む、の順。
	// 取り込む step は CTA ブロックに出ている分岐 (data-cta-variant) ごとに optional step を用意し、
	// 画面に出ている分岐だけが step になる: per-child (お子さまを選ぶ) / family-rule (とくべつルールは
	// 家庭全体に 1 回) / rule-unavailable (penalty・special はボタン無し) / no-children (先にお子さま登録) /
	// login (ログイン画面へ)。ボタン名は画面表記 (取り込み / 一括追加) に合わせ「取り込み（一括追加）ボタン」と併記。
	marketplaceDetail: {
		title: `${TEMPLATE_TERMS.short}の詳細`,
		steps: {
			// ① ページ概要（画面中央 modal）
			'marketplace-detail-intro': {
				title: 'このページについて',
				what: `選んだ${TEMPLATE_TERMS.short} 1 件の詳細ページです。含まれる活動・ごほうび・チェック項目・ルールを確認してから、ご自身の家庭に取り込めます。`,
				how: `中身の一覧を確認し、ページ下部の取り込み（一括追加）ボタンから取り込みます。取り込みにはログインと${CHILD_TERMS.honorific}の登録が必要です（未ログインのときはボタンがログイン画面への案内に変わります）。`,
				goal: `中身を確かめたうえで取り込めるので、家庭に合う${TEMPLATE_TERMS.short}だけを安心して追加できます。`,
				tips: [
					`上部のタグや対象年齢をタップすると、似た${TEMPLATE_TERMS.short}を一覧で探せます`,
					`ログイン中は左上の「${ADMIN_VIEW_TERMS.short}へ」で${ADMIN_VIEW_TERMS.canonical}に戻れます`,
				],
			},
			// ② 内容プレビューの見方
			'marketplace-detail-preview': {
				title: '中身を確認する',
				what: `この${TEMPLATE_TERMS.short}に含まれる活動・ごほうび・チェック項目・ルールの一覧です。取り込む前に中身をひと通り確認できます。`,
				how: `1. 一覧をスクロールして含まれる項目とポイントを確認します\n2. 活動セットは取り込む項目をチェックで選べます（ログイン + ${CHILD_TERMS.honorific}登録済のとき）\n3. チェックリストは取り込み済みの項目を重複させずスキップします`,
				goal: `取り込む前に中身が分かるので、ご家庭に必要なものだけを選んで追加できます。`,
			},
			// ③ 活動セットの取り込む項目を選ぶ（活動セット + ログイン + お子さま登録済のみ描画 → optional）
			'marketplace-detail-select': {
				title: '取り込む活動を選ぶ',
				what: `活動セットでは、取り込む活動をチェックで選べます。すでに登録済みの活動（「登録済み」バッジ）は重複しないよう最初からチェックが外れています。`,
				how: `1. 「すべて選ぶ」「すべて外す」でまとめて切り替えます\n2. 個別にチェックを付け外しします（「N件 / M件 を取り込みます」に反映）\n3. 0 件のときは取り込みボタンが押せません。1 件以上選んでください`,
				goal: `「歯みがきとお片付けだけ」のように必要な活動だけを取り込め、既存の活動と二重になりません。`,
			},
			// ④-a 取り込む（活動セット / ごほうびセット / チェックリスト / 交換ルール = お子さまを選ぶ）
			'marketplace-detail-import': {
				title: '取り込む',
				what: `ページ下部の取り込み（一括追加）ボタンを押すと、${ADMIN_VIEW_TERMS.canonical}に移り、どの${CHILD_TERMS.honorific}に追加するかを選ぶ画面が開きます。`,
				how: `1. ページ下部の取り込み（一括追加）ボタンをタップします\n2. 開いた画面で、追加する${CHILD_TERMS.honorific}を選びます\n3. 確定すると、選んだ${CHILD_TERMS.honorific}に追加されます`,
				goal: `選んだ${CHILD_TERMS.honorific}の${PAGE_TITLES.activities}・${REWARD_TERMS.menu}・${PAGE_TITLES.checklists}に${TEMPLATE_TERMS.short}の内容が追加されます。`,
				tips: [
					`${CHILD_TERMS.honorific}ごとに取り込めるので、上の子・下の子で別々の${TEMPLATE_TERMS.short}を使い分けられます`,
				],
				relatedLinks: [
					{ label: PAGE_TITLES.activities, href: '/admin/activities' },
					{ label: REWARD_TERMS.menu, href: '/admin/rewards' },
					{ label: PAGE_TITLES.checklists, href: '/admin/checklists' },
					{
						label: `${PAGE_TITLES.settings} > ${RULES_TERMS.settingsMenu}`,
						href: '/admin/settings/rules',
					},
				],
			},
			// ④-b 取り込む（とくべつルール = ボーナス: 家庭全体に 1 回、お子さま選択なし）
			'marketplace-detail-import-rule': {
				title: '取り込む（とくべつルール）',
				what: `とくべつルール（ボーナス）は${CHILD_TERMS.honorific}ごとではなく、ご家庭全体に 1 回で追加されます。${CHILD_TERMS.honorific}を選ぶ画面は出ません。`,
				how: `1. ページ下部の取り込み（一括追加）ボタンをタップします\n2. そのまま「${PAGE_TITLES.settings} > ${RULES_TERMS.settingsMenu}」に移り、自動で追加されます\n3. 追加後は同じ画面で ON / OFF を切り替えられます`,
				goal: `ボーナスルールが家庭全体に効き、「${PAGE_TITLES.settings} > ${RULES_TERMS.settingsMenu}」でいつでも止められます。`,
				relatedLinks: [
					{
						label: `${PAGE_TITLES.settings} > ${RULES_TERMS.settingsMenu}`,
						href: '/admin/settings/rules',
					},
				],
			},
			// ④-c とくべつルール (penalty / special) は取り込みボタンが無い
			'marketplace-detail-rule-unavailable': {
				title: 'このルールは取り込めません',
				what: `ペナルティ型のとくべつルールは慎重に審査中、特別型は将来枠のため、いまは取り込みボタンがありません。ここにはその説明だけが出ます。`,
				how: `1. ボーナス型のとくべつルールや、活動セット・ごほうびセットから選び直します\n2. 一覧へ戻るには下の「…一覧に戻る」をタップします`,
				goal: `取り込めない理由が分かり、代わりに使えるボーナス型ルールへ迷わず移れます。`,
			},
			// ④-d お子さま未登録（ログイン済）
			'marketplace-detail-no-children': {
				title: `先に${CHILD_TERMS.honorific}を登録する`,
				what: `取り込み先になる${CHILD_TERMS.honorific}がまだ登録されていません。ボタンは${CHILD_TERMS.honorific}登録画面への案内に変わっています。`,
				how: `1. 「まずは${CHILD_TERMS.honorific}を登録してください」をタップします\n2. ${CHILD_TERMS.honorific}を登録したら、この${TEMPLATE_TERMS.short}に戻って取り込みます`,
				goal: `${CHILD_TERMS.honorific}を登録すると同じボタンが取り込み（一括追加）に変わり、どの${CHILD_TERMS.honorific}に追加するかを選べます。`,
			},
			// ④-e 未ログイン
			'marketplace-detail-login': {
				title: 'ログインして取り込む',
				what: `取り込みにはログインが必要です。ボタンを押すとログイン画面に移ります（新規の方はログイン画面の「新規アカウント作成」から登録できます）。`,
				how: `1. ページ下部のボタンをタップしてログインします\n2. ログイン後、この${TEMPLATE_TERMS.short}に戻って取り込み（一括追加）ボタンを押します\n3. ${CHILD_TERMS.honorific}が未登録なら先に登録します`,
				goal: `ログインと${CHILD_TERMS.honorific}登録がそろえば、${TEMPLATE_TERMS.short}をワンタップで${ADMIN_VIEW_TERMS.canonical}に取り込めます。`,
			},
		},
	},
	// #3271 (EPIC #3260 C7): 低頻度顧客接点ページ（証明書 / 記録ブック / ごほうび申請の承認）
	adminCertificates: {
		// #4674 F1 / M: 呼称は画面表記の「証明書」に統一 (旧「賞状コレクション」「賞状」)
		title: CERTIFICATE_TERMS.full,
		// #4674 (EPIC #4650): 2 step とも中央 modal で「上のお子さまタブで切り替える」と案内しても
		// 何も光らなかったため、お子さま切替ボタン行と一覧カードに anchor を張り、印刷 / シェアの
		// 最頻操作 step を追加する。発行条件の数値は habit-milestones.ts の定数から埋め込む (直書き禁止)。
		steps: {
			// ① ページ概要（画面中央 modal）
			'certificates-intro': {
				title: 'このページについて',
				what: `お子さまががんばって獲得した${CERTIFICATE_TERMS.canonical}を集めて見られるページです。連続記録・レベルアップ・月間や年間のがんばりなど、節目ごとに${CERTIFICATE_TERMS.canonical}が自動で贈られます。`,
				how: `保護者が作る操作はありません。お子さまが活動を続けて、たとえば ${STREAK_MILESTONE_DAYS[0]} 日連続の記録・レベル ${CERTIFICATE_LEVEL_MILESTONES[0]} 到達・1 か月に ${MONTHLY_HABIT_DAYS_THRESHOLD} 日以上の記録といった節目を満たすと、ここに増えていきます。`,
				goal: `お子さまの「ここまでがんばった」を${CERTIFICATE_TERMS.canonical}という形で振り返れて、ご家族で成長をお祝いできます。`,
				tips: [
					`このページはレポート画面の「📜 ${CERTIFICATE_TERMS.canonical}」から開きます。左上の「← レポートへ」で戻れます`,
				],
			},
			// ② お子さまを切り替える（お子さまが 1 人以上のときだけ描画されるボタン行）
			'certificates-child-select': {
				title: '画面の見方（お子さまを切り替える）',
				what: `上のお子さまのボタンで表示する子を切り替えます。ボタンの数字はその子が持っている${CERTIFICATE_TERMS.canonical}の数です。お子さまが 1 人のご家庭ではボタンも 1 つだけ表示されます。`,
				how: `1. 見たいお子さまのボタンを押します\n2. その子の${CERTIFICATE_TERMS.canonical}が種類ごと（連続記録・レベルアップ・月間がんばり・カテゴリマスター・年間がんばり大賞）に並びます`,
				goal: 'どのお子さまがどんな節目を達成したかが、ひと目で分かります。',
			},
			// ③ 証明書を開いて印刷・シェアする（1 件以上あるときだけ描画される一覧）
			'certificates-open': {
				title: `よく使う操作（${CERTIFICATE_TERMS.canonical}を開いて印刷・シェアする）`,
				what: `${CERTIFICATE_TERMS.canonical}のカードを押すと詳細が開き、印刷やご家族へのシェアができます。`,
				how: `1. 見たい${CERTIFICATE_TERMS.canonical}のカードを押します\n2. 詳細画面の「${CERTIFICATE_DETAIL_LABELS.printButton}」で紙に印刷したり PDF として保存したりできます（${PAID_PLAN_LABEL}）\n3. 「${CERTIFICATE_DETAIL_LABELS.showShareCardButton}」→「${CERTIFICATE_DETAIL_LABELS.downloadButton}」で画像として保存し、離れて暮らすご家族に送れます`,
				goal: `がんばりを紙や画像で残せるので、お子さまの達成感が形になって残ります。`,
				tips: [
					`${CERTIFICATE_TERMS.canonical}は${PLAN_FULL_TERMS.free}でも閲覧でき、PDF保存・印刷は${PAID_PLAN_LABEL}で利用できます`,
				],
			},
		},
	},
	adminGrowthBook: {
		title: GROWTH_BOOK_TERMS.full,
		// #4675 (EPIC #4650): 旧 2 step は selector 省略の中央 modal で、しかも存在しない
		// 年度切替 UI と分野別一覧を案内していた。画面の DOM 順 (お子さま切替 → 表紙 → 年間サマリー →
		// 月別 → 証明書リンク) に anchor を張り直し、描画条件を持つ step は optional にする。
		steps: {
			// ① ページ概要（画面中央 modal）
			'growth-book-intro': {
				title: 'このページについて',
				what: `お子さまの今年度（4月〜翌年3月）のがんばりを 1 冊にまとめた${GROWTH_BOOK_TERMS.full}です。表紙・年間サマリー・月別の記録が並びます。`,
				how: `保護者が入力する操作はありません。お子さまの記録から自動でまとめられ、${PAID_PLAN_LABEL}では印刷して手元に残すこともできます。`,
				goal: '1 年の成長をまとめて振り返れて、ご家族の思い出として保存できます。',
				tips: [
					`このページはレポート画面の「📖 ${GROWTH_BOOK_TERMS.canonical}」から開きます。左上の「← レポートへ」で戻れます`,
				],
			},
			// ② お子さま切替 (子供 2 人以上のときだけ描画)
			'growth-book-child-tabs': {
				title: '画面の見方（お子さまを切り替える）',
				what: 'お子さまが 2 人以上のとき、上のボタンで表示する子を切り替えます。お子さまが 1 人のご家庭ではボタンは出ず、その子の記録がそのまま表示されます。',
				how: `1. 見たいお子さまのボタンを押します\n2. 下の表紙・年間サマリー・月別の記録がその子の内容に切り替わります`,
				goal: 'きょうだいそれぞれの 1 年を、同じページで順番に振り返れます。',
			},
			// ③ 年間サマリー (記録が 1 件以上あるときだけ描画)
			'growth-book-summary': {
				title: '画面の見方（年間サマリー）',
				what: '今年度の合計が並びます。「活動回数」は記録した回数、「獲得ポイント」はその合計、「最長連続日数」は毎日続いた最長の日数、「証明書」は受け取った証明書の枚数です。下には「いちばんがんばった月」と「とくいなカテゴリ」も出ます。',
				how: `1. 4 つの数字で 1 年の量をつかみます\n2. 「いちばんがんばった月」「とくいなカテゴリ」でその子らしさを見ます\n3. その下の「📅 月別の記録」で、月ごとの回数・活動日数・連続日数を振り返ります`,
				goal: '1 年でどれだけ積み上がったかと、得意な分野・伸びた時期がひと目で分かります。',
			},
			// ④ 印刷 (有料プラン かつ 記録があるときだけ描画)
			'growth-book-print': {
				title: 'よく使う操作（印刷して残す）',
				what: `${PAID_PLAN_LABEL}では、この${GROWTH_BOOK_TERMS.full}を紙に印刷したり PDF として保存したりできます。ボタンは記録が 1 件以上あるときに右上に出ます。`,
				how: `1. 右上の「🖨️ 印刷 / PDF」を押します\n2. ブラウザの印刷画面が開きます\n3. そのまま印刷するか、送信先（プリンター）で「PDF に保存」を選んで保存します`,
				goal: '1 年の記録を手元に残せて、お子さまと一緒に見返したりご家族に渡したりできます。',
				tips: [
					`${GROWTH_BOOK_TERMS.full}は${PLAN_FULL_TERMS.free}でも閲覧でき、PDF保存・印刷は${PAID_PLAN_LABEL}で利用できます`,
				],
			},
			// ⑤ 証明書一覧へ (記録があるときだけ描画)
			'growth-book-certificates': {
				title: `画面の見方（${CERTIFICATE_TERMS.canonical}を見る）`,
				what: `年間サマリーで数えている${CERTIFICATE_TERMS.canonical}の中身は、ページ下部のリンクから一覧で確認できます。`,
				how: `1. 「📜 ${CERTIFICATE_TERMS.canonical}一覧を見る →」を押します\n2. ${CERTIFICATE_TERMS.full}のページで、種類ごとに並んだ${CERTIFICATE_TERMS.canonical}を確認します`,
				goal: `どんな節目で${CERTIFICATE_TERMS.canonical}が贈られたのかまで辿れます。`,
				relatedLinks: [
					{ label: 'レポート', href: '/admin/reports' },
					{ label: CERTIFICATE_TERMS.full, href: '/admin/certificates' },
				],
			},
		},
	},
	adminRewardsRequests: {
		title: 'ごほうび申請の承認',
		// #4676 (EPIC #4650): 旧 step 2 はページ最外 div (見出し・戻るリンク・履歴を含む) を
		// spotlight していて概要 step と見分けが付かなかった。未処理セクション / 承認ボタン /
		// 却下ボタン / 履歴セクションに anchor を分け、申請 0 件のときは操作 step が出ないようにする。
		// ボタン名・件数・文字数は ADMIN_REWARDS_REQUESTS_LABELS と定数を引く (直書き禁止)。
		steps: {
			// ① ページ概要（画面中央 modal）
			'rewards-requests-intro': {
				title: 'このページについて',
				what: `${CHILD_TERMS.honorific}が「このごほうびと交換したい」と申請したものを、保護者が確認して承認・却下するページです。初期設定では保護者の承認を経て交換が確定します（設定 > ${ADMIN_RULES_PAGE_LABELS.pageTitle}の「${ADMIN_RULES_PAGE_LABELS.rewardApprovalSectionTitle}」で、承認なしの即時交換にも切り替えられます）。`,
				how: `申請があると「${ADMIN_REWARDS_REQUESTS_LABELS.pendingSectionTitle}」に並びます。中身を見て、承認するか却下するかを選びます。下の「${ADMIN_REWARDS_REQUESTS_LABELS.historySectionTitle}」には処理済みの申請が残ります。`,
				goal: `${CHILD_TERMS.honorific}の交換申請を保護者が見守りながら、納得したうえでごほうびを渡せます。`,
				tips: [`申請が届くと管理画面の上部にお知らせが出ます。ごほうび管理の ⋮ からも開けます`],
			},
			// ② 未処理の申請（常設セクション。0 件のときは「申請はありません」が出る）
			'rewards-requests-pending': {
				title: `画面の見方（${ADMIN_REWARDS_REQUESTS_LABELS.pendingSectionTitle}）`,
				what: `まだ処理していない申請がここに並びます。1 件ごとに ${CHILD_TERMS.honorific}の名前・ごほうびの内容・必要ポイント・申請日時が表示されます。申請が無いときは「${ADMIN_REWARDS_REQUESTS_LABELS.emptyPendingMessage}」と表示され、${CHILD_TERMS.honorific}が交換を申し込むとここに増えます。`,
				how: `1. 見出し横の件数で未処理の数を確認します\n2. 各申請の内容と必要ポイントを確認します`,
				goal: '処理が必要な申請だけを、まとめて確認できます。',
			},
			// ③ 承認する（未処理の申請が 1 件以上あるときだけ描画）
			'rewards-requests-approve': {
				title: `よく使う操作（${ADMIN_REWARDS_REQUESTS_LABELS.approveButton}）`,
				what: `ごほうびを実際に渡したあとに押すボタンです。押すとその場で交換が確定し、必要ポイントが${CHILD_TERMS.honorific}の残高から引かれます。`,
				how: `1. ごほうびを${CHILD_TERMS.honorific}に渡します\n2. 「${ADMIN_REWARDS_REQUESTS_LABELS.approveButton}」を押します\n3. 残高が足りないときは確定できず、画面上部にお知らせが出ます`,
				goal: '渡したものだけがポイント消費として記録され、渡し忘れ・二重消費を防げます。',
			},
			// ④ 却下する（未処理の申請が 1 件以上あるときだけ描画）
			'rewards-requests-reject': {
				title: `よく使う操作（${ADMIN_REWARDS_REQUESTS_LABELS.rejectButton}）`,
				what: `今回は見送るときに使います。却下してもポイントは引かれず、${CHILD_TERMS.honorific}の残高は変わりません。`,
				how: `1. 「${ADMIN_REWARDS_REQUESTS_LABELS.rejectButton}」を押します\n2. 「${ADMIN_REWARDS_REQUESTS_LABELS.rejectNoteLabel}」に理由を書きます（書かなくても進めます）\n3. 「${ADMIN_REWARDS_REQUESTS_LABELS.rejectConfirmButton}」を押すと却下が確定します（「${ADMIN_REWARDS_REQUESTS_LABELS.rejectCancelButton}」でやめられます）`,
				goal: `理由を添えると${CHILD_TERMS.honorific}の画面に表示され、次にどうすればよいかが伝わります。`,
				tips: [`却下の理由は最大 ${REWARD_REJECT_NOTE_MAX_LENGTH} 文字です`],
			},
			// ⑤ 履歴（常設セクション）
			'rewards-requests-history': {
				title: `画面の見方（${ADMIN_REWARDS_REQUESTS_LABELS.historySectionTitle}）`,
				what: `処理済みの申請が新しい順に ${REWARD_REQUEST_HISTORY_LIMIT} 件まで残り、「${ADMIN_REWARDS_REQUESTS_LABELS.statusApproved}」「${ADMIN_REWARDS_REQUESTS_LABELS.statusRejected}」のしるしが付きます。`,
				how: `1. しるしで結果を確認します\n2. ${CHILD_TERMS.honorific}の名前と使ったポイントで、いつ何を渡したかを振り返ります`,
				goal: '「先週なにを渡したか」をあとから確認でき、ごほうびの出しすぎにも気づけます。',
				tips: ['確定した承認・却下を取り消す操作はありません。渡してから承認を押すのが確実です'],
				relatedLinks: [
					{ label: 'ごほうび管理', href: '/admin/rewards' },
					{ label: ADMIN_RULES_PAGE_LABELS.pageTitle, href: '/admin/settings/rules' },
				],
			},
		},
	},
} as const;
