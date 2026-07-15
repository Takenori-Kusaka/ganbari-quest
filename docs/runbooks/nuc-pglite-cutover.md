# NUC PGlite cutover runbook (旧 sqlite → PGlite)

EPIC #3620 / ADR-0064 §ロールバック保証 (非破壊 import-then-swap) の実行手順。
実行ツール: `scripts/nuc-pglite-cutover.ts` (export / import の 2 subcommand)。

## 前提

- 対象: NUC 本番 (`C:\Docker\ganbari-quest`、DB `data/ganbari-quest.db`) または NUC staging。
- **旧 sqlite DB は全工程で read-only** (CLI が copy に対して export する)。swap 後も物理保持し、問題があれば .env を戻すだけで復帰する。
- バックアップは **cutover 作業の直前に取得** (PO 合意 2026-07-09。旧 DB ファイル一式 + `-wal`/`-shm` を日付付き dir へ copy)。

## 手順

CLI は **app image に同梱** (Dockerfile runtime stage、AC-C5) されており、host に node_modules は不要。
`docker compose run` で実行する (staging lane = `deploy-nuc-staging.yml` の PGlite lane と同一コマンド)。

```bash
# 0. (本番のみ) 直前バックアップ
cp data/ganbari-quest.db* backup/pre-pglite-cutover-$(date +%Y%m%d)/

# 1. アプリ停止 (WAL flush。NUC デプロイ順序と同じ)
docker compose stop app

# 2. export (旧 DB → JSON。原本 read-only、copy に対して実行。CLI は image 同梱)
docker compose run --rm --no-deps app npx tsx scripts/nuc-pglite-cutover.ts export \
  --db /app/data/ganbari-quest.db --out /app/data/.cutover-export.json
#    → counts が表示される (14 軸)。控えておく。

# 3. import (fresh PGlite 構築 + migration 適用 + import + 件数突合)
docker compose run --rm --no-deps app npx tsx scripts/nuc-pglite-cutover.ts import \
  --in /app/data/.cutover-export.json --data-dir /app/data/pglite
#    → 「import + 件数突合 完了」が出れば成功。
#    → errors>0 または件数不一致なら CLI が dataDir を削除して exit 1 (旧 DB 無傷、原因解消後に再実行)。

# 4. swap (.env 切替)
#    DATA_SOURCE=pglite
#    PGLITE_DATA_DIR=/app/data/pglite   (コンテナ内 path。docker-compose の volume に合わせる)

# 5. 起動 + health (health は probePg = PGlite への実接続 + schema 実在検証)
docker compose up -d
curl -s http://localhost:3000/api/health   # 200 + "dataSource":"pglite" + schemaValid:true を確認

# 6. 実画面確認 (子供一覧 / ポイント残高 / 活動記録 1 件)
```

## 中止基準 (errors>0 abort)

- step 3 で import error または件数不一致 → CLI が自動 abort (dataDir 削除済み)。**swap しない**。
- step 5 で health 非 200 / 実画面で子供が見えない → **復帰手順**へ。

## 復帰手順 (ロールバック)

1. `.env` を `DATA_SOURCE=sqlite` (PGLITE_* を除去) に戻す
2. `docker compose up -d` — 旧 sqlite DB は無変更のためそのまま復帰
3. 失敗した `data/pglite` dir は調査後に削除可

## 意図的な再 cutover 手順 (#3713 AC3)

deploy-nuc.yml の cutover step は **`data/pglite` が既存なら skip する** (PGlite 稼働後の deploy で cutover 後データを凍結 snapshot で上書きしないため、PR #3711)。旧 sqlite snapshot から意図的にやり直す場合のみ、以下を手動実行する:

1. NUC 上で PGlite dataDir を退避または削除: `mv data/pglite data/pglite.discard-$(date +%Y%m%d)` — **cutover 以降の記録データは失われる**ことを PO に確認してから実行する
2. `gh workflow run deploy-nuc.yml` を dispatch — Step 2.5 が「dataDir 不在 + legacy sqlite 存在」を検知し cutover を再実行する
3. 完了後 `/api/health` で `dataSource:"pglite"` + 実画面で子供一覧を確認

## 検証済みエビデンス (2026-07-11、AC-C4)

- cross-backend round-trip test: `tests/unit/services/pglite-cutover-roundtrip.test.ts` (内容保全・自然キー再解決)
- CLI 実プロセス E2E: 実 lazy-migration schema の seed DB → export (counts 14 軸) → import → **件数突合 全一致** → reopen で children 実読
- tenant: 旧 'local' → 新 `LOCAL_TENANT_UUID` (`src/lib/server/auth/local-tenant.ts` SSOT。swap 後の local auth が同 UUID を返し帰属一貫)
