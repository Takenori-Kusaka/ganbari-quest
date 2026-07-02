// src/routes/api/v1/import/cloud/+server.ts
// PINコードによるクラウドインポートAPI

import { json } from '@sveltejs/kit';
import { requireRole } from '$lib/server/auth/factory';
import { apiError, validationError } from '$lib/server/errors';
import { logger } from '$lib/server/logger';
import { isZipBytes, parseBackupZip } from '$lib/server/services/backup-archive';
import {
	consumeCloudExportDownload,
	fetchCloudExportByPin,
} from '$lib/server/services/cloud-export-service';
import {
	importFamilyData,
	previewImport,
	validateExportData,
} from '$lib/server/services/import-service';
import {
	AtomicReplaceError,
	replaceImportAtomic,
} from '$lib/server/services/replace-import-service';
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

	// #2362 PR-3 (ADR-0055): template export は child 別 shape を持つ。
	// 取込時は ChildSelectionDialog で選択された targetChildIds を必須化 (per-child instance binding)。
	let body: { pinCode?: string; targetChildIds?: number[] };
	try {
		body = await request.json();
	} catch {
		return validationError('JSONの解析に失敗しました');
	}

	const pinCode = body.pinCode?.trim();
	if (!pinCode || pinCode.length < 4) {
		return validationError('PINコードを入力してください');
	}

	const targetChildIds = Array.isArray(body.targetChildIds)
		? body.targetChildIds.filter((v): v is number => typeof v === 'number' && Number.isFinite(v))
		: undefined;

	// PINでクラウドデータ取得（#3376: full は ZIP バイナリになり得るため bytes で取得）
	let record: Awaited<ReturnType<typeof fetchCloudExportByPin>>['record'];
	let bytes: Uint8Array;
	try {
		const result = await fetchCloudExportByPin(pinCode);
		record = result.record;
		bytes = result.bytes;
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		if (msg.includes('PIN') || msg.includes('有効期限') || msg.includes('ダウンロード')) {
			return apiError('VALIDATION_ERROR', msg);
		}
		logger.error('[cloud-import] PIN検索失敗', { error: msg });
		return apiError('INTERNAL_ERROR', 'クラウドデータの取得に失敗しました');
	}

	// テンプレートインポート (per-child shape, ADR-0055)。template は常に JSON。
	if (record.exportType === 'template') {
		return handleTemplateImport(
			new TextDecoder().decode(bytes),
			tenantId,
			mode,
			record,
			targetChildIds,
		);
	}

	// フルインポート。#3376: 新形式は画像込み ZIP（完全復元）、旧形式は data.json（JSON、後方互換）。
	if (isZipBytes(bytes)) {
		return handleFullZipImport(bytes, tenantId, mode, record);
	}
	return handleFullImport(new TextDecoder().decode(bytes), tenantId, mode, record);
};

/**
 * #3376: 画像込み ZIP のクラウドフルインポート。
 * parseBackupZip で zip-bomb 防御 + manifest 整合性検証を行い、data.json + 静的ファイルを
 * importFamilyData で完全復元する（avatarUrl 貼替・zip-slip 防御は import-service が担う）。
 */
