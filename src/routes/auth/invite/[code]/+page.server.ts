// /auth/invite/[code] — 招待リンクランディングページ (#0129)
// 招待コードを検証し、ログイン/サインアップへ誘導する

import { fail, redirect } from '@sveltejs/kit';
import {
	AUTH_INVITE_LABELS,
	getInviteJoinBlockedMessage,
	INVITE_RELOCATION_LABELS,
} from '$lib/domain/labels';
import { CANCEL_TERMS } from '$lib/domain/terms';
import {
	CONTEXT_COOKIE_NAME,
	INVITE_COOKIE_MAX_AGE_SECONDS,
	INVITE_COOKIE_NAME,
} from '$lib/domain/validation/auth';
import { requireAppUserId } from '$lib/server/auth/guards';
import { getInvite } from '$lib/server/services/invite-service';
import {
	checkRelocationEligibility,
	relocateToInvitedTenant,
} from '$lib/server/services/tenant-relocation-service';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, cookies, locals }) => {
	const { code } = params;

	// 招待コードの有効性チェック
	const invite = await getInvite(code);
	if (!invite) {
		return {
			valid: false as const,
			relocation: false as const,
			error: AUTH_INVITE_LABELS.invalidLink,
			errorDesc: AUTH_INVITE_LABELS.invalidLinkDesc,
			// 次アクションは「招待の再発行を依頼する」であり、ログアウトでは解決しない
			sessionActive: false,
		};
	}

	// 既にログイン済みのユーザー → テナント所属チェック (#0203)
	if (locals.identity && locals.identity.type === 'cognito') {
		// #3555 ①: 宛先 email 束縛付き招待 (#3549 判断2) は、受諾処理に入る前に
		// ログイン中 user の email と照合し、不一致なら理由 + 次アクションを案内する
		// (受諾時の INVITE_EMAIL_MISMATCH で無説明 dead-end になるのを防ぐ)。
		// 照合は invite-service と同じ case-insensitive exact 一致。
		if (invite.email && invite.email.toLowerCase() !== locals.identity.email.trim().toLowerCase()) {
			cookies.delete(INVITE_COOKIE_NAME, { path: '/' });
			return {
				valid: false as const,
				relocation: false as const,
				error: AUTH_INVITE_LABELS.emailMismatch,
				errorDesc: AUTH_INVITE_LABELS.emailMismatchDesc,
				// ログイン中なので、別アカウントで受け直すためのログアウト導線を出す
				sessionActive: true,
			};
		}
		// #4643: 所属の有無は解決済の context で判定する。旧実装は IdP の sub で
		// findUserTenants を引いており、所属済でも必ず 0 件になって「別グループ所属」の
		// 警告が一度も出ず、そのまま招待 Cookie を積んでいた。
		if (locals.context) {
			// 既にテナント所属 → 招待 Cookie を保存しない (残すと別経路で無断合流しうる)
			cookies.delete(INVITE_COOKIE_NAME, { path: '/' });

			// #4642: 自分ひとりの家族グループの owner なら「引っ越し合流」を選べる。
			// 誤って自分の家族グループを作ってしまった人が、後から正しい招待に合流する唯一の出口。
			// **不可逆操作**なので、ここでは確認画面を出すだけで何も実行しない。
			const eligibility = await checkRelocationEligibility(locals.context.userId ?? '');
			if (eligibility.blockedReason === null) {
				return {
					valid: false as const,
					relocation: true as const,
					error: INVITE_RELOCATION_LABELS.title,
					errorDesc: INVITE_RELOCATION_LABELS.lead,
					sessionActive: true,
				};
			}

			// #4049: errorDesc を undefined にすると画面が invalidLinkDesc (再発行依頼) に
			// フォールバックし、本経路で必要な「ログアウト → 招待リンク再タップ」案内が消える。
			// 共有端末で親が子の招待リンクを踏む標準ユースケースの唯一の出口なので専用文言を返す。
			// #4642: 引っ越せない理由 (他メンバーが居る / owner でない) は、その理由ごとの
			// 次アクションを出す (「ログアウトして踏み直す」では解決しないため)。
			const errorDesc =
				eligibility.blockedReason === 'HAS_OTHER_MEMBERS'
					? INVITE_RELOCATION_LABELS.blockedHasOtherMembers
					: eligibility.blockedReason === 'NOT_OWNER'
						? INVITE_RELOCATION_LABELS.blockedNotOwner
						: AUTH_INVITE_LABELS.alreadyInTenantDesc;
			return {
				valid: false as const,
				relocation: false as const,
				error: AUTH_INVITE_LABELS.alreadyInTenant,
				errorDesc,
				sessionActive: true,
			};
		}

		// テナント未所属 → 招待処理をトリガー
		cookies.set(INVITE_COOKIE_NAME, code, {
			path: '/',
			httpOnly: true,
			sameSite: 'lax',
			secure: true,
			// #4636: 招待の有効期限 (7 日) まで有効。10 分だとメール確認を挟むだけで cookie が先に
			// 消え、招待を踏んだのに新規家族グループが作られる経路になっていた。
			maxAge: INVITE_COOKIE_MAX_AGE_SECONDS,
		});
		cookies.delete('context_token', { path: '/' });
		redirect(302, '/admin');
	}

	// 未ログインユーザー → Cookie に保存してログイン/サインアップへ誘導
	cookies.set(INVITE_COOKIE_NAME, code, {
		path: '/',
		httpOnly: true,
		sameSite: 'lax',
		secure: true,
		// #4636: 招待の有効期限 (7 日) まで有効。10 分だとメール確認を挟むだけで cookie が先に
		// 消え、招待を踏んだのに新規家族グループが作られる経路になっていた。
		maxAge: INVITE_COOKIE_MAX_AGE_SECONDS,
	});

	return {
		valid: true as const,
		relocation: false as const,
		invite: {
			role: invite.role,
			childId: invite.childId,
			expiresAt: invite.expiresAt,
		},
	};
};

