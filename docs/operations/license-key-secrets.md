# ライセンスキー HMAC シークレット運用手順書

| 項目 | 内容 |
|------|------|
| ステータス | accepted |
| 最終更新 | 2026-04-11 |
| 対象シークレット | `AWS_LICENSE_SECRET`, `AWS_LICENSE_SECRET_PREVIOUS` |
| 対象環境 | Lambda (prod / staging), ローカル dev |
| 関連 ADR | [ADR-0026（archive）](../decisions/archive/0026-license-key-architecture.md) |
| 関連 Issue | #807, #806 |
| 関連設計書 | [license-key-requirements.md](../design/license-key-requirements.md), [license-subscription-causality.md](../design/license-subscription-causality.md) |

---

## 0. 本書の位置づけ

がんばりクエストのライセンスキーは、`GQ-XXXX-XXXX-XXXX-YYYYY` 形式で最後の 5 文字が HMAC-SHA256 署名（チェックサム）となっている。この HMAC 計算に用いるシークレットが `AWS_LICENSE_SECRET` であり、**これが漏洩するとライセンスキーを第三者が無限に発行できる状態になる**。したがって本シークレットは以下の通り管理すること。

> **本書は ADR-0026（ライセンスキーアーキテクチャ決定）§G2「鍵ローテーション年 1 回 / grace period 90 日」の運用実装詳細である。**

---

## 1. 生成

### 1.1 新規生成コマンド

```bash
# 32 バイト (256 bit) の乱数を hex で出力
openssl rand -hex 32
```

出力例（こちらをそのまま値として使う。64 文字 hex 固定）:

```
c7f8a9d0e1b2c3d4e5f60718293a4b5c6d7e8f9012345678901234567890abcd
```

### 1.2 検証

- 長さが必ず 64 文字（32 byte × 2）であること
- 英小文字 `a-f` と数字 `0-9` のみで構成されること
- 過去 5 年分の値と重複しないこと（履歴は後述 §5 で管理）

### 1.3 絶対禁止事項

- 手書き・推測可能文字列（`ganbari-quest-secret-2026` 等）を使わない
- `uuidgen` 等の他ツール出力を使わない（エントロピーが HMAC-SHA256 要件に満たない場合がある）
- ローカルの開発シークレットを本番に流用しない
- シークレットを Git コミットに含めない（`.env.local` は `.gitignore` 済みだが念押し）

---

## 2. 保管場所

### 2.1 本番・ステージング (AWS)

**推奨**: AWS Secrets Manager

| 項目 | 値 |
|------|---|
| シークレット名 | `ganbari-quest/license-key-hmac` |
| リージョン | `us-east-1` |
| フィールド | `current` (現行), `previous` (grace period 用) |
| KMS キー | AWS マネージドキー (`aws/secretsmanager`) 可。要件厳格化時は CMK へ移行 |
| アクセス | Lambda 実行ロール (`ganbari-quest-app-role`) のみ read 許可 |

**Lambda 注入方式**: Lambda の環境変数にシークレット値を埋め込まず、Secrets Manager から起動時に取得する形式を推奨。

```typescript
// 例: src/lib/server/license-key-service.ts の初期化
import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';

let cachedSecret: { current: string; previous?: string } | null = null;

export async function getLicenseSecret() {
  if (cachedSecret) return cachedSecret;
  const client = new SecretsManagerClient({ region: 'us-east-1' });
  const res = await client.send(new GetSecretValueCommand({
    SecretId: 'ganbari-quest/license-key-hmac',
  }));
  cachedSecret = JSON.parse(res.SecretString ?? '{}');
  return cachedSecret!;
}
```

