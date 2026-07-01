import type {
	CloudExportRecord,
	CloudExportStatus,
	InsertCloudExportInput,
	UpdateCloudExportStatusInput,
} from '../types';

export interface ICloudExportRepo {
	findByTenant(tenantId: string): Promise<CloudExportRecord[]>;
	findByPin(pinCode: string): Promise<CloudExportRecord | undefined>;
	findById(id: number, tenantId: string): Promise<CloudExportRecord | undefined>;
	insert(input: InsertCloudExportInput): Promise<CloudExportRecord>;
	/**
	 * 非同期 build 状態遷移 (async-backup-export.md §3.2)。tenantId で束縛して更新する
	 * (#2845 B1 と同じ cross-tenant write 遮断方針)。
	 *
	 * 第 4 引数 `opts` は status 遷移に付随する副次値をまとめて更新する:
	 * - `failureReason`: status='failed' 時の理由 (それ以外の遷移では null 化して残渣を消す)
	 * - `fileSizeBytes` / `description`: build 完了 (`ready`) 時に確定する成果物メタ。pending insert
	 *   時点では未確定 (0 / null) のため ready 遷移とアトミックに埋める。
	 *
	 * > 設計 §3.2 は `updateStatus(id, tenantId, status, failureReason?)` を要求するが、pending→ready で
	 * > fileSizeBytes / description も確定させる必要があるため、失敗理由を含む options object 形に一般化した
	 * > (単一 mutation に集約し status と成果物メタの不整合を防ぐ)。
	 */
	updateStatus(
		id: number,
		tenantId: string,
		status: CloudExportStatus,
		opts?: UpdateCloudExportStatusInput,
	): Promise<void>;
	/**
	 * build 待ち (status='pending') のレコードを tenant 横断で最大 limit 件返す (cron drain 用)。
	 * deleteExpired と同じく低頻度・全 tenant 走査 (DynamoDB は Scan) を許容する。
	 */
	findPendingBuilds(limit: number): Promise<CloudExportRecord[]>;
	/**
	 * #3509 QM 是正 (async-backup-export.md §3.2 追補): status='building' かつ
	 * buildStartedAt が staleThresholdMs より古いレコードを tenant 横断で返す
	 * (cron worker が build 中に kill/timeout し永久 stuck した行の reclaim 用)。
	 */
	findStaleBuildingExports(staleThresholdMs: number): Promise<CloudExportRecord[]>;
	/**
	 * #2845 B1: tenantId 必須 (旧 id-only は DynamoDB 側で tenant 無束縛 Scan + 全 tenant write 可能形状)。
	 * 呼び出し元 (findByPin 経路) は record.tenantId を持つため signature で束縛する。
	 */
	incrementDownloadCount(id: number, tenantId: string): Promise<void>;
	deleteById(id: number, tenantId: string): Promise<void>;
	deleteExpired(now: string): Promise<number>;
	countByTenant(tenantId: string): Promise<number>;
}
