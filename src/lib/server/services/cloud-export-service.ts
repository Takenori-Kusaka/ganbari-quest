// src/lib/server/services/cloud-export-service.ts
// クラウドエクスポート共有サービス（PIN付きS3保管 + インポート）

import { getAuthMode } from '$lib/server/auth/factory';
import { getRepos } from '$lib/server/db/factory';
import type { CloudExportRecord, CloudExportType } from '$lib/server/db/types';
import { logger } from '$lib/server/logger';
import { exportFamilyData } from '$lib/server/services/export-service';
import {
	getPlanLimits,
	type PlanTier,
	resolveFullPlanTier,
} from '$lib/server/services/plan-limit-service';

// PIN生成用の文字セット（O/0/I/1を除外して誤読防止）
const PIN_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const PIN_LENGTH = 6;
const EXPIRY_DAYS = 7;

/** PIN コードを生成（6桁英数字） */
function generatePin(): string {
	let pin = '';
	for (let i = 0; i < PIN_LENGTH; i++) {
		pin += PIN_CHARS[Math.floor(Math.random() * PIN_CHARS.length)];
	}
	return pin;
}

/** ユニークな PIN を生成（衝突チェック） */
async function generateUniquePin(): Promise<string> {
	const repos = getRepos();
	for (let attempt = 0; attempt < 10; attempt++) {
		const pin = generatePin();
		const existing = await repos.cloudExport.findByPin(pin);
		if (!existing) return pin;
	}
	throw new Error('PIN生成に失敗しました（衝突回避不可）');
}

/** 有効期限を計算（7日後） */
function calculateExpiry(): string {
	const d = new Date();
	d.setDate(d.getDate() + EXPIRY_DAYS);
	return d.toISOString();
}

/** テンプレートエクスポートデータを構築（活動セット + チェックリスト） */
async function buildTemplateExportData(tenantId: string): Promise<{
	data: string;
	description: string;
}> {
	const repos = getRepos();

	// 活動一覧
	const activities = await repos.activity.findActivities(tenantId);
	// チェックリストテンプレート（子供ごとに紐づくテンプレートを収集）
	const children = await repos.child.findAllChildren(tenantId);
	const checklistTemplates: Array<{
		name: string;
		items: Array<{ name: string; icon: string }>;
	}> = [];
	for (const child of children) {
		const templates = await repos.checklist.findTemplatesByChild(child.id, tenantId);
		for (const tpl of templates) {
			const items = await repos.checklist.findTemplateItems(tpl.id, tenantId);
			checklistTemplates.push({
				name: tpl.name,
				items: items.map((it) => ({ name: it.name, icon: it.icon })),
			});
		}
	}

	const templateData = {
		format: 'ganbari-quest-template' as const,
		version: '1.0.0',
		exportedAt: new Date().toISOString(),
		activities: activities.map((a) => ({
			name: a.name,
			categoryId: a.categoryId,
			icon: a.icon,
			basePoints: a.basePoints,
			ageMin: a.ageMin,
			ageMax: a.ageMax,
			triggerHint: a.triggerHint,
		})),
		checklistTemplates,
	};

	const parts: string[] = [];
	if (activities.length > 0) parts.push(`活動${activities.length}件`);
	if (checklistTemplates.length > 0) parts.push(`チェックリスト${checklistTemplates.length}件`);
	const description = parts.join('、') || 'データなし';

	return { data: JSON.stringify(templateData), description };
}

/** フルバックアップデータを構築（既存エクスポート形式） */
async function buildFullExportData(tenantId: string): Promise<{
	data: string;
	description: string;
}> {
	const exportData = await exportFamilyData({ tenantId });
	const childCount = exportData.family.children.length;
	const logCount = Object.values(exportData.data).reduce(
		(sum, d) => sum + (d.activityLogs?.length ?? 0),
		0,
	);
	const description = `フルバックアップ（子供${childCount}人、ログ${logCount}件）`;
	return { data: JSON.stringify(exportData), description };
}

export interface CloudExportOptions {
	tenantId: string;
	exportType: CloudExportType;
	label?: string;
	licenseStatus: string;
	planId?: string;
}

export interface CloudExportResult {
	pinCode: string;
	expiresAt: string;
	exportType: CloudExportType;
	fileSizeBytes: number;
	description: string;
}

