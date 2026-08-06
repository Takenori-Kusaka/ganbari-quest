// src/lib/features/child-home/habit-certificate-notice.ts
//
// #4261 ③ — 習慣化告知を「いつ出すか」の純関数。保存側は
// `$lib/server/services/habit-certificate-notice-service` が持つ。
//
// 判定を component から出しているのは、ADR-0012 との両立条件 (1 回だけ / 演出を重ねない /
// 閉じる操作を挟まない) を **DOM 無しで固定できる形**にしておくため。同じ理由で
// #4313 (`ui-mode-change-notice.ts`) も純関数を切り出している。

import { HABIT_CERTIFICATE_NOTICE_LABELS } from '$lib/domain/labels';
import type { UiMode } from '$lib/domain/validation/age-tier';

/**
 * 次回起動で 1 回だけ伝える内容。**顧客識別子は載せない** (#4174 / #4197 と同じ基準)。
 *
 * 型をここ (client 側) に置き、server service が import する。逆向き
 * (`$lib/server/**` を client から import) は SvelteKit の illegal import になるため。
 */
export interface HabitCertificateNotice {
	/** 達成した月 (YYYY-MM) */
	yearMonth: string;
	/** その達成で付与したポイント */
	points: number;
}

export interface HabitCertificateNoticeVisibility {
	/** 未読の告知 (無ければ null) */
	notice: HabitCertificateNotice | null;
	/** 誕生日ボーナスが未受取か */
	birthdayPending: boolean;
	/** `?screenshot=*` 撮影中か */
	isScreenshotMode: boolean;
}

/**
 * 告知を出すか。
 *
 * **出さないと決めた回では既読化もしない** — pending は次回起動へ繰り越す。
 * 「出さなかったのに読んだことにする」と、その家庭では告知が永久に届かない
 * (= Push 未達家庭の無音を別の形で再生産する)。
 */
export function shouldShowHabitCertificateNotice({
	notice,
	birthdayPending,
	isScreenshotMode,
}: HabitCertificateNoticeVisibility): boolean {
	if (!notice) return false;
	// 誕生日ボーナスと同じ回に 2 枚重ねない (ADR-0012: 連続演出にしない)。
	if (birthdayPending) return false;
	// 撮影日に依存して baseline が動くのを避ける (#3017 と同じ扱い)。
	if (isScreenshotMode) return false;
	return true;
}

/** 年齢モード別の文言。amount は呼び出し側で pointSettings に沿って整形した文字列。 */
export function getHabitCertificateNoticeText(
	uiMode: Exclude<UiMode, 'baby'>,
	amount: string,
): { title: string; body: string } {
	const labels = HABIT_CERTIFICATE_NOTICE_LABELS[uiMode];
	return { title: labels.title, body: labels.body(amount) };
}
