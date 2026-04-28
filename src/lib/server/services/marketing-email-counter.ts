// src/lib/server/services/marketing-email-counter.ts
// #1601 (ADR-0023 §3.3): マーケティングメール接触頻度カウンタ。
//
// 1 テナントあたり「年 6 回」を上限とするため、settings KV に
// `marketing_email_count_<YEAR>` キーで送信回数を記録する。
//
// 対象に含まれるもの (枠を消費):
//   - 期限切れ前リマインド (renewal reminder)
//   - 休眠復帰メール (dormant reactivation)
//
// 対象に含まれないもの (システム通知扱い、枠外):
//   - トライアル終了通知 (trial-notification cron) — 既存系統で別管理
//   - サインアップ確認 / 解約受付 / メンバー参加通知などのトランザクションメール
//   - ライセンスキー配布
//
// 設計判断:
//   - 年単位 (UTC YYYY) で管理する。年跨ぎでリセット。
//   - 数値は文字列として保存し、parseInt でデコード (settings KV の型に合わせる)。
//   - DynamoDB の atomic increment を使わず Get → Put にしているのは、
//     cron は 1 日 1 回で同テナントへの重複呼び出しが起きにくく、
//     また誤差が ±1 件発生しても上限超過には繋がらない (上限は次回送信判定で再評価)。

import { getRepos } from '$lib/server/db/factory';
import { logger } from '$lib/server/logger';

// ============================================================
// Constants
// ============================================================

/**
 * ADR-0023 §3.3 に定める年間マーケティングメール上限。
 * 期限切れ前リマインド (3 回) + 休眠復帰メール (1 回) でも余裕がある設定。
 */
export const MARKETING_EMAIL_YEARLY_LIMIT = 6;

const SETTINGS_KEY_PREFIX = 'marketing_email_count_';

// ============================================================
// Public API
// ============================================================

/** YYYY (UTC 4 桁) を返す。年跨ぎ判定の SSOT。 */
export function getCurrentYearKey(now: Date = new Date()): string {
	return String(now.getUTCFullYear());
}

/** 当年のキー名 (settings KV のキー)。 */
function settingKey(year: string): string {
	return `${SETTINGS_KEY_PREFIX}${year}`;
}

/**
 * テナントの当年送信回数を取得する。未送信なら 0。
 */
export async function getMarketingEmailCount(
	tenantId: string,
	year: string = getCurrentYearKey(),
): Promise<number> {
	const repos = getRepos();
	const raw = await repos.settings.getSetting(settingKey(year), tenantId);
	if (!raw) return 0;
	const parsed = Number.parseInt(raw, 10);
	if (Number.isNaN(parsed) || parsed < 0) {
		logger.warn('[marketing-email-counter] invalid stored count', {
			context: { tenantId, year, raw },
		});
		return 0;
	}
	return parsed;
}

/**
 * 当年の送信回数を 1 増やす。返り値は increment 後の値。
 *
 * NOTE: Get → Put の race を避ける目的の atomic 操作は使っていない。
 * 詳細は本ファイル冒頭の設計判断メモ参照。
 */
export async function incrementMarketingEmailCount(
	tenantId: string,
	year: string = getCurrentYearKey(),
): Promise<number> {
	const repos = getRepos();
	const current = await getMarketingEmailCount(tenantId, year);
	const next = current + 1;
	await repos.settings.setSetting(settingKey(year), String(next), tenantId);
	return next;
}

/**
 * このテナントに対して当年もう 1 通送れるかを判定する。
 *
 * @returns true なら送信可、false なら年間上限到達のため send をスキップすべき。
 */
export async function canSendMarketingEmail(
	tenantId: string,
	year: string = getCurrentYearKey(),
): Promise<boolean> {
	const count = await getMarketingEmailCount(tenantId, year);
	return count < MARKETING_EMAIL_YEARLY_LIMIT;
}
