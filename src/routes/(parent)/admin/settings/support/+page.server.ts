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
	// #support-unify: 相談 intent の返信先 hint (「○○ に返信します」) でアカウントメールを提示するため、
	// cognito 認証時のみ識別子メールを渡す (local モードは null = フォームで明示入力を促す)。
	const accountEmail = locals.identity?.type === 'cognito' ? locals.identity.email : null;
	return { accountEmail };
};

// #support-unify: 1 フォーム統合の検証ロジック。intent (用件 2 軸) + 内容分類を併用する。
//   - intent='feedback' (感想・要望、返信不要): category = feature|bug|other を併記
//   - intent='consult'  (相談・困りごと、返信希望): category='consult' に固定 + 返信先必須 + childAge 任意
// 競合フォーム research: 単一フォーム + intent セレクタが支配的。返信先の必須/任意は intent でトグル。
// 純粋関数として抽出し、action の認知的複雑度を抑える (biome noExcessiveCognitiveComplexity)。
type ParsedFeedback = {
	intent: 'feedback' | 'consult';
	category: string;
	text: string;
	replyEmail: string;
	childAge: string;
};

function validateFeedbackForm(
	form: FormData,
	accountEmail: string,
): { error: string } | { ok: ParsedFeedback } {
	const intent = form.get('intent')?.toString() ?? 'feedback';
	const text = form.get('text')?.toString()?.trim() ?? '';
	const replyEmail = form.get('email')?.toString()?.trim() ?? '';
	const childAge = form.get('childAge')?.toString()?.trim() ?? '';
	const rawCategory = form.get('category')?.toString() ?? '';

	if (intent !== 'feedback' && intent !== 'consult') {
		return { error: 'ご用件の選択が不正です' };
	}
	if (!text || text.length === 0) {
		return { error: '内容を入力してください' };
	}
	if (text.length > 1000) {
		return { error: '1000文字以内で入力してください' };
	}
	if (intent === 'feedback' && !['feature', 'bug', 'other'].includes(rawCategory)) {
		return { error: 'カテゴリが不正です' };
	}
	if (replyEmail && (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(replyEmail) || replyEmail.length > 254)) {
		return { error: 'メールアドレスの形式が正しくありません' };
	}
	if (childAge && childAge.length > 100) {
		return { error: 'お子さまの年齢は100文字以内で入力してください' };
	}
	// 相談は返信が前提のため、返信先 (入力 or アカウントメール) を必須にする。
	if (intent === 'consult' && !replyEmail && !accountEmail) {
		return { error: '相談・困りごとは返信先メールアドレスを入力してください' };
	}

	// intent='consult' は category='consult' 固定。intent='feedback' のみ内容分類を要求する。
	const category = intent === 'consult' ? 'consult' : rawCategory;
	return { ok: { intent, category, text, replyEmail, childAge } };
}

export const actions = {
	sendFeedback: async ({ request, locals }) => {
		const tenantId = requireTenantId(locals);
		const form = await request.formData();
		const accountEmail = locals.identity?.type === 'cognito' ? locals.identity.email : '';

		const parsed = validateFeedbackForm(form, accountEmail);
		if ('error' in parsed) {
			return fail(400, { feedbackError: parsed.error });
		}
		const { intent, category, text, replyEmail, childAge } = parsed.ok;

		const categoryLabel = {
			feature: '機能要望',
			bug: 'バグ報告',
			other: 'その他',
			consult: '相談・困りごと',
		}[category as 'feature' | 'bug' | 'other' | 'consult'];
		const email = accountEmail || 'local-user';

		// InquiryRecord は childAge 列を持たないため、相談時のみ本文先頭に付記する
		// (3 repo schema 変更を避ける最小実装、ADR-0010)。
		const body = childAge ? `【お子さまの年齢】${childAge}\n\n${text}` : text;

		let inquiryId = '';
		try {
			inquiryId = await generateInquiryId();
			await saveInquiry({
				inquiryId,
				tenantId,
				email,
				replyEmail: replyEmail || null,
				category,
				body,
				status: 'open',
				createdAt: new Date().toISOString(),
			});
		} catch (err) {
			logger.error('Inquiry save failed', { error: String(err) });
		}

		notifyInquiry(tenantId, category, body, email, replyEmail || undefined, inquiryId).catch(
			() => {},
		);

		const confirmTo = replyEmail || (email !== 'local-user' ? email : '');
		if (confirmTo && inquiryId) {
			sendInquiryConfirmationEmail(confirmTo, inquiryId).catch(() => {});
		}

		logger.info(`Feedback received: [${categoryLabel}] ${inquiryId} from ${email} (${tenantId})`);
		// #2904: フィードバック送信数の計測 (FAB 撤去 reversible 化、research §5-5)
		trackBusinessEvent('feedback_submitted', { category, intent }, tenantId);
		return { feedbackSuccess: true, inquiryId, intent };
	},
} satisfies Actions;