async function handleFullZipImport(
	zipBytes: Uint8Array,
	tenantId: string,
	mode: string,
	record: Awaited<ReturnType<typeof fetchCloudExportByPin>>['record'],
): Promise<Response> {
	const parsed = await parseBackupZip(zipBytes);
	if (!parsed.ok) {
		return apiError('VALIDATION_ERROR', parsed.error);
	}
	const { body, staticFiles } = parsed.value;

	const validation = validateExportData(body);
	if (!validation.valid) {
		return apiError('VALIDATION_ERROR', validation.error);
	}

	if (mode === 'preview') {
		const preview = await previewImport(validation.data, tenantId);
		return json({ ok: true, preview: { exportType: 'full', ...preview } });
	}

	if (mode === 'execute') {
		try {
			// #3376 adversarial: validate 成功後に DL を消費 (preview / validate 失敗では消費しない)
			await consumeCloudExportDownload(record);
			const result = await importFamilyData(validation.data, tenantId, staticFiles);
			return json({ ok: true, result: { exportType: 'full', ...result } });
		} catch (err) {
			logger.error('[cloud-import] フル ZIP インポート失敗', { error: String(err) });
			return apiError('INTERNAL_ERROR', 'フルインポートに失敗しました');
		}
	}

	// replace
	try {
		// #3376 adversarial: validate 成功後に DL を消費 (preview / validate 失敗では消費しない)
		await consumeCloudExportDownload(record);
		// #3326: clear + import を原子境界で実行し、途中失敗時は旧データを必ず復元する。
		logger.info('[cloud-import] 置換インポート開始 (ZIP, 原子化)', { context: { tenantId } });
		const result = await replaceImportAtomic(validation.data, tenantId, staticFiles);
		return json({ ok: true, result: { exportType: 'full', ...result } });
	} catch (err) {
		if (err instanceof AtomicReplaceError) {
			logger.error('[cloud-import] 置換 ZIP インポート中止 (既存データ保全)', {
				context: { errors: err.result.errors.slice(0, 3) },
			});
			return apiError(
				'VALIDATION_ERROR',
				`インポートに失敗したため中止しました（既存データは保全されています）: ${err.result.errors[0] ?? ''}`,
			);
		}
		logger.error('[cloud-import] 置換 ZIP インポート失敗', { error: String(err) });
		return apiError('INTERNAL_ERROR', '置換インポートに失敗しました');
	}
}

/**
 * テンプレートインポート (per-child instance, #2362 PR-3 / ADR-0055)
 *
 * 入力 shape (cloud-export-service v2.0.0 が出力):
 *   { activitiesByChild: [{ childId, childNickname, activities: [...] }], checklistTemplates: [...] }
 *
 * 取込フロー (PO 判断 A 案):
 *   1. preview: 集計のみ (childIds 不要)
 *   2. execute: targetChildIds 必須 (ChildSelectionDialog で選択された復元先 child)
 *      - 旧 export の各 child の activities を targetChildIds の各 child に instance 化
 *      - 同名 activity は per-child で重複スキップ (`source: 'cloud-import'`)
 *      - childId 元情報は捨てる (復元先 child が SSOT)
 */
