import { AUTH_LICENSE_STATUS } from '$lib/domain/constants/auth-license-status';
import { todayDateJST, toJSTDateString } from '$lib/domain/date-utils';
import { requireTenantId } from '$lib/server/auth/factory';
import { getActivityLogs } from '$lib/server/services/activity-log-service';
// #2458-B: sibling-challenge-service (legacy) → child-challenge-service (per-child instance) 移行
// #4688: 達成タブは「受取済みを含む履歴」を読む (active + 未請求だけの一覧を流用しない)
import { getChildChallengeRecords } from '$lib/server/services/child-challenge-service';
import { applyRetentionFilter, resolveFullPlanTier } from '$lib/server/services/plan-limit-service';
import { getRedemptionRequestsForChild } from '$lib/server/services/reward-redemption-service';
import { getTenantValuePreview } from '$lib/server/services/value-preview-service';
import type { PageServerLoad } from './$types';

function getDateRange(period: string): { from: string; to: string } {
	const to = todayDateJST();

	if (period === 'today') {
		return { from: to, to };
	}

	if (period === 'month') {
		const from = new Date();
		from.setDate(from.getDate() - 30);
		return { from: toJSTDateString(from), to };
	}

	// Default: week
	const from = new Date();
	from.setDate(from.getDate() - 7);
	return { from: toJSTDateString(from), to };
}

const VALID_KINDS = ['activities', 'achievements', 'purchases', 'milestones'] as const;
type HistoryKind = (typeof VALID_KINDS)[number];

function parseKind(raw: string | null): HistoryKind {
	if (raw && (VALID_KINDS as readonly string[]).includes(raw)) {
		return raw as HistoryKind;
	}
	return 'activities';
}

export const load: PageServerLoad = async ({ parent, url, locals }) => {
	const tenantId = requireTenantId(locals);
	const { child } = await parent();
	if (!child) {
		return {
			logs: [],
			summary: { totalCount: 0, totalPoints: 0, byCategory: {} },
			achievements: [],
			purchases: [],
			milestones: [],
			period: 'week',
			kind: 'activities' as HistoryKind,
		};
	}

	const period = url.searchParams.get('period') ?? 'week';
	const kind = parseKind(url.searchParams.get('kind'));
	const dateRange = getDateRange(period);
	const planTier = await resolveFullPlanTier(
		tenantId,
		locals.context?.licenseStatus ?? AUTH_LICENSE_STATUS.NONE,
		locals.context?.plan,
	);
	// 活動タブだけが期間タブ (today / week / month) を持つ。期間タブは +page.svelte で
	// activities パネル内にのみ描画され、`handleKindChange` も activities のときしか period を
	// 引き継がない。
	const filtered = applyRetentionFilter(planTier, dateRange);
	// 達成 / 交換タブは全期間の履歴を出すタブなので、期間ではなく**保持期間 cutoff だけ**を
	// 適用する (ADR-0049 表示フィルタ層)。ここで `filtered` を渡すと「直近 7 日の達成しか
	// 出ない」別の後退になる。
	const retention = applyRetentionFilter(planTier, {});

	// 4 種類のデータを並列取得 (Promise.all、AC2/AC3/AC4)
	// 取得失敗時はそのタブのみ空配列フォールバック (history 全体は守る)
	//
	// 保持期間 (ADR-0049) の適用方針:
	//   activities / achievements / purchases = event 行なので絞る (前 3 者は range 必須引数)
	//   milestones                            = **集計値なので絞らない** (ADR-0049 §6)
	// `getTenantValuePreview` だけ range を取らないのは実装漏れではない。マイルストーンは
	// `MILESTONES` 定義から導出される「がんばりの証」で、保存期間の影響を受けない集計値として
	// 恒久保持する (同 §6 が report_daily_summaries 等の集計に対して定めた扱いと同じ)。
	const [activityResult, achievementsResult, purchasesResult, valuePreviewResult] =
		await Promise.allSettled([
			getActivityLogs(child.id, tenantId, filtered),
			getChildChallengeRecords(child.id, tenantId, retention),
			getRedemptionRequestsForChild(child.id, tenantId, retention),
			getTenantValuePreview(tenantId),
		]);

	const activityData =
		activityResult.status === 'fulfilled'
			? activityResult.value
			: { logs: [], summary: { totalCount: 0, totalPoints: 0, byCategory: {} } };

	// #4688: 受取済み (rewardClaimed) も含む達成履歴。claim した瞬間に消えないこと (F1)
	const achievements = achievementsResult.status === 'fulfilled' ? achievementsResult.value : [];

	const purchases =
		purchasesResult.status === 'fulfilled'
			? purchasesResult.value.map((r) => ({
					id: r.id,
					rewardId: r.rewardId,
					status: r.status,
					requestedAt: r.requestedAt,
					resolvedAt: r.resolvedAt,
					parentNote: r.parentNote,
				}))
			: [];

	const milestones =
		valuePreviewResult.status === 'fulfilled'
			? (valuePreviewResult.value.children.find((c) => c.childId === child.id)?.milestones ?? [])
					.filter((m) => m.achieved)
					.sort((a, b) => {
						const aDate = a.achievedAt ?? '';
						const bDate = b.achievedAt ?? '';
						return bDate.localeCompare(aDate);
					})
			: [];

	return {
		logs: activityData.logs,
		summary: activityData.summary,
		achievements,
		purchases,
		milestones,
		period,
		kind,
	};
};
