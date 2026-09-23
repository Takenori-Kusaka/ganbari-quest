// labels 層 (ADR-0045 / #4965): プラン名・プラン制限・権限ゲート・トライアル (2 つ以上の area で使う下層の共有)。置き場所の規則は docs/DESIGN.md §6
import {
	ACTIVITY_QUOTA_TERMS,
	CANCEL_TERMS,
	CHILD_TERMS,
	PLAN_FULL_TERMS,
	PLAN_TERMS,
	PRICE_TERMS,
	REWARD_TERMS,
	TRIAL_TERMS,
	UPGRADE_TERMS,
} from '../terms';
import { ACTION_LABELS } from './common';

// ============================================================
// プラン名
// ============================================================

// #1916: atom (プラン名) は terms.ts (PLAN_FULL_TERMS / PLAN_TERMS) に移譲
// 本 namespace は compound として terms.ts を template literal 参照する。
export const PLAN_LABELS = {
	free: `${PLAN_FULL_TERMS.free}`,
	standard: `${PLAN_FULL_TERMS.standard}`,
	family: `${PLAN_FULL_TERMS.premium}`,
} as const;

export const PLAN_SHORT_LABELS = {
	free: `${PLAN_TERMS.free}`,
	standard: `${PLAN_TERMS.standard}`,
	family: `${PLAN_TERMS.premium}`,
} as const;

export type PlanKey = keyof typeof PLAN_LABELS;

/** プラン制限メッセージで使う共通ラベル（「スタンダードプラン以上」） */
export const PAID_PLAN_LABEL = 'スタンダードプラン以上' as const;

// ============================================================
// PLAN_GATE_LABELS — プラン制限メッセージテンプレート (#1925 Phase 2 C0)
// ============================================================
//
// アプリ本体に直書きされた「機能 X はプラン Y 以上で…」エラーメッセージを
// 共通テンプレート化する compound 層。後続 C1-C15 の各実装箇所で本 namespace
// を import してリテラル置換する際に「char-by-char 変化ゼロ」を保証するため、
// 既存メッセージと完全一致するよう PLAN_FULL_TERMS から組み立てる。
//
// テンプレート選択指針 (既存 11+ 箇所のカバレッジ):
//   - standardOrAboveFor(feature)            : "{feature}はスタンダードプラン以上でご利用いただけます"
//   - familyOnlyFor(feature)                 : "{feature}はファミリープランでご利用いただけます"
//   - familyLimitedFor(feature)              : "{feature}はファミリープラン限定です"
//   - standardOrAboveGenericWithUpgrade      : "この機能はスタンダードプラン以上でご利用いただけます。プランをアップグレードしてください。"
//   - familyLimitedWithUpgradeFor(feature)   : "{feature}はファミリープラン限定です。アップグレードすると利用できます。"
//   - viewerTokenFamilyOnly                  : "ファミリープラン限定の機能です"
//
// 参照: docs/DESIGN.md §6 / Issue #1925 / terms.ts (PLAN_FULL_TERMS atom)

/** プラン制限 403 の末尾導線文 (#4767 PO 回答 #4)。PLAN_GATE_LABELS 内の各 compound が共有する。 */
const PLAN_UPGRADE_CTA = 'プランをアップグレードしてください。';

/** クラウド保管上限 403 の本文。`cloudExportLimitReached` / `cloudExportLimitReachedNaming` が共有する。 */
const CLOUD_EXPORT_LIMIT_REACHED = (max: number) =>
	`クラウド保管は最大${max}件までです。古いエクスポートを削除してから、もう一度お試しください。`;

/**
 * 活動 quota 上限 403 の本文 (#4693)。`activityLimitReached` / `activityLimitReachedWithUpgrade` が共有する。
 * `CLOUD_EXPORT_LIMIT_REACHED` (#4710) と同型の抽出。
 */
const ACTIVITY_LIMIT_REACHED = (max: number) =>
	`${ACTIVITY_QUOTA_TERMS.original}は ${max} 個までです（${ACTIVITY_QUOTA_TERMS.presetImport}は無制限です）`;

