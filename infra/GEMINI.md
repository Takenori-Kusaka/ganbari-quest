# infra/ — デプロイ・環境変数

## 環境変数配布の手順 (#911)
新規 env 追加時は以下の **4箇所すべて** に配布すること:
1. `ci.yml` (E2Eテスト用ダミー)
2. `deploy.yml` (テスト用ダミー)
3. AWS Lambda (CDK context 経由で GitHub Secrets から注入)
4. NUC サーバー (self-hosted runner が GitHub Secrets から `.env` 生成)

## AWS Cost Explorer API 制限
- API 呼び出しは 1回 $0.01 かかるため、**1日1回** を上限とする。
- リアルタイムクエリは避け、DB にキャッシュした値を表示する。

## デプロイ順序 (NUC)
SQLite の破損防止のため、必ず以下の順序を守る:
1. `docker compose stop app`
2. `node scripts/migrate-xxx.cjs` (DB マイグレーション)
3. `git pull` & `docker compose build`
4. `docker compose up -d`
