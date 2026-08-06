// src/lib/server/services/ui-mode-change-notice-service.ts
// #4313: 年齢帯 UI (uiMode) が自動で切り替わったことを、その子供の**次回ログイン**で
// 1 回だけ告知するための pending notice。
//
// root class (Issue #4313): 「ユーザー不在のバッチ処理がユーザーに見える状態を変更する際、
// 次回セッション開始時に差分を伝える機構が無い」。本 service がその機構の保存層を担う。
//
// 保存先は **settings KV** (`grace-period-service` / `default-child-service` と同じ前例)。
// `children` テーブルへの列追加は不可逆スキーマ変更のため採らない (Issue §未確定事項)。
// 削除 API が settings repo に無いため、既読化は空文字 upsert で表現する
// (auth-service のセッション破棄 / grace-period-service の復元と同じ扱い)。

import type { ChildId } from '$lib/domain/ids';
import type { UiMode } from '$lib/domain/validation/age-tier-types';
import { UI_MODES } from '$lib/domain/validation/age-tier-types';
import { getSetting, setSetting } from '$lib/server/db/settings-repo';
import { logger } from '$lib/server/logger';

const KEY_PREFIX = 'ui_mode_change_notice:';

export interface UiModeChangeNotice {
	from: UiMode;
	to: UiMode;
	/** 切替が起きた日 (YYYY-MM-DD, JST)。 */
	changedOn: string;
}

/** child ごとの settings KV キー。 */
export function uiModeChangeNoticeKey(childId: ChildId): string {
	return `${KEY_PREFIX}${childId}`;
}

function isUiMode(value: unknown): value is UiMode {
	return typeof value === 'string' && (UI_MODES as readonly string[]).includes(value);
}

/**
 * uiMode 切替を記録する。**from === to のときは何もしない** (同一モード内の年齢変化では
 * 告知しない — Issue AC「境界越えのみ」)。
 *
 * 告知の記録失敗で本処理 (年齢更新 / 誕生日ボーナス付与) を落とさないため、例外は
 * ここで握り潰して log に落とす。
 */
export async function recordUiModeChangeNotice(
	params: { childId: ChildId; from: UiMode; to: UiMode; changedOn: string },
	tenantId: string,
): Promise<void> {
	const { childId, from, to, changedOn } = params;
	if (from === to) return;

	try {
		await setSetting(
			uiModeChangeNoticeKey(childId),
			JSON.stringify({ from, to, changedOn } satisfies UiModeChangeNotice),
			tenantId,
		);
	} catch (e) {
		logger.error('[ui-mode-change-notice] failed to record notice', {
			service: 'ui-mode-change-notice',
			tenantId,
			error: e instanceof Error ? e.message : String(e),
			context: { childId, from, to },
		});
	}
}

/** 未読の notice を返す。未設定 / 既読 / 壊れた値はすべて null (画面を落とさない)。 */
export async function getUiModeChangeNotice(
	childId: ChildId,
	tenantId: string,
): Promise<UiModeChangeNotice | null> {
	let raw: string | undefined;
	try {
		raw = await getSetting(uiModeChangeNoticeKey(childId), tenantId);
	} catch (e) {
		logger.error('[ui-mode-change-notice] failed to read notice', {
			service: 'ui-mode-change-notice',
			tenantId,
			error: e instanceof Error ? e.message : String(e),
			context: { childId },
		});
		return null;
	}

	if (!raw) return null;

	try {
		const parsed = JSON.parse(raw) as Partial<UiModeChangeNotice>;
		if (!isUiMode(parsed.from) || !isUiMode(parsed.to)) return null;
		if (parsed.from === parsed.to) return null;
		return {
			from: parsed.from,
			to: parsed.to,
			changedOn: typeof parsed.changedOn === 'string' ? parsed.changedOn : '',
		};
	} catch {
		return null;
	}
}

/**
 * 既読にする。以後 `getUiModeChangeNotice` は null を返す (再表示しない)。
 * 同じ notice に対して何度呼んでも結果は同じ (冪等)。
 */
export async function clearUiModeChangeNotice(childId: ChildId, tenantId: string): Promise<void> {
	try {
		await setSetting(uiModeChangeNoticeKey(childId), '', tenantId);
	} catch (e) {
		logger.error('[ui-mode-change-notice] failed to clear notice', {
			service: 'ui-mode-change-notice',
			tenantId,
			error: e instanceof Error ? e.message : String(e),
			context: { childId },
		});
	}
}
