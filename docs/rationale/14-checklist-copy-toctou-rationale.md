# checklist copy の quota TOCTOU 設計判断

<!-- 命名規則: NN-機能名-rationale.md -->

## 議論の発端

- **日時**: 2026-07-16
- **発端 Issue / セッション**: #3474（#3181 / #3469 follow-up、QM adversarial review）
- **問題意識**: `/admin/checklists` の「別の子から copy」(`copyDistributionFromChild`) は、free プランの
  per-child テンプレ上限 (`maxChecklistTemplates`) を copy が超えて付与しないよう quota を enforce する。
  #3181 item1 で「ループ前 1 回読み」から「各 grant 直前に live 再評価」へ緩和したが、
  `checkChecklistTemplateLimit` (read) と `distributeToChildren` (insert) の 2 つの await 境界が残るため、
  DynamoDB では並行 POST 2 本が同一 live count を読んで over-grant する窓が理論上残存する
  (PR #3469 は本体 scope を「緩和」と正直に framing し、根治を本 Issue に委ねた)。concurrency 再現テスト 0 件。

## 検討した代替案

| 案 | 概要 | 検討した理由 |
|----|------|-----------|
| 案 A: DB-level 制約 | `checklist_template_assignments` に「per-child ≤ N」を表現する counter item + transaction (DynamoDB) / conditional で atomic count-and-insert | over-grant を物理的に不能化 |
| 案 B: application 単一強制点 | copy を service 層の 1 tx にまとめ、count-and-insert を単一 await に畳む | window を最小化 |
| 採用案: live 再評価 + accepted-residual 明文化 | 各 grant 直前の live 再評価を維持し、backend 別に window の有無を明記。soft-limit の bounded over-grant を accepted residual として文書化 + concurrency regression test で live 再評価の非退行を固定 | Pre-PMF (ADR-0010) の投資対効果 |

## 棄却理由

- **案 A 棄却理由**: `maxChecklistTemplates` は「per-child ≤ N」という**集合基数制約**であり、単一行の
  unique index では表現できない。DynamoDB で atomic 化するには counter item + `TransactWriteItems` +
  ConditionExpression が要り、schema 変更 + write DPU 増を伴う。over-grant の実害は「soft plan limit を
  1〜2 テンプレ超過」で、security/safety invariant ではない (課金・データ整合を壊さない)。Pre-PMF で
  この規模の機構を入れるのは過剰防衛 (ADR-0010 §3 / ADR-0063 の「silo は enterprise 向けに温存」と同性質)。
- **案 B 棄却理由**: copy は「source の assignments を 1 件ずつ target に配信」する反復で、各 iteration が
  別 template。単一 tx に畳んでも DynamoDB は cross-item の atomic count を保証しないため window は残る
  (SQLite/NUC では下記のとおり元々 window が無い)。実装複雑度が増すだけで DynamoDB の根治にならない。

## 採用案とその理由

**backend 別に TOCTOU window の有無を明示し、DynamoDB の bounded over-grant を accepted residual とする。**

- **SQLite / NUC (better-sqlite3、同期・単一 writer)**: `distributeToChildren` の insert は同期的に即反映され、
  次 iteration の `checkChecklistTemplateLimit` が確定 count を読む。**TOCTOU window は構造的に存在しない**
  (live 再評価は exact)。本 backend は self-host 単一家庭でそもそも並行 admin 操作が起きない。
- **DynamoDB (SaaS)**: read→insert の 2 await 境界が残り、並行 POST 2 本が同一 live count を読む窓が残存。
  ただし影響は「free の per-child テンプレ上限を数件超過」に限定される soft-limit 違反であり、
  課金・認可・データ整合を壊さない。**bounded over-grant を accepted residual** とし、根治 (案 A) は
  「soft-limit の over-grant が実運用で問題化した」ことをトリガに再検討する (Pre-PMF では投資しない)。

`copyDistributionFromChild` は各 grant 直前の live 再評価を維持し、この不変条件 (live 再評価が exact な
SQLite で over-grant が起きない) を concurrency regression test で固定する
(`tests/unit/routes/admin-checklists-copy-distribution.test.ts` の live-count interleaving シナリオ)。

## 残された懸念・フォローアップ

- [ ] DynamoDB の bounded over-grant が実運用で問題化した場合、案 A (counter item + TransactWriteItems) を
      再検討する — 関連: #3474
- [ ] EPIC #3424 (DSQL 移管) 後は Postgres の `SELECT ... FOR UPDATE` / serializable tx で案 B が
      現実的になるため、DSQL 移管完了時に再評価する

## 関連

- **議論源 Issue / PR**: #3474 / #3181 / #3469 / #3098
- **影響を受ける設計書**: `docs/design/data-model-resource-scope.md` §4.2 (checklist 配信)
- **関連 ADR**: [ADR-0010](../decisions/0010-pre-pmf-scope-judgment.md)（Pre-PMF scope 判断）/
  [ADR-0061](../decisions/0061-band-aid-breaking-shift-left-mechanization.md)（accepted-residual gate）