/**
 * 活動の上限にまつわる復元結果の文言 SSOT (#4693)。
 *
 * 復元は 4 経路 (settings > データ の ZIP / JSON 復元、クラウド取込、活動管理の ︙ →
 * 「バックアップから復元」、`api/v1/activities/import` の merge) あり、**保管が起きたときは
 * どこから入っても同じ文言**でなければならない (同じ状況で画面ごとに言うことが違うのを防ぐ)。
 * ただし `api/v1/activities/import` は route 入口の `checkActivityLimit` (#3759) を残しており、
 * custom が上限ちょうどのときは 403 (`PLAN_GATE_LABELS.activityLimitReached`) で終わり
 * ここには到達しない (境界の正確な記述は `server/services/activity-quota.ts` 冒頭の但し書き)。
 * marketplace 側の feedback (`resolveImportFeedback`) と settings 画面の両方がここを読む。
 */
export const ACTIVITY_QUOTA_LABELS = {
	/**
	 * "119 件のうち 3 件を有効化し、116 件はプランの上限のため保管しました（アップグレードで使えます）"
	 *
	 * PO 回答 (2026-09-03) #2: 上限を超える復元で顧客のデータを落とさない。超過分は archived (保管)
	 * で取り込み、入った数 / 入らなかった数 / 理由 / 次の行動を必ず出す。
	 * 「復元しました」だけで黙って落とすのは不可。導線 (link) は呼び出し側が併記する。
	 *
	 * @param total 復元対象だったオリジナル活動の行数 (= activated + archived)
	 * @param activated 有効な状態で入った行数
	 * @param archived プランの上限のため保管 (archived) した行数
	 */
	restoreArchivedResult: (total: number, activated: number, archived: number) =>
		`${total} 件のうち ${activated} 件を有効化し、${archived} 件はプランの上限のため保管しました（${UPGRADE_TERMS.actionVerb}で使えます）`,

	/**
	 * 過去の復元で保管した分を **あとから見ても分かる**ようにする常設の記録 (#4693 QM 再レビュー)。
	 *
	 * `archived_reason` は enum (`ARCHIVED_REASONS`) で、上限による自動保管専用の値を足すには
	 * Aurora DSQL の CHECK 制約を張り替える必要があるが、DSQL は `ALTER TABLE … ADD CONSTRAINT`
	 * を受け付けない (0A000)。そのため行単位では「親が自分で選んで保管した」分と区別が付かない。
	 * 代わりに **テナント単位の耐久記録**を残し、この文言で親の画面に出す
	 * (「自分で選んだ覚えはない」に答えられる状態を、行の外側で成立させる)。
	 */
	pastRestoreArchivedNotice: (dateLabel: string, archived: number) =>
		`${dateLabel} の復元で、${archived} 件の活動をプランの上限のため保管しました（${UPGRADE_TERMS.actionVerb}で使えます）`,
} as const;

