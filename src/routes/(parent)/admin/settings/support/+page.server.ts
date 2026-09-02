// #2324 (EPIC #2319 ⑤): support グループ load + action。
// 旧 /admin/settings/+page.server.ts から sendFeedback action を移行。
// appInfo / founderInquiry は静的なため load 不要。

import { fail } from '@sveltejs/kit';
import {
	type BackupHealthVerdict,
	evaluateBackupHealth,
	isBackupNotificationConfigured,
} from '$lib/domain/backup-health';
// #4512: validation / 通知本文の文言は labels SSOT 経由 (docs/DESIGN.md §6 / ADR-0045)
import { SETTINGS_LABELS } from '$lib/domain/labels';
import { getEnv } from '$lib/runtime/env';
import { requireTenantId } from '$lib/server/auth/factory';
import { generateInquiryId, saveInquiry } from '$lib/server/db/inquiry-repo';
import { logger } from '$lib/server/logger';
import { notifyInquiry } from '$lib/server/services/discord-notify-service';
import { sendInquiryConfirmationEmail } from '$lib/server/services/email-service';
import { getPgliteBackupStatus } from '$lib/server/services/pglite-backup-service';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	// #support-unify: 相談 intent の返信先 hint (「○○ に返信します」) でアカウントメールを提示するため、
	// cognito 認証時のみ識別子メールを渡す (local モードは null = フォームで明示入力を促す)。
	const accountEmail = locals.identity?.type === 'cognito' ? locals.identity.email : null;

	// #4087 (E3 / EPIC #4119): バックアップ状態を家族 (非エンジニア) が見られる場所に出す。
	//
	// NUC セルフホスト (DATA_SOURCE=pglite) のときだけ載せる。クラウド (dsql) のバックアップは
	// AWS Backup が担っており本画面の対象外で、載せると「自分で見るべきもの」を誤らせる。
	const backupHealth = getEnv().DATA_SOURCE === 'pglite' ? await readBackupHealth() : null;

	return { accountEmail, backupHealth };
};

/**
 * バックアップ状態を判定して返す。**画面を落とさない**ことを優先する。
 *
 * 状態ファイルが読めないこと自体はサポート画面の主目的 (相談フォーム) と無関係なので、
 * ここで throw すると「バックアップ状態が読めないせいで相談できない」という逆転が起きる。
 */
async function readBackupHealth(): Promise<BackupHealthVerdict | null> {
	try {
		const status = await getPgliteBackupStatus();
		return evaluateBackupHealth(
			{
				lastSuccessAt: status.lastSuccessAt,
				consecutiveFailures: status.consecutiveFailures,
				lastFailureMessage: status.lastFailureMessage,
				notificationConfigured: isBackupNotificationConfigured(process.env),
				// #4162: guard 発火中は「取得は成功 / ローテーションが保留」。
				// 欠損時 0 扱いで旧 status file と後方互換。
				rotationPendingCount: status.rotationPendingCount ?? 0,
				// #4162: 放置の長さで critical へ昇格させるために渡す (guard は自己解除しない)。
				rotationBlockedSince: status.rotationBlockedSince ?? null,
			},
			new Date(),
		);
	} catch {
		return null;
	}
}

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
		return { error: SETTINGS_LABELS.feedbackInvalidIntentError };
	}
	if (!text || text.length === 0) {
		return { error: SETTINGS_LABELS.feedbackContentRequiredError };
	}
	if (text.length > 1000) {
		return { error: SETTINGS_LABELS.feedbackContentTooLongError };
	}
	if (intent === 'feedback' && !['feature', 'bug', 'other'].includes(rawCategory)) {
		return { error: SETTINGS_LABELS.feedbackInvalidCategoryError };
	}
	if (replyEmail && (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(replyEmail) || replyEmail.length > 254)) {
		return { error: SETTINGS_LABELS.feedbackInvalidEmailError };
	}
	if (childAge && childAge.length > 100) {
		return { error: SETTINGS_LABELS.feedbackChildAgeTooLongError };
	}
	// 相談は返信が前提のため、返信先 (入力 or アカウントメール) を必須にする。
	if (intent === 'consult' && !replyEmail && !accountEmail) {
		return { error: SETTINGS_LABELS.feedbackConsultReplyRequiredError };
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
			feature: SETTINGS_LABELS.feedbackCategoryFeature,
			bug: SETTINGS_LABELS.feedbackCategoryBug,
			other: SETTINGS_LABELS.feedbackCategoryOther,
			consult: SETTINGS_LABELS.feedbackCategoryConsult,
		}[category as 'feature' | 'bug' | 'other' | 'consult'];
		const email = accountEmail || 'local-user';

		// InquiryRecord は childAge 列を持たないため、相談時のみ本文先頭に付記する
		// (3 repo schema 変更を避ける最小実装、ADR-0010)。
		const body = childAge
			? `${SETTINGS_LABELS.feedbackChildAgeBodyPrefix(childAge)}\n\n${text}`
			: text;

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
			// #3210: save 失敗を握り潰して偽成功を返さない (data-loss + 偽成功の根治)。
			// Discord は founder の実 inbox なので best-effort backup として試行しつつ、
			// ユーザーには明示エラーを返し「届いた」と誤認させない (feedback / consult 双方)。
			// #4197: 通知 payload に tenantId / メールアドレスを載せない (#4174 Q3 の PO 決裁)。
			// save 失敗時もそれは同じ — ここでユーザーには明示エラーを返しており (下)、
			// 「届いたのに誰からか分からない」状態にはならない。
			notifyInquiry(category, body, inquiryId).catch(() => {});
			return fail(500, {
				feedbackError: SETTINGS_LABELS.feedbackSendFailedError,
			});
		}

		notifyInquiry(category, body, inquiryId).catch(() => {});

		const confirmTo = replyEmail || (email !== 'local-user' ? email : '');
		if (confirmTo && inquiryId) {
			sendInquiryConfirmationEmail(confirmTo, inquiryId).catch(() => {});
		}

		logger.info(`Feedback received: [${categoryLabel}] ${inquiryId} from ${email} (${tenantId})`);
		return { feedbackSuccess: true, inquiryId, intent };
	},
} satisfies Actions;
