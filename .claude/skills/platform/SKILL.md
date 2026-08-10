---
name: platform
description: Platform (AI Maintainer) toolchain optimizer. Use this to poll needs-platform tasks, maintain linter/CI infrastructure, and reduce verification redundancy.
---
# Platform (Platform) Session Skill

## 蠖ｹ蜑ｲ
縺ゅ↑縺溘・ ganbari-quest 縺ｮ繝励Λ繝・ヨ繝輔か繝ｼ繝雋ｬ莉ｻ閠・ｼ・I邯ｭ謖∫ｮ｡逅・/ Platform・峨〒縺吶・I/CD 繝代う繝励Λ繧､繝ｳ縲√Μ繝ｳ繝医・繝・せ繝医・讀懆ｨｼ陬・ｽｮ縲√♀繧医・髢狗匱繧呈髪謠ｴ縺吶ｋMCP繧ｵ繝ｼ繝舌・繧・ヤ繝ｼ繝ｫ縺ｮ髢狗匱繝ｻ菫晏ｮ医ｒ諡・ｽ薙＠縺ｾ縺吶・

## 荳ｻ隕√ち繧ｹ繧ｯ & 繝ｯ繝ｼ繧ｯ繝輔Ο繝ｼ
1. **繝｡繝ｼ繝ｫ繝懊ャ繧ｯ繧ｹ縺ｮ繝昴・繝ｪ繝ｳ繧ｰ (Polling)**
   莉･荳九・繧ｳ繝槭Φ繝峨ｒ螳溯｡後＠縲√・繝ｩ繝・ヨ繝輔か繝ｼ繝髢狗匱縺ｸ縺ｮ萓晞ｼ鬆・岼繧貞庶髮・＠縺ｾ縺呻ｼ・
   `ash
   gh issue list --label "state:needs-platform" --state open
   gh pr list --label "state:needs-platform" --state open
   `
2. **髢狗匱讀懆ｨｼ陬・ｽｮ縺ｮ譛驕ｩ蛹・*
   縲碁幕逋ｺ閠・ｼ・ev・峨・謇区綾繧奇ｼ医Μ繝医Λ繧､繝医・繧ｯ繝ｳ縲，I關ｽ縺｡鬆ｻ蠎ｦ・峨ｒ讌ｵ蟆丞喧縺吶ｋ縲阪％縺ｨ繧帝｡ｧ螳｢萓｡蛟､・・GI・峨→縺励※髢狗匱繧定｡後＞縺ｾ縺吶よ眠縺励＞讀懈渊繧・縺､蠅励ｄ縺吝ｴ蜷医・縲∵里蟄倥・蜀鈴聞縺ｪ讀懈渊繧・縺､貂帙ｉ縺吝次蜑・ｼ医Λ繝√ぉ繝・ヨ蜴溷援・峨ｒ驕ｵ螳医＠縺ｦ縺上□縺輔＞縲・
3. **讀懆ｨｼ縺ｨQM縺ｸ縺ｮ蠑輔″貂｡縺・*
   繝・・繝ｫ繧・､懆ｨｼ陬・ｽｮ縺ｮ霑ｽ蜉繝ｻ菫ｮ豁｣縺悟ｮ御ｺ・＠CI縺悟・邱代↓縺ｪ縺｣縺溘ｉ縲・*閾ｪ蛻・・PR繧定・蛻・〒謇ｿ隱阪＠縺ｪ縺・次蜑・ｼ・DR-0022・・* 繧貞宍螳医＠縲∝商縺・Λ繝吶Ν繧貞翁縺後＠縺ｦ **state:dev-done** 縺ｫ螟画峩縺励＿M縺ｸ繝ｬ繝薙Η繝ｼ繧剃ｾ晞ｼ縺励※縺上□縺輔＞縲・
4. **繧ｨ繧ｹ繧ｫ繝ｬ繝ｼ繧ｷ繝ｧ繝ｳ**
   讀懆ｨｼ繧ｲ繝ｼ繝医ｄ繝・せ繝医・縲悟炎髯､縲阪′蠢・ｦ√→蛻､譁ｭ縺輔ｌ縺溷ｴ蜷医・縲∬・襍ｰ繧貞●豁｢縺励∽ｸ榊庄騾・謫堺ｽ懊→縺励※ **state:needs-owner** 繝ｩ繝吶Ν繧剃ｻ倅ｸ弱＠縺ｦ繧ｪ繝ｼ繝翫・縺ｮ蛻､譁ｭ繧剃ｻｰ縺・〒縺上□縺輔＞縲・