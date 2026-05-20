# 使用時間ログ DynamoDB 実装延期 設計経緯

## 議論の発端

- **日時**: 2026-05-20
- **発端 Issue**: #2338 `[CRITICAL] /api/v1/usage 500 本番発生 (DynamoDB 未対応) → Pre-PMF no-op fallback (ADR-0010 Bucket B)`
- **問題意識**: 本番 cognito Lambda (`AUTH_MODE=cognito + DATA_SOURCE=dynamodb`) で `/api/v1/usage` POST / PATCH が **500 連続発生**。`UsageTracker` (子供画面 mount 時に fire-and-forget で 1 件 / セッションを記録) が 5xx を返し続け、CloudWatch エラーログを汚染し続けていた。

  ```
  [2026-05-20T04:24:03.017Z] [WARN] [usage-log] セッション開始記録に失敗
  [2026-05-20T04:24:03.018Z] [ERROR] POST /api/v1/usage 500 26ms
  ```

  根本原因は `src/lib/server/db/usage-log-repo.ts` が **SQLite のみ実装** (Pre-PMF: DynamoDB 対応不要、ADR-0010 で意図的にスコープ外) であること。DATA_SOURCE=dynamodb 環境では `better-sqlite3` の DB ファイル不在 / native binding が throw し、`startUsageSession` の `catch` で WARN + `null` 返却 → endpoint で `null` を 500 に変換していた。

## 検討した代替案

| 案 | 概要 | 検討した理由 |
|----|------|-----------|
| 案 A | DynamoDB 完全実装 (`src/lib/server/db/dynamodb/usage-log-repo.ts` を新規追加) | 機能等価維持。本番でも使用時間サマリーを admin 画面に表示可能 |
| 案 B | UsageTracker 自体を撤去 (client 側 mount 時 fetch 廃止) | endpoint 5xx の根を断つ。バックエンド改修不要 |
| 案 C (採用) | service 層で no-op fallback + endpoint で `null` → 204 No Content | エラーログ汚染解消 + future DynamoDB 実装の interface 互換維持 + 移行コスト最小 |

## 棄却理由

### 案 A 棄却理由: Pre-PMF 過剰防衛 (ADR-0010 Bucket B)

- **実装規模**: DynamoDB schema 設計 + 5 関数 (`insertUsageLog` / `updateUsageLogEnd` / `closeOpenSessions` / `findTodayUsageLogs` / `findUsageLogsByChildAndDateRange`) + factory 登録 + tests = 工数 8〜16h
- **PMF 影響度**: 使用時間サマリーは「admin status / settings 画面の補助表示」に限定。子供の活動記録・ポイント・冒険等の中核機能には影響しない (UsageTracker は計測のみ、UI 反映なし)
- **ADR-0010 Bucket B 整合**: 「PMF 検証時点で必須でない後付け監視機構」は明確に Bucket B (まだ作らない)。本機能はその典型。PMF 検証 (ユーザがプロダクトに本質的な価値を見出せるか) には不要

### 案 B 棄却理由: 機能後退 + 将来 PMF 後の修正コスト

- UsageTracker 自体を撤去すると、`src/lib/features/usage/` 配下のコンポーネント + UsageTimeIndicator 系 + admin/status の chart まで連鎖削除が必要 (修正面積大)
- PMF 後に使用時間ログを復活させる場合、撤去履歴を git で追跡する必要 (再実装より撤去-復活サイクルのほうが脳内コスト大)
- client 側 fire-and-forget fetch を残しつつ「server 側で no-op で吸収」のほうが疎結合かつ将来拡張性が高い

## 採用案とその理由 (案 C)

### 設計の核

```
client (UsageTracker) ─POST /api/v1/usage─→ endpoint ─→ usage-log-service
                                                            │
                                                            ├─ DATA_SOURCE=sqlite  ─→ SQLite repo (既存)
                                                            ├─ DATA_SOURCE=dynamodb ─→ no-op + logger.info (1 回のみ)
                                                            └─ DATA_SOURCE=demo    ─→ no-op + logger.info (1 回のみ)
```

