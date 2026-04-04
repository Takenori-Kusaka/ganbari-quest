import { fail } from '@sveltejs/kit';
import { requireTenantId } from '$lib/server/auth/factory';
import { getSettings, setSetting } from '$lib/server/db/settings-repo';
import { logger } from '$lib/server/logger';
import { getAllChildren } from '$lib/server/services/child-service';
import { computeAllChildrenDetailedReport } from '$lib/server/services/report-service';
import {
	getRankingTrend,
	getWeeklyRanking,
	isRankingEnabled,
} from '$lib/server/services/sibling-ranking-service';
import { generateReportsForChildren } from '$lib/server/services/weekly-report-service';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, url, parent }) => {
	const tenantId = requireTenantId(locals);

	// 月パラメータ（デフォルト: 今月）
	const now = new Date();
	const defaultMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
	const selectedMonth = url.searchParams.get('month') ?? defaultMonth;

	const [children, reportSettings] = await Promise.all([
		getAllChildren(tenantId),
		getSettings(['weekly_report_enabled', 'weekly_report_day'], tenantId),
	]);

	const childList = children.map((c) => ({ id: c.id, nickname: c.nickname }));

	// ランキングデータ取得（ファミリープラン用、#373）
	const parentData = await parent();
	const isFamily = parentData.planTier === 'family';

	let rankingData: Awaited<ReturnType<typeof getWeeklyRanking>> | null = null;
	let trendData: Awaited<ReturnType<typeof getRankingTrend>> | null = null;
	if (isFamily) {
		try {
			const rankingOn = await isRankingEnabled(tenantId);
			if (rankingOn && children.length > 1) {
				[rankingData, trendData] = await Promise.all([
					getWeeklyRanking(tenantId),
					getRankingTrend(tenantId, 4),
				]);
			}
		} catch {
			// ランキング取得失敗は無視
		}
	}

	// 週次 + 月次レポートを並行取得
	let monthlyReports: Awaited<ReturnType<typeof computeAllChildrenDetailedReport>> = [];
	try {
		const [weeklyReports, monthly] = await Promise.all([
			generateReportsForChildren(childList, tenantId),
			computeAllChildrenDetailedReport(tenantId, selectedMonth),
		]);
		monthlyReports = monthly;

		// 先月のデータも取得（比較用）
		const [prevY, prevM] = getPrevMonth(selectedMonth);
		const prevMonthStr = `${prevY}-${String(prevM).padStart(2, '0')}`;
		let prevMonthlyReports: typeof monthlyReports = [];
		try {
			prevMonthlyReports = await computeAllChildrenDetailedReport(tenantId, prevMonthStr);
		} catch {
			// 先月データなしでも継続
		}

		return {
			reports: weeklyReports,
			monthlyReports,
			prevMonthlyReports,
			selectedMonth,
			settings: {
				enabled: reportSettings.weekly_report_enabled !== '0',
				day: reportSettings.weekly_report_day ?? 'monday',
			},
			rankingData,
			trendData,
			isFamily,
		};
	} catch (e) {
		logger.error('月次レポート取得エラー', { context: { error: String(e) } });
		const weeklyReports = await generateReportsForChildren(childList, tenantId);
		return {
			reports: weeklyReports,
			monthlyReports: [],
			prevMonthlyReports: [],
			selectedMonth,
			settings: {
				enabled: reportSettings.weekly_report_enabled !== '0',
				day: reportSettings.weekly_report_day ?? 'monday',
			},
			rankingData: null,
			trendData: null,
			isFamily,
		};
	}
};

function getPrevMonth(yearMonth: string): [number, number] {
	const parts = yearMonth.split('-').map(Number);
	const y = parts[0] ?? 2026;
	const m = parts[1] ?? 1;
	if (m === 1) return [y - 1, 12];
	return [y, m - 1];
}

export const actions: Actions = {
	updateSettings: async ({ request, locals }) => {
		const tenantId = requireTenantId(locals);
		const fd = await request.formData();
		const enabled = fd.get('enabled') === 'on' ? '1' : '0';
		const day = String(fd.get('day') ?? 'monday');

		const validDays = [
			'monday',
			'tuesday',
			'wednesday',
			'thursday',
			'friday',
			'saturday',
			'sunday',
		];
		if (!validDays.includes(day)) {
			return fail(400, { error: '無効な曜日です' });
		}

		await setSetting('weekly_report_enabled', enabled, tenantId);
		await setSetting('weekly_report_day', day, tenantId);

		return { settingsUpdated: true };
	},
};
