// src/lib/server/services/habit-certificate-notice-service.ts
//
// #4261 ③ — 月間の習慣化証明書 (#4172) で増えた残高の理由を、**Push が届かない家庭にも**
// 伝えるための pending 保持。
//
// ## 何が壊れていたか
//
// #4172 AC11' は「親のみに通知し、子への演出は出さない」を選んだ (子に演出を出すと子の中で
// 完結し、親が「1 ヶ月続いたね」と言う前にアプリが言ってしまう)。経路は Web Push のみで、
// `/api/v1/notifications/subscribe` が child role を 403 で拒否する (#1593) ため親のみは
// 構造的に保証されている。**ところが Push を許可していない家庭では 1 通も届かない。**
// 子から見ると残高だけが 50pt 増え、理由を知る手段が無い。
// **仕組みが動いていても伝わっていなければ、褒める機構は成立していない** (PO 決裁 2026-08-06)。
//
// ## なぜ「pending を残して次回起動で 1 回だけ」なのか
//
// 発行は活動記録の副作用として起きるため、子が画面を見ていないタイミングを含む。
// バッチ的に起きた変化を次のセッション開始時に 1 回だけ伝える形は #4313
// (`ui-mode-change-notice-service`) と同じ root class で、**その流儀に揃える**
// (観測・保存の形を 2 つ持たない)。
//
// ADR-0012 (anti-engagement) との両立条件 (PO 決裁):
//   - **1 回だけ。** 既読で消え、再表示しない → 本 service の clear が担う
//   - **演出を足さない** (紙吹雪・音・連続ダイアログ不可) → 表示側の静的バナーが担う
//   - **閉じる操作を挟まない** → 表示した時点で既読化する (子に × を押させない)
//
// ## 置き場所が settings KV である理由
//
// `children` への列追加は不可逆なスキーマ変更で、1 行 1 子の一時的な未読フラグには重い。
// `grace-period-service` / `ui-mode-change-notice-service` と同じ settings KV の前例に従う。
// settings repo に削除 API が無いため、**既読は空文字 upsert で表す** (前例と同じ)。

import type { ChildId } from '$lib/domain/ids';
// 型の SSOT は client 側に置く (client から `$lib/server/**` は import できないため)。
import type { HabitCertificateNotice } from '$lib/features/child-home/habit-certificate-notice';
import { getRepos } from '$lib/server/db/factory';

export type { HabitCertificateNotice };

const KEY_PREFIX = 'habit_certificate_notice:';

/** 子ごとに 1 本。溜めずに最後の達成だけを持つ (連続表示しない、ADR-0012)。 */
export function habitCertificateNoticeKey(childId: ChildId): string {
	return `${KEY_PREFIX}${childId}`;
}

const YEAR_MONTH_PATTERN = /^\d{4}-\d{2}$/;

/** 月間習慣化の達成を記録する。既存の pending は上書きする (最後の達成だけを伝える)。 */
export async function recordHabitCertificateNotice(
	notice: HabitCertificateNotice & { childId: ChildId },
	tenantId: string,
): Promise<void> {
	const { childId, yearMonth, points } = notice;
	const repos = getRepos();
	await repos.settings.setSetting(
		habitCertificateNoticeKey(childId),
		JSON.stringify({ yearMonth, points }),
		tenantId,
	);
}

/**
 * 未読の告知を読む。
 *
 * **壊れた値はすべて null に倒す。** 子供画面のホームは全機能の入口であり、
 * 告知という付帯物のために画面全体が落ちてはならない。
 */
export async function getHabitCertificateNotice(
	childId: ChildId,
	tenantId: string,
): Promise<HabitCertificateNotice | null> {
	const repos = getRepos();
	const raw = await repos.settings.getSetting(habitCertificateNoticeKey(childId), tenantId);
	if (!raw) return null;

	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return null;
	}
	if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;

	const { yearMonth, points } = parsed as Record<string, unknown>;
	if (typeof yearMonth !== 'string' || !YEAR_MONTH_PATTERN.test(yearMonth)) return null;
	if (typeof points !== 'number' || !Number.isFinite(points) || points < 0) return null;

	return { yearMonth, points };
}

/** 既読にする。settings repo に削除 API が無いため空文字 upsert で表す。 */
export async function clearHabitCertificateNotice(
	childId: ChildId,
	tenantId: string,
): Promise<void> {
	const repos = getRepos();
	await repos.settings.setSetting(habitCertificateNoticeKey(childId), '', tenantId);
}
