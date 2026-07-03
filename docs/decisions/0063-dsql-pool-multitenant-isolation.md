# 0063. DSQL pool マルチテナント分離 — 信頼 claim/context + アプリ層単一強制点 + fitness function（RLS 非対応の代替防御線）

| 項目 | 内容 |
|------|------|
| ステータス | accepted |
| 日付 | 2026-06-29 |
| 起票者 | Takenori Kusaka（補佐: Claude） |
| 関連 Issue | #3424 (EPIC) / #3434 (設計⑤) |

## コンテキスト

EPIC #3424（DynamoDB → Aurora DSQL 移管、コスト最優先）で、テナント（= 家族グループ、`tenant_id` 列）分離をどう機械強制するかを確定する必要がある。子供データを扱うためテナント間漏洩は絶対不可。実機 PoC（`docs/research/2026-06-28-aurora-dsql-adoption.md` §11.1、us-east-1 実クラスタ）で **DSQL は PostgreSQL RLS（`CREATE POLICY` / `ENABLE ROW LEVEL SECURITY`）を非対応**（`[0A000] unsupported`）と確証した。現状 DynamoDB single-table も結局アプリ層強制であり、RLS 不在は移行で**非悪化**。

## 検討した選択肢（OSS / 確立パターン 2 件以上 — #1350）

### 選択肢 A: pool + PostgreSQL RLS（DB エンジン強制）
- 概要: AWS Prescriptive Guidance「pool + RLS」/ acts_as_tenant / django-tenants / Supabase RLS。`CREATE POLICY USING (tenant_id = current_setting(...))` でアプリが WHERE を書き忘れても DB が漏洩を止める多層防御。
- デメリット: **DSQL は RLS 非対応（実機確証）→ そもそも採用不可**。

### 選択肢 B: silo（cluster-per-tenant）+ per-tenant IAM
- 概要: 1 家族 = 1 DSQL クラスタ。`dsql:DbConnect` を当該クラスタ ARN のみに許可し IAM で物理分離（AWS SaaS Factory silo / token-vending）。
- デメリット: 全クラスタへ N 回マイグレーション / サインアップ毎 provisioning / アカウント quota / 横断集計不能 / 無料枠アカウント単位共有 / 運用 N 倍。**pre-PMF に過剰（ADR-0010）**。
- Pre-PMF コスト: 高。将来 enterprise/規制テナント出現時の再検討トリガとして温存。

### 選択肢 C: pool + 信頼 claim/context + アプリ層単一強制点 + fitness function（採用）
- 概要: 単一クラスタ・`tenant_id` 行分離。実プロダクト前例 acts_as_tenant（Rails）/ PostHog（`team_id`）。RLS の代替防御線を CI fitness function で機械化。
- メリット: 1 マイグレーション / 横断集計可 / コスト最小（scale-to-zero）。現 DynamoDB と同型でコードパス 1 本化。
- Pre-PMF コスト: 低（既存 `route-db-boundary.test.ts` / IDOR invariant test の同型流用、ADR-0061 整合）。

## 決定

**選択肢 C を採用**。DSQL は RLS 非対応のため A は不可、B は pre-PMF 過剰。論理分離を以下で「実効力ある」分離にする:

1. **tenantId 列 + 複合 PK 先頭**（`PRIMARY KEY (tenant_id, id)`、DSQL の高カーディナリティ PK 推奨と両立、UUID と複合で hot key 回避）。
2. **信頼 tenantId の確立**: Cognito 由来の偽造不能 tenantId（現状は JWT 検証後の membership 解決 + 署名付き context cookie。Pre-Token-Generation Lambda で familyId claim を載せる方式は claim 陳腐化対策込みの最適化オプション）。**DB は JWT を読まない** — `hooks.server.ts` が検証済 tenantId を確定する。
3. **tenant-scoped repository 単一強制点**: 生クエリ発行を境界外で禁止し `WHERE tenant_id = :ctx` 注入を 1 箇所に集約。
4. **fitness function（RLS 代替防御線）**: `tenant_id` 述語の無い SELECT/UPDATE/DELETE を AST/lint で CI hard-fail（新規違反 1 件で fail）。
5. **cross-tenant E2E 不変条件**: 家族 A の token で家族 B のリソースを叩き 403/空 を assert（IDOR hardening #3228 と同型）。

RLS は追わない（非対応・現状非悪化）。「実効力」の源泉は **tenantId が Cognito 署名で偽造不能**な点であり、悪意ある cross-tenant read は不成立。残存リスク（開発者の WHERE 書き忘れ）を 3〜5 の機械強制で閉じる。

## 結果

- テナント分離は **アプリ層機械強制 + CI fitness function**で担保。RLS（DB エンジン強制）の砦は無いが、現 DynamoDB から悪化せず、機械検証は強化される。
- **NUC（SQLite 単テナント）両立**: 同一 tenant-scoped repository を no-op フィルタとして再利用（SQLite ファイル自体が物理分離）。コードパス 1 本化。
- **将来の再検討トリガ**: enterprise / 規制テナント出現時は、当該テナントのみ silo（cluster-per-tenant + per-tenant IAM）へ昇格する段階導入を別途 ADR で検討する。
- Pre-PMF（ADR-0010）Bucket A。1-in-1-out は月末棚卸（`docs/CLAUDE.md` §ADR 月 1 棚卸）で消化（ADR-0060 / 0061 precedent）。
- SSOT: `docs/research/2026-06-28-aurora-dsql-adoption.md` §10-§11 / EPIC #3424。