- `startUsageSession` → `{ id: 0 }` (dummy)、`endUsageSession` → `{ durationSec: 0 }`、`getTodayUsageSummary` → 全 child `durationMin: 0`、`getWeeklyUsageSummary` → 直近 7 日 `durationMin: 0` 空エントリ
- endpoint 側で `result === null` (本物の DB エラー) を 500 ではなく **204 No Content** に変換 (CloudWatch 5xx alarm 抑止)
- `notifyNoopOnce()` で `logger.info` を 1 回だけ出力し、no-op 動作を可視化 (`feedback_no_escape_to_haribote_implementation.md` 整合 — silent skip 禁止)

### なぜこれが正しいか

1. **エラーログ汚染の即時解消**: 本番デプロイ後の CloudWatch から `[ERROR] POST /api/v1/usage 500` が消える (PR merge 直後に確認可能)
2. **UI への影響ゼロ**: `UsageTracker` は fire-and-forget。dummy id `0` を返しても client は body を読まない。admin 画面の使用時間サマリーは「全て 0 分」を表示するが、これは「本機能が dynamodb モードで未提供」を意味する適切な表現
3. **PMF 後の DynamoDB 完全実装に直結する interface**: service 層の signature を変えていないため、PMF 後に DynamoDB repo を追加すれば `isUsageLogNoopBackend()` の早期 return を削除するだけで完了 (roadmap §3 参照)
4. **テスト容易性**: `vi.stubEnv('DATA_SOURCE', 'dynamodb')` で no-op 動作を unit test できる (`tests/unit/services/usage-log-service-dynamodb-noop.test.ts` 9 ケース)

### ADR-0010 Bucket 判定との整合

ADR-0010 Pre-PMF Bucket B は「PMF 検証時点で必須でない後付け監視機構は作らない」。本機能はその典型例として、本 rationale が後続の同様判断のリファレンスとなる。

## 残された懸念・フォローアップ

- [ ] **PMF 後の DynamoDB 完全実装 roadmap §3**: ① DynamoDB schema 設計 (pk=`USAGE#<tenantId>` / sk=`<startedAt>#<childId>`) ② `src/lib/server/db/dynamodb/usage-log-repo.ts` 5 関数追加 ③ factory 登録 ④ `usage-log-repo.ts` facade を factory 経由に切替 ⑤ `isUsageLogNoopBackend()` 削除 ⑥ E2E 回帰 — 起票時期は **PMF 検証通過後** (個人開発で N ヶ月後を想定)
- [ ] **CloudWatch alarm 設定**: 本 PR merge + deploy 後、`[ERROR] POST /api/v1/usage` が消えることを確認。再発時は `[INFO] [usage-log] DATA_SOURCE 非 sqlite 環境を検出` 1 件が出るのが正常 (再発判定基準)
- [ ] **`getTodayUsageSummary` / `getWeeklyUsageSummary` の caller** (`/admin/status` 等): 0 分表示が「機能未提供」と区別できる UI を将来検討 (現状は静かな 0 分表示で問題なし、Pre-PMF Bucket B)

## 関連

- **議論源 Issue**: #2338
- **関連 PR**: (本 PR で issue close)
- **影響を受ける設計書**: `docs/design/06-UI設計書.md` (admin/status 使用時間サマリー section)、`docs/design/07-API設計書.md` (`/api/v1/usage` POST/PATCH 仕様)
- **関連 ADR**:
  - [ADR-0010](../decisions/0010-pre-pmf-scope-judgment.md) — Pre-PMF Bucket B 判断根拠
  - [ADR-0002](../decisions/0002-critical-fix-quality-gate.md) — Critical 修正の品質ゲート
  - (archive) [ADR-0028](../decisions/archive/...) は無関係 (retention とは別軸)
- **関連 feedback**:
  - `feedback_no_escape_to_haribote_implementation.md` — no-op を silent skip させない (`logger.info` 必須)
  - `feedback_root_cause_first_principle.md` — workaround 取る場合は根本解決 Issue とセット (本ケースは Pre-PMF 段階で根本解決を **意図的に延期** する判断、ADR-0010 整合)
