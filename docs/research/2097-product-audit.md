# #2097 Product Audit (前提誤認の体系的洗い出し)

> **目的**: v2 research を含む過去 8 回の demo / production 統合提案が前提誤認に基づいていたため、product を構造的に正しく理解した上で 2097 の真のゴールを特定する。

## エグゼクティブサマリー (3 行)

1. **ADR-0039 (2026-04-18 accepted) は #2097 と同じゴール (`/demo/**` 廃止 + 本番ルートで `?mode=demo` 駆動) を 1 ヶ月前に決定済み**、hooks.server.ts に Phase 1 が実装済。`event.locals.isDemo` / `runtimeMode` で demo を本番ルート上で駆動、demo write は `can(ctx, 'write.db')` Policy Gate で構造的に deny される設計が既に存在する。
2. **#2097 の真のゴール = ADR-0039 Phase 2 (`/demo/**` 48 ファイル / 4,722 行の削除) の完遂** であり、新規大規模リファクタではない。ADR-0039 §移行パスは「1 PR 一括実施 (PO 判断 2026-04-18、tmp/QA-1180-demo-integration.md)」と明記、本来 1 ヶ月前に完遂すべき作業が未着手で残存。
3. **私の v2 deep research / Multi-Lambda / CDK 各補強研究は全て前提誤認** — ADR-0039/0040 archived を読んでいなかったため、既存アーキを再発明する提案 (案 D Demo Tenant、案 F Multi-Lambda 等) を生成。実態は **既存 ADR-0039 Phase 1 → Phase 2 移行作業 1-2 週間** で goal 達成可能、2 ヶ月リファクタは過剰見積もり。

---

## §1. ganbari-quest の実態 (前提誤認を訂正)

### §1-1. Deploy 形態は dual

| 環境 | DB | 認証 | 起動方法 |
|---|---|---|---|
| **AWS Lambda (production)** | DynamoDB (single-table) | Cognito + Google OAuth | `deploy.yml` GHA push to main |
| **NUC LAN サーバ (production 2)** | SQLite (WAL モード) | PIN (LAN 内のみ) | `deploy-nuc.yml` GHA push to main, self-hosted runner |

**Repository pattern が既存**: `src/lib/server/db/factory.ts` で `DATA_SOURCE` env 切替、35 Repository × 2 実装 (SQLite + DynamoDB)。

### §1-2. 5 実行モード × 5 ライセンスプラン (ADR-0040)

```
モード:
  build       (Vite prerender)
  demo        (?mode=demo / gq_demo cookie)
  local-debug (npm run dev)
  aws-prod    (Lambda + DynamoDB)
  nuc-prod    (NUC + SQLite)

プラン: free / standard / family / trial-expired / ops
```

**`src/lib/runtime/runtime-mode.ts`** で純関数化、`event.locals.runtimeMode` に注入。

### §1-3. demo 既存アーキテクチャ (ADR-0039 Phase 1 実装済)

`src/hooks.server.ts` line 254-373:

```ts
// 1) デモ実行モード判定
//   ?mode=demo クエリ → gq_demo cookie → /demo/* パス (Phase 1 backward compat)
event.locals.isDemo = resolveDemoActive(modeQuery, demoCookie, path).isDemo;

// 3) デモ状態なら書き込みを 200 no-op で抑止
//   Policy Gate `can(ctx, 'write.db')` 経由で判定 (ADR-0040 P4)
if (shouldReturnDemoNoop(method, path, mode)) return json({ ok: true, demo: true });

// 4) デモ時はダミー context を合成
event.locals.context = {
  tenantId: 'demo',          // ← demo tenant ID 既存
  role: 'owner',
  licenseStatus: AUTH_LICENSE_STATUS.ACTIVE,
};
```

つまり **demo は既に「本番ルート + 仮想 tenant + write no-op」の Stripe test mode 設計** が動作している。

### §1-4. 未完遂作業 = `/demo/**` 48 ファイル削除 (ADR-0039 Phase 2)

| 内訳 | ファイル数 | 行数 (推定) |
|---|---|---|
| `/demo/(child)/**` | ~7 | ~1,500 |
| `/demo/(parent)/admin/**` | ~30 | ~2,800 |
| `/demo/+layout.svelte` 他 | ~11 | ~400 |
| **合計** | **48** | **~4,722** (ADR-0039 記載値) |

