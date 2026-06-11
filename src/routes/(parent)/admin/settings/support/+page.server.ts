// #2324 (EPIC #2319 ⑤): support グループ load + action。
// 旧 /admin/settings/+page.server.ts から sendFeedback action を移行。
// appInfo / founderInquiry は静的なため load 不要。

import { fail } from '@sveltejs/kit';
import { requireTenantId } from '$lib/server/auth/factory';
import { generateInquiryId, saveInquiry } from '$lib/server/db/inquiry-repo';
import { logger } from '$lib/server/logger';
import { trackBusinessEvent } from '$lib/server/services/analytics-service';
import { notifyInquiry } from '$lib/server/services/discord-notify-service';
import { sendInquiryConfirmationEmail } from '$lib/server/services/email-service';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	// #2904: FeedbackFab 撤去を reversible にする計測 (research §5-5 / ADR-0010 最小実装)。
	// 既存 analytics 機構 (DynamoDB provider、未設定環境では noop) に 1 イベント追加するのみで、
	// 撤去後 1-2 ヶ月で「support 到達 / 送信がゼロ化していないか」を確認できるようにする。
	trackBusinessEvent('support_page_view', undefined, locals.context?.tenantId);
	return {};
};

export const actions = {
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

		notifyInquiry(tenantId, category, text, email, replyEmail || undefined, inquiryId).catch(
			() => {},
		);

		const confirmTo = replyEmail || (email !== 'local-user' ? email : '');
		if (confirmTo && inquiryId) {
			sendInquiryConfirmationEmail(confirmTo, inquiryId).catch(() => {});
		}

		logger.info(`Feedback received: [${categoryLabel}] ${inquiryId} from ${email} (${tenantId})`);
		// #2904: フィードバック送信数の計測 (FAB 撤去 reversible 化、research §5-5)
		trackBusinessEvent('feedback_submitted', { category }, tenantId);
		return { feedbackSuccess: true, inquiryId };
	},
} satisfies Actions;
