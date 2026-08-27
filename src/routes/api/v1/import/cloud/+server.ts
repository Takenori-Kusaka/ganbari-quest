// src/routes/api/v1/import/cloud/+server.ts
// PINコードによるクラウドインポートAPI

import { json } from '@sveltejs/kit';
import { asChildId, type CategoryId, type ChildId } from '$lib/domain/ids';
import { requireRole } from '$lib/server/auth/factory';
import type { ErrorCode } from '$lib/server/errors';
import { apiError, validationError } from '$lib/server/errors';
import { logger } from '$lib/server/logger';
import { isZipBytes, parseBackupZip } from '$lib/server/services/backup-archive';
import type { CloudExportFetchFailure } from '$lib/server/services/cloud-export-service';
import {
	CloudExportFetchError,
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
	ReplaceRestoreFailedError,
	ReplaceSnapshotError,
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

/**
 * #4717: PIN 取得の失敗理由 → HTTP エラー種別 (ADR-0062 種別×手段マッピング)。
 * 新しい理由を追加したら型エラーになるので、分類漏れ (= 500 に落ちる) を構造的に防ぐ。
 */
const FETCH_FAILURE_TO_ERROR_CODE: Record<CloudExportFetchFailure, ErrorCode> = {
	'invalid-pin': 'VALIDATION_ERROR',
	expired: 'VALIDATION_ERROR',
	'download-limit': 'VALIDATION_ERROR',
	'not-ready': 'EXPORT_NOT_READY',
	'build-failed': 'EXPORT_FAILED',
	'data-missing': 'NOT_FOUND',
};

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
	let body: { pinCode?: string; targetChildIds?: unknown[] };
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
		? body.targetChildIds
				.filter((v): v is string | number => typeof v === 'string' || typeof v === 'number')
				.map(asChildId)
		: undefined;

	// PINでクラウドデータ取得（#3376: full は ZIP バイナリになり得るため bytes で取得）
	let record: Awaited<ReturnType<typeof fetchCloudExportByPin>>['record'];
	let bytes: Uint8Array;
	try {
		const result = await fetchCloudExportByPin(pinCode);
		record = result.record;
		bytes = result.bytes;
	} catch (err) {
		// #4717: 失敗理由は型 (CloudExportFetchError.reason) で受ける。
		// 旧実装は message の文字列 match で分類しており、新しい理由 (生成待ち) が漏れて
		// 500「システムに問題が発生しました」になっていた (受け取る側が障害と誤認)。
		if (err instanceof CloudExportFetchError) {
			return apiError(FETCH_FAILURE_TO_ERROR_CODE[err.reason], err.message);
		}
		const msg = err instanceof Error ? err.message : String(err);
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
			const result = await importFamilyData(validation.data, tenantId, staticFiles);
			// #3405-2 consume-on-success: import 成功後に DL を消費する。旧実装は import 前に消費して
			// いたため、import 失敗時に「データ未取込 + DL 回数消費」が両立して quota を無駄に失っていた。
			await consumeCloudExportDownload(record);
			return json({ ok: true, result: { exportType: 'full', ...result } });
		} catch (err) {
			logger.error('[cloud-import] フル ZIP インポート失敗', { error: String(err) });
			return apiError('INTERNAL_ERROR', 'フルインポートに失敗しました');
		}
	}

	// replace
	try {
		// #3326: clear + import を原子境界で実行し、途中失敗時は旧データを必ず復元する。
		logger.info('[cloud-import] 置換インポート開始 (ZIP, 原子化)', { context: { tenantId } });
		const result = await replaceImportAtomic(validation.data, tenantId, staticFiles);
		// #3405-2 consume-on-success: 置換成功後に DL を消費する。replaceImportAtomic は失敗時に旧データを
		// 保全する (#3326) ため、失敗時は「データ保全 + DL 未消費」となり quota + データの二重損失を防ぐ。
		await consumeCloudExportDownload(record);
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
		if (err instanceof ReplaceSnapshotError || err instanceof ReplaceRestoreFailedError) {
			// #4720 pg 系: snapshot 取得失敗 (置換未開始、旧データ無傷) / 復元失敗 (手動復旧が必要) は
			// 「保全されています」と言わず実態の文言を返す。
			logger.error('[cloud-import] 置換インポート失敗 (pg snapshot 経路)', {
				error: String(err),
				context: { kind: err.name },
			});
			return apiError('INTERNAL_ERROR', err.message);
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
	targetChildIds: ChildId[] | undefined,
): Promise<Response> {
	const description = record.description;
	type TemplateActivity = {
		name: string;
		categoryId: CategoryId;
		icon: string;
		basePoints: number;
		triggerHint?: string | null;
		isMainQuest?: number;
		priority?: 'must' | 'optional';
	};
	type TemplateChildBucket = {
		childId: ChildId;
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

		// #3405-2 consume-on-success: 全 child への取込が成功した後に DL を消費する。旧実装は取込前に
		// 消費していたため、bulk insert 途中失敗で「未取込 + DL 回数消費」が両立して quota を無駄に失っていた。
		await consumeCloudExportDownload(record);

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
			const result = await importFamilyData(validation.data, tenantId);
			// #3405-2 consume-on-success: import 成功後に DL を消費する (失敗時は quota を消費しない)。
			await consumeCloudExportDownload(record);
			return json({ ok: true, result: { exportType: 'full', ...result } });
		} catch (err) {
			logger.error('[cloud-import] フルインポート失敗', { error: String(err) });
			return apiError('INTERNAL_ERROR', 'フルインポートに失敗しました');
		}
	}

	// replace
	try {
		// #3326: clear + import を原子境界で実行し、途中失敗時は旧データを必ず復元する。
		logger.info('[cloud-import] 置換インポート開始 (原子化)', { context: { tenantId } });
		const result = await replaceImportAtomic(validation.data, tenantId);
		// #3405-2 consume-on-success: 置換成功後に DL を消費する (replaceImportAtomic は失敗時に旧データを
		// 保全するため、失敗時は quota + データの二重損失を防ぐ)。
		await consumeCloudExportDownload(record);
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
		if (err instanceof ReplaceSnapshotError || err instanceof ReplaceRestoreFailedError) {
			// #4720 pg 系: snapshot 取得失敗 (置換未開始、旧データ無傷) / 復元失敗 (手動復旧が必要) は
			// 「保全されています」と言わず実態の文言を返す。
			logger.error('[cloud-import] 置換インポート失敗 (pg snapshot 経路)', {
				error: String(err),
				context: { kind: err.name },
			});
			return apiError('INTERNAL_ERROR', err.message);
		}
		logger.error('[cloud-import] 置換インポート失敗', { error: String(err) });
		return apiError('INTERNAL_ERROR', '置換インポートに失敗しました');
	}
}
