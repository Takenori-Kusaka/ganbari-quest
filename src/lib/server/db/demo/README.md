# Demo Repository (`src/lib/server/db/demo/`)

ADR-0048 §決定 §2 / §段階別 milestone 週 2-3 の実装。

## 役割

Multi-Lambda demo deployment (`demo.ganbari-quest.com`) で稼働する demo Lambda 専用の Repository 実装。`factory.ts` の `DATA_SOURCE=demo` 分岐で選択される。

## 設計原則 (Martin Fowler Test Double)

「Fake (read) + Stub (write) hybrid」:

- **read API** (`find*` / `get*` / `list*` / `count*` 等): `$lib/server/demo/demo-data.ts` の fixture から該当データを返す (Fake)
- **write API** (`insert*` / `update*` / `delete*` / `upsert*` 等): 契約を満たす最小値を返す (Stub、no-op)

## AWS Lambda Best Practices 遵守

[AWS Lambda Best Practices 公式](https://docs.aws.amazon.com/lambda/latest/dg/best-practices.html) の anti-pattern を物理的に発生不可能にする:

> Don't store user data, events, or other information that has security implications **in the local file system of your Lambda function** or in the function's memory.

本 directory の Repository は **module-level singleton で user-specific mutable state を保持しない**。write API は no-op のため、fixture (DEMO_*) の値は immutable に固定される。

session-scoped state (「demo で記録 → リロードで保持」) は **client sessionStorage 限定** (ADR-0048 §決定 P-1.1) で、Lambda 側は完全 stateless を維持する。

## 関連

- ADR-0048: Multi-Lambda Demo Deployment (`docs/decisions/0048-multi-lambda-demo-deployment.md`)
- `src/lib/server/db/factory.ts` の `DATA_SOURCE=demo` 分岐
- `src/lib/server/auth/providers/anonymous.ts` (`AUTH_MODE=anonymous`)
- `src/lib/server/demo/demo-data.ts` (fixture SSOT)
