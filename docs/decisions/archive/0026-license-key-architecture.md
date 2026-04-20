# ADR-0026: ライセンスキーアーキテクチャ

> **Archived (2026-04-20)**: ライセンスキーアーキテクチャ。実装完了、運用段階

| 項目 | 内容 |
|------|------|
| ステータス | accepted |
| 日付 | 2026-04-11 |
| 起票者 | Takenori-Kusaka |
| 関連 Issue | #809, #247, #319, #806, #807, #810, #811, #812, #813, #814 |
| 関連 ADR | ADR-0013（Cognito + Google OAuth）, ADR-0024（プラン解決責務分離）, ADR-0025（License ↔ Stripe 因果関係） |
| 参照設計書 | `docs/design/license-subscription-causality.md`, `docs/design/08-データベース設計書.md`, `docs/design/19-プライシング戦略書.md` |
| 実装 | `src/lib/server/services/license-key-service.ts` |

## コンテキスト

がんばりクエストの有料プラン（standard / family）の利用権は **ライセンスキー** で管理する。
Stripe で決済 → ライセンスキー発行 → ユーザーが自テナントに紐付け（consume）、という流れ。

「決済 SaaS に Cognito ID を渡さず、独立したキーで権限を管理する」設計は以下の要件から決まった:

1. **決済（Stripe）とアプリ認証（Cognito）の分離** — Stripe アカウントと Cognito ユーザーを 1:1 に紐付けない
2. **キャンペーン・贈答配布** — Stripe を通さずに権限配布したい（新規流入施策、トラブル補償）
3. **Stripe アカウント紛失時のリカバリ** — メール変更等で Stripe と Cognito の紐付けが壊れても、キーで復旧可能
4. **OSS self-host 版との互換性** — Stripe を使わない self-host 運用でも同じ権限付与フローが使える

しかし、現行実装（`src/lib/server/services/license-key-service.ts`）には以下の決定事項が明文化されていなかった:

- なぜ HMAC-SHA256 で、Ed25519 や JWT ではないのか
- なぜ `0/O/1/I` を除外した 32 文字アルファベットなのか
- なぜ一回限り使用（consume）で、複数デバイス activation ではないのか
- 有効期限の既定値（現在は未実装）
- HMAC 秘密鍵のローテーションポリシー（#807 で未定義と指摘）
- 購入者 tenant 以外での consume 制約

新規開発者・運営・監査担当者がこれらを判断根拠として参照できるように、本 ADR で決定を記録する。

## 検討した選択肢

### A. キー生成方式

**A-1: HMAC-SHA256（対称鍵）+ 5文字 checksum（採用）**
- メリット: 実装が単純、署名検証が軽量（1 Lambda invocation 内で完結）、DB 問い合わせ前にブルートフォース拒否可能
- デメリット: 秘密鍵漏洩時は全キー無効化が必要、非対称署名と比べてキー偽造検知力が落ちる

**A-2: Ed25519（非対称鍵）**
- メリット: 公開鍵を OSS 版に配布して署名検証できる、秘密鍵漏洩時の影響範囲が狭い
- デメリット: キーが長くなる（署名が 64 byte → Base32 で 104 文字）、UX が悪化（手入力・口頭伝達困難）

**A-3: JWT（JWS）形式**
- メリット: 標準規格、ツール豊富
- デメリット: キーが非常に長い（200 文字以上）、B2C 向けの「ライセンスキー」UX に合わない

**A-4: 純乱数 + DB lookup（署名なし、#247 の初期実装）**
- メリット: 最小実装
- デメリット: DB 問い合わせなしに偽造検知できない、総当たり攻撃で潜在的な列挙リスク

**判断**: A-1 を採用。理由は UX（16 文字 Base32 + 5 文字 checksum = 25 文字で手入力可能）、Pre-PMF 段階では個人運営のため秘密鍵管理が単純なほうがよい、Stripe 事前認証レイヤーで主要攻撃は防げる、の 3 点。

### B. キー形式・文字セット

**B-1: `GQ-XXXX-XXXX-XXXX(-YYYYY)` + 32 文字アルファベット `ABCDEFGHJKLMNPQRSTUVWXYZ23456789`（採用）**
- `0/O/1/I` を除外（手書き・口頭伝達時の誤認防止）
- プレフィックス `GQ-` は「がんばりクエスト」のブランド識別子
- 4 文字 × 3 セグメント = 12 文字 payload + 5 文字 checksum = 17 文字（プレフィックス込みで 20 文字）

