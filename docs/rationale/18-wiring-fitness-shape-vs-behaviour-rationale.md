# 配線を守る test — 形状検査から振る舞い検査へ 設計経緯

## 議論の発端

- **日時**: 2026-09-09
- **発端 Issue / セッション**: PR #4860 (QM セッション、adversarial reviewer 4 ラウンド)
- **問題意識**: **「配線が生きていること」を守る test を 3 回硬化し、3 回とも抜けられた。** 純関数と store の契約 test は緑のまま、それを**呼ぶ側**が呼ばなくなっても誰も気づかない。実際 #4860 の元欠陥 (Svelte 5 の子 `$effect` が親の `onMount` より先に走るため、親の仮置きが子の訂正を上書きする) を戻しても、既存 test は 1 件も落ちなかった。

守りたい不変条件はこれだけである:

- 子供 layout は章の **builder** を渡す (件数を推測して章を組み立てない)
- 件数を知っているのはホームだけなので、ホームが `setChildActivityPresence` で書く
- ホームを離れたら `undefined` に戻す (持ち越すと別画面で嘘になる)

## 検討した代替案

| 案 | 概要 | 検討した理由 |
|----|------|-----------|
| 案 A | source を正規表現で読み、関数名の出現を assert する | 最も安く、依存が要らない |
| 案 B | source を AST (`svelte/compiler` の `parse`) に落とし、呼び出しの**形**を assert する | 名前の出現ではなく「何が引数に渡っているか」を見られる |
| 案 C | AST + `ImportSpecifier` の alias 解決 + `$effect` スコープ限定 | 案 B の抜け道を塞ぐ |
| **採用案** | **home component を活動 0 件 / 40 件で mount し、unmount を跨いで `getChildActivityPresence()` を読む振る舞い test** | 形ではなく**結果**を見るので、書き方に依存しない |

## 棄却理由

3 案とも実際に破られた。**破ったのは adversarial reviewer で、いずれも実測 (mutation を当てて test が緑のままであることを確認) である。**

- **案 A 棄却理由**: 名前を残したまま意味を壊せる。実測で 3 通り — ① builder を arrow で包んで件数を差し込む (`setChildChapterBuilder(() => makeChildChapterBuilder(uiMode)(true), …)`) ② `setChildActivityPresence(true)` と決め打ちで書く ③ `return () => …` を `const _reset = () => …` に変える (文字列は在るが cleanup ではない)。**284/284 緑のまま通った。**
- **案 B 棄却理由**: **alias 1 行で外れる**。`import { setChildActivityPresence as writePresence }` と書けば callee 名が一致しないので「呼んでいない」と数えられ、否定 assertion (`length === 0`) が通る。`setChapters as applyChapters` も同様で、for ループが 0 件を回って **vacuous に通る**。加えて `$effect` の外に置いた dead code (`function _makeCleanup(){ return () => …(undefined) }`) で cleanup 検査を満たせる一方、**正しい抽出 (`return makeCleanup()`) は落ちる** — 「危険な書き方が通り、安全な書き方が落ちる」向きに歪んでいた。
- **案 C 棄却理由**: 案 A / B の 6 通りは塞げたが、**さらに 3 通りが残った**。① 実 `$effect` の中の**到達しない分岐**で return する (`if (data.activities.length < 0) return () => …`) — 存在は見るが到達可能性を見ない ② `import * as store` → `store.setChildActivityPresence(true)` — `MemberExpression` を見ておらず、alias 解決も `ImportSpecifier` までで `ImportNamespaceSpecifier` は対象外 ③ `const writeIt = setChildActivityPresence; writeIt(true)` — 局所変数への再束縛。加えて **形状検査では原理的に閉じられない** ものが 1 つある: `setChildActivityPresence(data.activities.length >= 0)` は形が正しく**値が常に true**。

**共通の構造**: v2 は 3 通り、v3 は 3 通り、v4 は 3 通りで破られた。**形状検査には常に「次の形」がある。** そして硬化 1 周ごとに adversarial 1 周を消費した。

## 採用案とその理由

上記 9 通り + M13 は、すべて「**コードが、その形が言っているとおりに動かない**」という 1 つの class である。形を見る限りいたちごっこが終わらないので、**層を変える**。

home を活動 0 件 / 40 件で mount し、unmount を跨いで `getChildActivityPresence()` を読む振る舞い test 1 本で:

- alias で書こうが namespace 経由で書こうが局所変数に束縛しようが、**書き込んだ値が読める**
- 到達しない分岐に置いた cleanup は**実行されない**ので落ちる
- `length >= 0` のような常に true になる式は、**0 件のケースで期待値と食い違う**

**「呼んでいるか」ではなく「その結果どうなるか」を見れば、書き方の自由度は問題にならない。**

本 PR (#4860) で入れなかったのは、home component の依存が重く (mount に必要な props / store / navigation の量)、4 ラウンド目の時点でそこに手を伸ばすと PR がさらに膨らむため。**形状検査を残したまま、閉じていない範囲を test header と PR body に明記する**方針を採った (adversarial reviewer の推奨と一致)。

## 残された懸念・フォローアップ

- [ ] 振る舞い test の実装 — home を 0 件 / 40 件で mount し unmount を跨いで presence を読む 1 本。**入れたら現行の形状検査は縮小してよい** (存在確認だけ残す)
- [ ] 同種の「配線が生きていること」を守る test が他にもある (`tests/unit/architecture/*` の callsite 系)。同じ弱点を持っていないかは未確認

## 関連

- **議論源 Issue / PR**: #4860 (`tests/unit/architecture/child-tutorial-wiring-callsites-4860.test.ts` の header に同じ内容の要約がある)
- **影響を受ける設計書**: なし (test の設計方針であり仕様ではない)
- **関連 ADR**: [ADR-0006](../decisions/0006-safety-assertion-erosion-ban.md) (assertion 弱体化禁止) / [ADR-0061](../decisions/0061-band-aid-breaking-shift-left-mechanization.md) (same-class-N→guard、fitness function)
