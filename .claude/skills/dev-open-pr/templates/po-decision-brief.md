## PO 決裁ブリーフ (po-decision:required)

<!-- #3862: pr-review skill「Step 0: PO 決裁 triage」該当 PR にのみ添付する条件付きセクション。
     kind 別追加セクションと同じ慣行で、PR template 共通セクションの後ろに append する
     (PR_TEMPLATE_SECTIONS.json の必須 13 セクションには含めない = 全 PR 強制ではない)。
     ADR 型 1 ページ・5 分読了。AI は triage + ブリーフ生成のみ、判断は PO が行う。 -->

### 1. リスク分類

<!-- 可逆 / 不可逆の別 + 影響する顧客面 (子供画面 / 親画面 / 課金 / データ / 法務) を 1-2 行で -->

### 2. ロールバック可否 / データ破壊の有無

<!-- revert PR だけで戻るか。migration / 物理削除等でデータが破壊されるなら復旧手段を明記 -->

### 3. trade-off (Pre-PMF スコープ判断、ADR-0010)

<!-- 何を得て何を捨てるか。運用コスト / 保守コスト増・新規デザインアーキテクチャパターン採用・
     技術負債の積み残しの有無 (PO 決裁 2026-07-19 追加軸) を明示 -->

### 4. 推奨 + 反対理由 3 つ

<!-- 推奨 (merge すべきか) を 1 行 + adversarial-reviewer skill の objections 3 件を転記。
     tmp/adversarial-evidence/<pr>.json が未生成なら .claude/skills/adversarial-reviewer/SKILL.md の
     手順で生成してから転記する (AI 要約への過信を構造的に打ち消す) -->

**推奨**:

| 軸 | 反対理由 (adversarial-reviewer 転記) |
|---|---|
| business | |
| UX | |
| security | |

### 5. プロダクト実態 (実機 SS + 顧客面の変化)

<!-- PO が「プロダクトで何が起きるか」を読む核。UI 変更なら実機 SS (screenshots branch 参照)、
     非 UI なら顧客に届く挙動・データ・料金面の変化を具体的に。「変化なし」ならその根拠を書く -->

### 6. PO への判断依頼事項 (1〜3 個)

<!-- Yes/No で答えられる形に絞る。例: 「この migration を本番適用してよいか (Yes/No)」 -->

1.
