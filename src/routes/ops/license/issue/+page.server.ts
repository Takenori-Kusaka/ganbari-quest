// src/routes/ops/license/issue/+page.server.ts
// #802: キャンペーン用ライセンスキー一括発行
//
// issue form action: plan × 数量を指定して campaign kind で一括発行する。
// 発行結果は画面に表示し、CSV ダウンロードは同一 action の戻り値 (form.keys) を
// クライアント側で Blob にして保存させる（サーバ側で CSV を生成するより、誤操作での
// ダウンロード漏れを抑制できる）。
//
// - 認可: Cognito identity が必要 (layout の isOpsMember で原則ブロック済み、念のためのガード)
// - 監査: ops_audit_log に action='license.issue' で 1 件記録 (metadata に発行件数・理由・全キー)
// - 上限: 1 request あたり 500 件（運用上まとめて配る最大想定）

import { error, fail } from '@sveltejs/kit';
import { ALL_LICENSE_PLANS, type LicensePlan } from '$lib/domain/constants/license-plan';
import { issueLicenseKey } from '$lib/server/services/license-key-service';
import { recordOpsAudit } from '$lib/server/services/ops-audit-log-service';
import type { Actions, PageServerLoad } from './$types';

const MAX_BATCH = 500;

export const load: PageServerLoad = async ({ locals }) => {
	const identity = locals.identity;
	if (!identity || identity.type !== 'cognito') {
		error(403, 'Forbidden');
	}
	return {
		plans: ALL_LICENSE_PLANS,
	};
};

export const actions: Actions = {
	issue: async (event) => {
		const { locals, request } = event;
		const identity = locals.identity;
		if (!identity || identity.type !== 'cognito') {
			error(403, 'Forbidden');
		}

		const form = await request.formData();
		const planRaw = (form.get('plan') ?? '').toString();
		const quantityRaw = (form.get('quantity') ?? '').toString();
		const reason = (form.get('reason') ?? '').toString().trim();
		const expiresAtRaw = (form.get('expiresAt') ?? '').toString().trim();
		const tenantIdRaw = (form.get('tenantId') ?? '').toString().trim();

		if (!ALL_LICENSE_PLANS.includes(planRaw as LicensePlan)) {
			return fail(400, { error: 'プランが不正です' });
		}
		const plan = planRaw as LicensePlan;

		const quantity = Number.parseInt(quantityRaw, 10);
		if (!Number.isFinite(quantity) || quantity < 1 || quantity > MAX_BATCH) {
			return fail(400, { error: `数量は 1〜${MAX_BATCH} の範囲で指定してください` });
		}

		if (!reason || reason.length > 200) {
			return fail(400, { error: 'キャンペーン名/理由は 1〜200 文字で指定してください' });
		}

		// expiresAt は空ならデフォルト 90 日（service 側で処理）。明示的な空文字＝デフォルト、
		// 'never' なら期限なし、それ以外は ISO 文字列として解釈。
		let expiresAtArg: string | null | undefined;
		if (expiresAtRaw === '' || expiresAtRaw === 'default') {
			expiresAtArg = undefined;
		} else if (expiresAtRaw === 'never') {
			expiresAtArg = null;
		} else {
			const parsed = new Date(expiresAtRaw);
			if (Number.isNaN(parsed.getTime())) {
				return fail(400, { error: '有効期限の形式が不正です' });
			}
			expiresAtArg = parsed.toISOString();
		}

		// tenantId: campaign キーは任意 tenant が consume 可能だが、
		// 発行時の record.tenantId には「どの campaign プール由来か」を判別できる識別子を入れる。
		// 空なら 'campaign:<reason>' を自動採番。
		const tenantId = tenantIdRaw || `campaign:${reason.slice(0, 80)}`;
		const issuedBy = `ops:${identity.userId}`;

		const issuedKeys: string[] = [];
		const errors: string[] = [];

		for (let i = 0; i < quantity; i++) {
			try {
				const rec = await issueLicenseKey({
					tenantId,
					plan,
					kind: 'campaign',
					issuedBy,
					expiresAt: expiresAtArg,
				});
				issuedKeys.push(rec.licenseKey);
			} catch (e) {
				errors.push(e instanceof Error ? e.message : String(e));
			}
		}

		if (issuedKeys.length === 0) {
			return fail(500, {
				error: `発行に失敗しました: ${errors[0] ?? 'unknown error'}`,
			});
		}

		await recordOpsAudit({
			identity,
			event,
			action: 'license.issue',
			target: tenantId,
			metadata: {
				plan,
				quantity: issuedKeys.length,
				requested: quantity,
				reason,
				expiresAt: expiresAtArg ?? 'default',
				keys: issuedKeys,
				errors: errors.length > 0 ? errors : undefined,
			},
		});

		return {
			issued: true,
			plan,
			reason,
			tenantId,
			issuedBy,
			expiresAt: expiresAtArg ?? 'default',
			keys: issuedKeys,
			errors: errors.length > 0 ? errors : undefined,
		};
	},
};
