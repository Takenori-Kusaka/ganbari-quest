# 非同期 backup export + 一時 DL リンク（確定設計）

> **位置づけ**: backup-import-redesign §5 P5「大容量・スケール対応」の確定設計。同期生成→レスポンス直返しの配信経路が
> AWS/NUC 双方で破綻する問題への是正。実装は既存 `cloud-export-service` の拡張で行い、使い捨て機構を新設しない。
> 関連: [backup-import-redesign.md](backup-import-redesign.md) §5 / #3326（import 原子境界）/ #3437（AWS Backup PITR 役割分担）/ #3436（DSQL chunk+saga）

## 1. 設計背景（なぜ非同期化が必要か）

現状 `/api/v1/export?format=zip` は ZIP を **request レスポンス body で直接返す**同期方式。これが両 runtime で破綻する:

- **AWS 本番の実効天井は 6MB / 30 秒**（`MAX_ZIP_SIZE=100MB` ではない）。Function URL が **BUFFERED**（レスポンス body 6MB hard cap、`compute-stack.ts:337`）+ Lambda **30 秒 timeout**（`:222`）+ 512MB メモリ（`:221`）。大きめのフル ZIP は 6MB で配信不能になり 500。
- **NUC でも**、大容量 ZIP の**生成時間中にリクエストが返らず**、ブラウザ / リバースプロキシ（nginx 等）の timeout・接続断に晒され、進捗も見えない。

→ 「同期生成してレスポンスで返す」は runtime を問わず不適。**生成を背景化し、生成物は別の DL 経路で渡す**必要がある。S3 presigned は Lambda body 6MB も 30 秒も迂回する。

## 2. 設計原則

1. **両 runtime 非同期を前提**（AWS/NUC とも）。生成 = 背景ジョブ、client = polling、DL = 別経路、の 1 本化フロー。片方だけ同期にしない（NUC も browser/proxy timeout に晒されるため）。
2. **既存 `cloud-export-service` を最大再利用**。S3 key 体系（`exports/${tenantId}/${pinCode}/`）/ TTL 7 日 / DL カウント / cron 掃除（`cleanupExpiredExports`）はそのまま流用。使い捨て機構を新設しない。
3. **非同期基盤 = 既存 cron に job 1 つ追加**（新インフラ 0）。fire-and-forget は AWS で不可（レスポンス後に Lambda freeze）。SQS/StepFunctions は Pre-PMF 過剰（ADR-0010）。EventBridge → cron-dispatcher → `/api/cron/:job` を再利用。
4. **配信は dual**（生成は unified、配信のみ runtime 差）: AWS = S3 presigned URL へ 302 redirect / NUC = 署名付きアプリ route が `storage.readFile` から stream。`IStorageRepo.getDownloadUrl(key, opts)` が `{kind:'redirect', url}`（AWS）/ `{kind:'proxy'}`（NUC）を返し、DL route が分岐。
5. **セキュリティ（CWE-598）**: 一時リンクは「リンクを持つ誰でも DL 可」になる。子供データ ZIP のため、発行 route で認証 + tenant 一致必須 / presigned TTL 短命（60〜300 秒）/ DL 用カウンタ / NUC は `static/` 外へ保存（無認証 web 配信の回避）。
6. **分割バックアップは繰延**。presigned が単一ファイルの配信上限を外すため配信目的の分割は不要。#3437 で DR/全体復旧を AWS Backup PITR が持ち**アプリ層 export は 1 家族分に上限**される。分割は #3326 import-then-swap 境界 / #3436 DSQL saga と一体設計すべきで、単一家族が生成時 512MB に抵触する実データが出るまで着手しない。
7. **#3437 役割分担**: DR / 全体復旧 = AWS Backup PITR（インフラ層・全テナント）。家族単位 export = アプリ層（1 tenant・ユーザー操作）。

## 3. 仕様

### 3.1 `cloud_exports` に status カラム追加
`status: 'pending' | 'building' | 'ready' | 'failed'` + `failureReason: string | null` + **`updatedAt: string`（全 status 遷移で更新、§3.2-4 の stale reclaim 判定に使用）** を追加（`schema.ts` + `types/index.ts` + `cloud-export-repo.interface.ts` + sqlite/dynamodb/demo 3 実装）。DB migration は DSQL 移管（#3433）と同期。既存カラム（id/tenantId/exportType/pinCode/s3Key/fileSizeBytes/label/expiresAt/downloadCount/maxDownloads/createdAt）は不変。

