#!/usr/bin/env node
// scripts/backup-to-gdrive.cjs — STUB (legacy crontab 互換、緊急 hotfix 2026-06-02)
//
// 背景:
// - 本 file は元々 GDrive upload を実装していたが #1442 (scripts/ 棚卸し 58 件削除) で削除された
// - 一部 NUC 環境の crontab / .env (`BACKUP_POST_HOOK`) で旧 path 参照が残存しており、起動失敗 (MODULE_NOT_FOUND)
// - 緊急対応として stub (no-op + warning log) を再配備し、起動失敗を解消
//
// 推奨マイグレーション:
// - 新 path: `scripts/hooks/gdrive-upload.cjs` (現状未実装、必要なら別 issue で再実装)
// - `.env` の `BACKUP_POST_HOOK` を新 path に更新するか、未設定で運用
//
// follow-up: GDrive upload 機能再実装 or 完全廃止判断は別 issue で

const backupPath = process.argv[2];
const ts = new Date().toISOString();

console.warn(`[backup-to-gdrive STUB ${ts}] no-op exit 0 (GDrive upload 未実装)`);
console.warn(`[backup-to-gdrive STUB] backup file: ${backupPath ?? '(none)'}`);
console.warn(
	`[backup-to-gdrive STUB] 推奨: .env BACKUP_POST_HOOK を未設定 or scripts/hooks/gdrive-upload.cjs 実装後にそちらへ更新`,
);

// no-op exit 0 (backup 自体は正常完了済、本 hook 失敗で backup-db.cjs を fail させない)
process.exit(0);
