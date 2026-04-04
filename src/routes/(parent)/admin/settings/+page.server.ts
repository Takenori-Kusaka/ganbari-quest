import { CURRENCY_CODES } from '$lib/domain/point-display';
import type { CurrencyCode, PointUnitMode } from '$lib/domain/point-display';
import { requireTenantId } from '$lib/server/auth/factory';
import { generateInquiryId, saveInquiry } from '$lib/server/db/inquiry-repo';
import { getSetting, getSettings, setSetting } from '$lib/server/db/settings-repo';
import { logger } from '$lib/server/logger';
import { changePin } from '$lib/server/services/auth-service';
import { clearAllFamilyData, getDataSummary } from '$lib/server/services/data-service';
import { notifyInquiry } from '$lib/server/services/discord-notify-service';
import { sendInquiryConfirmationEmail } from '$lib/server/services/email-service';
import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	const tenantId = requireTenantId(locals);

	// 各データ取得を個別にエラーハンドリング（1つの失敗でページ全体が500にならないように）
	let dataSummary: Awaited<ReturnType<typeof getDataSummary>> = {
		children: 0,
		activityLogs: 0,
		pointLedger: 0,
		statuses: 0,
		achievements: 0,
		loginBonuses: 0,
		checklistTemplates: 0,
		voices: 0,
	};
	let decayIntensity = 'normal';

	let siblingMode = 'both';
	let siblingRankingEnabled = 'false';
	let notificationSettings = {
		remindersEnabled: true,
		reminderTime: '09:00',
		streakEnabled: true,
		achievementsEnabled: true,
		quietStart: '21:00',
		quietEnd: '07:00',
	};

	try {
		[dataSummary, decayIntensity, siblingMode, siblingRankingEnabled] = await Promise.all([
			getDataSummary(tenantId),
			getSetting('decay_intensity', tenantId).then((v) => v ?? 'normal'),
			getSetting('sibling_mode', tenantId).then((v) => v ?? 'both'),
			getSetting('sibling_ranking_enabled', tenantId).then((v) => v ?? 'false'),
		]);
		const ns = await getSettings(
			[
				'notification_reminders_enabled',
				'notification_reminder_time',
				'notification_streak_enabled',
				'notification_achievements_enabled',
				'notification_quiet_start',
				'notification_quiet_end',
			],
			tenantId,
		);
		notificationSettings = {
			remindersEnabled: ns.notification_reminders_enabled !== 'false',
			reminderTime: ns.notification_reminder_time ?? '09:00',
			streakEnabled: ns.notification_streak_enabled !== 'false',
			achievementsEnabled: ns.notification_achievements_enabled !== 'false',
			quietStart: ns.notification_quiet_start ?? '21:00',
			quietEnd: ns.notification_quiet_end ?? '07:00',
		};
	} catch (err) {
		logger.error('[settings] load failed, using defaults', { error: String(err) });
	}

	return {
		dataSummary,
		decayIntensity,
		siblingMode,
		siblingRankingEnabled,
		notificationSettings,
	};
};