> 現状コードは `process.env.AWS_LICENSE_SECRET` を直接読む実装 (#806) のため、移行期の暫定として **Lambda 環境変数に Secrets Manager 値を CDK 経由で注入**する。恒久実装は #810 で扱う。

### 2.2 環境変数の命名

| 環境変数 | 用途 | 必須 |
|---------|------|------|
| `AWS_LICENSE_SECRET` | 現行シークレット。新規ライセンスキーの署名・検証に使用 | **必須** (#806 で optional → required に変更予定) |
| `AWS_LICENSE_SECRET_PREVIOUS` | 旧シークレット。ローテーション後の grace period 中のみ検証に使用 | 任意（ローテーション中のみ設定） |

### 2.3 ローカル開発

- `.env.local` に `AWS_LICENSE_SECRET` を記載（ダミー値 `dev-hmac-local-only-do-not-use-in-prod` などで可）
- `.env.example` には値を記載せず、placeholder とコメントのみ
- コミット禁止: `.gitignore` に `.env.local` が含まれていることを確認

---

## 3. ローテーション

### 3.1 ローテーション周期

| タイミング | 周期 |
|-----------|------|
| 定期ローテーション | **年 1 回**（毎年 4 月 1 日を目処） |
| 漏洩時・疑いがある時 | **即時** |
| 人員異動時（権限持ちが退職） | **2 週間以内** |

### 3.2 grace period

ローテーション後、**90 日間** は旧シークレットでも検証可能とする。これにより、ローテーション直前に発行されたライセンスキーが無効化されない。

- 90 日経過後は `AWS_LICENSE_SECRET_PREVIOUS` を削除
- 90 日経過前に新しいローテーションを行う場合は、現行シークレットを previous に格下げし、既存の previous は破棄

### 3.3 ローテーション手順（定期・計画的）

> **所要時間**: 約 30 分（デプロイ時間含む）

1. **現行シークレットをバックアップ**
   - 現行値を `AWS_LICENSE_SECRET_PREVIOUS` にコピー
   - Secrets Manager であれば `previous` フィールドに現行 `current` 値を移動

2. **新シークレットを生成**
   ```bash
   openssl rand -hex 32
   ```

3. **Secrets Manager を更新**
   ```bash
   aws secretsmanager put-secret-value \
     --secret-id ganbari-quest/license-key-hmac \
     --region us-east-1 \
     --secret-string '{"current":"<NEW_HEX>","previous":"<OLD_HEX>"}'
   ```

4. **Lambda を再デプロイ**（CDK / GitHub Actions）
   - main push で自動デプロイ、または手動で `aws lambda update-function-configuration` を実行
   - デプロイ後、コールドスタートでシークレットが再読み込みされる

5. **動作確認**
   - 新シークレットで発行した新規ライセンスキーが `verifyLicenseKey` でパスすること
   - 旧シークレットで発行済みのライセンスキーも引き続きパスすること（grace period の検証）
   - ユニットテスト: `npx vitest run tests/unit/server/license-key-service.test.ts`

6. **90 日後に previous を破棄**
   ```bash
   aws secretsmanager put-secret-value \
     --secret-id ganbari-quest/license-key-hmac \
     --region us-east-1 \
     --secret-string '{"current":"<NEW_HEX>"}'
   ```
   - Lambda を再デプロイして `AWS_LICENSE_SECRET_PREVIOUS` がない状態にする

7. **運用記録**
   - 後述 §5 の履歴ログに追記
   - Issue を起票して CLOSE（例: "ops: HMAC シークレット年次ローテーション 2027-04"）

### 3.4 ローテーション手順（漏洩時・緊急）

> **所要時間**: 15 分以内で実施

1. **即時インシデント起票**
   - `priority:critical` + `area:billing` + `incident` ラベル
   - 漏洩経路の推定、影響範囲の初期評価

2. **新シークレット生成 + Secrets Manager 更新**
   - 通常ローテーションと同じコマンド
   - `previous` フィールドは設定せず、**旧シークレットを即無効化**

3. **Lambda 再デプロイ**

4. **旧シークレットで発行されたライセンスキーを全件再発行**
   - DynamoDB を走査し `status='active'` のキーを列挙
   - 新シークレットで再生成し、旧キーを `revoked` に更新
   - 該当テナントへ新しいライセンスキーをメール通知（サポート窓口経由）

5. **事後対応**
   - 漏洩経路の根本原因分析
   - ADR-0026 §G2 のローテーションポリシー見直しを検討
   - インシデントレポート（`docs/operations/incidents/YYYY-MM-DD-license-secret-leak.md`）を起票

> **注意**: 漏洩時は grace period を設けない。旧シークレットで署名されたキーが攻撃者の手にある可能性を排除できないため。

---

## 4. 旧シークレットでの検証（grace period 実装）

`verifyLicenseKey` は以下の順序で検証する:

1. `AWS_LICENSE_SECRET` (current) で HMAC 照合
2. マッチしない場合、`AWS_LICENSE_SECRET_PREVIOUS` が設定されていれば previous で HMAC 照合
3. どちらもマッチしない → 署名検証失敗

```typescript
// 例: src/lib/server/license-key-service.ts
export function verifyLicenseKey(licenseKey: string): boolean {
  const current = process.env.AWS_LICENSE_SECRET;
  const previous = process.env.AWS_LICENSE_SECRET_PREVIOUS;
  if (!current) {
    throw new Error('AWS_LICENSE_SECRET is required');
  }
  if (verifyWithSecret(licenseKey, current)) return true;
  if (previous && verifyWithSecret(licenseKey, previous)) return true;
  return false;
}
```

> 実装は #810 の対応タスクとする。現状の `verifyLicenseKey` は previous フォールバックを持たないため、ローテーション時は全キー強制再発行が必要になる。

---

## 5. 履歴ログ

ローテーション記録は以下の表に追記すること。実際のシークレット値は絶対に書かない（hash の先頭 4 文字のみ）。

| # | 日付 | 種別 | previous hash | current hash | 実施者 | 関連 Issue |
|---|------|------|--------------|-------------|--------|-----------|
| 0 | （初期） | 初期生成 | — | - | - | #806 (設定時) |
| 1 | 2027-04-01 | 定期 | - | - | - | TBD |

> 運用開始後、毎回追記する。hash は例えば `sha256(secret)` の先頭 4 文字（例: `3f2a`）のみを記録し、値そのものを決して書かない。

---

## 6. 受け入れテスト (本書の Done 基準)

- [x] 生成方法（`openssl rand -hex 32`）記載
- [x] 保管場所（AWS Secrets Manager 推奨）記載
- [x] ローテーション周期（年 1 回 + 漏洩時即時）記載
- [x] grace period (90 日) の運用方法記載
- [x] 漏洩時手順記載
- [x] 環境変数命名規約記載
- [x] ADR-0026 と双方向リンク
- [ ] `AWS_LICENSE_SECRET_PREVIOUS` フォールバック実装 → #810 で別 Issue 化
- [ ] 履歴ログに初回生成記録追記 → #806 の対応時

---

## 7. 関連文書

| ドキュメント | 役割 |
|------------|------|
| [ADR-0026（archive）](../decisions/archive/0026-license-key-architecture.md) | ライセンスキーアーキテクチャ決定記録（上位） |
| [license-key-requirements.md](../design/license-key-requirements.md) | 要件定義書（should-be） |
| [license-subscription-causality.md](../design/license-subscription-causality.md) | License ↔ Stripe 因果関係マップ |
| [runbook.md](./runbook.md) | 障害対応ランブック（上位） |

---

## 更新履歴

| 日付 | 更新内容 | 更新者 |
|------|---------|--------|
| 2026-04-11 | 初版作成 (#807) | Claude Code |