export const PLAN_GATE_LABELS = {
	/**
	 * "{feature}はスタンダードプラン以上でご利用いただけます"
	 *
	 * カバー対象 (C1-C15 リテラル置換):
	 *   - errors.ts: 'AI 活動提案はスタンダードプラン以上でご利用いただけます'
	 *   - cloud-export-service.ts: 'クラウドエクスポートはスタンダードプラン以上でご利用いただけます'
	 *   - admin/reports/+page.server.ts: '週次メールレポートはスタンダードプラン以上でご利用いただけます'
	 *   - admin/rewards/+page.server.ts: `${rewardCustomizeFeature}はスタンダードプラン以上でご利用いただけます` (#4992)
	 *   - api/v1/export/+server.ts: 'エクスポート機能はスタンダードプラン以上でご利用いただけます'
	 */
	standardOrAboveFor: (feature: string) =>
		`${feature}は${PLAN_FULL_TERMS.standard}以上でご利用いただけます`,

	/**
	 * ごほうび管理で有料になる操作の名前 (#4928 / #4992)。`standardOrAboveFor` の引数に使う。
	 *
	 * プリセット / テンプレートの取込は全プラン可なので「ごほうび管理」全体を有料と言わない。
	 * admin/rewards の拒否文言とページガイドの tips が同じ語を使うよう 1 箇所に置く。
	 * 値は料金表の行名 (REWARD_TERMS.originalCreateEdit) と同じにする — 拒否された操作が
	 * 料金表のどの行かを顧客が突き合わせられるように (#4992)。
	 */
	rewardCustomizeFeature: REWARD_TERMS.originalCreateEdit,

	/**
	 * "無料プランではお子さま1人あたり N 個までです。スタンダードプラン以上にアップグレードすると無制限に作成できます。"
	 *
	 * #4512: checklists の上限エラー 5 箇所が「フリープラン」を直書きしていた
	 * (プラン名の SSOT は「無料プラン」で、「フリー」はカード等の短縮名。#4502 の
	 *  使い分け決裁を server 面にも適用する)。文と数値の組み立てを 1 箇所に閉じる。
	 *
	 * @param max 上限値。`allowed: false` の分岐でのみ呼ぶこと (#4622)。
	 *   引数を `number` に狭めてあるため、`max: number | null` をそのまま埋めて
	 *   「1人あたり null 個」を出す経路がコンパイルで落ちる。
	 */
	perChildLimitReached: (max: number) =>
		`${PLAN_FULL_TERMS.free}ではお子さま1人あたり ${max} 個までです。${PLAN_FULL_TERMS.standard}以上にアップグレードすると無制限に作成できます。`,

	/** 同上の短い版 (上限値だけを述べ、アップグレード導線は呼び出し側が別に出す場合)。 */
	perChildLimitReachedShort: (max: number) =>
		`${PLAN_FULL_TERMS.free}ではお子さま1人あたり ${max} 個までです。`,

	/** 一括取込で一部だけ入った場合の結果通知。 */
	bulkImportPartiallyLimited: (added: number | string, rejected: number | string, note: string) =>
		`${added} 件取り込みました。${PLAN_FULL_TERMS.free}の上限に達したため ${rejected} 件は取り込めませんでした。${PLAN_FULL_TERMS.standard}以上で無制限。${note}`,

	/**
	 * "{feature}はファミリープランでご利用いただけます"
	 *
	 * カバー対象:
	 *   - suggest-plan-gate.ts: '${featureLabel}はファミリープランでご利用いただけます'
	 *   - admin/checklists/+page.server.ts: 'AI チェックリスト提案はファミリープランでご利用いただけます'
	 */
	familyOnlyFor: (feature: string) => `${feature}は${PLAN_FULL_TERMS.premium}でご利用いただけます`,

	/**
	 * "{feature}はファミリープラン限定です"
	 *
	 * カバー対象:
	 *   - admin/messages/+page.server.ts: '自由テキストメッセージはファミリープラン限定です'
	 */
	familyLimitedFor: (feature: string) => `${feature}は${PLAN_FULL_TERMS.premium}限定です`,

	/**
	 * "この機能はスタンダードプラン以上でご利用いただけます。プランをアップグレードしてください。"
	 *
	 * カバー対象:
	 *   - server/errors.ts: 'この機能はスタンダードプラン以上でご利用いただけます。プランをアップグレードしてください。'
	 */
	standardOrAboveGenericWithUpgrade: `この機能は${PLAN_FULL_TERMS.standard}以上でご利用いただけます。${PLAN_UPGRADE_CTA}`,

	/**
	 * "プランをアップグレードしてください。" — プラン制限 403 の末尾に付ける導線文 (#4767 PO 回答 #4)。
	 * 画面 / test が「導線が載っているか」を照合するための export。
	 */
	upgradeCta: PLAN_UPGRADE_CTA,

	/**
	 * "{feature}はスタンダードプラン以上でご利用いただけます。プランをアップグレードしてください。"
	 * "{feature}はプレミアムプラン限定です。プランをアップグレードしてください。"
	 *
	 * プラン制限 403 (`planLimitError`) の**唯一の顧客向け文言** (#4767 PO 回答 #4)。
	 * 旧実装は `message` (機能名入り・導線なし) と `userMessage` (導線入り・機能名なし) の 2 本を
	 * 別々の文字列で持ち、client が読む `message` には導線が載っていなかった。
	 * 機能名 + 要求 tier + アップグレード導線を 1 文に組み立て、両チャネルに同じ文字列を載せる。
	 *
	 * @param feature 機能名 (`FEATURE_LABELS` 等の labels SSOT から渡す)
	 * @param requiredTier その機能が要求する最低 tier
	 */
	requiredTierWithUpgradeFor: (feature: string, requiredTier: 'standard' | 'family') =>
		requiredTier === 'family'
			? `${feature}は${PLAN_FULL_TERMS.premium}限定です。${PLAN_UPGRADE_CTA}`
			: `${feature}は${PLAN_FULL_TERMS.standard}以上でご利用いただけます。${PLAN_UPGRADE_CTA}`,

	// 活動 quota 上限 403 の「機能名」だった `activityAddFeature` は #4693 (QM 4 巡目) で撤去した。
	// 唯一の読み手だった REST 2 面 (`api/v1/activities` POST / `api/v1/activities/import` merge) が
	// `quotaLimitError` + `activityLimitReachedWithUpgrade` に移ったため、参照ゼロになった。
	// 数量制限を機能ゲートの文型 (`requiredTierWithUpgradeFor`) に流し込む入口を残すと、
	// 「3 個までは使えるのに『ご利用いただけます』と言われる」#4710 と同 class の症状が再発する。
	// 読み手のいない label を置き続けない (#4584「フラグと実装が別々の真実になる」と同じ理由)。

	/**
	 * "スタンダード以上" — バッジ / タグ用の短縮形 (#4512)
	 *
	 * PremiumBadge の label / ヘッダーの premium バッジ / pricing の家族パターンタグが
	 * それぞれ同じ文字列を持っていた (3 重定義)。短縮プラン名 atom から組み立てる。
	 */
	standardOrAboveBadge: `${PLAN_TERMS.standard}以上`,

	/**
	 * "この機能はプレミアムプラン限定です。プランをアップグレードしてください。"
	 *
	 * #4710: `PLAN_LIMIT_EXCEEDED` の userMessage が要求 tier を見ずに常に
	 * `standardOrAboveGenericWithUpgrade` を返しており、**スタンダード契約者が
	 * プレミアム限定機能 (AI 提案) を叩くと「スタンダード以上にしてください」**と言われた。
	 * 既にスタンダードなので次の行動が取れない。要求 tier 別に文を出し分けるための片割れ。
	 */
	familyLimitedGenericWithUpgrade: `この機能は${PLAN_FULL_TERMS.premium}限定です。${PLAN_UPGRADE_CTA}`,

	/**
	 * "{feature}はファミリープラン限定です。アップグレードすると利用できます。"
	 *
	 * カバー対象:
	 *   - admin/settings/+page.server.ts: 'きょうだいランキングはファミリープラン限定です。アップグレードすると利用できます。'
	 */
	familyLimitedWithUpgradeFor: (feature: string) =>
		`${feature}は${PLAN_FULL_TERMS.premium}限定です。アップグレードすると利用できます。`,

	/**
	 * "ファミリープラン限定の機能です"
	 *
	 * カバー対象:
	 *   - api/v1/admin/viewer-tokens/+server.ts: 'ファミリープラン限定の機能です'
	 */
	viewerTokenFamilyOnly: `${PLAN_FULL_TERMS.premium}限定の機能です`,

	/**
	 * "ご家族の人数が上限（オーナーを含めて {max} 人）に達しています。…"
	 *
	 * 家族メンバー招待の quota 上限 (maxFamilyMembers) 到達時の 403 文言 (#1111 / EPIC #3533 §10.7)。
	 * 旧 `api/v1/admin/invites/+server.ts` 内ハードコードを SSOT 経由に是正 (ADR-0045 / P5)。
	 *
	 * **上限は owner を含む合計**である (#4500)。「メンバー上限（4人）」とだけ言うと、LP で
	 * 「4 人まで招待できる」と読んだ顧客が 3 人目の招待でブロックされた時に不具合と誤認する。
	 * オーナーを含む数え方であることを、ブロックされたその場で明示する。
	 */
	memberLimitReached: (max: number) =>
		`ご家族の人数が上限（オーナーを含めて${max}人）に達しています。これ以上の招待はプランのアップグレードが必要です。`,

	/**
	 * "オリジナル活動は N 個までです（プリセットからの取込は無制限です）"
	 *
	 * 活動 quota 上限 (maxActivities) 到達時の 403 文言 (#4622)。
	 * 旧実装は routes 7 箇所に直書きされ、`checkActivityLimit` の `max: number | null` を
	 * そのまま埋めていたため「最大 null 個」を出しうる型の穴になっていた。
	 * 引数を `number` に狭めることで、null を渡す呼び出しがコンパイルで落ちる。
	 *
	 * #4693 PO 回答 (2026-09-03): 上限の母集団は親が手で作った活動 (custom) だけで、
	 * プリセット取込は消費しない。旧「カスタム活動は最大 N 個まで作成できます」は
	 * 「テンプレも入らない」と読めたため、数える対象と数えない経路の両方を言う
	 * (atom: ACTIVITY_QUOTA_TERMS)。アップグレード導線は呼び出し側 (PlanLimitError の
	 * upgradeUrl / `upgradeLinkLabel`) が併記する。
	 *
	 * @param max 上限値。`allowed: false` の分岐でのみ呼ぶこと (無制限プランは上限に達しない)
	 */
	activityLimitReached: ACTIVITY_LIMIT_REACHED,

	/**
	 * "オリジナル活動は N 個までです（プリセットからの取込は無制限です）。プランをアップグレードしてください。"
	 *
	 * 上と同じ本文に **アップグレード導線まで載せた** 版 (#4693 QM 4 巡目)。REST の 403 用。
	 *
	 * # なぜ REST 用に別 compound が要るか
	 *
	 * admin の form action は `createPlanLimitError` が `upgradeUrl` を構造化フィールドで返し、
	 * 画面が `upgradeLinkLabel` のリンクを併記するので、本文に導線を書く必要がない。
	 * 一方 REST (`api/v1/activities` POST / `api/v1/activities/import` merge) は顧客に届くのが
	 * `message` の 1 本だけ (#4767 PO 回答 #4) なので、導線を本文に含めないと案内が消える。
	 *
	 * # なぜ `requiredTierWithUpgradeFor` を使わないか (#4710 と同 class)
	 *
	 * `requiredTierWithUpgradeFor` は **機能ゲート**の文型 (「〜はスタンダードプラン以上でご利用
	 * いただけます」) で、**数量制限**に使うと「3 個までは使えるのに『使えません』」という自己矛盾に
	 * なる。クラウド保管枠で同じ症状を直したのが #4710 の `quotaLimitError` で、活動 quota の
	 * REST 2 面がその移行から漏れていた。数量制限は「N 個までです」+ 導線で言い切る。
	 *
	 * @param max 上限値。`allowed: false` の分岐でのみ呼ぶこと
	 */
	activityLimitReachedWithUpgrade: (max: number) =>
		`${ACTIVITY_LIMIT_REACHED(max)}。${PLAN_UPGRADE_CTA}`,

	/**
	 * "子供は最大{max}人まで登録できます。プランをアップグレードしてください。"
	 *
	 * 子供 quota 上限 (maxChildren) 到達時の 403 文言 (#4622)。activityLimitReached と同型。
	 */
	childLimitReached: (max: number) =>
		`子供は最大${max}人まで登録できます。プランをアップグレードしてください。`,

	/**
	 * "クラウド保管は最大{max}件までです。古いエクスポートを削除してから、もう一度お試しください。"
	 *
	 * クラウド保管の同時保管数上限 (maxCloudExports) 到達時の 403 文言 (#4710)。
	 *
	 * `activityLimitReached` / `childLimitReached` と違い **アップグレードを案内しない**。
	 * maxCloudExports は free=0 / standard=3 / family=10 で、free は 0 なのでプランゲート側で
	 * 弾かれる。つまり**この上限に達するのは契約中の顧客だけ**であり、その顧客に
	 * 「プランをアップグレードしてください」と言うのが #4710 の症状そのものになる
	 * (最上位の family=10 に至っては上げ先が無い)。その場で取れる行動を案内する。
	 *
	 * @param max 上限値。上限に達した分岐でのみ呼ぶこと
	 */
	cloudExportLimitReached: CLOUD_EXPORT_LIMIT_REACHED,

	/**
	 * 上限到達 403 に「どれを消せばいいか」を名指しで添える (#4767 PO 回答 #3)。
	 *
	 * 候補は service が失敗 → DL 使い切り → 作成日が古い順に並べた先頭数件
	 * (`SETTINGS_LABELS.cloudDeleteCandidate` で 1 件ずつ整形済み)。候補が無ければ上の文だけ。
	 * 画面側 (`resolveApiErrorMessage`) は 200 字で切るため、候補は呼び出し側で 3 件までに絞る。
	 */
	cloudExportLimitReachedNaming: (max: number, candidates: readonly string[]) =>
		candidates.length === 0
			? CLOUD_EXPORT_LIMIT_REACHED(max)
			: `${CLOUD_EXPORT_LIMIT_REACHED(max)}もう使えないものから削除できます: ${candidates.join('、')}`,

	/**
	 * 上限到達 403 のうち、**消しても損の無い行 (作成失敗 / 回数切れ) が 1 つも無い**場合 (#4767 QM must)。
	 *
	 * この状況で候補として挙げられるのは「まだダウンロードできる共有」しかない。
	 * 「削除の候補」とだけ言うと、まだ必要な共有をワンクリックで消させることになるため、
	 * **失われるものを明示**したうえで候補を出す (削除自体は取り消せない)。
	 */
	cloudExportLimitReachedLiveOnly: (max: number, candidates: readonly string[]) =>
		`${CLOUD_EXPORT_LIMIT_REACHED(max)}いま保管されているものはすべてまだダウンロードできる共有です。削除すると取り出せなくなります（元に戻せません）: ${candidates.join('、')}`,

	// チェックリストテンプレート quota 上限 (maxChecklistTemplates) 到達時の 403 文言は
	// `perChildLimitReached` / `perChildLimitReachedShort` (上記) が SSOT。
	// #4622 の「上限メッセージに null を渡せない」関門は、そちらの引数を `number` に
	// 狭めることで満たしている (同じ文言の label を 2 つ置くと SSOT が割れるため統合した)。
	//
	// develop 側 (#4707/#4727 経由) に一時的に入っていた `checklistTemplateLimitReached` /
	// `checklistTemplateLimitReachedWithUpgrade` は、全 callsite (checklists/+page.server.ts 5 箇所) が
	// `perChildLimitReached*` を参照しており到達不能な重複だった。加えてプラン名を
	// 「フリープラン」と直書きしており #4512 (プラン名 SSOT = `PLAN_FULL_TERMS.free`) に反するため、
	// `perChildLimitReached*` に統合した。

	/**
	 * プランを確認できないため取込を中止したときの文言 (#4693 fail-closed)。
	 * 障害中だけ上限が消える経路を作らないための拒否であり、顧客には再試行を促す。
	 */
	planUnverifiableImportAborted:
		'ただいまプランを確認できないため取り込みを中止しました。しばらくしてからもう一度お試しください。',

	/**
	 * 復元で **プランは無料と分かっているが、現在の利用数を数えられなかった** ときの文言 (#4693 QM 再レビュー)。
	 *
	 * 現在数の集計は「子供一覧 → 子ごとに活動一覧」の 1+N 読み取りで、transient に最も当たりやすい。
	 * 数えられない以上は残枠を 0 とみなして保管するが、**この世帯は無料と確定している**ので
	 * アップグレードすれば復帰できる (自己回復の導線がある)。だから上限超過と同じ導線を出す。
	 */
	usageUnverifiableRestoreArchived: (archived: number) =>
		`ただいまご利用状況を確認できなかったため、${archived} 件の活動は保管しました。${UPGRADE_TERMS.actionVerb}すると使えます。`,

	/**
	 * 復元で **プラン自体を判定できなかった** ときの文言 (#4693 QM 再レビュー 3 巡目)。
	 *
	 * 倒し方の候補は 3 つあった:
	 *   (a) 全部保管する → 有料世帯が一時的な読み取り失敗だけで復元データを全部無効化され、
	 *       自力で戻す導線が無い (アーカイブ解除は課金 webhook 経由しか無い)。却下
	 *   (b) 上限を適用せず全部有効で入れる → 無料世帯が読み取り失敗を挟むだけで上限 3 のところ
	 *       119 件を恒久保持できる (#4693 症状 1 の再生産)。しかも「あとで整理されます」と
	 *       言っても、その整理を行うコードが存在しない (嘘になる)。却下
	 *   (c) **中止する** → 何も書かないのでデータは失われず (顧客の手元のバックアップは無傷)、
	 *       課金境界も守られ、文言も嘘にならない。再試行で回復できる。**これを採る**
	 *
	 * 取込 (`planUnverifiableImportAborted`) と同じ倒し方に揃うので、判定不能時の挙動が
	 * 取込 / 復元で分岐しなくなる。
	 */
	planUnresolvedRestoreAborted:
		'ただいまプランを確認できないため、活動の復元を中止しました。データは失われていません。しばらくしてからもう一度お試しください。',

	/**
	 * **誰が**上限に達しているのかを言う版 (#4693)。
	 *
	 * 旧実装は上限に達した子の名前を出さず、しかも 1 人でも超過していれば全員分の配信を
	 * 丸ごと失敗させていた。「誰の上限か分からない / 余裕のある子にも入らない」の 2 重の
	 * 詰まりになるため、名前を出したうえで**余裕のある子には配信する**。
	 *
	 * プラン名は #4512 の SSOT (`PLAN_FULL_TERMS`) 経由で組み立てる。
	 */
	perChildLimitReachedForChildren: (names: readonly string[], max: number) =>
		`${names.join('・')}は${PLAN_FULL_TERMS.free}の上限（お子さま1人あたり ${max} 個）に達しているため配信をスキップしました。${PLAN_FULL_TERMS.standard}以上にアップグレードすると無制限に作成できます。`,

	/**
	 * プラン制限エラー banner / toast に併記するアップグレード導線リンクのラベル (#2894 AC3)。
	 *
	 * PlanLimitError (`upgradeUrl='/admin/subscription'`) を受領した admin 取込フローで、
	 * エラーメッセージの隣に表示する `<a>` のテキスト。NN/G #9 (error recovery) 整合で
	 * 「どこへ行けば解消できるか」を必ず提示する。
	 */
	upgradeLinkLabel: `${UPGRADE_TERMS.actionVerb}する`,

	/**
	 * dropdown / メニュー内の上限到達 add 項目に付ける lock マーカーアイコン (EPIC #3533 §10.2.3)。
	 *
	 * 上限到達時の add 系メニュー項目は完全 disabled にせず locked-but-active にし
	 * (NN/G: disabled + 説明なしは dead-end アンチパターン)、本アイコンで「制約あり」を最小表現する。
	 * 選択でプラン画面へ遷移させ、制約詳細はプラン画面に一元化する (P1)。
	 * standalone button / section の quota ゲートは FeatureGate の popover が担う (§10.2.1)。
	 */
	lockedItemIcon: '🔒',
} as const;

