// src/lib/server/db/dsql/cloud-export-repo.ts
// EPIC #3424 / M4-E PR8c (repo 層 衛星系) / 設計 SSOT: dsql-data-model.md §11.2 / §P9 /
// async-backup-export.md §3.1-§3.2
//
// ICloudExportRepo (cloud_exports) の DSQL backend 実装。設計契約:
//   - **factory 注入** (fitness#8)。全操作が単文のため txn runner 不要。
//   - **§P9 tenant 述語**: findByPin (PIN の無 tenant 単点 lookup、pin_code global UNIQUE が
//     機能要件 — schema §11.2)、findPendingBuilds / findStaleBuildingExports (cron drain の
//     cross-tenant scan) / deleteExpired (retention cron) を除く全メソッドが family_id = tenantId
//     を含む。updateStatus / incrementDownloadCount / deleteById は #2845 B1 の cross-tenant write
//     遮断方針で tenantId 束縛 (不一致は affected 0 の no-op、sqlite と同 shape)。
//   - **UUID surrogate PK**: export_id は gen_random_uuid() 採番。entity.id = export_id 文字列。
//   - **status state machine (#3504/#3509)**: 'building' 遷移時のみ build_started_at = now()、
//     他遷移では NULL に戻す (staleness reclaim の対象から外す)。failure_reason は常に上書き
//     (非 failed 遷移で残渣を消す)。ready 遷移では file_size_bytes / description を同一 UPDATE で
//     確定 (status と成果物メタの不整合防止)。
//   - **行数カウント**: deleteExpired は RETURNING で rows.length を数える (SqlExecutor は
//     rowCount 非公開、daily-mission-complete と同 convention)。

import { sql } from 'drizzle-orm';
import type { ICloudExportRepo } from '../interfaces/cloud-export-repo.interface';
import type { CloudExportRecord, CloudExportStatus } from '../types';
import type { SqlExecutor } from './sql-executor';

interface CloudExportRow {
	export_id: string;
	family_id: string;
	export_type: string;
	pin_code: string;
	s3_key: string;
	file_size_bytes: number;
	label: string | null;
	description: string | null;
	expires_at: string;
	download_count: number;
	max_downloads: number;
	status: string;
	failure_reason: string | null;
	build_started_at: string | null;
	created_at: string;
}

const EXPORT_COLUMNS = sql.raw(
	`export_id, family_id, export_type, pin_code, s3_key, file_size_bytes, label,
	 description, expires_at, download_count, max_downloads, status, failure_reason,
	 build_started_at, created_at`,
);

/** row → CloudExportRecord entity (text カラムの union 型を narrow、sqlite と同 shape)。 */
function toExport(row: CloudExportRow): CloudExportRecord {
	return {
		id: row.export_id,
		tenantId: row.family_id,
		exportType: row.export_type as CloudExportRecord['exportType'],
		pinCode: row.pin_code,
		s3Key: row.s3_key,
		fileSizeBytes: row.file_size_bytes,
		label: row.label,
		description: row.description,
		expiresAt: row.expires_at,
		downloadCount: row.download_count,
		maxDownloads: row.max_downloads,
		status: row.status as CloudExportStatus,
		failureReason: row.failure_reason,
		buildStartedAt: row.build_started_at,
		createdAt: row.created_at,
	};
}

