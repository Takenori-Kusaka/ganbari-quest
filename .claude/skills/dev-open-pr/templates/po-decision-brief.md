## PO 決裁ブリーフ (po-decision:required)

<!-- #3862 / #3918: pr-review skill「Step 0: PO 決裁 triage」該当 PR にのみ添付する条件付きセクション。
     PR template 共通セクションの後ろに append する (PR_TEMPLATE_SECTIONS.json の必須セクション外)。

     様式 = 一枚絵 (PO 恒久要件 2026-07-23): PO は下の mermaid 図 1 枚 (+ UI 変更時は実機 SS) だけを
     見て Yes/No を判断できること。長文説明を主成果物にしない (補足は折りたたみへ)。
     記入原則: 各 node は 1 行 15〜25 字で言い切る / 5 秒で要点把握 (ADR-0012 整合、装飾より情報設計) /
     深刻度は 🔴🟡🟢 絵文字 + classDef 色で二重表現 / 「___」を全て置換してから起票する。 -->

```mermaid
flowchart TB
  classDef danger fill:#fee2e2,stroke:#dc2626,color:#7f1d1d
  classDef warn fill:#fef3c7,stroke:#b45309,color:#78350f
  classDef ok fill:#dcfce7,stroke:#15803d,color:#14532d
  classDef ask fill:#dbeafe,stroke:#1d4ed8,color:#1e3a8a

  subgraph RISK["① リスク・可逆性"]
    R1["可逆性: 🟢可逆 / 🔴不可逆 → ___"]
    R2["顧客面: 子供画面/親画面/課金/データ/法務 → ___"]
    R3["ロールバック: revert のみで戻る? データ破壊? → ___"]
  end
  subgraph TRADE["② trade-off (ADR-0010)"]
    T1["得る: ___"]
    T2["捨てる/負債: 運用保守コスト・新アーキ・積み残し → ___"]
  end
  subgraph OBJ["③ 反対理由 (adversarial-reviewer 転記)"]
    O1["business: ___"]
    O2["UX: ___"]
    O3["security: ___"]
  end
  subgraph CUST["④ 顧客面の変化 (プロダクト実態)"]
    C1["___ (UI 変更なら直下の実機 SS / 変化なしなら根拠)"]
  end
  subgraph ASK["⑤ PO 判断依頼 (Yes/No で回答可能に、1〜3 個)"]
    Q1["Q1: ___"]
  end

  RISK --> ASK
  TRADE --> ASK
  OBJ --> ASK
  CUST --> ASK

  class R1,R3 danger
  class T2,O1,O2,O3 warn
  class T1,C1 ok
  class Q1 ask
```

<!-- UI 変更時: mermaid 直下に実機 SS (screenshots branch) を embed する。図 + SS の 2 点で完結させる。
     mermaid で表現しきれない複雑な構図 (アーキ図等) が要る場合のみ画像 SS 添付に切替可 (GitHub 上で
     直接視認できる形が必須。外部ツールを開かせない)。 -->

<details>
<summary>補足 (PO は原則読まなくてよい — 図の根拠・詳細)</summary>

<!-- 図に収まらない根拠のみ簡潔に。③ の反対理由は tmp/adversarial-evidence/<pr>.json を
     .claude/skills/adversarial-reviewer/SKILL.md の手順で生成してから転記する
     (AI 要約への過信を構造的に打ち消す)。未生成のまま ③ を埋めない -->

</details>