// ============================================================
// OWNER_GATE_LABELS — owner-gate 403 / 401 エラー文言 SSOT (#3561 ①③)
// ============================================================
//
// account / tenant / members 系 owner-gate endpoint (requireRole(locals, ['owner'])
// seam、#3528 fitness#3 / #3556) の {error} body 文言を PLAN_GATE_LABELS 同様に
// compound 層へ集約する (ADR-0062 §2 error body 統一の territory)。既存 client
// 互換のため、各値は置換前のハードコード文言とバイト一致で維持する。
// endpoint 側の変換 helper は src/lib/server/auth/owner-gate.ts (ownerGateResponse)。

/** "owner のみ{action}できます" — owner-gate 403 文言の共通テンプレート (#3561 ①) */
const ownerOnly = (action: string) => `owner のみ${action}できます`;

export const OWNER_GATE_LABELS = {
	/**
	 * 401: 認証コンテキスト欠落。requireRole が throw する HttpError(401) を
	 * endpoint 文言へ変換する際の body (#3561 ③)。各 endpoint 上流の
	 * `!context` 早期 return と同一文言（バイト一致）。
	 */
	authRequired: '認証が必要です',
	/** POST api/v1/admin/account/delete (owner 系 3 pattern 共通) */
	accountDelete: ownerOnly('実行'),
	/** GET api/v1/admin/account/deletion-info */
	deletionInfo: ownerOnly('取得'),
	/** POST api/v1/admin/tenant/cancel */
	tenantCancel: ownerOnly(`${CANCEL_TERMS.canonical}申請`),
	/** POST api/v1/admin/tenant/reactivate */
	tenantReactivate: ownerOnly(`${CANCEL_TERMS.canonical}キャンセル`),
	/** DELETE api/v1/admin/members/[userId] */
	memberDelete: ownerOnly('メンバーを削除'),
	/** POST api/v1/admin/members/[userId]/transfer-ownership */
	transferOwnership: ownerOnly('権限を移譲'),
	/** POST api/v1/admin/invites (#3726、置換前文言とバイト一致) */
	inviteCreate: ownerOnly('招待を作成'),
	/** DELETE api/v1/admin/invites/[code] (#3726、置換前文言とバイト一致) */
	inviteRevoke: ownerOnly('招待を取り消し'),
} as const;