/** クラウドエクスポートを実行 */
export async function createCloudExport(options: CloudExportOptions): Promise<CloudExportResult> {
	const { tenantId, exportType, label, licenseStatus, planId } = options;

	// ローカルモードではクラウドエクスポート不可（ファイルDLのみ）
	if (getAuthMode() === 'local') {
		throw new Error('クラウドエクスポートはSaaS版でのみ利用可能です');
	}

	// プラン制限チェック
	const tier: PlanTier = await resolveFullPlanTier(tenantId, licenseStatus, planId);
	const limits = getPlanLimits(tier);
	if (limits.maxCloudExports === 0) {
		throw new Error('クラウドエクスポートはスタンダードプラン以上でご利用いただけます');
	}

	// 保管数上限チェック
	const repos = getRepos();
	const currentCount = await repos.cloudExport.countByTenant(tenantId);
	if (currentCount >= limits.maxCloudExports) {
		throw new Error(
			`クラウド保管数の上限（${limits.maxCloudExports}件）に達しています。既存のエクスポートを削除してください`,
		);
	}

	// エクスポートデータ構築
	const { data, description } =
		exportType === 'template'
			? await buildTemplateExportData(tenantId)
			: await buildFullExportData(tenantId);

	// PIN生成 + S3保存
	const pinCode = await generateUniquePin();
	const s3Key = `exports/${tenantId}/${pinCode}/data.json`;
	const dataBytes = new TextEncoder().encode(data);

	await repos.storage.saveFile(s3Key, Buffer.from(dataBytes), 'application/json');

	// DB記録
	const expiresAt = calculateExpiry();
	await repos.cloudExport.insert({
		tenantId,
		exportType,
		pinCode,
		s3Key,
		fileSizeBytes: dataBytes.length,
		label: label ?? null,
		description,
		expiresAt,
	});

	logger.info('[cloud-export] エクスポート作成', {
		context: { tenantId, exportType, pinCode, size: dataBytes.length },
	});

	return { pinCode, expiresAt, exportType, fileSizeBytes: dataBytes.length, description };
}

/** 自テナントのクラウドエクスポート一覧を取得 */
export async function listCloudExports(tenantId: string): Promise<CloudExportRecord[]> {
	const repos = getRepos();
	const all = await repos.cloudExport.findByTenant(tenantId);
	const now = new Date().toISOString();
	// 有効期限切れをフィルタ（表示はするがexpiredフラグ付き）
	return all.filter((e) => e.expiresAt > now && e.downloadCount < e.maxDownloads);
}

/** クラウドエクスポートを削除 */
export async function deleteCloudExport(id: number, tenantId: string): Promise<void> {
	const repos = getRepos();
	const record = await repos.cloudExport.findById(id, tenantId);
	if (!record) throw new Error('エクスポートが見つかりません');

	// S3からも削除
	try {
		await repos.storage.deleteByPrefix(record.s3Key);
	} catch {
		// S3削除失敗はログのみ（DB側は削除する）
		logger.warn('[cloud-export] S3削除失敗', { context: { s3Key: record.s3Key } });
	}

	await repos.cloudExport.deleteById(id, tenantId);
	logger.info('[cloud-export] エクスポート削除', { context: { id, tenantId } });
}

/** PINコードでクラウドエクスポートデータを取得（インポート用） */
export async function fetchCloudExportByPin(pinCode: string): Promise<{
	record: CloudExportRecord;
	data: string;
}> {
	const repos = getRepos();
	const record = await repos.cloudExport.findByPin(pinCode.toUpperCase());

	if (!record) throw new Error('PINコードが無効です');
	if (new Date(record.expiresAt) < new Date())
		throw new Error('このエクスポートは有効期限切れです');
	if (record.downloadCount >= record.maxDownloads)
		throw new Error('このエクスポートはダウンロード回数の上限に達しています');

	// S3からデータ取得
	const fileData = await repos.storage.readFile(record.s3Key);
	if (!fileData) throw new Error('エクスポートデータが見つかりません');

	// ダウンロードカウント増加
	await repos.cloudExport.incrementDownloadCount(record.id);

	return { record, data: fileData.data.toString('utf-8') };
}

/** 期限切れエクスポートを一括削除（Cronジョブ用） */
export async function cleanupExpiredExports(): Promise<number> {
	const repos = getRepos();
	const now = new Date().toISOString();

	// 期限切れレコードを取得（S3削除用）
	// Note: findByTenant は全テナント横断できないので、deleteExpired で一括削除
	const deletedCount = await repos.cloudExport.deleteExpired(now);

	if (deletedCount > 0) {
		logger.info('[cloud-export] 期限切れエクスポート削除', { context: { deletedCount } });
	}

	return deletedCount;
}
