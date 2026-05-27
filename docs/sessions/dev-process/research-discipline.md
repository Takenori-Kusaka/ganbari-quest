# 調査規律 — 正しい問い → 仮説中立 framing → 反証確認

> deep research / 技術調査が confirmation bias の合理化に堕ちないための規律。3 ラウンド連続で結論逆転した失敗の構造的是正。

**SSOT 位置付け**: [dev-process/README.md](README.md) の各論。

---

## 1. 調査の前に「正しい問い」が立っているか確認する

deep research を疑う観点は「仮説に流されたか（framing bias）」だけでなく、その**手前の「問いそのものが正しく立っているか」**。一般論の調査ではなく、**自プロダクトの前提条件から問いを立てる**。

着手前に必ず:

1. **問いをプロダクト前提に当てる** — 「<技術> のベストプラクティスは?」（一般論）でなく「**<自プロダクトの前提条件> の文脈で <技術> に何が本当に必要か**」と問い直す
2. **前提条件を明示列挙** — 実行基盤（NUC 単一 SQLite）/ 顧客（家庭・子供）/ 開発体制（AI 駆動、self-review が効きにくい）/ 段階（Pre-PMF）/ 制約（ADR-0010 過剰防衛禁止）を問いに織り込む
3. **failure class / customer impact 起点** — 機能網羅でなく「顧客が離脱する failure（データ消失 / 起動不能 / 子供画面破綻 / 別の子のデータ表示）」から逆算して問う
4. **一般論の結果を必ず自プロダクトに落とす** — 「業界では X」で止めず「このプロダクトでは X が合う / 合わない、理由は前提条件 Y」まで

正しい問いの例:

- ❌「migration ツール一覧」→ ✅「NUC 単一 SQLite + 既存 data 保全必須で lazy startup migration / shadow-table recreation のどちらが必要か」
- ❌「ソフトウェア品質ベストプラクティス」→ ✅「家庭 / 子供 / NUC SQLite / AI 駆動 / Pre-PMF で親が即離脱する failure class を捕捉する最小十分検証」

> 教訓: schema flip 着手時に「このプロダクトで migration に何が本当に必要か」とプロダクト前提から問えていれば、data copy migration 漏れ（NUC data loss + startup blocking の本番インシデント 2 件）を着手前に予見できた可能性が高い。一般的な「migration ツール一覧」調査ではこの問いは出てこなかった。

---

## 2. 仮説中立の framing（confirmation bias を作らない）

deep research agent に「User 仮説を裏付けよ」「Claude の提案を疑え」と framing すると、agent はその framing に沿った証拠を集める = confirmation bias の rationalization に過ぎない。framing で結論が逆転するのは research でなく合理化。

1. **仮説中立 framing** — 「customer use case を列挙し、各 case に最適な pattern を判定せよ」と framing する（仮説を先に与えない）
2. **customer use case 起点** — 「pattern を先に決めて事例で裏付ける」でなく「家庭の use case を列挙 → 各 case に schema / pattern を当てはめる」
3. **反証事例を最低 3 件確認**してから提示
4. **業界事例は補強であって決定根拠ではない** — 各事例の domain context を理解した上で適合性判定
5. agent への framing で「<仮説>を裏付けよ」「<仮説>を疑え」を使わない、「事実を列挙し評価せよ」を使う
6. **User と一緒に use case を評価**する場（`tmp/user-question/<task>-customer-use-case-qa.md` 形式）を作る

> 教訓: family master 一律仮説を「裏付け」framing → 業界 12 事例で裏付け成功 / per-type 仮説を「疑う」framing → per-type 推奨で反証成功。同じ問いで framing だけ変えて結論が逆転 = research の体をなしていない。

---

## 3. 二段構えの関係

§1（正しい問い）と §2（仮説中立 framing）は二段構え:

- §1 = 「問い自体が正しいか」（プロダクト前提に当たっているか）
- §2 = §1 で正しい問いが立った前提での「証拠の集め方が中立か」（framing bias がないか）

両方を満たして初めて research が意思決定の根拠になる。片方でも崩れると合理化になる。