**B-2: UUID 形式（`xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx`）**
- メリット: 標準
- デメリット: 36 文字で長すぎる、hex で `0` と `o` の誤認問題は緩和されるが `0` と `O` の UI 表示問題は残る

**B-3: Base58（Bitcoin 式、`0/O/I/l` 除外の 58 文字）**
- メリット: エントロピー密度が高い
- デメリット: 英小文字を含み手書き時の大小判定が必要（子供が親に口頭で伝える時に混乱）

**判断**: B-1 を採用。UX 優先（大人も子供も手入力できる文字数・文字種）。

### C. 有効期限

**C-1: 発行から 90 日（採用、今後実装）**
- メリット: 未使用キーの永続蓄積を防ぐ、期限切れで運営が状況把握可能
- デメリット: 贈答キーを長期保管するユーザーが使えなくなる可能性

**C-2: 無期限**
- メリット: シンプル
- デメリット: DB に未使用キーが永久蓄積、運営コスト増

**C-3: キー種別ごとに可変（purchase=無期限、campaign=30日、gift=90日）**
- メリット: 用途に応じた柔軟性
- デメリット: 実装・説明コスト増

**判断**: C-1 を採用。ただし期限切れキーは自動削除せず `status='expired'` として保持（監査用）。90 日内に未使用なら運営が状況確認するトリガーにする。今後 C-3 に拡張する余地を残す（`expiresAt` フィールドは柔軟）。

### D. 消費モデル

**D-1: 一回限り使用（consume）— 発行時に tenant 未指定、consume 時に紐付け（採用）**
- メリット: シンプル、贈答・譲渡・campaign と親和性が高い、不正利用検知が容易
- デメリット: 複数デバイスでの利用という概念がない（ただしテナント単位で tenantId に紐付けるため、同一 tenant 内の複数デバイスは問題なし）

**D-2: 複数デバイス activation（seat 数で管理）**
- メリット: B2B ライセンスで一般的
- デメリット: がんばりクエストは家族単位（tenant 単位）の SaaS で、デバイス数を増やしても家族規模は変わらない（家族メンバー数は tenant 内で管理）

**判断**: D-1 を採用。tenant と 1:1 で紐付ければ、家族内の複数デバイスは自然にカバーされる。

### E. 購入者 tenant 以外での consume 制約

**E-1: 制約なし（採用）— 誰でも consume 可能**
- メリット: 贈答・譲渡が自由、campaign 配布 URL を誰でも利用可能
- デメリット: キー漏洩時に第三者に先取りされるリスク

**E-2: 購入者 tenant にのみ紐付け可能**
- メリット: 不正 consume 防止
- デメリット: 贈答・campaign が実装不可能

**E-3: 購入者 tenant を優先、24 時間経過後に第三者 consume 可**
- メリット: 紛失・譲渡両対応
- デメリット: 仕様が複雑

**判断**: E-1 を採用。理由は贈答・campaign 対応が必須要件（C-3 方針）、キーは十分なエントロピー（HMAC 署名 + 32 文字セット + 12 文字 payload = 2^60 以上）を持つため列挙攻撃は不可、メール送信でキー到達を確認できるため。ただし将来的にレート制限・ブルートフォース対策が必要（#813）。

### F. ストレージ

**F-1: DynamoDB single-table, PK=`LICENSE#{licenseKey}`, SK=`META`（採用）**
- メリット: ADR-0012 に準拠、O(1) lookup、tenant 別集計は GSI で対応
- デメリット: tenant 別一覧取得は GSI が必要（#816 で実装予定）

### G. HMAC 秘密鍵のローテーション（#807）

**G-1: 無期限（現状）**
- リスク: 秘密鍵漏洩時の影響範囲が大きい

**G-2: 年 1 回ローテーション（採用、2026-Q2 実装予定）**
- 旧鍵で署名された既存キーは grace period 90 日間検証可能
- 新発行キーは新鍵で署名
- DynamoDB に鍵バージョン（`keyVersion`）を記録して検証時に切替
- AWS Secrets Manager で鍵を管理、CloudFormation からも参照

