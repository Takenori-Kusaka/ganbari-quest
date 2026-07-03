// src/lib/domain/constants/cloud-export-status.ts
// クラウドバックアップ export の非同期 build 状態機械 SSOT (#3504、#3424 で runtime 配列化)。
// 遷移: pending → building → ready / failed (stale building は cron が reclaim、#3509)。
// DSQL cloud_exports.status の CHECK 生成 (fitness#13) と型定義が共有する。

export const CLOUD_EXPORT_STATUSES = ['pending', 'building', 'ready', 'failed'] as const;
export type CloudExportStatus = (typeof CLOUD_EXPORT_STATUSES)[number];