export const SUBSCRIPTION_PLAN_LABELS: Record<string, string> = {
	monthly: 'スタンダード月額',
	yearly: 'スタンダード年額',
	'family-monthly': 'ファミリー月額',
	'family-yearly': 'ファミリー年額',
	lifetime: 'ライフタイム',
} as const;

/** プランラベルを取得 */
export function getPlanLabel(tier: string): string {
	return PLAN_LABELS[tier as PlanKey] ?? tier;
}

/** サブスクリプションプランラベルを取得 (subscription-plan.ts の値 → 表示ラベル) */
export function getSubscriptionPlanLabel(plan: string): string {
	return SUBSCRIPTION_PLAN_LABELS[plan] ?? plan;
}

// ============================================================
// トライアル関連ラベル（#1166 景品表示法準拠）
// ============================================================

/**
 * トライアル仕様の仕様書:
 *  - Stripe Checkout 側は trial_period_days を使用しない（stripe-service.ts #314）
 *  - アプリ内 trial-service で一元管理（DEFAULT_TRIAL_DAYS = 7）
 *  - ユーザーが /admin/license から明示的にボタンを押して開始
 *  - クレジットカード登録不要、7 日後の自動課金なし
 *  - 終了後は無料プランに自動移行（tokushoho.html / terms.html と整合）
 *
 * 上記仕様のため、登録 CTA の下に「付帯」表記を書くと「登録すれば自動で
 * トライアル付帯」と誤認させる景品表示法リスクがある（Issue #1166 参照）。
 * 登録・購入系 CTA には「付帯」「付き」などの表記を書かないこと。
 * CI: tests/e2e/trial-notice-consistency.spec.ts が登録 / 購入系 CTA 近傍に
 * 「付帯」表記が出ないことを検証する（#4322 で撤去された専用 lint の後継、#4482）。
 */
