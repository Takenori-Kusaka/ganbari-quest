# M3 物理モデル レビュー Round 1 台帳（4 独立観点 / [must]8）

> **工程**: M3 プロセス定義 §M3（`detailed-design-process.md`）+ §6 board（Fagan inspection: artifact 提示 → 独立並列レビュー → 欠陥ログ → rework → follow-up）。**Round 1 = 4 独立観点全 FAIL（[must]計 8）**。物理層最難関ゆえ件数は多いが **3 テーマに収束**。最重要 = **原初の危機（genMissStreak 喪失）の再来を board が実コードで捕捉**。
>
> **入力の是正**: 初版が `tmp/dsql-reset-plan-2026-07-05.md`（git-tracked でなく plain `grep` でヒット）を見落とし「reset-plan は存在しない」と虚偽記述 → 撤回。reset-plan **決定#1（JSON 列 TEXT 据置、2026-07-05 ユーザー承認）は controlling**。決定#3（point プリミティブ一本化）/#4（carryover 廃止）も reconcile。
>
> **状態**: 全 [must]8 を rework で解消（本台帳にトレース）。commit + push（feature/dsql-m3-physical）。

---

## テーマ分類と収束

| テーマ | [must] | 要旨 |
|---|---|---|
| **A データ喪失の根絶（最優先）** | 4 件（#1-#4） | 列展開/子表化が実 field を silent drop → **全 JSON 列 text 据置** |
| **B セキュリティ** | 2 件（#5-#6） | fitness allowlist 閉集合化 / 実行時接続 role 分離 |
| **C PoC 規律・トレース honesty** | 2 件（#7-#8） | 未実行 spike 依拠の断言降格 / M2 分類の捏造訂正 |

---

## [must] 台帳（欠陥 → 根拠 → 是正 → トレース）

### テーマA: データ喪失の根絶（text 据置）

| # | 欠陥（board 指摘） | 実コード根拠 | 是正 | 反映箇所 |
|---|---|---|---|---|
| **A-1** | child_challenges targetConfig 列展開が `genMissStreak`/`genMode`/`activityId`/`ageAdjustments` を落とす（genMissStreak=#3203 救済入力＝**原初喪失と同型**） | 実 write `child-challenge-service.ts:556-562` が `genMode`/`genMissStreak` を含む（宣言型 `TargetConfig:347-353` より広い）。export `export-format.ts:284-287` は opaque string | targetConfig/rewardConfig を **`target_config`/`reward_config` text 据置** | §1.6 R-CHILD_CHALLENGE / §4.1 表 / §4.2 |
| **A-2** | children.displayConfig の展開先 `display_color`/`display_decoration` は**実在しない捏造列**。実 field は cardSize/itemsPerCategory/collapsible（#2148 全消失） | `display-config.ts:7-14` `DisplayConfig{cardSize,itemsPerCategory,collapsible}` | **`display_config` text 据置**（将来 SQL field 検索が実発生したら `ALTER ADD COLUMN` 可逆展開） | §1.2 R-CHILD / §4.2 / §9 U-3 |
| **A-3** | evaluation_scores 子表化は reset-plan 決定#1 が明示否定（原初喪失の現場） | reset-plan 決定#1 + field query 0 件（grep） | **`evaluations.scores_json` text 列に吸収**（子表を作らない） | §1.4 / §4.2 / §4.3 / §8.1 |
| **A-4** | checklist_log_items 子表化（reset-plan 否定、item_id gap #3601） | field query 実 grep **0 件** + reset-plan 決定#1 | **`checklist_logs.items_json` text 列に吸収**（子表を作らない） | §1.6 / §4.2 / §8.1 |
| **A-派生** | backup round-trip 破壊 #3376（`export-format.ts:286-287` opaque string export） | 列展開/子表化が export ⇄ DB verbatim 往復を壊す | **text 据置で同時解消**（verbatim 保全、cutover 安全） | §4.4 |

> **反証（Phase 1 で裏取り）**: DPU 読み射影の最適化のみ。実 DPU で問題が出た列のみ後で可逆に見直す（既定は据置）= PoC 保留 #3425（§7）。

### テーマB: セキュリティ

| # | 欠陥（board 指摘） | 是正 | 反映箇所 |
|---|---|---|---|
| **B-5** | fitness function の family_id 述語例外が open な「グローバルっぽい表」判定で、新表が silent に述語なしで通る | **閉じた allowlist に固定**（categories/stamp_masters/age_benchmarks/plans/plan_tiers/stripe_webhook_events + users/email_login_lockouts + global-UNIQUE capability lookup viewer_tokens/cloud_exports/push_subscriptions/memberships/invites を明示列挙、それ以外 hard-fail）。加えて **不変条件「surrogate/capability 単独 fetch → 取得行 family_id で再スコープ」** を明記、cross-tenant E2E でトークン他家族流用 assert | §3.4（allowlist 表 + 不変条件） |
| **B-6** | 実行時接続ロールが物理設計に不在。GRANT を防御線に名指す以上ロールモデルは物理責務（DbConnectAdmin だと GRANT bypass で残高改竄・同意削除素通り） | **実行 = 専用最小権限 postgres role（DbConnect 系、append-only 表 UPDATE/DELETE grant なし）/ migration = DbConnectAdmin 別クレデンシャル** を物理設計に明記。**#3429 IAM ロールモデルを「schema 非依存」から schema 結合 MUST に格上げ**（実 policy JSON は PoC） | §3.4（接続ロールモデル）/ §7 #3429 |

