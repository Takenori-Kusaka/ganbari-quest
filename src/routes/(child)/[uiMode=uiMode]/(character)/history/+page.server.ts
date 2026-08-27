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
	const filtered = applyRetentionFilter(planTier, dateRange);

	// 4 種類のデータを並列取得 (Promise.all、AC2/AC3/AC4)
	// 取得失敗時はそのタブのみ空配列フォールバック (history 全体は守る)
	const [activityResult, achievementsResult, purchasesResult, valuePreviewResult] =
		await Promise.allSettled([
			getActivityLogs(child.id, tenantId, filtered),
			getChildChallengeRecords(child.id, tenantId),
			getRedemptionRequestsForChild(child.id, tenantId),
			getTenantValuePreview(tenantId),
		]);

	const activityData =
		activityResult.status === 'fulfilled'
			? activityResult.value
			: { logs: [], summary: { totalCount: 0, totalPoints: 0, byCategory: {} } };

	// #4688: 受取済み (rewardClaimed) も含む達成履歴。claim した瞬間に消えないこと (F1)
	const achievements = achievementsResult.status === 'fulfilled' ? achievementsResult.value : [];

	// #4632: 交換履歴は「いつ・何を・いくらで交換したか」を出す画面。
	// 申請時点 snapshot (title / icon / points) と個数を渡さないと、UI は日付をタイトル代わりに
	// 出しアイコンを 🎁 固定にするしかなく、何を交換したか判別できない。
	const purchases =
		purchasesResult.status === 'fulfilled'
			? purchasesResult.value.map((r) => ({
					id: r.id,
					rewardId: r.rewardId,
					rewardTitle: r.rewardTitle,
					rewardIcon: r.rewardIcon,
					rewardPoints: r.rewardPoints,
					quantity: r.quantity,
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