/** DSQL 用 ICloudExportRepo を生成する (db は注入、fitness#8)。 */
export function createDsqlCloudExportRepo(db: SqlExecutor): ICloudExportRepo {
	return {
		async findByTenant(tenantId) {
			const result = await db.execute(sql`
				SELECT ${EXPORT_COLUMNS} FROM cloud_exports
				WHERE family_id = ${tenantId}
				ORDER BY created_at DESC, export_id DESC
			`);
			return (result.rows as unknown as CloudExportRow[]).map(toExport);
		},

		async findByPin(pinCode) {
			// pin_code global UNIQUE の無 tenant 単点 lookup (§11.2 機能要件)。
			const result = await db.execute(sql`
				SELECT ${EXPORT_COLUMNS} FROM cloud_exports WHERE pin_code = ${pinCode}
			`);
			const row = result.rows[0] as unknown as CloudExportRow | undefined;
			return row ? toExport(row) : undefined;
		},

		async findById(id, tenantId) {
			const result = await db.execute(sql`
				SELECT ${EXPORT_COLUMNS} FROM cloud_exports
				WHERE family_id = ${tenantId} AND export_id = ${id}
			`);
			const row = result.rows[0] as unknown as CloudExportRow | undefined;
			return row ? toExport(row) : undefined;
		},

		async insert(input) {
			// #3574 ①: expire-then-purge。pin_code は expire 後の値再利用が前提 (§11.2) だが global
			// UNIQUE のため、自 family の dead 旧行 (期限切れ or DL 上限到達) が同 pin を占有したまま
			// 再発行すると UNIQUE 衝突で沈黙失敗する。挿入前に自 family の再利用可能な旧行を purge する。
			// live 行 (自/他 family) が占有していれば purge 対象外 → UNIQUE 衝突が surface する
			// (= 2 live 行防止は維持)。purge を自 family scope に限定し他 family の行には触れない (§P9)。
			await db.execute(sql`
				DELETE FROM cloud_exports
				WHERE family_id = ${input.tenantId} AND pin_code = ${input.pinCode}
					AND (expires_at < now() OR download_count >= max_downloads)
			`);
			const result = await db.execute(sql`
				INSERT INTO cloud_exports
					(family_id, export_type, pin_code, s3_key, file_size_bytes, label, description,
					 expires_at, max_downloads, status)
				VALUES (${input.tenantId}, ${input.exportType}, ${input.pinCode}, ${input.s3Key},
					${input.fileSizeBytes}, ${input.label ?? null}, ${input.description ?? null},
					${input.expiresAt}::timestamptz, ${input.maxDownloads ?? 10},
					${input.status ?? 'pending'})
				RETURNING ${EXPORT_COLUMNS}
			`);
			const row = result.rows[0] as unknown as CloudExportRow | undefined;
			if (!row) throw new Error('insert: insert returned no row');
			return toExport(row);
		},

		async updateStatus(id, tenantId, status, opts) {
			// #3504/#3509: failure_reason は常に上書き (非 failed 遷移で残渣を消す)。
			// build_started_at は 'building' 遷移時のみ now()、他遷移では NULL に戻す。
			const sets: ReturnType<typeof sql>[] = [
				sql`status = ${status}`,
				sql`failure_reason = ${opts?.failureReason ?? null}`,
				status === 'building' ? sql`build_started_at = now()` : sql`build_started_at = NULL`,
			];
			if (opts?.fileSizeBytes !== undefined) {
				sets.push(sql`file_size_bytes = ${opts.fileSizeBytes}`);
			}
			if (opts?.description !== undefined) {
				sets.push(sql`description = ${opts.description}`);
			}
			await db.execute(sql`
				UPDATE cloud_exports SET ${sql.join(sets, sql`, `)}
				WHERE family_id = ${tenantId} AND export_id = ${id}
			`);
		},

		async claimForBuild(id, tenantId) {
			// #3522: pending → building の CAS claim (楽観ロック)。status='pending' 条件付き UPDATE で
			// 更新できた行のみ RETURNING され (rows.length === 1)、DSQL の OCC (楽観並行制御) が
			// 二重 build を単一 worker に絞る。'building' 遷移なので build_started_at=now /
			// failure_reason=NULL も確定する (updateStatus('building') と同じ副次値)。
			const result = await db.execute(sql`
				UPDATE cloud_exports
				SET status = 'building', build_started_at = now(), failure_reason = NULL
				WHERE family_id = ${tenantId} AND export_id = ${id} AND status = 'pending'
				RETURNING export_id
			`);
			return result.rows.length === 1;
		},

		async findPendingBuilds(limit) {
			// #3504: build 待ちを tenant 横断で createdAt asc に最大 limit 件 (cron drain、§11.2)。
			const result = await db.execute(sql`
				SELECT ${EXPORT_COLUMNS} FROM cloud_exports
				WHERE status = 'pending'
				ORDER BY created_at ASC, export_id ASC
				LIMIT ${limit}
			`);
			return (result.rows as unknown as CloudExportRow[]).map(toExport);
		},

		async findStaleBuildingExports(staleThresholdMs) {
			// #3509: build_started_at が閾値より古い building 行の reclaim (NULL も fail-safe で stale 扱い)。
			const cutoff = new Date(Date.now() - staleThresholdMs).toISOString();
			const result = await db.execute(sql`
				SELECT ${EXPORT_COLUMNS} FROM cloud_exports
				WHERE status = 'building'
					AND (build_started_at IS NULL OR build_started_at < ${cutoff}::timestamptz)
			`);
			return (result.rows as unknown as CloudExportRow[]).map(toExport);
		},

		async incrementDownloadCount(id, tenantId) {
			// #2845 B1: tenantId 所有権検証付き。不一致なら affected 0 の no-op。
			await db.execute(sql`
				UPDATE cloud_exports SET download_count = download_count + 1
				WHERE family_id = ${tenantId} AND export_id = ${id}
			`);
		},

		async deleteById(id, tenantId) {
			await db.execute(sql`
				DELETE FROM cloud_exports WHERE family_id = ${tenantId} AND export_id = ${id}
			`);
		},

		async deleteExpired(now) {
			// #3625: 削除件数は CTE で DB 側 count 集約し、削除全行を client に materialize しない。
			const result = await db.execute(sql`
				WITH deleted AS (
					DELETE FROM cloud_exports WHERE expires_at < ${now}::timestamptz
					RETURNING 1
				)
				SELECT count(*)::int AS c FROM deleted
			`);
			return Number((result.rows[0] as { c: number }).c);
		},

		async countByTenant(tenantId) {
			const result = await db.execute(sql`
				SELECT count(*) AS c FROM cloud_exports WHERE family_id = ${tenantId}
			`);
			return Number((result.rows[0] as { c: unknown }).c);
		},
	};
}