// #1916: atom (トライアル日数) は terms.ts (TRIAL_TERMS) に移譲
// #3033: TrialBanner を urgent 専用に縮小し not-started / expired / active 通常の compound を撤去
// (代替: header pill / /admin/subscription / TrialEndedDialog #770 / ロック機能接触時の文脈表示)
export const TRIAL_LABELS = {
	durationDays: TRIAL_TERMS.durationDays,
	bannerTitleUrgent: `${ACTION_LABELS.freeTrial}は明日で終了します`,
	bannerDescActive: '全機能をお試しいただけます。',
	// PO 決裁 2026-09-10 決定 3(a): トライアルは申込経路から**自動で開始**する。
	// 始まったことを顧客に告げないと、「無料体験を始める」を押しに行って
	// 「すでに使用済みです」に当たる (自分が始めた覚えが無いのに使い切っている)。
	// 終了日は**その日いっぱい使える最後の日**を出す (判定は isTrialEndDateActiveJST の `>=`)。
	startedNotice: (endDate: string) =>
		`${TRIAL_TERMS.duration}の${ACTION_LABELS.freeTrial}が始まりました。${endDate}まで全機能をお使いいただけます`,
	bannerCtaNotStarted: ACTION_LABELS.viewPlans,
	// #2941 項目 2: startTrial action の negative path (trialUsed=true 再押下 → fail 400) を
	// ユーザーに見える形で表示する (NN/G #1 visibility of system status)。
	// startErrorAlreadyUsed は server (subscription +page.server.ts) が fail body に入れ、
	// startErrorFallback は client (#3033 で開始導線を SaasLicensePanel に一本化後は
	// 同 panel の startTrial form) が getActionErrorDisplay の fallback に使う。
	startErrorAlreadyUsed: `${ACTION_LABELS.freeTrial}はすでに使用済みです`,
	startErrorFallback: `${ACTION_LABELS.freeTrial}を開始できませんでした。時間をおいて再度お試しください。`,
	// trial active 中は body バナーでなく header pill で残日数を常時視認させる
	// (tap で /admin/subscription へ。urgent 残 1 日以下のみ body バナー併用)
	headerPillLabel: (days: number) => `残り${days}日`,
	headerPillTitle: `${ACTION_LABELS.freeTrial}中`,
} as const;

