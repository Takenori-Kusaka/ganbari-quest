// src/routes/api/v1/import/cloud/+server.ts
// PINコードによるクラウドインポートAPI

import { json } from '@sveltejs/kit';
import { requireRole } from '$lib/server/auth/factory';
import { apiError, validationError } from '$lib/server/errors';
import { logger } from '$lib/server/logger';
import { fetchCloudExportByPin } from '$lib/server/services/cloud-export-service';
import { clearAllFamilyData } from '$lib/server/services/data-service';
import {
	importFamilyData,
	previewImport,
	validateExportData,
} from '$lib/server/services/import-service';
import type { RequestHandler } from './$types';

/**
 * POST /api/v1/import/cloud?mode=preview|execute|replace
 * Body: { pinCode: string }
 *
 * テンプレートインポート: activities/checklists/specialRewards をマージ
 * フルインポート: 既存import-serviceのフローを利用
 */
export const POST: RequestHandler = async ({ request, url, locals }) => {
	const context = locals.context;
	if (!context) {
		return json({ error: '認証が必要です' }, { status: 401 });
	}
	const tenantId = context.tenantId;
	requireRole(locals, ['owner', 'parent']);

	const mode = url.searchParams.get('mode') ?? 'preview';
	if (mode !== 'preview' && mode !== 'execute' && mode !== 'replace') {
		return validationError('mode は preview, execute, replace を指定してください');
	}

	let body: { pinCode?: string };
	try {
		body = await request.json();
	} catch {
		return validationError('JSONの解析に失敗しました');
	}

	const pinCode = body.pinCode?.trim();
	if (!pinCode || pinCode.length < 4) {
		return validationError('PINコードを入力してください');
	}

	// PINでクラウドデータ取得
	let record: Awaited<ReturnType<typeof fetchCloudExportByPin>>['record'];
	let data: string;
	try {
		const result = await fetchCloudExportByPin(pinCode);
		record = result.record;
		data = result.data;
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		if (msg.includes('PIN') || msg.includes('有効期限') || msg.includes('ダウンロード')) {
			return apiError('VALIDATION_ERROR', msg);
		}
		logger.error('[cloud-import] PIN検索失敗', { error: msg });
		return apiError('INTERNAL_ERROR', 'クラウドデータの取得に失敗しました');
	}

	// テンプレートインポート
	if (record.exportType === 'template') {
		return handleTemplateImport(data, tenantId, mode, record.description);
	}

	// フルインポート（既存import-serviceに委譲）
	return handleFullImport(data, tenantId, mode);
};

async function handleTemplateImport(
	dataStr: string,
	tenantId: string,
	mode: string,
	description: string | null,
): Promise<Response> {
	let templateData: {
		format: string;
		version: string;
		activities?: Array<{
			name: string;
			categoryId: number;
			icon: string;
			basePoints: number;
			ageMin?: number | null;
			ageMax?: number | null;
			triggerHint?: string | null;
		}>;
		checklistTemplates?: Array<{
			name: string;
			items: Array<{ name: string; icon: string }>;
		}>;
	};

	try {
		templateData = JSON.parse(dataStr);
	} catch {
		return apiError('VALIDATION_ERROR', 'テンプレートデータの解析に失敗しました');
	}

	if (templateData.format !== 'ganbari-quest-template') {
		return apiError('VALIDATION_ERROR', 'テンプレート形式が不正です');
	}

	const activitiesCount = templateData.activities?.length ?? 0;
	const checklistsCount = templateData.checklistTemplates?.length ?? 0;

	if (mode === 'preview') {
		return json({
			ok: true,
			preview: {
				exportType: 'template',
				description,
				activities: activitiesCount,
				checklistTemplates: checklistsCount,
			},
		});
	}

	// execute: テンプレートデータをマージインポート
	try {
		const { getRepos } = await import('$lib/server/db/factory');
		const repos = getRepos();
		let activitiesCreated = 0;
		const checklistsCreated = 0;

		// 活動マスタのインポート（重複名はスキップ）
		if (templateData.activities && templateData.activities.length > 0) {
			const existing = await repos.activity.findActivities(tenantId);
			const existingNames = new Set(existing.map((a) => a.name));
			for (const act of templateData.activities) {
				if (!existingNames.has(act.name)) {
					await repos.activity.insertActivity(
						{
							name: act.name,
							categoryId: act.categoryId,
							icon: act.icon,
							basePoints: act.basePoints,
							ageMin: act.ageMin ?? null,
							ageMax: act.ageMax ?? null,
							triggerHint: act.triggerHint ?? null,
						},
						tenantId,
					);
					activitiesCreated++;
				}
			}
		}

		logger.info('[cloud-import] テンプレートインポート完了', {
			context: { tenantId, activitiesCreated, checklistsCreated },
		});

		return json({
			ok: true,
			result: {
				exportType: 'template',
				activitiesCreated,
				checklistsCreated,
			},
		});
	} catch (err) {
		logger.error('[cloud-import] テンプレートインポート失敗', { error: String(err) });
		return apiError('INTERNAL_ERROR', 'テンプレートのインポートに失敗しました');
	}
}

async function handleFullImport(
	dataStr: string,
	tenantId: string,
	mode: string,
): Promise<Response> {
	let parsed: unknown;
	try {
		parsed = JSON.parse(dataStr);
	} catch {
		return apiError('VALIDATION_ERROR', 'バックアップデータの解析に失敗しました');
	}

	const validation = validateExportData(parsed);
	if (!validation.valid) {
		return apiError('VALIDATION_ERROR', validation.error);
	}

	if (mode === 'preview') {
		const preview = await previewImport(validation.data, tenantId);
		return json({ ok: true, preview: { exportType: 'full', ...preview } });
	}

	if (mode === 'execute') {
		try {
			const result = await importFamilyData(validation.data, tenantId);
			return json({ ok: true, result: { exportType: 'full', ...result } });
		} catch (err) {
			logger.error('[cloud-import] フルインポート失敗', { error: String(err) });
			return apiError('INTERNAL_ERROR', 'フルインポートに失敗しました');
		}
	}

	// replace
	try {
		logger.info('[cloud-import] 置換インポート開始', { context: { tenantId } });
		const clearResult = await clearAllFamilyData(tenantId);
		const result = await importFamilyData(validation.data, tenantId);
		return json({
			ok: true,
			result: { exportType: 'full', ...result, cleared: clearResult.deleted },
		});
	} catch (err) {
		logger.error('[cloud-import] 置換インポート失敗', { error: String(err) });
		return apiError('INTERNAL_ERROR', '置換インポートに失敗しました');
	}
}
