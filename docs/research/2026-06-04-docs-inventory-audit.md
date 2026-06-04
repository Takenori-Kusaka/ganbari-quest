# docs/ 棚卸 inventory 監査（#2440 PR-0）

| 項目 | 内容 |
|------|------|
| 関連 Issue | #2440（PO 着手承認 + 4 判断回答: 2026-06-04） |
| 役割 | 経緯メタ汚染の機械計測記録 + 是正の判定基準 SSOT。整形 PR 群（#2440 確定計画）の基準書 |
| 計画本文 | #2440 の確定計画コメント（PR 構成・粒度ルール・gate 方針） |

## 1. 判定基準（User 指針の操作化）

> 変更履歴はコミットメッセージに入れるべきであり、設計ドキュメントに中途半端に残すと情報が複雑化する。設計ドキュメントは端的かつ無駄ない情報のみで構成し、変更履歴は git で管理する。（User 直接指摘 2026-05-23）

| 区分 | あるべき内容 | docs から外す対象（経緯メタ） |
|---|---|---|
| 設計 docs（`docs/design/` 等） | 「現状の正解」のみ。端的・無駄なし | 「旧 X は #NNNN で撤去済」型 inline 注記 / strikethrough 履歴表 / 「YYYY-MM-DD 時点」datestamp / 「Phase N で〜」進行注記 / 「変更履歴」節 |
| ADR（`docs/decisions/`） | 決定 + 採用根拠 + 棄却案。**supersede / deprecated 記録は正当** | active ADR 本文に混入した進行中検討 Q&A（PO 判断 Q3 により ADR の本格棚卸も scope に含む: volume 超過分割・1-in-1-out 消化・archive 移動） |
| rationale（`docs/rationale/`） | 機能設計の検討 narrative・棄却案比較 | 設計 docs と重複する仕様記述 |
| git commit / PR description | 変更履歴・supersede 経緯・修正理由の置き場所（正） | — |
| 調査資料（`docs/research/`） | 調査の計測結果・比較分析（本ファイル含む） | — |

## 2. 汚染 inventory（機械計測、2026-06-04）

### 計測コマンド

```bash
# 経緯メタ marker 密度（docs/zenn 除外、per-file 集計）
PAT='で実装済|で追加|で修正|で merge|で撤去|で削除|で統合|で置換|で rename|で振り|時点|棚卸|追記|→ #|（#[0-9]|\(#[0-9]| #[0-9]+ で|旧 |以前は|かつては|当初|当時|Phase [0-9].* で|PR #[0-9]+ で|supersede|deprecated|変更履歴|更新履歴|改訂履歴|履歴$'
for f in $(find docs/design docs/research docs/decisions docs/rationale docs/runbooks docs/operations docs/troubleshoot docs/sessions docs/security docs/reference -name '*.md'); do
  c=$(grep -cE "$PAT" "$f"); [ "$c" -gt 0 ] && echo "$c $f"; done | sort -rn

# 明示的「変更履歴 / 実装状況 / 更新経緯」節見出しを持つ file
grep -rlE '^#{1,4}\s*(変更履歴|更新履歴|改訂履歴|実装状況|更新経緯|履歴|変更ログ|更新ログ|改訂記録)' docs/ --include='*.md'
```

### dir 別集計

| dir | files | 汚染 file | marker hits | 備考 |
|---|---|---|---|---|
| design（top-level） | 76 | 61 | 1,187 | 是正対象の主戦場 |
| design/billing-redesign | 46 | 46 | 1,377 | **scope 除外**（billing EPIC #2514/#2525 帰属の process artifact、PO 判断 Q1「独立 issue のみ」） |
| decisions（ADR） | 76 | 75 | 597 | 大半は正当な supersede 記録。是正は本文混入 Q&A + 本格棚卸（PO 判断 Q3） |
| reference / operations / research / sessions / rationale / runbooks / troubleshoot / security | ~72 | ~65 | 534 | 小 dir 群、是正パターン確立に先行 |
| **合計** | ~339 | 247 | 3,695 | scope 内 ~200 file / ~2,300 hits |

### 汚染上位（design top-level、scope 内）

06-UI設計書(155) / lp-content-map(141) / 08-データベース設計書(120) / parallel-implementations(99) / 07-API設計書(70) / 26-ゲーミフィケーション設計書(44) / asset-catalog(43) ほか。

### 明示的「変更履歴/実装状況」節を持つ file = 26 件（ROI 最大、純削除 PR で優先処理）

design: 01-企画書 / 06-UI設計書 / 10-SaaS展開ロードマップ / 14-セキュリティ設計書 / 15-ブランドガイドライン / 16-運用設計書 / 17a-データ保護影響評価書 / 18-個人開発SaaS展開ガイド / 19-プライシング戦略書 / 20-リリース判定・運用手順書 / 22a-アイコン・ラベル統一規約 / 22b-タイポグラフィ・スペーシングガイドライン / 26-ゲーミフィケーション設計書 / account-deletion-flow / plan-change-flow / license-key-competitor-analysis / license-key-requirements / license-subscription-causality。
runbooks: account-deletion-email-automation。operations: license-key-secrets / notification-runbook / sla / stripe-dashboard-runbook。troubleshoot: github_actions。
（`docs/design/_template.md` のヒットはテンプレ指示文のため対象外）

### サンプル目視検証（false positive でないこと）

- 06-UI設計書: 「旧 +page.svelte」「§4.18/4.19 は #2295 で撤去済」= inline 経緯注記
- lp-content-map: 「~~06b~~ **#1621 R17 で削除し統合**」= strikethrough 履歴表、「2026-05-01 #1789 確定時点」= datestamp

## 3. 整形 PR の粒度ルール（PO 判断 Q2 の research 結論）

**file 数を一次基準とせず、3 条件 AND で 1 PR ≤ 30 file まで許容**:

1. **同質性**: 1 PR = 単一種別の操作のみ（純削除のみ / ADR 分割のみ / 参照更新のみ）。種別混在禁止（#2223/#2224 BLOCK の主因 = 異質混在。変更分解の統制実験とも整合）
2. **diff 行数**: 純削除 ≤ 800 行 / 改変含む ≤ 400 行（SmartBear/Cisco 研究の 200-400 LOC 帯。削除は per-line 検証が軽く 2 倍許容）
3. **機械検証**: 「意味変更ゼロ」を grep/diff で機械確認できること。`--fix` 一括は禁止（#2243）

ADR 棚卸は supersede chain・README 表・1-in-1-out を伴う**意味変更**のため **1 ADR = 1 PR / ≤400 行 / QM 5 手順フル**。SSOT ファイル削除は別 PR 必須（既存ルール踏襲）。

## 4. 再混入防止 gate（PO 判断 Q4 の research 結論）

専用 script は**新設しない**（check-* script の ratchet 骨格が 5-7 本でコピペ重複している実態 = #2668 で既認知。個別最適 script の増殖を避ける）。`scripts/check-internal-terms.mjs` の対象 glob 引数化 + banlist 外部 JSON 化（`scripts/check-doc-code-references.mjs` の `--baseline-path` 引数化が先行事例）で「docs 履歴メタ banlist」を config として渡す。ratchet 共通骨格は #2668 が提案する baseline-utils 共通モジュール（未作成、#2668 AC-2）の切り出しに相乗り。**棚卸本体（削除 PR 群）を先行**し、gate は #2668 着手時に後付け。
