// src/lib/server/services/marketing-suppression-keys.ts
// #4338: マーケティングメールの**配信抑止記録**となる `settings` キーの SSOT
// (依存を持たない leaf module)。
//
// 定義をここに置くのは、記録する側 (lifecycle-email-service / marketing-email-counter) と
// 消さない側 (soft-delete-keys → tenant-cleanup-service) の両方が同じ 1 本を見るためである。
// 記録側に定数を置いたまま削除側で文字列を複製すると、キー名を変えたときに
// 「抑止記録だと気付かれないまま消される」経路が復活する (ADR-0045 の atom SSOT と同じ理由)。

/**
 * マーケティング配信を opt-out したテナントの settings KV キー。
 * 値の有無だけで判定する (`runLifecycleEmails` の 1 番目のゲート)。
 */
import { toJSTDateString } from '$lib/domain/date-utils';

export const MARKETING_UNSUBSCRIBED_KEY = 'marketing_unsubscribed_at';

/** 休眠復帰メール送信済みフラグの settings KV キー (1 テナントにつき 1 回限り)。 */
export const DORMANT_REACTIVATION_SENT_KEY = 'dormant_reactivation_sent';

/** 年間送信回数カウンタのキー接頭辞 (`marketing_email_count_<YYYY>`)。 */
export const MARKETING_EMAIL_COUNT_KEY_PREFIX = 'marketing_email_count_';

/** 年 (UTC 4 桁) から送信回数カウンタのキー名を作る。 */
export function marketingEmailCountKey(year: string): string {
	return `${MARKETING_EMAIL_COUNT_KEY_PREFIX}${year}`;
}

/**
 * 退会処理の途中で**消してはならない**配信抑止キーを返す。
 *
 * ## なぜ消してはならないのか (#4338)
 *
 * `runLifecycleEmails` は `listAllTenants()` を素通しで全 families を走査し、削除進行中か
 * どうかを一切見ない。opt-out 判定は {@link MARKETING_UNSUBSCRIBED_KEY} の**有無だけ**である。
 * したがって「settings は消えたが後続ステップが失敗して families 行が残った」テナント
 * (= この削除順序が存在する理由そのものの窓) から抑止記録を消すと、**退会を申し出て、かつ
 * 配信停止していた家族に、退会処理の最中に販促メールを送る**経路ができる。
 * 特定電子メール法のオプトアウト遵守 / GDPR 第 17 条・第 21 条の観点で、最も送ってはいけない相手である。
 *
 * 3 つ全部を残す必要がある。opt-out だけ残しても、送信済フラグが消えれば休眠復帰メールが
 * 再び 1 通送れる状態に戻り、カウンタが消えれば年 6 回の枠を使い切っていてもリセットされる。
 *
 * ## 年カウンタの扱い
 *
 * カウンタは年ごとの別キーだが、`canSendMarketingEmail` が読むのは**当年のキーだけ**である。
 * 過年度分は誰も読まないので残す必要がない。年跨ぎの実行で「当年」の判定が呼び出し側と
 * cron 側でずれても、跨いだ先の年はカウンタ 0 = 設計どおりのリセットであり実害にならないが、
 * 年境界での取りこぼしを避けるため前年分も併せて残す (2 キー、いずれも日時の数値のみ)。
 *
 * 年の基準は書き手 (`getCurrentYearKey`) と同じ **JST** に揃える (#4120)。基準がずれると
 * 元日 00:00〜09:00 JST に退会した家族の当年カウンタが「前年キー」として扱われ、
 * 残すべきキーを 1 つ取り逃がす。
 *
 * @param now 現在時刻 (テスト用に注入可能)
 */
export function getMarketingSuppressionKeys(now: Date = new Date()): readonly string[] {
	const year = Number(toJSTDateString(now).slice(0, 4));
	return [
		MARKETING_UNSUBSCRIBED_KEY,
		DORMANT_REACTIVATION_SENT_KEY,
		marketingEmailCountKey(String(year)),
		marketingEmailCountKey(String(year - 1)),
	];
}
