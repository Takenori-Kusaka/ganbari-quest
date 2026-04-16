// GET /api/v1/admin/account/export — 削除前データエクスポート (#740)
//
// アカウント削除確認画面からダウンロードリンクを提供する。
// プラン別にエクスポート範囲が異なる:
//   free:     子供名・活動サマリ（最小限）
//   standard: フルエクスポート
//   family:   フル + きょうだい比較

import { json } from '@sveltejs/kit';
import { requireTenantId } from '$lib/server/auth/factory';
import { requireRole } from '$lib/server/auth/guards';
import { generateDeletionExportForTenant } from '$lib/server/services/deletion-export-service';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals }) => {
	requireRole(locals, ['owner']);
	const tenantId = requireTenantId(locals);
	const licenseStatus = locals.context?.licenseStatus ?? 'none';
	const planId = locals.context?.plan;

	const result = await generateDeletionExportForTenant(
		tenantId,
		licenseStatus,
		planId,
	);

	return json(result);
};
