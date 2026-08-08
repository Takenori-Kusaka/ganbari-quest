// src/lib/features/child-home/ui-mode-change-notice.ts
// #4313: 年齢帯 UI 切替の告知ダイアログ — 表示判定と文言解決 (純関数)。
//
// 「誰も操作していないのに結果だけが変わる」(cron / 誕生日ボーナスによる uiMode 上書き) を
// 次回ログインの初回描画で 1 回だけ伝えるための派生ロジック。Svelte 非依存なので unit test で
// 直接固定できる。

import { UI_MODE_CHANGE_LABELS } from '$lib/domain/labels';
import type { UiMode } from '$lib/domain/validation/age-tier-types';

/** server から渡される pending notice (settings KV に保存された 1 件)。 */
export interface UiModeChangeNotice {
	from: UiMode;
	to: UiMode;
	/** 切替が起きた日 (YYYY-MM-DD, JST)。 */
	changedOn: string;
}

export interface UiModeChangeMessage {
	heading: string;
	body: string;
	closeLabel: string;
	parentNote: string;
	settingsLabel: string;
	emoji: string;
	ariaLabel: string;
}

/**
 * 告知ダイアログを出すか。
 *
 * ADR-0012 (Anti-engagement): 誕生日モーダルが出る回では出さない。notice は既読化されず
 * server 側に残るため、次回ログインで単独表示される。**ダイアログを 2 枚連続で見せない。**
 */
export function shouldShowUiModeChangeNotice(params: {
	notice: UiModeChangeNotice | null | undefined;
	birthdayPending: boolean;
	isScreenshotMode: boolean;
}): boolean {
	if (!params.notice) return false;
	if (params.birthdayPending) return false;
	if (params.isScreenshotMode) return false;
	return true;
}

/** 切替**後**の uiMode に対応する文言を解決する (labels.ts SSOT 経由)。 */
export function resolveUiModeChangeMessage(to: UiMode): UiModeChangeMessage {
	return {
		heading: UI_MODE_CHANGE_LABELS.heading[to],
		body: UI_MODE_CHANGE_LABELS.body[to],
		closeLabel: UI_MODE_CHANGE_LABELS.closeLabel[to],
		parentNote: UI_MODE_CHANGE_LABELS.parentNote,
		settingsLabel: UI_MODE_CHANGE_LABELS.settingsLabel,
		emoji: UI_MODE_CHANGE_LABELS.emoji,
		ariaLabel: UI_MODE_CHANGE_LABELS.dialogAriaLabel,
	};
}
