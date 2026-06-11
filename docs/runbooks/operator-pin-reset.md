# Runbook: operator-level PIN reset (#2994 / EPIC #2990)

おやカギコード (parent-gate PIN) を忘れた owner を、**メールに依存せず運用者 (= アプリをデプロイした人) のデプロイ制御面から**救済する手順。PIN は speed bump (子供が親管理画面に入れなければよい程度の仕切り) であり、「サーバ / デプロイ環境の env を書ける = owner 本人」という実認証に寄生する設計 (Issue #2994 / deep research a934ba)。

- **cognito クラウド版のユーザ救済はこの runbook の対象外**: アプリ内の `/auth/reset-pin` (アカウントパスワード再入力、#2993) で自己回復できる。本 runbook の §4 (DynamoDB) は SaaS 運用者によるサポート介入用フォールバック。
- 適用結果: PIN は **未設定状態** に戻り、次回 `/switch` アクセスで**新規作成フロー (#2992)** が表示される (env に新しい平文 PIN を書く方式は不採用 — Vaultwarden の平文警告と同根)。

## 1. 主機構: `PARENT_PIN_RESET` env (AUTH_MODE=local 専用)

任意の**未使用文字列** (日付入り推奨、例: `reset-2026-06-11`) を env に設定して再起動すると、初回リクエスト時に 1 回だけ適用される。

| 性質 | 内容 |
|---|---|
| 冪等 | 同じ token は二度と適用されない (`settings.pin_reset_applied` 照合)。env を消し忘れて再起動しても再 reset されない (Metabase `MB_SETUP_TOKEN` 放置事故の反面教師) |
| no-op | env が無い通常運用では完全に何もしない (攻撃面を増やさない、Vaultwarden `ADMIN_TOKEN` 整合) |
| 適用内容 | `pin_hash` 初期化 (未設定化) + 失敗カウンタ / ロックアウト解除 |
| 記録 | `[AUDIT] [PIN_RESET]` ログ (適用事実 + token prefix) |
| 実装 | `src/lib/server/services/pin-operator-reset.ts` (hooks.server.ts が初回リクエストで評価) |

### docker-compose (NUC セルフホスト)

```bash
# 1. .env (docker-compose が読む env file) に追記
echo 'PARENT_PIN_RESET=reset-2026-06-11' >> .env

# 2. 再起動 → ブラウザでアプリに 1 回アクセス (初回リクエストで適用)
docker compose up -d --force-recreate app

# 3. ログで適用を確認
docker compose logs app | grep PIN_RESET

# 4. 適用後は env を削除して再起動 (衛生。残しても冪等で再適用はされない)
#    .env から PARENT_PIN_RESET 行を削除
docker compose up -d --force-recreate app
```

### PaaS (Heroku 型 config vars)

```bash
heroku config:set PARENT_PIN_RESET=reset-2026-06-11 -a <app>   # 設定で自動再起動
heroku logs -a <app> | grep PIN_RESET                           # 適用確認 (要 1 アクセス)
heroku config:unset PARENT_PIN_RESET -a <app>                   # 適用後 unset
```

> Render / Railway / Fly.io 等も「config vars 設定 → 再デプロイ → 1 アクセス → unset」の同型。

## 2. フォールバック: SQLite 直接操作 (docker / NUC、env が使えない場合)

```bash
# コンテナ内の DB を直接初期化 (settings は key-value)
docker compose exec app sqlite3 /app/data/ganbari-quest.db \
  "UPDATE settings SET value='' WHERE key IN ('pin_hash','pin_locked_until'); \
   UPDATE settings SET value='0' WHERE key='pin_failed_attempts';"
```

ホスト側に DB を bind mount している場合はホストの `sqlite3` でも同じ SQL を実行できる。実行後の再起動は不要 (次のリクエストから未設定扱い)。

## 3. フォールバック: PaaS one-off run

```bash
heroku run -a <app> -- \
  sqlite3 /app/data/ganbari-quest.db \
  "UPDATE settings SET value='' WHERE key IN ('pin_hash','pin_locked_until');"
```

> 注意: PaaS の ephemeral filesystem 構成では SQLite が再デプロイで消える前提のため、そもそも PIN も消える。永続 volume 構成の場合のみ本手順が必要。

## 4. フォールバック: cognito SaaS (DynamoDB、運用者によるサポート介入)

env 方式はマルチテナントの SaaS では対象 tenant を特定できないため使えない。運用者が IAM 権限で該当 tenant の settings item を直接更新する:

```bash
aws dynamodb update-item \
  --table-name <GanbariQuestTable> \
  --key '{"PK":{"S":"TENANT#<tenantId>"},"SK":{"S":"SETTING#pin_hash"}}' \
  --update-expression 'SET #v = :empty' \
  --expression-attribute-names '{"#v":"value"}' \
  --expression-attribute-values '{":empty":{"S":""}}'
```

`pin_locked_until` も同様に空に更新するとロックも解除される。key 構造は `src/lib/server/db/dynamodb/` の settings 実装を参照。IAM 権限を持つ = SaaS 運用者本人であることが認可境界 (AWS Lambda env / IAM の一次資料整合)。

## 5. やらないこと (Pre-PMF、ADR-0010)

- **リカバリーコード / メール magic link の再導入**: PIN は実認証でない (PO 確定、EPIC #2990)
- **IAM-gated reset Lambda の実装**: §4 の `update-item` で代替可能なため文書化に留める
- **`PARENT_PIN_RESET` の必須 env 化**: optional。`check-new-required-env` の必須配布対象にしない