**判断**: G-2 を採用。Pre-PMF 段階では秘密鍵漏洩は低確率だが、SOC2/ISO27001 準拠の前提として年 1 回のローテーションプロセスを整備する。

## 決定

上記 A-1 / B-1 / C-1 / D-1 / E-1 / F-1 / G-2 を採用する。

### 実装サマリ

| 項目 | 決定 |
|-----|------|
| 署名アルゴリズム | HMAC-SHA256 |
| キー形式 | `GQ-XXXX-XXXX-XXXX-YYYYY` |
| 文字セット | `ABCDEFGHJKLMNPQRSTUVWXYZ23456789`（32 文字、0/O/1/I 除外） |
| エントロピー | 12 文字 × 5 bit = 60 bit（約 1.15 × 10^18） |
| checksum | HMAC-SHA256 から 5 文字（25 bit） |
| 有効期限 | 発行から 90 日（2026-Q2 実装） |
| 消費モデル | 一回限り使用（consume） |
| consume 制約 | 誰でも可（+ レート制限で保護、#813） |
| ストレージ | DynamoDB single-table |
| 鍵ローテーション | 年 1 回（grace period 90 日） |
| 監査ログ保持期間 | 1 年（DynamoDB TTL） |

## 結果

### 期待される効果

- 新規開発者が「なぜこの形式なのか」で迷わない
- ライセンスキー機能の拡張（期限・レート制限・鍵ローテーション）の議論ベースラインができる
- OSS self-host 版との互換性を保ちながら Cloud SaaS 固有の機能を追加可能
- 監査時に設計判断の根拠を提示可能

### トレードオフ

- HMAC（対称鍵）採用により、秘密鍵漏洩時は全キー再発行が必要
- 誰でも consume 可能のため、キー漏洩対策としてレート制限（#813）が必須
- 有効期限実装（#808 / #812）が先行必要

### 現行実装との差分（TODO）

| # | 現状 | ADR 決定 | 対応 |
|---|------|--------|------|
| 1 | `AWS_LICENSE_SECRET` が optional、未設定時は legacy format を受け入れる | secret 必須、legacy format は読み取り専用で段階的廃止 | #806 |
| 2 | 有効期限フィールドが未実装 | `expiresAt` を DynamoDB item に追加、90 日デフォルト | #808 / #812 |
| 3 | consume API のレート制限なし | IP + キー prefix でレート制限 | #813 |
| 4 | 鍵ローテーションポリシー未実装 | 鍵バージョン + AWS Secrets Manager 管理 | #807 |
| 5 | `tenantId` 別 GSI なし | `listLicenseKeysByTenant` 実装 | #816 |
| 6 | E2E ライフサイクルテストなし | 発行 → consume → expire → revoke の E2E | #810 |

これらは `#814 ライセンスキー全面再設計 EPIC` で段階的に実装する。

## 競合分析（#811 で詳細予定）

| サービス | キー形式 | 署名 | 消費モデル | 採用理由 / 不採用理由 |
|---------|--------|------|----------|-------------------|
| **Keygen.sh** | UUID | Ed25519 | 複数デバイス activation | 機能豊富だが個人開発には過剰、月額 $99 〜 |
| **Lemon Squeezy** | 28 文字英数 | 独自 | 一回限り or 複数 activation | Stripe 代替、ただし決済手数料が高い |
| **Paddle** | UUID | 独自 | 複数 activation | 税務代行が強み、個人開発向けでない |
| **Stripe Customer Portal** | なし（Stripe Customer ID 直接） | なし | N/A | Cognito と 1:1 結合、贈答/campaign 不可 |
| **自作（採用）** | `GQ-XXXX-XXXX-XXXX-YYYYY` | HMAC-SHA256 | 一回限り | UX 優先、個人運営コスト最小、OSS 互換 |

## ログマスク標準（#869 追記、2026-04-11）

ライセンスキーは本質的に認証情報（bearer credential）であり、完全値がログ・監視基盤・Discord 通知に残存すると漏洩リスクが増幅する。以下を本プロジェクトのログマスク標準として定める。

### H-1: マスク方式