export const actions = {
	changePin: async ({ request, locals }) => {
		const tenantId = requireTenantId(locals);
		const form = await request.formData();
		const currentPin = form.get('currentPin')?.toString() ?? '';
		const newPin = form.get('newPin')?.toString() ?? '';
		const confirmPin = form.get('confirmPin')?.toString() ?? '';

		if (!currentPin || !newPin || !confirmPin) {
			return fail(400, { error: 'すべてのフィールドを入力してください' });
		}

		if (newPin.length < 4 || newPin.length > 8) {
			return fail(400, { error: 'PINは4〜8桁で設定してください' });
		}

		if (!/^\d+$/.test(newPin)) {
			return fail(400, { error: 'PINは数字のみで設定してください' });
		}

		if (newPin !== confirmPin) {
			return fail(400, { error: '新しいPINが一致しません' });
		}

		const result = await changePin(currentPin, newPin, tenantId);
		if ('error' in result) {
			if (result.error === 'INVALID_CURRENT_PIN') {
				return fail(400, { error: '現在のPINが正しくありません' });
			}
			if (result.error === 'LOCKED_OUT') {
				return fail(429, { error: 'ロックアウト中です。しばらくお待ちください' });
			}
		}

		return { success: true };
	},
	updatePointSettings: async ({ request, locals }) => {
		const tenantId = requireTenantId(locals);
		const form = await request.formData();
		const mode = form.get('point_unit_mode')?.toString() ?? 'point';
		const currency = form.get('point_currency')?.toString() ?? 'JPY';
		const rateStr = form.get('point_rate')?.toString() ?? '1';

		// Validation
		if (mode !== 'point' && mode !== 'currency') {
			return fail(400, { pointError: 'モードが不正です' });
		}
		if (!CURRENCY_CODES.includes(currency as CurrencyCode)) {
			return fail(400, { pointError: '通貨コードが不正です' });
		}
		const rate = Number.parseFloat(rateStr);
		if (Number.isNaN(rate) || rate <= 0 || rate > 10000) {
			return fail(400, { pointError: 'レートは0より大きく10000以下で入力してください' });
		}

		await setSetting('point_unit_mode', mode as PointUnitMode, tenantId);
		await setSetting('point_currency', currency, tenantId);
		await setSetting('point_rate', String(rate), tenantId);

		return { pointSuccess: true };
	},
	sendFeedback: async ({ request, locals }) => {
		const tenantId = requireTenantId(locals);
		const form = await request.formData();
		const category = form.get('category')?.toString() ?? '';
		const text = form.get('text')?.toString()?.trim() ?? '';
		const replyEmail = form.get('email')?.toString()?.trim() ?? '';

		if (!text || text.length === 0) {
			return fail(400, { feedbackError: '内容を入力してください' });
		}
		if (text.length > 1000) {
			return fail(400, { feedbackError: '1000文字以内で入力してください' });
		}
		if (!['feature', 'bug', 'other'].includes(category)) {
			return fail(400, { feedbackError: 'カテゴリが不正です' });
		}
		if (replyEmail && (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(replyEmail) || replyEmail.length > 254)) {
			return fail(400, { feedbackError: 'メールアドレスの形式が正しくありません' });
		}

		const categoryLabel = { feature: '機能要望', bug: 'バグ報告', other: 'その他' }[category];
		const email = locals.identity?.type === 'cognito' ? locals.identity.email : 'local-user';

		// 受付番号を発番（ファクトリ経由で SQLite/DynamoDB 両対応）
		let inquiryId = '';
		try {
			inquiryId = await generateInquiryId();
			await saveInquiry({
				inquiryId,
				tenantId,
				email,
				replyEmail: replyEmail || null,
				category,
				body: text,
				status: 'open',
				createdAt: new Date().toISOString(),
			});
		} catch (err) {
			logger.error('Inquiry save failed', { error: String(err) });
		}

		// Discord Webhook に送信（受付番号入り）
		notifyInquiry(tenantId, category, text, email, replyEmail || undefined, inquiryId).catch(
			() => {},
		);

		// 受付確認メール送信（返信先メールがある場合）
		const confirmTo = replyEmail || (email !== 'local-user' ? email : '');
		if (confirmTo && inquiryId) {
			sendInquiryConfirmationEmail(confirmTo, inquiryId).catch(() => {});
		}

		logger.info(`Feedback received: [${categoryLabel}] ${inquiryId} from ${email} (${tenantId})`);
		return { feedbackSuccess: true, inquiryId };
	},
	updateSiblingSettings: async ({ request, locals }) => {
		const tenantId = requireTenantId(locals);
		const form = await request.formData();
		const mode = form.get('siblingMode')?.toString() ?? 'both';
		const rankingEnabled = form.has('siblingRankingEnabled') ? 'true' : 'false';

		if (!['cooperative', 'competitive', 'both'].includes(mode)) {
			return fail(400, { siblingError: '不正なモードです' });
		}

		await setSetting('sibling_mode', mode, tenantId);
		await setSetting('sibling_ranking_enabled', rankingEnabled, tenantId);

		return { siblingSuccess: true };
	},
	updateNotificationSettings: async ({ request, locals }) => {
		const tenantId = requireTenantId(locals);
		const form = await request.formData();

		const remindersEnabled = form.has('remindersEnabled') ? 'true' : 'false';
		const reminderTime = form.get('reminderTime')?.toString() ?? '09:00';
		const streakEnabled = form.has('streakEnabled') ? 'true' : 'false';
		const achievementsEnabled = form.has('achievementsEnabled') ? 'true' : 'false';
		const quietStart = form.get('quietStart')?.toString() ?? '21:00';
		const quietEnd = form.get('quietEnd')?.toString() ?? '07:00';

		// HH:MM format validation
		const timeRegex = /^\d{2}:\d{2}$/;
		if (!timeRegex.test(reminderTime) || !timeRegex.test(quietStart) || !timeRegex.test(quietEnd)) {
			return fail(400, { notificationError: '時刻の形式が不正です' });
		}

		await setSetting('notification_reminders_enabled', remindersEnabled, tenantId);
		await setSetting('notification_reminder_time', reminderTime, tenantId);
		await setSetting('notification_streak_enabled', streakEnabled, tenantId);
		await setSetting('notification_achievements_enabled', achievementsEnabled, tenantId);
		await setSetting('notification_quiet_start', quietStart, tenantId);
		await setSetting('notification_quiet_end', quietEnd, tenantId);

		return { notificationSuccess: true };
	},
	clearData: async ({ request, locals }) => {
		const tenantId = requireTenantId(locals);
		const form = await request.formData();
		const confirm = form.get('confirm')?.toString() ?? '';

		if (confirm !== '削除') {
			return fail(400, { clearError: '確認テキスト「削除」を入力してください' });
		}

		try {
			const result = await clearAllFamilyData(tenantId);
			logger.info(`[data-clear] テナント ${tenantId} のデータクリア完了（form action）`);
			return { clearSuccess: true, cleared: result.deleted };
		} catch (err) {
			logger.error('[data-clear] データクリア失敗', { error: String(err) });
			return fail(500, { clearError: 'データクリアに失敗しました' });
		}
	},
} satisfies Actions;
