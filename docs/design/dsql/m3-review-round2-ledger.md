# M3 物理モデル レビュー Round 2 台帳（4 独立観点）

> **Round 2 判定**: セキュリティ PASS / PoC honesty PASS（実測確定は error code と厳密一致・誇張ゼロ確認）/ M2 fidelity PASS。**残 [must]2 件は Round 1 修正の伝播漏れ（1 箇所残しパターン）**。最終 rework で解消、本台帳にトレース。
>
> **収束**: [must]2（伝播漏れ）+ [should]6 + [note]2 を反映。M3 は「実測裏取り済み + 伝播完全」の物理設計として **Round 3 / 収束**へ。

---

## [must]（Round 1 修正の伝播漏れ = 1 箇所残し）

| # | 欠陥（観点） | 根拠 | 是正 | 反映箇所 |
|---|---|---|---|---|
| **1（最重要・データ喪失再来経路、skeptic+性能 収束）** | §2.1 PK 凍結 governing-rule 表の「凍結（自然複合 PK）」に `checklist_log_items` / `evaluation_scores` が残存。§4.2/§4.3/§8.1/§1.4/§1.6 は「両子表を作らず text 据置」と是正済なのに **権威的 freeze list に残り自己矛盾** → M4 が読むと子表を新設し **PK 非可逆凍結 → 原初のデータ喪失（scoresJson/itemsJson 解体、genMissStreak 型 silent drop）が非可逆に再来** | §2.1 freeze list の残存 | **両子表を §2.1 freeze list から削除**。加えて実コード artifact を **M4 blocker として名指し**: (a) `pk-freeze-manifest.ts:41,50`（両子表の複合 PK declare）を凍結 ceremony 前に撤去必須（§2.2）(b) `dsql/schema.ts:547/642/575`（evaluation_scores/checklist_log_items 子表 + playerStatsJson 列展開）を M4 で捨てて rewrite（§10）。全 grep で他残渣 0 件確認 | §2.1 / §2.2 / §10 |
| **2（引用残渣、DSQL 制約観点）** | §1.5 point_ledger secondary「spike#7 で 2x = 最初から張る」が残存。PoC は point_ledger 2x を未計測（むしろ検証7 = 非 PK filter は統計未反映で full scan、二次 index は「張れば効く」でない）。§5.2（統計反映後に採否）+ §7 #3425 と矛盾 = Round 1 [must]C-7 の未伝播 | §1.5 の未実行 spike 確定引用 | **「spike#7 で 2x = 最初から張る」を撤回し PoC 保留に降格**（§5.2 と整合、統計反映後の実データ規模で採否） | §1.5 |

## [should]（3 観点で提示、反映）

| 項目 | 是正 | 反映箇所 |
|---|---|---|
| owner_guard の §1 本文「spike#3」「spike#6」ラベルが旧 spike 番号（事実は正しいが出典ラベル誤り） | §1 R-USER / R-MEMBERSHIP を **「Phase 1 PoC 検証3」に統一**（§3.1B/§8.2 と整合） | §1.1 |
| §10 reset-plan 決定#2 要約「branded id + 合成 id 廃止」が "branded id も廃止" と誤読され決定#2 の "維持" を反転 | **「branded id 型は維持・複合自然キー entity の合成 id のみ廃止」と分離表記** | §10 |
| PoC results doc が feature/dsql-poc-phase1 のみに存在（クラスタ削除済で orphan 化リスク） | **`docs/research/dsql-poc-phase1-results-2026-07-05.md` を本 branch に cherry-pick 同梱**（設計 + evidence 同梱 ship、traceability） | branch 同梱 |
| #3429 IAM ロール分離が「M4 spike」= design-only（DbConnectAdmin 付与で台帳改竄素通り） | **実 IAM policy JSON を本番 cutover 前 hard blocker に格上げ**（CDK 構成 spike とは別に role 分離だけは cutover 必須） | §3.4 / §7 #3429 |
| capability 再スコープ不変条件が E2E 1 層依存（family_id fitness は capability 5 表を allowlist 除外） | **targeted fitness を推奨**（capability lookup 後に family_id 束縛が無い pattern を AST 検出、ADR-0061 整合）を §3.4 に追記 | §3.4 |
| memberships(user_id) allowlist で偽造 user_id による他ユーザーのテナント列挙リスク | allowlist 行に **「user_id = 認証済 principal 本人のみ」制約を明記** | §3.4 |

## [note]

| 項目 | 是正 | 反映箇所 |
|---|---|---|
| §P0 P5 裏取り帰属の混在 | **3000 行 & 10MiB = PoC 検証4 / 5 分・128MiB・行 2MiB = spike#1 + 公式 CHAP_quotas** に分離 | §P0 P5 |
| §4.1 行番号 `556-562`（内容は正確、番号のみずれ） | **`555-561` に訂正** | §4.1 |

---

## 判定

- **[must]2（伝播漏れ）解消** + [should]6 + [note]2 反映。全て 1 箇所残しの伝播完全化で、Round 1 の設計判断（全 JSON 列 text 据置 / PoC honesty）を全箇所に整合させた。
- **データ喪失再来経路（§2.1 freeze list + pk-freeze-manifest.ts + dsql schema.ts）を断ち、M4 blocker として名指し**（M3 は設計ゆえ実装は編集せず、M4 の凍結前撤去タスクとして固定）。
- PoC evidence を branch 同梱し traceability を確保（クラスタ削除済の orphan 化防止）。
- → **M3 収束見込み。Round 3 board（fresh agent 独立再確認）で exit 判定**。
