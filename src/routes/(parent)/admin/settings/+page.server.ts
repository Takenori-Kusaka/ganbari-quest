import { env } from '$env/dynamic/private';
import { CURRENCY_CODES } from '$lib/domain/point-display';
import type { CurrencyCode, PointUnitMode } from '$lib/domain/point-display';
import { requireTenantId } from '$lib/server/auth/factory';
import { setSetting } from '$lib/server/db/settings-repo';
import { logger } from '$lib/server/logger';
import { changePin } from '$lib/server/services/auth-service';
import { fail } from '@sveltejs/kit';
import type { Actions } from './$types';

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

		if (!text || text.length === 0) {
			return fail(400, { feedbackError: '内容を入力してください' });
		}
		if (text.length > 1000) {
			return fail(400, { feedbackError: '1000文字以内で入力してください' });
		}
		if (!['feature', 'bug', 'other'].includes(category)) {
			return fail(400, { feedbackError: 'カテゴリが不正です' });
		}

		const categoryLabel = { feature: '機能要望', bug: 'バグ報告', other: 'その他' }[category];
		const email = locals.identity?.type === 'cognito' ? locals.identity.email : 'local-user';

		// Discord Webhook に送信（設定されている場合）
		const webhookUrl = env.FEEDBACK_DISCORD_WEBHOOK_URL;
		if (webhookUrl) {
			try {
				await fetch(webhookUrl, {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({
						embeds: [
							{
								title: `📬 ${categoryLabel}`,
								description: text,
								color: category === 'bug' ? 0xff4444 : 0x4a90d9,
								fields: [
									{ name: 'テナント', value: tenantId, inline: true },
									{ name: '送信者', value: email, inline: true },
								],
								timestamp: new Date().toISOString(),
							},
						],
					}),
				});
			} catch (e) {
				logger.error('Discord webhook failed', { error: String(e) });
			}
		}

		logger.info(`Feedback received: [${categoryLabel}] from ${email} (${tenantId})`);
		return { feedbackSuccess: true };
	},
} satisfies Actions;
