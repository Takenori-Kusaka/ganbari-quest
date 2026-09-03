// src/routes/api/v1/export/cloud/+server.ts
// クラウドエクスポートAPI（一覧取得 + 新規作成）

import { json } from '@sveltejs/kit';
import { AUTH_LICENSE_STATUS } from '$lib/domain/constants/auth-license-status';
import { requireRole } from '$lib/server/auth/factory';
import type { CloudExportType } from '$lib/server/db/types';
import { apiError, planLimitError, quotaLimitError, validationError } from '$lib/server/errors';
import { logger } from '$lib/server/logger';
import {
	CloudExportPlanGateError,
	CloudExportQuotaError,
	createCloudExport,
	listCloudExports,
} from '$lib/server/services/cloud-export-service';
import type { RequestHandler } from './$types';

/** GET /api/v1/export/cloud — 自テナントのクラウドエクスポート一覧 */
export const GET: RequestHandler = async ({ locals }) => {
	const context = locals.context;
	if (!context) {
		return json({ error: '認証が必要です' }, { status: 401 });
	}
	const tenantId = context.tenantId;
	requireRole(locals, ['owner', 'parent']);

	try {
		const exports = await listCloudExports(tenantId);
		return json({ ok: true, exports });
	} catch (err) {
		logger.error('[cloud-export] 一覧取得失敗', { error: String(err) });
		return apiError('INTERNAL_ERROR', 'クラウドエクスポート一覧の取得に失敗しました');
	}
};

/** POST /api/v1/export/cloud — クラウドエクスポート作成 */
export const POST: RequestHandler = async ({ request, locals }) => {
	const context = locals.context;
	if (!context) {
		return json({ error: '認証が必要です' }, { status: 401 });
	}
	const tenantId = context.tenantId;
	requireRole(locals, ['owner', 'parent']);

	let body: { exportType?: string; label?: string };
	try {
		body = await request.json();
	} catch {
		return validationError('JSONの解析に失敗しました');
	}

	const exportType = body.exportType;
	if (exportType !== 'template' && exportType !== 'full') {
		return validationError('exportType は template または full を指定してください');
	}

	const licenseStatus = locals.context?.licenseStatus ?? AUTH_LICENSE_STATUS.NONE;
	const planId = locals.context?.plan;

	try {
		// #3504: 非同期起票 (pending)。実 build は cron (drainPendingExports) が背景で行う。
		// ZIP サイズ上限超過等の build 失敗は起票時ではなく build 時に status='failed' として記録される。
		const result = await createCloudExport({
			tenantId,
			exportType: exportType as CloudExportType,
			label: body.label,
			licenseStatus,
			planId,
		});
		return json({ ok: true, ...result }, { status: 201 });
	} catch (err) {
		// プラン未達 / 保管上限は起票時点で同期的に弾く。**2 つは別事象**なので型で見分ける (#4710):
		//   未達 = その tier に機能が無い → 次の行動はアップグレード
		//   上限 = 契約中でも枠が埋まれば起きる → 次の行動は古いものを削除
		// 旧実装は両方を message の部分一致で拾って planLimitError('standard') に潰していたため、
		// 既にスタンダード契約の顧客にも「スタンダードプラン以上でご利用いただけます」と返していた。
		if (err instanceof CloudExportPlanGateError) {
			return planLimitError(err.requiredTier, err.userMessage, { tenantId });
		}
		if (err instanceof CloudExportQuotaError) {
			return quotaLimitError(err.userMessage, { tenantId, current: err.current, max: err.max });
		}
		const msg = err instanceof Error ? err.message : String(err);
		logger.error('[cloud-export] 作成失敗', { error: msg });
		return apiError('INTERNAL_ERROR', 'クラウドエクスポートの作成に失敗しました');
	}
};
