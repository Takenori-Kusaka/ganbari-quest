// tests/unit/services/weekly-report-email.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockSend = vi.fn().mockResolvedValue({});
vi.mock('@aws-sdk/client-ses', () => ({
	SESClient: class {
		send = mockSend;
	},
	SendEmailCommand: class {
		params: unknown;
		constructor(params: unknown) {
			this.params = params;
		}
	},
}));

vi.mock('$env/dynamic/private', () => ({
	env: {
		SES_SENDER_EMAIL: 'noreply@ganbari-quest.com',
		SES_CONFIG_SET_NAME: 'ganbari-quest-config',
	},
}));

vi.mock('$lib/server/logger', () => ({
	logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { sendWeeklyReportEmail } from '$lib/server/services/email-service';
import type { WeeklyReportData } from '$lib/server/services/email-service';

describe('sendWeeklyReportEmail', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockSend.mockResolvedValue({});
		process.env.AUTH_MODE = 'cognito';
	});

	it('週次レポートメールを送信する', async () => {
		const report: WeeklyReportData = {
			childName: '太郎',
			dateRange: '3/22〜3/28',
			categories: [
				{ name: 'うんどう', count: 5, diff: 2 },
				{ name: 'べんきょう', count: 3, diff: 0 },
				{ name: 'せいかつ', count: 7, diff: -1 },
			],
			streak: 12,
			pointsEarned: 180,
			totalPoints: 1420,
			newAchievements: ['1週間皆勤'],
		};
		const result = await sendWeeklyReportEmail('parent@example.com', report);
		expect(result).toBe(true);
		expect(mockSend).toHaveBeenCalledTimes(1);
	});

	it('実績なしのレポートも送信できる', async () => {
		const report: WeeklyReportData = {
			childName: '花子',
			dateRange: '3/22〜3/28',
			categories: [{ name: 'うんどう', count: 2, diff: -3 }],
			streak: 0,
			pointsEarned: 20,
			totalPoints: 100,
			newAchievements: [],
		};
		const result = await sendWeeklyReportEmail('parent@example.com', report);
		expect(result).toBe(true);
	});
});
