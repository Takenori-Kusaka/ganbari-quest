import { and, asc, count, desc, eq, lt, sql } from 'drizzle-orm';
import { db } from '../client';
import { cloudExports } from '../schema';
import type {
	CloudExportRecord,
	CloudExportStatus,
	InsertCloudExportInput,
	UpdateCloudExportStatusInput,
} from '../types';

/** Drizzle の text カラムは string に推論されるので CloudExportRecord にキャスト */
function toRecord(row: typeof cloudExports.$inferSelect): CloudExportRecord {
	return row as unknown as CloudExportRecord;
}

export async function findByTenant(tenantId: string): Promise<CloudExportRecord[]> {
	const rows = await db
		.select()
		.from(cloudExports)
		.where(eq(cloudExports.tenantId, tenantId))
		.orderBy(desc(cloudExports.createdAt))
		.all();
	return rows.map(toRecord);
}

export async function findByPin(pinCode: string): Promise<CloudExportRecord | undefined> {
	const row = db.select().from(cloudExports).where(eq(cloudExports.pinCode, pinCode)).get();
	return row ? toRecord(row) : undefined;
}

export async function findById(
	id: number,
	tenantId: string,
): Promise<CloudExportRecord | undefined> {
	const row = db
		.select()
		.from(cloudExports)
		.where(and(eq(cloudExports.id, id), eq(cloudExports.tenantId, tenantId)))
		.get();
	return row ? toRecord(row) : undefined;
}

export async function insert(input: InsertCloudExportInput): Promise<CloudExportRecord> {
	const now = new Date().toISOString();
	const row = db
		.insert(cloudExports)
		.values({
			tenantId: input.tenantId,
			exportType: input.exportType,
			pinCode: input.pinCode,
			s3Key: input.s3Key,
			fileSizeBytes: input.fileSizeBytes,
			label: input.label ?? null,
			description: input.description ?? null,
			expiresAt: input.expiresAt,
			maxDownloads: input.maxDownloads ?? 10,
			createdAt: now,
			status: input.status ?? 'pending',
		})
		.returning()
		.get();
	return toRecord(row);
}

/**
 * #3504: 非同期 build 状態遷移 (tenantId 束縛)。ready 時は成果物メタ (size/description) も更新。
 * #3509 QM 是正: 'building' 遷移時は buildStartedAt を now() で記録し、それ以外の遷移
 * (pending/ready/failed) では null に戻す (staleness reclaim の対象から外す)。
 */
export async function updateStatus(
	id: number,
	tenantId: string,
	status: CloudExportStatus,
	opts?: UpdateCloudExportStatusInput,
): Promise<void> {
	// failureReason は常に上書き: opts 指定があればそれを、無ければ null (非 failed 遷移で残渣を消す)。
	const patch: Partial<typeof cloudExports.$inferInsert> = {
		status,
		failureReason: opts?.failureReason ?? null,
		buildStartedAt: status === 'building' ? new Date().toISOString() : null,
	};
	if (opts?.fileSizeBytes !== undefined) patch.fileSizeBytes = opts.fileSizeBytes;
	if (opts?.description !== undefined) patch.description = opts.description;
	db.update(cloudExports)
		.set(patch)
		.where(and(eq(cloudExports.id, id), eq(cloudExports.tenantId, tenantId)))
		.run();
}

/** #3504: build 待ち (status='pending') を tenant 横断で createdAt asc に最大 limit 件返す。 */
export async function findPendingBuilds(limit: number): Promise<CloudExportRecord[]> {
	const rows = await db
		.select()
		.from(cloudExports)
		.where(eq(cloudExports.status, 'pending'))
		.orderBy(asc(cloudExports.createdAt))
		.limit(limit)
		.all();
	return rows.map(toRecord);
}

/**
 * #3509 QM 是正: status='building' かつ buildStartedAt が staleThresholdMs より古いレコードを
 * tenant 横断で返す (cron worker が build 中に kill/timeout し永久 stuck した行の reclaim 用)。
 * buildStartedAt が NULL (旧行、想定外だが fail-safe) も stale 扱いで含める。
 */
export async function findStaleBuildingExports(
	staleThresholdMs: number,
): Promise<CloudExportRecord[]> {
	const cutoff = new Date(Date.now() - staleThresholdMs).toISOString();
	const rows = await db
		.select()
		.from(cloudExports)
		.where(
			and(
				eq(cloudExports.status, 'building'),
				sql`(${cloudExports.buildStartedAt} IS NULL OR ${cloudExports.buildStartedAt} < ${cutoff})`,
			),
		)
		.all();
	return rows.map(toRecord);
}

/** #2845 B1: tenantId 所有権検証付き (composite key)。不一致なら affected 0 の no-op。 */
export async function incrementDownloadCount(id: number, tenantId: string): Promise<void> {
	db.update(cloudExports)
		.set({ downloadCount: sql`${cloudExports.downloadCount} + 1` })
		.where(and(eq(cloudExports.id, id), eq(cloudExports.tenantId, tenantId)))
		.run();
}

export async function deleteById(id: number, tenantId: string): Promise<void> {
	db.delete(cloudExports)
		.where(and(eq(cloudExports.id, id), eq(cloudExports.tenantId, tenantId)))
		.run();
}

export async function deleteExpired(now: string): Promise<number> {
	const result = db.delete(cloudExports).where(lt(cloudExports.expiresAt, now)).run();
	return result.changes;
}

export async function countByTenant(tenantId: string): Promise<number> {
	const result = db
		.select({ value: count() })
		.from(cloudExports)
		.where(eq(cloudExports.tenantId, tenantId))
		.get();
	return result?.value ?? 0;
}