### テーマC: PoC 規律・トレース honesty

| # | 欠陥（board 指摘） | 是正 | 反映箇所 |
|---|---|---|---|
| **C-7** | 未実行 spike の「確定」扱い。§11.1 は spike#1 のみ、§11.2 は spike#2-#8 未実施。owner_guard 23505 / PK-prefix 既定 access path / 生成列 42P17 回避 / point_ledger 2x secondary / F1 dedup 等は spike#2-#8 依拠 | **これらを構造決定→PoC 保留（#3425/#3427）に降格**、spike#1 のみの事実を正しく帰属。**注: 実機 PoC で正当に確定できる見込み**（降格しておけば PoC 結果で構造決定に戻せる） | §5.1/§5.2（降格）/ §7 #3425・#3427 / §8.2 |
| **C-8** | stamp_cards/certificates を「M2 が自然複合にしていたものを物理で降格」と記述 = 捏造。M2 §3.1 は既に両者を**代理識別子バケット**に分類済（M2 §1.6 R-STAMP_CARD PK も surrogate + 自然 UNIQUE 併記） | **「M2 の代理識別子判断を物理で追認・根拠明文化」に訂正**（物理 outcome = UUID surrogate + droppable UNIQUE は M2 と一致） | §1.6 R-STAMP_CARD / §1.8 R-CERTIFICATE / §2.1 governing rule 表 / §8.2 |

---

## [should]（余力で反映済）

| 項目 | 是正 | 反映箇所 |
|---|---|---|
| activity_logs/daily_missions に child_id 物理再導入時の app 層等価不変条件 | `child_id == 活動所有 child` を (C) app 層不変条件として物理復活（M2 が自明化した述語）を明記 | §3.3 |
| owner_guard の担保範囲 over-claim | I-OWN を **≤1（owner_guard UNIQUE で物理強制）** と **≥1（最後の owner 降格/削除ブロック = app 層）** に正直に分割 | §3.1(B) / §3.3 |
| 多態 source_type/source_id の再スコープ義務 | `WHERE family_id = <当該行.family_id>` で参照先束縛を §3.1(D) + §3.4 不変条件に明記 | §3.1(D) / §3.4 |
| I-BAL-NONNEG の FOR UPDATE を構造決定と over-claim | **DSQL OCC 下で FOR UPDATE が 40001 footprint を生むか未検証 → PoC 保留（#3425）に移動**。write-then-check に畳む代替も PoC 比較 | §6.6 / §7 #3425 |
| ASYNC UNIQUE の build 完了を書込開放前に確認する順序 | cutover 順序（CREATE TABLE → ASYNC UNIQUE → job 完了 poll → 書込開放）を明記（build 未完了中 INSERT で一意未強制の窓） | §6.5 |

---

## reset-plan controlling 決定の reconcile（追加是正）

初版が見落とした `tmp/dsql-reset-plan-2026-07-05.md`（2026-07-05 ユーザー承認）と reconcile:

| reset-plan 決定 | reconcile |
|---|---|
| **#1 JSON 列 TEXT 据置** | テーマA で全 JSON 列 text 据置に是正（同根拠・同結論）。「reset-plan は存在しない」虚偽記述を撤回 |
| #2 branded id 維持 + 複合自然キー entity の合成 id 廃止 | §1/§2 の UUID PK + 自然複合 PK 昇格（合成 id 廃止）と整合済 |
| **#3 point 書込プリミティブ一本化** | §6.2 に `insertPointEntry` 単一化・ドメイン repo total_point 不触を追記 |
| **#4 carryover 廃止 + total_point authoritative 増分** | 初版 §6.2 の carryover 繰越エントリを撤回。retention = 古い ledger 削除のみ・total_point 不触。fitness#14 を増分整合検証に再定義 | §6.2 / §9 U-2 注記 / §10 |

---

## 決裁

- **全 [must]8 解消**（テーマA 4 / B 2 / C 2）+ [should]5 反映 + reset-plan 決定#1-#4 reconcile。
- **exit 判定は Round 2 board（fresh agent 独立再レビュー）**。本台帳は Fagan recorder 記録（決定→根拠→検証エビデンス→反映箇所）。
- **凍結 ceremony の残 blocker = U-1（age_benchmarks PK に category 含むか）** のみ（§9）。text 据置化で子表 PK 凍結 blocker（evaluation_scores/checklist_log_items）は消滅。
