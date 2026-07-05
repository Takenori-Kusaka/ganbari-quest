# M4-C（schema 完成 + PK 凍結 manifest）レビュー Round 1 台帳

> **対象 PR**: `feature/dsql-m4c-schema`（EPIC #3424 M4 計画 §3.4/§3.5、M3 §1/§2）
> **検収結果**: 凍結 PK correctness PASS（全 58 表の PK が M3 §2 と一致、非可逆な誤り 0）/ 60→58 網羅 PASS。
> [must] 2 件 + [should] 2 件はいずれも**可逆**（列追加 / doc 整合）で凍結 PK 非可逆リスクではない。本台帳に rework をトレースする。

## 凡例
- 状態: ✅ 修正済 / ⏭ 申し送り（別 PR）
- 可逆性: すべて可逆（`ALTER ADD COLUMN` 相当 or doc のみ）。PK 凍結（§P1 非可逆）には非該当。

---

## [must]1 — 未文書化データ喪失（checklist_templates.source_preset_id 欠落） ✅

| 項目 | 内容 |
|---|---|
| 症状 | DSQL `dsql/schema.ts` の `checklistTemplates` に provenance 列 `source_preset_id` が欠落。SQLite SSOT（`db/schema.ts` `checklist_templates.source_preset_id`、#1254 G1）には在る。marketplace 取込 dedup（`checklist-template-import-service.ts` / `marketplace/strategies/checklist-strategy.ts` の `existingTemplates.find(t => t.sourcePresetId === presetId)`）が常に miss → 同一テンプレ二重取込（機能退行）。兄弟 type（`child_activities` / `special_rewards` = source_preset_id、`child_challenges` = source_template_id）は provenance を持つのに checklist だけ欠落。 |
| 修正 | `checklistTemplates` に `sourcePresetId: text('source_preset_id')`（nullable、SSOT と同 shape）を追加。 |
| 検証 | `dsql-stamp-checklist-schema.test.ts` に「checklist_templates に source_preset_id provenance 列がある（dedup miss 防止、SQLite parity）」を追加し green。 |
| 可逆性 | 列追加（PK 不変、`ALTER ADD COLUMN` 相当）。 |

## [must]2 — settings の M3 traceability（no-silent-gap） ✅

| 項目 | 内容 |
|---|---|
| 症状 | `settings`(family_id, key) 表が M3 §1 の 60 relation に写像元を持たない（事実上 61 番目の非系譜表）。PK 値自体は正当（anchor(b) KVS 1-key-1-value）で凍結非可逆リスクは無いが、M3 §8.1「§1 各行が M2 60 relation に 1:1」宣言に反する。 |
| 修正 | M3 `m3-physical-model.md` に **§1.11「M2 relation 外の実装表（no-silent-gap、settings）」** を追補（KVS 存置根拠 = M2 L-14 軽微概念の受け皿 / anchor(b) 凍結非可逆リスクなし / export allowlist で CWE-522・916 対処 / 昇格 path）。§8.1 に「物理表 58 = 57 relation-backed + settings 1 実装表」の内訳と settings reconcile を明記。撤去はしない（実データ依存）。 |
| 可逆性 | doc のみ。 |

## [should]1 — M3 doc を本 PR 確定に同期（U-1 決裁 / age_benchmarks→market_benchmarks） ✅

| 項目 | 内容 |
|---|---|
| 修正 | M3 §1.10 / §3.4 allowlist / §8 / §9 の `age_benchmarks` → `market_benchmarks`。§1.10 R-AGE_BENCHMARK 行と §9 U-1 行を「**U-1 未決 / blocker**」→「**U-1 決裁済 = (age, category_id)**」に是正。§9 の「凍結 blocker は U-1 のみ」注記を「決裁済 → 凍結 blocker 残存 0」に是正。 |
| 可逆性 | doc のみ。 |

## [should]2 — 表名 drift 3 件を schema 名へ寄せる ✅

| doc 旧名 | schema 名（正） | 是正箇所 |
|---|---|---|
| `activity_preferences` | `child_activity_preferences` | M3 §1.3 / §2.1 |
| `age_benchmarks` | `market_benchmarks` | M3 §1.10 / §3.4 / §8 / §9 |
| `graduation_consents` | `graduation_consent` | M3 §1.9 / §3.4 append-only allowlist |

PK 列は元々一致ゆえ非可逆影響なし（表名表記のみ）。

## [note] — repo/migration PR（M4-D/E）へ申し送り（本 PR では記述のみ） ⏭

1. **`children.birth_date` nullable → ui_mode 派生 fallback**: birth_date が NULL の時 compute-on-read が永続 `ui_mode` 列へ fallback する契約を repo PR（M4-D）で保証。schema 側は `ui_mode` + `ui_mode_manually_set` を保持済（コメント済）。
2. **`stamp_masters` PK=(stamp_code) int→code cutover 写像**: sqlite 現行の int id → 安定 `stamp_code` 変換時に `stamp_entries.stamp_master_id`（text）の orphan 化防止を migration PR で検証。schema 側はコメント済。

## board 申し送り（後続セキュリティ/テスト PR で検討）
- **SQLite SSOT vs DSQL schema の列単位 diff を fitness function 化**して未文書化 column drop を機械検出する案。今回 `source_preset_id` は手 diff で発見（幸運）。機械ガードが望ましい（既存 fitness#6/#9/#13 の骨格に「同名表の列集合 parity」チェックを追加する形が有力）。

---

## DoD 再確認（rework 後）
- `npx vitest run src/lib/server/db/ tests/unit/db/` green（+source_preset_id parity test）
- `biome check` clean / pk-freeze-manifest test green / 合成 id 0 維持 / ADR-0006 assertion 弱体化なし
- 全修正を本台帳にトレース済。