async function handleTemplateImport(
	dataStr: string,
	tenantId: string,
	mode: string,
	record: Awaited<ReturnType<typeof fetchCloudExportByPin>>['record'],
	targetChildIds: number[] | undefined,
): Promise<Response> {
	const description = record.description;
	type TemplateActivity = {
		name: string;
		categoryId: number;
		icon: string;
		basePoints: number;
		triggerHint?: string | null;
		isMainQuest?: number;
		priority?: 'must' | 'optional';
	};
	type TemplateChildBucket = {
		childId: number;
		childNickname?: string;
		activities: TemplateActivity[];
	};
	let templateData: {
		format: string;
		version: string;
		activitiesByChild?: TemplateChildBucket[];
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
	if (templateData.version !== '2.0.0') {
		return apiError(
			'VALIDATION_ERROR',
			`サポートされていないテンプレートバージョンです (version=${String(templateData.version)})`,
		);
	}

	const childBuckets = Array.isArray(templateData.activitiesByChild)
		? templateData.activitiesByChild
		: [];
	const totalActivitiesInTemplate = childBuckets.reduce(
		(sum, bucket) => sum + (Array.isArray(bucket.activities) ? bucket.activities.length : 0),
		0,
	);
	const checklistsCount = templateData.checklistTemplates?.length ?? 0;

	if (mode === 'preview') {
		return json({
			ok: true,
			preview: {
				exportType: 'template',
				description,
				activities: totalActivitiesInTemplate,
				activitiesByChild: childBuckets.map((b) => ({
					childId: b.childId,
					childNickname: b.childNickname ?? null,
					activityCount: Array.isArray(b.activities) ? b.activities.length : 0,
				})),
				checklistTemplates: checklistsCount,
			},
		});
	}

	// execute: ChildSelectionDialog 経由で復元先 child が指定されている必要がある
	if (!targetChildIds || targetChildIds.length === 0) {
		return apiError(
			'VALIDATION_ERROR',
			'取込先のお子さまを 1 人以上選択してください (targetChildIds 必須)',
		);
	}

	try {
		const { getRepos } = await import('$lib/server/db/factory');
		const repos = getRepos();

		// 復元先 child の所有権検証 (cross-tenant access 防止)
		const ownedChildren = await repos.child.findAllChildren(tenantId);
		const ownedChildIds = new Set(ownedChildren.map((c) => c.id));
		const invalidIds = targetChildIds.filter((id) => !ownedChildIds.has(id));
		if (invalidIds.length > 0) {
			return apiError(
				'VALIDATION_ERROR',
				`指定されたお子さまが見つかりません (invalid: ${invalidIds.join(',')})`,
			);
		}

		// #3376 adversarial: 全 validation 成功後に DL を消費 (preview / validate 失敗では消費しない)
		await consumeCloudExportDownload(record);

		// 旧 export の活動を平坦化 (childId 元情報は捨てる、復元先 child が SSOT)
		const flatActivities: TemplateActivity[] = childBuckets.flatMap((b) =>
			Array.isArray(b.activities) ? b.activities : [],
		);
		// 同名 dedup (取込側で重複を吸収、ChildSelectionDialog で複数 child 選択時の整合保持)
		const uniqByName = new Map<string, TemplateActivity>();
		for (const act of flatActivities) {
			if (!uniqByName.has(act.name)) uniqByName.set(act.name, act);
		}

		let activitiesCreated = 0;
		const checklistsCreated = 0;

		// per-child instance bulk insert
		for (const cid of targetChildIds) {
			const existingInChild = await repos.childActivity.findActivitiesByChild(cid, tenantId);
			const existingNames = new Set(existingInChild.map((a) => a.name));
			const inputs = Array.from(uniqByName.values())
				.filter((a) => !existingNames.has(a.name))
				.map((a) => ({
					childId: cid,
					name: a.name,
					categoryId: a.categoryId,
					icon: a.icon,
					basePoints: a.basePoints,
					triggerHint: a.triggerHint ?? null,
					isMainQuest: a.isMainQuest ?? 0,
					priority: a.priority ?? 'optional',
					sourcePresetId: null,
				}));
			if (inputs.length > 0) {
				const created = await repos.childActivity.insertActivitiesBulk(inputs, tenantId);
				activitiesCreated += created.length;
			}
		}

		logger.info('[cloud-import] テンプレートインポート完了', {
			context: {
				tenantId,
				activitiesCreated,
				checklistsCreated,
				targetChildCount: targetChildIds.length,
			},
		});

		return json({
			ok: true,
			result: {
				exportType: 'template',
				activitiesCreated,
				checklistsCreated,
				targetChildIds,
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
	record: Awaited<ReturnType<typeof fetchCloudExportByPin>>['record'],
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
			// #3376 adversarial: validate 成功後に DL を消費 (preview / validate 失敗では消費しない)
			await consumeCloudExportDownload(record);
			const result = await importFamilyData(validation.data, tenantId);
			return json({ ok: true, result: { exportType: 'full', ...result } });
		} catch (err) {
			logger.error('[cloud-import] フルインポート失敗', { error: String(err) });
			return apiError('INTERNAL_ERROR', 'フルインポートに失敗しました');
		}
	}

	// replace
	try {
		// #3376 adversarial: validate 成功後に DL を消費 (preview / validate 失敗では消費しない)
		await consumeCloudExportDownload(record);
		// #3326: clear + import を原子境界で実行し、途中失敗時は旧データを必ず復元する。
		logger.info('[cloud-import] 置換インポート開始 (原子化)', { context: { tenantId } });
		const result = await replaceImportAtomic(validation.data, tenantId);
		return json({ ok: true, result: { exportType: 'full', ...result } });
	} catch (err) {
		if (err instanceof AtomicReplaceError) {
			logger.error('[cloud-import] 置換インポート中止 (既存データ保全)', {
				context: { errors: err.result.errors.slice(0, 3) },
			});
			return apiError(
				'VALIDATION_ERROR',
				`インポートに失敗したため中止しました（既存データは保全されています）: ${err.result.errors[0] ?? ''}`,
			);
		}
		logger.error('[cloud-import] 置換インポート失敗', { error: String(err) });
		return apiError('INTERNAL_ERROR', '置換インポートに失敗しました');
	}
}