- **形式**: 先頭 **7 文字** のみ出力する（`GQ-XXXX` まで）。後続には ` ...` を付与して切り詰めを明示
- **例**: `GQ-A3K8-Z9PQ-M2NR-WXYZ7` → `GQ-A3K8 ...`
- **実装例**: `licenseKey.slice(0, 7) + ' ...'`
- **呼び出し箇所**: `src/lib/server/services/license-key-service.ts` の `issueLicenseKey` / `validateLicenseKey` / `consumeLicenseKey` の logger 呼び出しで既にこの方式を採用（`#869` で `issueLicenseKey` にも遡及適用）

### H-2: 対象

以下のすべての出力経路で完全キー値を出してはならない。

| 経路 | 対応 |
|------|------|
| `logger.*` (info/warn/error/debug) | 先頭 7 文字マスクで出力 |
| `Error` の message / cause | マスク済み値のみ含める |
| Discord Webhook 通知 | マスク済み値のみ |
| CloudWatch / Sentry | logger 経由で自動的にマスクされる |
| 監査ログ（DynamoDB AUDIT アイテム、#804） | ハッシュ値または先頭 7 文字のみ保持 |
| Stripe metadata / webhook payload | マスク済み値のみ |

### H-3: 根拠

- **先頭 7 文字の情報量**: `GQ-XXXX` は文字セット 32 の 4 桁 = 約 100 万通り。運用時にサポート担当者が「どのキーの話をしているか」概ね特定できる水準
- **一意特定不可**: 4 文字では DynamoDB の `LICENSE#{完全キー}` PK で絞り込めない（スキャンが必要）ため、ログ漏洩時に攻撃者がキーを悪用することはできない
- **業界慣例**: Stripe API keys (`sk_live_...`) も同様に先頭 8–10 文字のマスクが標準。GitHub token もダッシュボード表示は同様

### H-4: 禁止事項

以下のアンチパターンを禁止する。

- 完全キー値を `console.log` / `logger.*` に渡す（マスクしない生値）
- Error メッセージに完全キーを含める（例: `new Error('Invalid key: ' + licenseKey)`）
- HTTP レスポンスボディに完全キーを含める（エラー返却時は prefix のみ）
- `JSON.stringify(licenseRecord)` で無加工にシリアライズしてログに出す

### H-5: CI / コードレビュー

- `logger.*(.*licenseKey.*)` / `console\..*licenseKey` の生値出力を検出する ESLint ルール追加を検討（別 issue にスピンオフ可）
- 既存コード棚卸し: PR 時に `grep -rn "licenseKey" src/` で logger 出力に完全値が含まれていないことを目視確認

## assume-leak 原則の対応状況（#869 追記、2026-04-11）

ライセンスキーは「流出する前提」でセキュリティ設計されるべき（業界標準: Keygen.sh / Lemon Squeezy / Adobe Licensing）。12 原則に対する本プロジェクトの対応状況を記録する。

| # | 原則 | 対応 issue | 状態 | 備考 |
|---|------|---------|------|------|
| 1 | 購入者紐付け (owner-only) | #798, #801 | ✅ 対応済 / 予定 | `LicenseRecord.kind` で cross-tenant consume を拒否 |
| 2 | サブスクリプション期間の有効期限 | #797 | ✅ 対応済 / 予定 | `expiresAt` 90 日デフォルト |
| 3 | 失効 (revocation) | #797, #805 | ✅ 対応済 / 予定 | `revokeLicenseKey` + 管理画面 (#805) |
| 4 | 未使用 TTL（発行後 N 日で失効） | — | ⚠️ Pre-PMF 対象外 | #2 の `expiresAt` が実質的に機能（90 日後に失効） |
| 5 | 監査ログ | #804 | ✅ 予定 | DynamoDB AUDIT アイテム、1 年 TTL |
| 6 | 異常検知アラート | — | ⚠️ Pre-PMF 対象外 | #804 の監査ログで手動レビュー可能。自動化は将来課題 |
| 7 | レート制限 | #813 | ✅ 予定 | IP + キー prefix でレート制限 |
| 8 | HMAC 必須化（legacy 拒否） | #806 | ✅ 対応済 | `AWS_LICENSE_SECRET` 必須化済 |
| 9 | シークレットローテーション | #807 | ✅ 予定 | 年 1 回、grace period 90 日 |
| 10 | 一回限り使用の実働 | #795 | ✅ 対応済 | `consumeLicenseKey` で status=active→consumed を atomic に更新 |
| 11 | **ログマスク** | #869（本追記） | ✅ 本 ADR で標準化 | 先頭 7 文字マスク |
| 12 | メール経路漏洩代替（ワンクリック署名リンク） | — | ⚠️ Pre-PMF 対象外 | 平文メール送付は業界慣例。署名付き URL は将来課題 |