// ============================================================
// PremiumModal 用ラベル（#1166 labels.ts SSOT 化 / #1961 Phase 7 H4: 価格 atom を terms.ts 参照化）
// ============================================================

export const PREMIUM_MODAL_LABELS = {
	dialogTitle: `⭐ プランを${ACTION_LABELS.upgrade}`,
	description: 'カスタマイズ機能でお子さまにぴったりの環境を作りましょう！',
	standardFeatures: [
		'✅ オリジナル活動の追加・編集',
		'✅ チェックリストのカスタマイズ',
		'✅ ごほうびリストの自由設定',
		`✅ ${CHILD_TERMS.honorific}の登録無制限`,
		'✅ データのエクスポート',
	],
	familyFeatures: [
		`✅ ${PLAN_SHORT_LABELS.standard}の全機能`,
		'✅ 無制限の履歴保持',
		'✅ きょうだいの比較',
		'✅ 年間サマリーレポート',
	],
	// #1961: 価格 atom は terms.ts (PRICE_TERMS) を SSOT として参照
	priceStandard: `${PRICE_TERMS.standard}`,
	priceFamily: `${PRICE_TERMS.family}`,
	priceUnit: '/月〜',
	ctaUpgrade: `${ACTION_LABELS.upgrade}する`,
	ctaLater: ACTION_LABELS.later,
} as const;