export const actions: Actions = {
	/**
	 * #4642: 引っ越し合流の実行。**不可逆** (元の家族グループのデータを削除する) なので、
	 * 明示同意のチェックを必須にし、可否はサーバー側で再検証する (画面の同意だけを信用しない)。
	 */
	relocate: async ({ params, locals, cookies, request }) => {
		if (!locals.identity || locals.identity.type !== 'cognito' || !locals.context) {
			redirect(302, '/auth/login');
		}

		const form = await request.formData();
		if (form.get('acknowledge') !== 'on') {
			return fail(400, { relocateError: INVITE_RELOCATION_LABELS.acknowledgeRequired });
		}
		// #4642 PO 差し戻し: 退会と結果が同じ (家族グループの物理削除) なので、確認語の入力も
		// 退会と同じく要求する。画面側の disabled だけに頼らず、ここでも同じ 2 条件を検証する。
		if (String(form.get('confirmText') ?? '').trim() !== CANCEL_TERMS.confirmPhrase) {
			return fail(400, { relocateError: INVITE_RELOCATION_LABELS.confirmInputMismatch });
		}

		const result = await relocateToInvitedTenant(
			params.code,
			requireAppUserId(locals),
			locals.identity.email,
			{ emailVerified: locals.identity.emailVerified },
		);

		if (!result.ok) {
			// 受諾拒否は理由ごとの文言 (SSOT)、引っ越し不可は理由ごとの案内に落とす
			const message =
				'acceptError' in result
					? getInviteJoinBlockedMessage(result.acceptError)
					: result.blockedReason === 'HAS_OTHER_MEMBERS'
						? INVITE_RELOCATION_LABELS.blockedHasOtherMembers
						: result.blockedReason === 'NOT_OWNER'
							? INVITE_RELOCATION_LABELS.blockedNotOwner
							: INVITE_RELOCATION_LABELS.failed;
			return fail(400, { relocateError: message });
		}

		// 所属が変わったので古い context を破棄し、次のリクエストで新しい家族グループとして発行させる
		cookies.delete(CONTEXT_COOKIE_NAME, { path: '/' });
		cookies.delete(INVITE_COOKIE_NAME, { path: '/' });
		redirect(303, '/admin');
	},
};