### 将来検討事項（2026-04-11 判断）

以下 3 項目は Pre-PMF の現時点では対象外とし、個別 issue は起票しない。本 ADR に「将来検討事項」として記録するのみとする。

- **#4 未使用 TTL**: #2 (`expiresAt` 90 日) が実質的に同等機能を提供するため、別建ての未使用 TTL は不要と判断
- **#6 異常検知アラート**: #5 の監査ログを手動でレビューする運用で十分。Pre-PMF では自動アラート基盤（CloudWatch Metric Filter / Anomaly Detection）の維持コストが便益を上回る
- **#12 メール経路漏洩代替**: ワンクリック署名 URL（例: `https://app/activate?token=<JWT>`）は UX を向上させるが、既存のメール平文送付方式は Keygen.sh / Lemon Squeezy / Adobe 等でも標準的な実装であり、優先度は低い

対応済 9/12 + 本 ADR でログマスク追加 = **10/12** で Pre-PMF としては十分と判断する。将来 PMF 到達後に #4 #6 #12 を再評価する。

## secret 配布の 4 経路（#911 追記、2026-04-12）

PR #863 で `assertLicenseKeyConfigured()` を導入した後、`.github/workflows/ci.yml` にのみ
`AWS_LICENSE_SECRET` を追加した結果、`deploy.yml` と `deploy-nuc.yml` が **25 連続失敗** した（#911）。
原因は「assertion はコードに導入したが、secret の配布先を CI の一部しか追加しなかった」という
構造的な同期漏れ。再発防止のため、本 ADR に **4 経路の配布マップ** を明文化する。

### 4 経路の対応関係

| # | 配布先 | 入力 | 実装箇所 | 値の種類 |
|---|-------|------|---------|---------|
| 1 | CI 通常 E2E (`ci.yml` e2e-test) | 直書きダミー値 | `.github/workflows/ci.yml` → `Run E2E tests` ステップ `env:` | ダミー（`e2e-test-secret-do-not-use-in-production`） |
| 2 | CI デプロイ前 E2E (`deploy.yml` test job) | 直書きダミー値 | `.github/workflows/deploy.yml` → `E2E tests (local / cognito-dev)` ステップ `env:` | ダミー（`ci-deploy-test-secret-do-not-use-in-production`） |
| 3 | AWS Lambda 本番 | GitHub Secrets → CDK context → Lambda environment | `.github/workflows/deploy.yml` の CDK deploy `-c awsLicenseSecret=${{ secrets.AWS_LICENSE_SECRET }}` + `infra/lib/compute-stack.ts` の `tryGetContext('awsLicenseSecret')` | **本番値**（64 文字 hex） |
| 4 | NUC ローカル本番 | GitHub Secrets → self-hosted runner → `.env` 自動生成 → docker compose `env_file` | `.github/workflows/deploy-nuc.yml` の `Generate .env from GitHub Secrets` ステップ（GHA Secret を `env:` で渡し PowerShell が `C:\Docker\ganbari-quest\.env` を生成） | **本番値**（#3 と同一） |

### なぜこの配布方式か

- **#1 / #2 はダミー値で十分**: CI の E2E は vite preview を起動するだけで、実際にライセンスキーを発行・検証する経路を踏まない。`assertLicenseKeyConfigured()` が要求する「何か値があること」だけ満たせばよい。本番値を CI に流さないことでセキュリティ表面を最小化
- **#3 は SSM 経由ではなく Lambda env 直接注入**: 本来は ADR-0026 §2.1 の通り AWS Secrets Manager 経由が推奨だが、恒久実装は #810 の範疇。移行期の暫定として CDK context → Lambda environment 方式で十分（Lambda env は暗号化されている）
- **#4 は GitHub Secrets 経由で配布する（PR #913 改訂後）**: 当初は「NUC マシンに `.env.production` を手動配置・GHA に通さない＝攻撃面最小化」という設計だった（PR #913 初版）。しかし self-hosted runner が NUC 上に常駐している時点で「GHA を通さない」という分離は形式論であり、`runner プロセス → ファイル` の経路は SSM/RDP 手動配置と同等のセキュリティ境界を持つ。むしろ手動配置の運用負債が大きく、#911 で 25 連続失敗した際に物理アクセスが必須となり復旧が遅れた。GHA 経由配布に統一することで、`gh secret set` 一発で Lambda + NUC 両方に同一値が配布され、rotate / 障害復旧が完全に無人化される

