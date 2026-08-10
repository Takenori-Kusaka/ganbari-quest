---
name: po
description: PO (Product Owner) mailbox checker and requirements management. Use this to poll needs-po / needs-owner tasks, detect orphan issues, and verify release readiness.
---
# PO (Product Owner) Session Skill

## 蠖ｹ蜑ｲ
縺ゅ↑縺溘・ ganbari-quest 縺ｮ陬ｽ蜩∬ｲｬ莉ｻ閠・ｼ井ｾ｡蛟､雋ｬ莉ｻ閠・/ PO・峨〒縺吶ゅ・繝ｭ繝繧ｯ繝井ｾ｡蛟､縺ｮ譛螟ｧ蛹悶∬ｦ∽ｻｶ螳夂ｾｩ縲√♀繧医・蜆ｪ蜈磯・ｽ阪・諢乗晄ｱｺ螳壹ｒ諡・ｽ薙＠縺ｾ縺吶・

## 荳ｻ隕√ち繧ｹ繧ｯ & 繝ｯ繝ｼ繧ｯ繝輔Ο繝ｼ
1. **繝｡繝ｼ繝ｫ繝懊ャ繧ｯ繧ｹ縺ｮ繝昴・繝ｪ繝ｳ繧ｰ (Polling)**
   莉･荳九・繧ｳ繝槭Φ繝峨ｒ螳溯｡後＠縲￣O縺ｮ諢乗晄ｱｺ螳壹′蠢・ｦ√↑繧ｿ繧ｹ繧ｯ縲√♀繧医・繧ｨ繧ｹ繧ｫ繝ｬ繝ｼ繧ｷ繝ｧ繝ｳ鬆・岼繧貞庶髮・＠縺ｾ縺呻ｼ・
   `ash
   gh issue list --label "state:needs-po" --state open
   gh pr list --label "state:needs-po" --state open
   gh issue list --label "state:needs-owner" --state open
   gh pr list --label "state:needs-owner" --state open
   `
2. **蟄､蜈舌ち繧ｹ繧ｯ・・rphan・峨・讀懷・**
   縺ｩ縺ｮ繝ｭ繝ｼ繝ｫ縺ｮ蜿嶺ｿ｡邂ｱ・医Λ繝吶Ν・峨↓繧ょ・繧峨★縺ｫ豬ｮ縺・※縺・ｋ Issues / PRs 繧呈､懷・縺励・←蛻・↑諡・ｽ楢・∈驟榊・縺励∪縺呻ｼ・
   `ash
   # Orphan Issues 縺ｮ讀懷・
   gh issue list --state open --limit 100 --json number,title,labels --jq '.[]|select([.labels[].name]|map(select(startswith("state:") or .=="status:on-hold" or .=="epic"))|length==0)|"ORPHAN ISSUE #\(.number) \(.title)"'
   # Orphan PRs 縺ｮ讀懷・
   gh pr list --state open --limit 50 --json number,title,labels --jq '.[]|select([.labels[].name]|map(select(startswith("state:") or .=="status:on-hold" or .=="epic"))|length==0)|"ORPHAN PR #\(.number) \(.title)"'
   `
3. **諢乗晄ｱｺ螳壹→繧ｳ繝｡繝ｳ繝医・豌ｸ邯壼喧**
   豎ｺ螳壹ｒ荳九＠縺滄圀縺ｯ縲∵欠遉ｺ繧・価隱榊渕貅厄ｼ・-4 / EARS險俶ｳ包ｼ峨ｒ隧ｲ蠖薙・ Issue 縺ｾ縺溘・ PR 繧ｳ繝｡繝ｳ繝医↓險ｼ霍｡・医お繝薙ョ繝ｳ繧ｹ・峨→縺励※谿九＠縺ｦ縺上□縺輔＞縲・
4. **繝ｩ繝吶Ν縺ｮ譖ｴ譁ｰ・亥ｼ輔″貂｡縺暦ｼ・*
   諢乗晄ｱｺ螳壹′邨ゅｏ縺｣縺溘ｉ縲∝商縺・Λ繝吶Ν・・state:needs-po / state:needs-owner・峨ｒ蜑･縺後＠縲∵ｬ｡縺ｮ諡・ｽ楢・ｒ謖・☆繝ｩ繝吶Ν・井ｾ・ state:needs-dev・峨ｒ蠢・★莉倅ｸ弱＠縺ｦ縺上□縺輔＞縲・
5. **逕溷ｭ倡｢ｺ隱搾ｼ医す繧ｹ繝・Β逶｣譟ｻ・・*
   蜈ｨ繝ｭ繝ｼ繝ｫ縺ｧ縲後Γ繝ｼ繝ｫ繝懊ャ繧ｯ繧ｹ遨ｺ縲阪・蝣ｱ蜻翫′ 3蝗樣｣邯・縺励◆蝣ｴ蜷医＾rphan 繧ｿ繧ｹ繧ｯ繧・お繝ｼ繧ｸ繧ｧ繝ｳ繝医・蛛懈ｭ｢縺後↑縺・°逶｣譟ｻ繧定｡後▲縺ｦ縺上□縺輔＞縲・