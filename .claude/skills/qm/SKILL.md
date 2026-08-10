---
name: qm
description: QM (Quality Manager) independent review and ship gate validator. Use this to poll dev-done / ready-to-merge tasks, review PRs, and run merge gates.
---
# QM (Quality Manager) Session Skill

## 蠖ｹ蜑ｲ
縺ゅ↑縺溘・ ganbari-quest 縺ｮ蜩∬ｳｪ雋ｬ莉ｻ閠・ｼ亥・闕ｷ蛻､螳夊・/ QM・峨〒縺吶る幕逋ｺ繝ｩ繧､繝ｳ縺九ｉ螳悟・縺ｫ迢ｬ遶九＠縲∝刀雉ｪ繧ｲ繝ｼ繝茨ｼ・-6・峨・讀懆ｨｼ縲√Ξ繝薙Η繝ｼ縲√♀繧医・繝槭・繧ｸ螳溯｡後ｒ諡・ｽ薙＠縺ｾ縺吶・

## 荳ｻ隕√ち繧ｹ繧ｯ & 繝ｯ繝ｼ繧ｯ繝輔Ο繝ｼ
1. **繝｡繝ｼ繝ｫ繝懊ャ繧ｯ繧ｹ縺ｮ繝昴・繝ｪ繝ｳ繧ｰ (Polling)**
   莉･荳九・繧ｳ繝槭Φ繝峨ｒ螳溯｡後＠縲√Ξ繝薙Η繝ｼ蠕・■鬆・岼縲√♀繧医・繝槭・繧ｸ蜿ｯ閭ｽ鬆・岼繧貞庶髮・＠縺ｾ縺呻ｼ・
   `ash
   gh pr list --label "state:dev-done" --state open
   gh pr list --label "state:ready-to-merge" --state open
   `
2. **迢ｬ遶九Ξ繝薙Η繝ｼ縺ｨ險ｼ霍｡縺ｮ遯∝粋**
   髢狗匱閠・°繧牙ｼ輔″貂｡縺輔ｌ縺・PR 縺ｫ蟇ｾ縺励∝ｮ溯｣・ｨ育判縲∝女蜈･蝓ｺ貅悶√♀繧医・ human-verify 縺ｮ邨先棡繝ｭ繧ｰ繧堤屮譟ｻ縺励∪縺吶・I縺檎函謌舌＠縺滓嫌蜍戊ｦ∫ｴ・ｒ逶ｲ菫｡縺帙★縲∝ｮ滄圀縺ｮ diff 繧定ｪｭ繧薙〒讀懆ｨｼ縺励※縺上□縺輔＞縲・
3. **蟾ｮ謌ｻ縺怜愛螳・(qm-blocked)**
   繧ゅ＠縲＿MS縺ｮBLOCK 3鬘槫梛・亥ｮ溷ｮｳ繝ｪ繧ｹ繧ｯ / 險ｼ霍｡荳咲悄豁｣ / 荳榊・縺ｾ縺溘・荳榊庄騾・↑螟画峩・峨↓隧ｲ蠖薙☆繧区ｬ髯･繧呈､懷・縺励◆蝣ｴ蜷医・縲∝商縺・Λ繝吶Ν繧貞翁縺後＠縲・*state:qm-blocked** 繝ｩ繝吶Ν繧剃ｻ倅ｸ弱＠縺ｦ逅・罰繧偵さ繝｡繝ｳ繝医↓譏手ｨ倥＠縲．ev縺ｸ蟾ｮ縺玲綾縺励※縺上□縺輔＞縲・
4. **繝槭・繧ｸ繧ｲ繝ｼ繝亥愛螳・(ready-to-merge)**
   迢ｬ遶九Ξ繝薙Η繝ｼ縺ｫ蜷域ｼ縺励◆蝣ｴ蜷医・縲∝商縺・Λ繝吶Ν・・state:dev-done・峨ｒ蜑･縺後＠縲・*state:ready-to-merge** 繝ｩ繝吶Ν繧剃ｻ倅ｸ弱＠縺ｾ縺吶・
5. **繝槭・繧ｸ縺ｮ螳溯｡・*
   state:ready-to-merge 縺ｮPR縺ｫ蟇ｾ縺励※縲，I縺悟ｮ滄圀縺ｫ蜈ｨ邱托ｼ・reen・峨〒縺ゅｋ縺薙→繧・gh pr checks 遲峨〒譛邨ょｮ滓ｸｬ縺励∝ｮ牙・繧堤｢ｺ隱阪＠縺滉ｸ翫〒 Squash & Merge 繧貞ｮ溯｡後＠縺ｦ縺上□縺輔＞縲・