### 本番値の同一性要件（CRITICAL）

**#3 (Lambda) と #4 (NUC) は同じ値を使うこと**。異なる値を使うと、NUC で発行したライセンスキーが
Lambda 本番で署名検証失敗する（または逆）。家族がスマホ（Lambda 経由）と自宅 PC（NUC 経由）の
両方から同じライセンスキーを使えるようにするための必須要件。

GHA Secrets に 1 つ登録すれば、deploy.yml の CDK deploy が #3 (Lambda env) に注入し、
deploy-nuc.yml の `Generate .env from GitHub Secrets` ステップが #4 (NUC `.env`) に注入するため、
同一性は構造的に保証される（人為ミスで不一致になる経路がない）。

### 新規 env 追加時の必須チェックリスト

production の assertion を新しい env に追加する PR では、**必ず以下を同一 PR 内で実施**すること。
一つでも欠けると deploy.yml / deploy-nuc.yml が連続失敗する（#911 の教訓）。

- [ ] `.env.example` に placeholder と生成コマンド例を追記
- [ ] `.github/workflows/ci.yml` e2e-test の env 追加（ダミー値）
- [ ] `.github/workflows/deploy.yml` test job の env 追加（ダミー値）
- [ ] `.github/workflows/deploy.yml` deploy job の CDK deploy に `-c xxxKey=${{ secrets.XXX }}` 追加
- [ ] `infra/lib/compute-stack.ts` (or 該当スタック) で `tryGetContext` + Lambda `environment` に投入
- [ ] `.github/workflows/deploy-nuc.yml` の `Generate .env from GitHub Secrets` ステップの `env:` ブロックと PowerShell 配列に env 追加
- [ ] `infra/CLAUDE.md` の「production 環境変数チェックリスト」表に追記
- [ ] PR 本文に "PO action required" セクションを書き、`gh secret set XXX --body <value> --repo Takenori-Kusaka/ganbari-quest` の 1 コマンドだけを掲載（Lambda + NUC 両方に自動配布される）

## 教訓

- **ADR を先に書いてから実装する** — 現行実装（`license-key-service.ts`）は #247 / #319 の積み重ねで決まったが、根拠が文書化されていなかったため #806 / #807 のような後追い指摘が発生した
- **オプション引数で「省略時フォールバック」を用意すると必ず事故る** — `AWS_LICENSE_SECRET` を optional にした結果、CI テスト環境で legacy format を受け入れる挙動が本番にも漏れた（#806）
- **Pre-PMF 段階では UX > セキュリティ強度** — 複雑な署名方式は個人運営では運用破綻する。HMAC + シンプルな秘密鍵管理が現実的
- **有効期限のないリソースは運用負債になる** — 初期実装で無期限キーを発行した結果、未使用キーが DynamoDB に蓄積し、棚卸し運用が生まれた
- **認証情報のログ出力は「暗黙の規則」では守られない** — ログマスク方式は ADR に明文化し、コードレビューと grep で機械的に検証する仕組みが必要（#869）
- **「assertion の導入」と「secret の配布」は同一 PR で完結させる** — コードに起動時チェックを追加したのに配布先の secret を全環境に届けないと、本番が一斉停止する（#911）。secret を必要とする assertion を追加する PR では、上記 4 経路すべてを同一 PR 内で更新すること
- **「自動化を持たない」設計は障害復旧コストで代償を払う** — PR #913 初版は NUC `.env.production` の手動配置で「GHA に secret を通さない」形式論を優先したが、self-hosted runner が NUC 上に常駐している時点でその境界は意味を成さず、#911 の復旧時に物理アクセスが必須となり遅延した。自動化の有無は「セキュリティ」ではなく「信頼境界の設計」で決めること（runner マシン自体が信頼境界なら、その内部に secret を流すことに追加のリスクはない）
