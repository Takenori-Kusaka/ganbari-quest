# 0020. NUC スケジューラ方式選定 — node-cron + 専用コンテナ

| 項目 | 内容 |
|------|------|
| ステータス | accepted |
| 日付 | 2026-04-24 |
| 起票者 | 開発チーム |
| 関連 Issue | #1375, #1374 |

## コンテキスト

NUC Docker 環境で `/api/cron/license-expire` / `/api/cron/retention-cleanup` / `/api/cron/trial-notifications` を定期実行する仕組みが存在しない。
既存の `backup` サービスは crond で日次バックアップを行うが、設計上 cron ジョブ汎用化は想定されていない。

要件:
- 既存 `src/lib/server/cron/schedule-registry.ts`（新設 SSOT）を参照できること
- docker-compose 内で完結（ホスト OS 依存なし）
- スケジュール定義は TypeScript で型安全に管理
- `docker compose --profile scheduler up` で opt-in 起動
- 通常 `npm run dev` では scheduler 不起動

## 検討した選択肢（OSS / 確立パターン最低 2 件必須 — #1350）

### 選択肢 A: crond（Alpine 標準）

- 概要: Docker コンテナ内で Alpine の crond を使い、static な crontab で endpoint を curl する
- 採用実績: 既存 `backup` サービスで採用済み
- メリット: 既存パターン踏襲・学習コスト 0・追加 npm パッケージ不要
- デメリット: `schedule-registry.ts` との二重管理（crontab + TypeScript の 2 箇所を更新）・SSOT 違反
- Pre-PMF コスト: 低（curl のみ追加）。ただし crontab 更新漏れリスクが残る

### 選択肢 B: node-cron（採用）

- 概要: `node-cron` npm パッケージで cron 式を Node.js プロセス内で解釈し、schedule-registry.ts を直接 import
- npm: [node-cron](https://www.npmjs.com/package/node-cron)（週 1 億 DL 超・MIT）
- 採用実績: Express/NestJS 等の Node サーバで広く使われる定番ライブラリ
- メリット: schedule-registry.ts を SSOT として直接参照可能・TypeScript 統一・型安全なスケジュール定義
- デメリット: Node.js プロセスの常駐が必要
- Pre-PMF コスト: 低（node-cron 150KB 未満・tsx は既存 devDep）

### 選択肢 C: bree（Worker Thread ベース）

- 概要: Worker Thread で各ジョブを独立実行する高機能スケジューラ
- npm: [bree](https://www.npmjs.com/package/bree)（Cabin.js チーム）
- メリット: retry / timeout 組込・ジョブ独立実行でクラッシュ分離
- デメリット: Pre-PMF にはオーバースペック（3 エンドポイントの HTTP POST に retry/worker は不要）
- Pre-PMF コスト: 中（学習コスト + ジョブファイル分割構造が必要）

### 選択肢 D: systemd-timer（ホスト OS）

- 概要: NUC の systemd で timer unit を定義し、docker 外から curl
- メリット: OS native・コンテナ外のログ管理が容易
- デメリット: docker-compose 内で完結しない・NUC セットアップ手順が複雑化・git 管理外になる
- Pre-PMF コスト: 高（NUC セットアップドキュメント + timer unit ファイル管理）

## 決定

**選択肢 B（node-cron + 専用コンテナ）** を採用する。

理由:
1. `schedule-registry.ts` を SSOT として直接 import でき、二重管理が不要
2. TypeScript で schedule 定義が型安全（`CronJob` 型）
3. docker-compose `profiles: scheduler` で opt-in、通常開発に影響なし
4. Pre-PMF フェーズで必要十分（選択肢 C/D は過剰）
5. `tsx` が既存 devDependencies に存在し、追加インストールが最小

## 結果

- `src/lib/server/cron/schedule-registry.ts` を新設（SSOT）
- `scripts/scheduler.ts` を専用コンテナのエントリポイントとして新設
- `Dockerfile.scheduler` を新設（node:22-alpine + tsx + node-cron）
- `docker-compose.yml` に `scheduler` サービスを `profiles: scheduler` で追加
- `CRON_SECRET` を NUC 本番 env として `infra/CLAUDE.md` に追記
- 各 cron endpoint への POST は `x-cron-secret` + `Authorization: Bearer` 両ヘッダを付与（既存 endpoint の auth パターン差異を吸収）

## 制約

- scheduler コンテナはDB に直接アクセスしない（HTTP POST 経由のみ）
- crontab を schedule-registry.ts と別に管理しない（SSOT 原則）
- NUC 本番での `profiles: scheduler` 有効化は `deploy-nuc.yml` の `docker compose up` コマンド修正で行う（本 ADR では scheduler コンテナ定義まで、deploy 組込は Sub A-3 #1377 のスコープ）
