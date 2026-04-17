// src/routes/ops/license/[key]/+page.server.ts
// #805: ライセンスキー詳細 + 失効アクション
//
// load: key で LicenseRecord を取り、license_events の履歴と併記する。
// actions.revoke: ops ユーザが「失効」ボタンを押したときの form action。
//   - license-key-service.revokeLicenseKey を呼ぶ（自動で license_events に revoked 記録）

import { error, fail } from '@sveltejs/kit';
import { getRepos } from '$lib/server/db/factory';
import {
	type LicenseRevokeReason,
	revokeLicenseKey,
} from '$lib/server/services/license-key-service';
import type { Actions, PageServerLoad } from './$types';

const VALID_REASONS: readonly LicenseRevokeReason[] = [
	'expired',
	'leaked',
	'ops-manual',
	'refund',
] as const;

export const load: PageServerLoad = async ({ params }) => {
	const key = decodeURIComponent(params.key).toUpperCase().trim();
	const record = await getRepos().auth.findLicenseKey(key);
	return {
		licenseKey: key,
		record: record ?? null,
	};
};

export const actions: Actions = {
	revoke: async (event) => {
		const { params, request, locals } = event;
		const key = decodeURIComponent(params.key).toUpperCase().trim();
		const form = await request.formData();
		const reasonRaw = (form.get('reason') ?? '').toString();
		const note = (form.get('note') ?? '').toString().trim() || null;

		if (!VALID_REASONS.includes(reasonRaw as LicenseRevokeReason)) {
			return fail(400, { error: '失効理由が不正です' });
		}
		const reason = reasonRaw as LicenseRevokeReason;

		const identity = locals.identity;
		if (!identity || identity.type !== 'cognito') {
			// ops layout の isOpsMember で原則ブロック済み。念のためのガード。
			error(403, 'Forbidden');
		}
		const actorId = `ops:${identity.userId}`;

		const result = await revokeLicenseKey({
			licenseKey: key,
			reason,
			revokedBy: actorId,
			context: {
				ip: (() => {
					try {
						return event.getClientAddress();
					} catch {
						return null;
					}
				})(),
				ua: request.headers.get('user-agent'),
			},
		});

		if (!result.ok) {
			return fail(409, { error: result.reason });
		}

		return { revoked: true, revokedAt: result.revokedAt, reason };
	},
};
