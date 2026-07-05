# M3 物理モデル レビュー Round 3 台帳（短）

> **Round 3 判定**: 3 観点すべて PASS（**0 [must]**）＝ **M3 ゲート成立**。統合前の最終 micro-touch（[should]2 + [note]2、純粋な整合掃除で設計判断は不変）を反映し、feature/dsql へ統合。

## [should]（M4 安全性、反映）

| # | 項目 | 是正 | 反映 |
|---|---|---|---|
| 1 | §10 の「M4 で捨てて rewrite する artifact」リストに **最も severe な `child_challenges.targetConfig 列展開`（`childChallenges` export :878、`target_*` 列 :888-892）が漏れ**（genMissStreak 喪失 = 原初喪失そのもの） | **child_challenges を明示追加**（`target_config` text 据置）。部分 rewrite の M4 実装者が `target_metric`/`base_target` を legit ドメイン列と誤認し温存する残余リスクを明記して断つ。既存 3 件（evaluation_scores:547 / checklist_log_items:642 / playerStats:578 の player_* 列 587-591）も export 行番号を精緻化 | §10 |
| 2 | §1.1 bonus_rules 発火条件「素の列に展開」+ §1.1 notification 静音「2 素の列」が §4.2「全 JSON 列 text 据置」と内部矛盾（M4 指示の二重化） | 両者を **text 据置に統一**（field query 0 件、将来必要になれば `ALTER ADD COLUMN` で可逆展開）。§9 U-3 / §4.2 と一貫化 | §1.1 |

## [note]（整形）

| 項目 | 是正 | 反映 |
|---|---|---|
| §6.6 の I-SUB/I-DECAY/I-PURGE/I-PIN-RESET 行が逐語重複（表が 2 度描画、Round 1 編集の残渣） | 重複 4 行を削除（1 セットに） | §6.6 |
| §10 schema.ts 行番号 drift | 実 `export const` 行に精緻化（evaluation_scores:547 / checklist_log_items:642 / daily_battles:578 / child_challenges:878 + 各展開列レンジ） | §10 |

## 判定

- 0 [must]。[should]2 + [note]2 は純粋な整合掃除で設計判断不変（全 JSON 列 text 据置の伝播完全化 + 表重複除去 + 行番号精緻化）。
- **M3 ゲート成立** → feature/dsql へ統合。M4（実装）は Phase 1 PoC close 済 + 本 M3 確定モデル + §10/§2.2 の M4 blocker（子表/列展開 artifact 撤去・rewrite）を入力に着手可。