ADR-0039 §廃止対象 通り、**Phase 2 で全削除予定**。Phase 1 backward compat (`/demo/*` パスでも demo 判定する) のため残存中。

---

## §2. 過去 v1/v2 research の前提誤認リスト

| # | 誤認内容 | 真実 | 影響 |
|---|---|---|---|
| 1 | demo の goal が未定義 | **ADR-0039 で 1 ヶ月前に確定済** (`/demo/**` 廃止 + 本番ルート `?mode=demo` 駆動) | v1 / v2 全研究の前提崩壊 |
| 2 | production = SQLite | **AWS Lambda = DynamoDB / NUC = SQLite (dual deploy)** | v2 主 research 案 D「SQLite demo tenant」が技術的に不可能 |
| 3 | demo 統合は新規大規模アーキ | **既存 ADR-0039 Phase 2 完遂作業 (1 PR)** | 2 ヶ月見積もり過剰、実態 1-2 週間 |
| 4 | Service Interface 抽象化が不足 | **既に Repository pattern 完備 + Policy Gate (ADR-0040) 完備** | v1 案 B (ViewModel) は補完であり主軸ではない |
| 5 | demo は sessionStorage / モック | **demo は本番ルート + in-memory tenant 'demo' + write no-op** (Stripe test mode 設計) | sessionStorage 議論は的外れ |
| 6 | Multi-Lambda 別 deploy 検討要 | **ADR-0039 で「サブドメイン分離は Pre-PMF 過剰」と棄却済** (選択肢 B 採用せず) | v2 補強研究 (Multi-Lambda) 不要 |
| 7 | CDK 6 stack 追加検討要 | **既存 6 stack そのまま、infra 変更ゼロ** が ADR-0039 採用案 | v2 CDK 補強研究 §8-3 結論「案 D が最適」と整合 (CDK Agent のみ正しい認識) |
| 8 | ChildHomeViewModel / ParentAdminViewModel が必要 | **不要** (本番ルートで demo も同じ load + 同じ component を通すため、ViewModel 抽象化は構造保証に不要) | Phase 1 PR #2108 の ViewModel 型定義は overshoot、削除候補 |
| 9 | `/demo/(child)/[mode]/shop/+page.svelte` snapshot copy | **`/demo/**` 全削除が正、shop は本番 `(child)/[uiMode]/shop/+page.svelte` を `?mode=demo` で駆動** | PR #2113 + 私の Edit は全て revert すべき |
| 10 | demo ナビに「ショップタブが欠落」 | **本番ナビをそのまま使う設計**、demo 専用 `/demo/(child)/+layout.svelte` の navItems 自体が不要 | navItems を本番 layout に統合 |
| 11 | 親画面は demo で「見せるだけ」 | **ADR-0040 P4 Policy Gate `can(ctx, 'write.db')` で全 write が deny 済** = 自動的に read-only 化 | 「親画面 read-only contract」の追加抽象化不要 |
| 12 | 5 phase 分割が必要 | **ADR-0039 §移行パス「1 PR 一括実施」明記** (5 分割を棄却済) | Phase 1 (PR #2108) merge 済、Phase 2 (#2110) / Phase 3 (#2113) は逆方向の作業 |

---

## §3. ADR-0039 / ADR-0040 が既に解決していること

PO 既発言 ↔ ADR 対応:

| PO goal (#2097) | ADR-0039 / 0040 解決方法 |
|---|---|
| 本番と同じ体験 demo | 本番ルート (`(child)/[uiMode]/**`) を `?mode=demo` で駆動 |
| 本番アップデート自動追従 | 同一コードパス = production 修正が demo に自動反映 |
| demo 専用開発ゼロ | `/demo/**` 削除後は demo 個別ファイル ゼロ |
| 実 DB に seed OK | **不要** (demo は in-memory tenant、Stripe test mode 設計) |
| Lambda + DynamoDB 整合 | ADR-0039 採用案 C は infra 変更ゼロ (CDK 工数 0 週) |
| 子供操作可、親見せるだけ | Policy Gate `can('write.db')` で demo write 全 deny、子供画面は read-only でも UI は動く (Stripe test mode 同設計) |

つまり **PO の goal 7/7 全項目を ADR-0039/0040 が既に満たしている**。残るのは Phase 2 移行作業のみ。

---

## §4. PR #2099 / #2110 / #2113 の再評価

| PR | 状態 | 評価 |
|---|---|---|
| **PR #2108 (Phase 1、merged)** | main に入った | `ChildHomeViewModel` / `ParentAdminViewModel` / ADR-0047 / 禁止語 SSOT。**型 + 文書のみで実害なし**、ADR-0039 と矛盾しないが overshoot |
| **PR #2110 (Phase 2、Draft)** | production toViewModel + DashboardView ViewModel 化 | **方向違い**。ADR-0039 では「本番 component を demo もそのまま通す」が正、ViewModel 抽象化は構造保証に不要 |
| **PR #2113 (Phase 3、Draft、agent worktree 削除済)** | demo seed 化 + ProdDashboardSections 削除 | ADR-0039 Phase 2 とは方向違い。demo seed 化ではなく `/demo/**` 削除が正 |
| **私の post-edit (#2113 への shop tab + shop page)** | push 済 | **revert すべき**。`/demo/(child)/+layout.svelte` 自体が ADR-0039 Phase 2 で削除対象 |

---

## §5. #2097 の真のゴール (再定義)

**Title 更新提案**:

> [CRITICAL] refactor: ADR-0039 Phase 2 完遂 — `src/routes/demo/**` 48 ファイル削除 + 本番ルートで `?mode=demo` 駆動

### 必達 AC (machine verifiable)

- [ ] `find src/routes/demo -type f | wc -l` → **0** (48 → 0)
- [ ] `/api/demo/exit` のみ残存 (cookie 削除エンドポイント)
- [ ] 本番ルート `(child)/[uiMode]/**` で `?mode=demo` 付与時に demo banner + plan switcher + floating CTA が条件 mount
- [ ] `event.locals.isDemo === true` 時の write が全て 200 `{ ok: true, demo: true }` (既存)
- [ ] LP `site/index.html` / `site/pricing.html` から demo へのリンクが `(child)/[uiMode]/home?mode=demo` 等に変更
- [ ] `scripts/check-no-demo-route-duplication.mjs` 新設 + CI 組込 (`/demo/**` 再生成を block)
- [ ] PR #2110 (Phase 2 ViewModel) / PR #2113 (Phase 3 seed 化) は **close** (方向違い)
- [ ] PR #2108 (Phase 1 ViewModel 型定義) は merge 済だが ADR-0047 と禁止語 SSOT のみ keep、ViewModel 型は使用しない or 削除

### 工数

ADR-0039 §移行パス「1 PR 一括実施」が前提。実装規模 = **48 ファイル削除 + LP リンク更新 + demo overlay 本番 layout 移植**。

- 削除: 自動 (48 files via `git rm`)
- LP リンク更新: ~10 箇所
- demo overlay 本番 layout 移植: ~1 layout, 条件 mount
- E2E 再撮影 + SS 比較
- **見積もり: 3-5 日**

2 ヶ月見積もりは前提誤認。ADR-0039 の「1 PR 一括」を尊重する。

---

## §6. 推奨アクション

1. **PR #2099 (closed)** / PR #2110 / PR #2113 を全 close、Phase 1 (PR #2108 merged) の ViewModel 型定義は将来削除候補として一旦保留
2. **#2097 Issue body を「ADR-0039 Phase 2 完遂」に書き換え**
3. **新規 1 PR で `/demo/**` 一括削除 + 本番 layout 条件 mount** を実装
4. **CI gate `check-no-demo-route-duplication.mjs` 追加** (ADR-0039 §CI 禁則記載済)
5. **ADR-0039 / ADR-0040 を archive → active に戻す** ことを検討 (これが #2097 の真の base となる)

---

## §7. 私が見落とした重要事実

1. **archive 配下の ADR を最初に読まなかった** (`docs/decisions/archive/0039-*.md` / `0040-*.md`)
2. **hooks.server.ts の "1) デモ実行モード判定" コメント** で ADR-0039 を見つけられなかった
3. **research 前に `infra/CLAUDE.md` を読まなかった** (NUC + Lambda dual deploy / DynamoDB を知らなかった)
4. **`src/lib/server/db/factory.ts` を見ずに「Repository pattern 不在」と仮説立てた**
5. **v2 deep research に「既存 ADR を読んで仮説検証」step を入れなかった**

次回以降の audit: **ADR archive 含めて全 ADR を最初に grep + 主要 hooks/middleware/factory ファイルを 30 分かけて読む** を必須化する。
