# ライセンスキー HMAC 署名 必須化 移行計画

| 項目 | 内容 |
|------|------|
| ステータス | accepted (計画策定、実装は sub-Issue 3 件で段階実施) |
| 最終更新 | 2026-05-22 |
| 起票 Issue | #2398 |
| 上位要件 | [docs/design/license-key-requirements.md](../design/license-key-requirements.md) (#812) |
| 上位設計書 | [docs/design/license-key-lifecycle.md](../design/license-key-lifecycle.md) §2.2 (LEGACY vs SIGNED) |
| 関連 ADR | ADR-0010 (Pre-PMF scope 判断) / archive/0026 (license key architecture) |
| シークレット運用 | [docs/operations/license-key-secrets.md](license-key-secrets.md) |
| Pre-PMF Bucket | A: 実装 + 訴求 (セキュリティ後退の根本解決) |

---

## 0. 本書の位置づけ

ライセンスキー HMAC 署名 (#797 / #806 / #812) を **optional → 必須化**するための **3 phase 段階移行計画**。
本書は計画策定 SSOT であり、実装は配下 sub-Issue 3 件 (Phase 1 / 2 / 3) で段階的に行う。

> **本 PR (Issue #2398 対応) は計画策定のみ。実 code 変更は sub-Issue 3 件で別 PR とする。**

---

## 1. 背景

### 1.1 現状 (legacy 受入経路の存在)

`src/lib/server/services/license-key-service.ts` に `isLegacyFormatAllowed()` が存在し、
以下条件で HMAC 署名のない legacy 形式 (`GQ-XXXX-XXXX-XXXX`、12 文字ペイロード + チェックサムなし) を受け入れる:

| 環境 | secret 状態 | `ALLOW_LEGACY_LICENSE_KEYS` | 受入可否 |
|------|-----------|-----------------------------|--------|
| production | 未設定 | — | **起動失敗** (#806 で assertLicenseKeyConfigured) |
| production | 設定済み | `true` | **受入** (移行期 opt-in) |
| production | 設定済み | 未設定 / `false` | reject |
| dev | — | — | 常に受入 (既存テスト互換) |
| test | — | — | 常に受入 |

### 1.2 セキュリティ後退の具体的リスク

- **改ざん検知不可**: legacy key は HMAC 署名がないため、攻撃者が KEY_CHARS (32 文字、0/O/1/I 除外) から
  任意の 12 文字組合せで偽造可能 → DB lookup に到達する前段で reject できない
- **brute-force 検知の母数低下**: 偽造 key が format 検査を通過するため `rate-limit-service.ts`
  (IP: 10/min, email: 20/hour) で記録されるが、署名検証段階での先行 reject 機構がない
- **監査ログ汚染**: legacy key 利用は `[LICENSE] Legacy format key used:` の info ログのみで、
  「合法な legacy 利用」と「偽造 brute-force」が同一ログレベルで混在

### 1.3 #797 / #806 / #812 follow-up としての位置づけ

- #797 (closed 2026-04-11): LicenseRecord に `expiresAt` / `revokedAt` / `revokedReason` 追加
- #806 (closed 2026-04-11): `AWS_LICENSE_SECRET` を production 必須化 + `ALLOW_LEGACY_LICENSE_KEYS` opt-in 導入
- #812 (closed 2026-04-11): 要件定義書策定。should-be として「HMAC 必須化」が定義済みだが切替時期未決

本計画は #806 で導入した opt-in (`ALLOW_LEGACY_LICENSE_KEYS=true`) の使命を完了させる作業。

---

## 2. legacy key 残存数調査

### 2.1 集計 query

legacy key は format `GQ-XXXX-XXXX-XXXX` で検出可能 (全長 14 文字 vs SIGNED 22 文字)。
DB ストレージ別の集計 query:

#### DynamoDB (production)

```bash
# Lambda 経由で集計 (PartiQL)
# テーブル名は env 駆動 (process.env.DYNAMODB_TABLE / TABLE_NAME、default 'ganbari-quest'
# — `src/lib/server/db/dynamodb/client.ts:8` 参照)。production / staging で異なるため、
# 実行環境の env 値を $DDB_TABLE に注入して呼ぶ。
DDB_TABLE="${DYNAMODB_TABLE:-${TABLE_NAME:-ganbari-quest}}"
aws dynamodb execute-statement \
  --statement "SELECT count(*) FROM \"${DDB_TABLE}\" WHERE begins_with(\"PK\", 'LICENSE#') AND size(\"licenseKey\") < 22"
```

PK プレフィックスは `LICENSE#`（`src/lib/server/db/dynamodb/auth-keys.ts:50-52` SSOT、`licenseKey()` 関数）。
または Lambda の ops endpoint (`/ops/license/legacy-count`) を Phase 1 で追加する案も検討
(ops 専用、`ops_users` group 認証必須)。

#### SQLite (NUC ローカル / local mode)

> **※ NUC (SQLite mode) は license key 永続化対象外のため本集計は SaaS / DynamoDB only**
>
> `DATA_SOURCE=sqlite` の `IAuthRepo` 実装 (`src/lib/server/db/sqlite/auth-repo.ts:106-128`) では
> `saveLicenseKey` / `findLicenseKey` / `listLicenseKeysByTenant` / `countLicenseKeys` 等が
> 全て **no-op または空配列返却** として実装されており、license key は永続化されない。
> 従って NUC local mode 下では legacy key 残存数は構造的に 0 件であり、本 §2 の集計対象から除外する。
> Phase 1 / 2 / 3 の AC で参照される「legacy 残存数」は全て **SaaS (DynamoDB) backend のみ** を指す。

### 2.2 集計結果記録ルール

- Phase 1 完了時点で本書 §6 「実績ログ」に集計値と日付を記録
- production / NUC fleet (もし複数ある場合) ごとに集計
- 残存 0 件確認後に Phase 2 着手

---

## 3. 移行期限策定

### 3.1 判断根拠

| 観点 | 判断 |
|------|------|
| Pre-PMF stage | サインアップ 20 名/月 (V2MOM Q2)、legacy 受入でも acquisition 可 |
| Bucket 分類 (ADR-0010) | **A: 実装 + 訴求** (セキュリティ後退の根本解決、防衛コストでなく仕様明確化) |
| breaking change の許容度 | **Pre-PMF だからこそ好機**。ユーザ数少なく rollback コスト低 |
| AC1 (legacy 残存数) 依存 | 残存 0 件確認できれば即 Phase 3 へ移行可能 |
| AC1 (legacy 残存数) > 0 件 | Phase 2 で email migration 案内 → grace period 30 日 → Phase 3 |

### 3.2 期限

- **Phase 1 完了**: 2026-Q3 末 (2026-09-30)
- **Phase 2 完了** (legacy 残存 > 0 件の場合): Phase 1 完了から +30 日 grace period
- **Phase 3 完了** (HMAC 必須化 + legacy code 物理削除): 2026-12-31 (Year 1 末まで)

期限は AC1 集計結果次第で前倒し可能。残存 0 件確認なら Phase 1 と Phase 3 を同一 sprint で実施。

---

## 4. Phase 計画

### Phase 1: warning log + ops alert (sub-Issue [#2403](https://github.com/Takenori-Kusaka/ganbari-quest/issues/2403))

**目的**: 現状把握 + 段階移行の準備。

**実装内容**:

- `validateLicenseKey()` の legacy 形式分岐 (`if (isLegacy && getLicenseSecret())`) の log を
  `logger.info` → `logger.warn` に格上げ、Discord incident channel へ alert (rate-limit 1h/key suffix)
- ops 集計 endpoint `/ops/license/legacy-count` 追加 (`ops_users` 認証必須、既存 `/ops/*` ルート規約に整合 — `src/routes/ops/` 配下)
  - response: `{ "legacyCount": <number>, "queriedAt": <ISO8601> }`
  - DynamoDB backend のみ対応 (NUC SQLite は §2.1 注記により集計対象外)
- `docs/operations/license-hmac-migration-plan.md` §6 に集計結果記録
- E2E: ops 認証 + endpoint 200 / 非 ops 403 を verify

**AC**:
- [ ] `/ops/license/legacy-count` 実装 + ops 認証 gate
- [ ] legacy key 検証時の Discord alert 1 件発火 E2E
- [ ] 既存 unit / E2E 全 PASS (legacy 受入 path は維持)
- [ ] 設計書 §6 (本書「実績ログ」) に集計結果記録

**期間**: 1 sprint (1 週間)

---

### Phase 2: 新規 legacy key 発行禁止 + 残存 user 案内 (sub-Issue [#2404](https://github.com/Takenori-Kusaka/ganbari-quest/issues/2404))

**目的**: 流入を止める + 既存ユーザに移行依頼。

**実装内容**:

- `generateLicenseKey()` 内 `if (secret)` 分岐の secret 未設定 fallback を **production で物理 throw**
  (dev / test では従来通り)。これにより新規 legacy key 発行を完全停止
- ops 画面 (`/ops/license`) に legacy key 保有 user 一覧 + email 一括送信機能
  - 案内 email template: 「再発行手続きのお願い」(grace period 30 日明示)
  - 該当 user 個別に新 SIGNED key を webhook 経由で再発行 (旧 legacy key は status='migrated' へ)
- 設計書 `docs/design/license-key-lifecycle.md` §2.2 を「LEGACY 廃止予告」に更新

**AC**:
- [ ] production で `generateLicenseKey()` の legacy fallback を throw
- [ ] ops 画面 legacy user 一覧 + email 一括送信実装
- [ ] migration email template + 30 日 grace period record
- [ ] E2E: ops 一覧表示 / email 送信 mock / migrated status 遷移
- [ ] 既存 active legacy key は引き続き validate 可能 (受入 path 維持)

**期間**: 1-2 sprint (2 週間)

---

### Phase 3: verify reject + legacy code 物理削除 (sub-Issue [#2405](https://github.com/Takenori-Kusaka/ganbari-quest/issues/2405))

**目的**: HMAC 必須化完遂 + tech debt 解消。

**実装内容**:

- `validateLicenseKey()` の `if (isLegacy && !isLegacyFormatAllowed())` 分岐を
  `if (isLegacy)` 一律 reject に変更 (dev/test 区別なし)
- `isLegacyFormatAllowed()` / `LEGACY_FORMAT` / `LICENSE_KEY_LEGACY_FORMAT`
  (`src/lib/domain/validation/auth.ts`) / `ALLOW_LEGACY_LICENSE_KEYS` env (`src/lib/runtime/env.ts`)
  を物理削除
- 関連 unit テスト (`tests/unit/services/license-key-service.test.ts` の legacy 受入 it ブロック)
  を削除 (ADR-0006 assertion 弱体化禁止に従い、削除であって緩和ではない)
- signup form (`src/routes/auth/signup/+page.svelte`) の `LICENSE_KEY_LEGACY_FORMAT.test()`
  バリデーションを撤去
- `.env.example` から `ALLOW_LEGACY_LICENSE_KEYS=false` コメント行を削除
- 設計書同期:
  - `docs/design/license-key-lifecycle.md` §2.2 表から LEGACY 行を削除
  - `docs/design/14-セキュリティ設計書.md` に「HMAC 必須化完了」note 追加
  - `docs/operations/license-hmac-migration-plan.md` 本書 status を `completed` に更新

**AC**:
- [ ] legacy key で login 試行 → 一律 reject E2E (production-like env)
- [ ] grep で `legacy.*hmac` / `LEGACY_FORMAT` / `ALLOW_LEGACY_LICENSE_KEYS` 残存 0 件
- [ ] 既存 SIGNED key で login PASS E2E
- [ ] `npm run pre-ready` 全 10 step PASS
- [ ] 設計書 3 件同期更新済み

**期間**: 1 sprint (1 週間)

---

## 5. rollback シナリオ

Phase 3 で「想定外の生存 legacy key」が発覚した場合の対応。

### 5.1 検知方法

- production deploy 後 24h 以内に Discord incident channel への `legacy_format_rejected` alert
  発火件数を監視
- 1 件でも発火 → 当該 license key の suffix から user identification (`audit_log` 等から trace)
  → email で再発行案内

### 5.2 rollback 手順

**短期 (hotfix)**:

1. `validateLicenseKey()` の `if (isLegacy)` 一律 reject を `if (isLegacy && process.env.LICENSE_HMAC_EMERGENCY_BYPASS !== 'true')` に変更 (緊急 env 追加)
2. Lambda env に `LICENSE_HMAC_EMERGENCY_BYPASS=true` 設定 → deploy
3. 該当 user へ migration 案内 + 個別 SIGNED key 発行
4. 48h 以内に Phase 3 を再適用 (env 撤去 + 一律 reject 復旧)

**根本対応**:

- Phase 1 集計 query の漏れ (例: 別 DB region / staging / NUC fleet 未集計) を調査
- 集計範囲を SSOT 化 (`docs/operations/license-hmac-migration-plan.md` §2.1 に追記)

### 5.3 rollback 後の責任

- emergency bypass を 48h 超えて維持しない (本計画の合意事項)
- bypass 維持中は legacy key 利用件数を hourly metric として ops dashboard に表示

---

## 6. 実績ログ

Phase 進捗・残存数集計をここに記録する。

| 日付 | Phase | 集計値 / 状態 | 記録者 |
|------|-------|-------------|--------|
| 2026-05-22 | 計画策定 | sub-Issue #2403 / #2404 / #2405 起票完了 | #2398 PR |
| 2026-05-25 | Phase 1.1/1.2 | logger.warn 格上げ + Discord alert 実装 (PR #2483 merged) | #2403 PR-1 |
| 2026-05-26 | Phase 1.3 | `/ops/license/legacy-count` endpoint 実装 (PR #2484 で `countLicenseKeys({ format: 'legacy' })` 拡張)。本番 deploy 後の本番 hit で legacy_count 確定 | #2484 PR |
| (Phase 1.3 deploy 後) | Phase 1 | legacy_count = ? (DynamoDB 本番集計値、ops endpoint で取得) | #2484 deploy |
| (Phase 2 完了時) | Phase 2 | migration email 送信 N 件 / migrated N 件 | #2404 |
| (Phase 3 完了時) | Phase 3 | legacy code 削除完了 / LEGACY 一律 reject 適用 | #2405 |

---

## 7. 関連リソース

- **実装**: `src/lib/server/services/license-key-service.ts` §HMAC署名 (line 27-114)
- **env 定義**: `src/lib/runtime/env.ts` `ALLOW_LEGACY_LICENSE_KEYS` (line 90)
- **domain 定義**: `src/lib/domain/validation/auth.ts` `LICENSE_KEY_LEGACY_FORMAT` (line 35)
- **signup**: `src/routes/auth/signup/+page.svelte` (line 7, 28)
- **テスト**: `tests/unit/services/license-key-service.test.ts` (line 1227, 1246, 1257, 1280, 1299)
- **設計書**: `docs/design/license-key-lifecycle.md` §2.2 / §2.3
- **シークレット運用**: `docs/operations/license-key-secrets.md`
- **要件**: `docs/design/license-key-requirements.md` (#812)