### 3.2 生成フロー（同期 build → pending + cron-drain）
1. export 起票 route が `cloud_exports` を **`status='pending'` で insert して即返す**（ZIP は作らない）。`createCloudExport` の同期 `buildFullBackupZip`（現 `:212-215`）を分離。
2. 新 cron job **`export-build`**（`schedule-registry.ts` に 1 エントリ、例 1〜5 分毎）→ 既存 `/api/cron/:job` → `status='pending'` を拾い `status='building'` → `buildFullBackupZip` → storage 保存 → `status='ready'`（失敗時 `status='failed'` + `failureReason`）。
3. 同一 job を **AWS（cron-dispatcher）と NUC（scheduler container `--profile scheduler`）の双方**が回す（dual runtime 同一コードパス）。
4. **stale `building` の reclaim（cron 自己タイムアウト検知）**: `cloud_exports` に `updatedAt`（全 status 遷移で `updateStatus` が更新するタイムスタンプ）を追加する。同一 job（`export-build` = `drainPendingExports`）が **新規 pending を拾う前に毎回**、`status='building'` かつ `updatedAt` が **10 分**（cron cadence 5 分 × 2 サイクル分、Lambda timeout・大容量 ZIP 生成時間を踏まえた安全マージン）超過のレコードを検出し、`status='failed'` + `failureReason='ビルドがタイムアウトしました。再度エクスポートしてください'` へ強制遷移する。reclaim 実行主体は **cron の次回実行時に自分自身が検知する**（別ジョブを新設しない、既存 dual runtime 同一コードパスに相乗り）。
   - `pending` への差し戻し（自動再試行）は採用しない。ワーカーが low-level で kill された場合、対象 ZIP が不完全に S3/FS へ書き込まれている可能性があり、自動リトライは重複書込み・競合を生みうるため、**fail-closed（failed 化）してユーザーに再エクスポートを促す**方が安全（Pre-PMF、ADR-0010 過剰実装回避）。
   - stuck 状態の UI 表示は §3.3 の `listCloudExports` が返す `status` にそのまま従う。reclaim 後は `status='failed'` になるため、既存の「生成状況を UI に見せる」フロー（pending/building/failed を返す）が失敗表示にそのまま反映し、無限「生成中…」表示を防ぐ。reclaim 前（10 分以内）は通常の `building` 表示のまま。

### 3.3 状態管理（polling）
既存 `GET /api/v1/export/cloud`（`listCloudExports`）に status を含める。client は既存 endpoint を polling するだけ（専用 status endpoint 不要）。現 filter（`expiresAt > now && downloadCount < maxDownloads`）を status 対応に修正し、pending/building/failed も返す（生成中が UI から消えないように）。

### 3.4 DL 経路（新設）
`GET /api/v1/export/cloud/[id]/download`: `requireRole(locals,['owner','parent'])` + `record.tenantId === context.tenantId` 検証（既存 `[id]/+server.ts` DELETE と同パターン）→ `status==='ready'` を確認 → `storage.getDownloadUrl(s3Key, {expiresIn})`:
- AWS: S3 presigned GET（`@aws-sdk/s3-request-presigner` `getSignedUrl`、TTL 60〜300 秒、対象 key 限定）→ 302 redirect。
- NUC: `{kind:'proxy'}` → 同 route が `storage.readFile(s3Key)` を認証済で stream（`static/` 直配信しない）。
DL 用カウンタで single-use 寄りに制御（import 用 `consumeCloudExportDownload` とは意味が別のため分離）。

### 3.5 NUC storage の是正
NUC の `saveFile` は `static/` 配下（web 配信対象）しか許さない（`sqlite/storage-repo.ts` `resolveContainedPath`）。cloud-export の子供データ ZIP を `static/exports/…` に置くと**無認証 web 配信され得る**。NUC は **`static/` 外（例 `data/exports/`）へ保存する経路**を用意し、専用の contained-path 検証（zip-slip 防御）を持たせる。現状 NUC で throw している制約（`cloud-export-service.ts:191`）を、この安全な保存経路の整備とセットで解除する。

### 3.6 Pre-PMF スコープ（ADR-0010）

**今やる（speculative でない・現実の欠落補修）**: 3.1 status カラム / 3.2 pending+cron-drain / 3.3 status polling / 3.4 DL route（presigned + proxy）/ 3.5 NUC `static/` 外保存。

**トリガまで待つ**: 分割バックアップ（§2-6、単一家族が生成時 512MB に抵触したら #3436 saga と同時設計）/ SQS・StepFunctions（cron-drain の latency がユーザー体感を害する実測が出たら async self-invoke → その次に SQS）/ build Lambda メモリ増（実 OOM が出たら）。

### 3.7 実装対象ファイル
`cloud-export-service.ts`（生成分離 + stale reclaim を `drainPendingExports` 冒頭に実装）/ `storage.interface.ts` + dynamodb/sqlite/demo storage-repo（`getDownloadUrl`）/ `schema.ts` + types + cloud-export-repo 3 実装（status + `updatedAt` + `findStaleBuilds(timeoutMs)`）/ `routes/api/v1/export/cloud/[id]/download/+server.ts`（新設）/ `schedule-registry.ts`（export-build job）/ `infra/lib/compute-stack.ts`（cron rule）。

> 根拠調査（実測制約・案比較）は git 履歴の設計調査（2026-07-01）参照。実 transform 不要の identity 部分は作らず、生成非同期化と DL 経路の欠落補修に絞る。
