# 0061 README拡充・ビジュアルブランディング

## Status: Done

### メタ情報

| 項目 | 値 |
|------|-----|
| フェーズ | Phase 1: 事前調査・プロトタイプ |
| 難易度 | 低 |
| 優先度 | 高 |
| 要件番号 | 3 |
| 依存チケット | なし |
| 規定書対応 | 第4章 マーケティング素材 |

---

### 概要

READMEを拡充し、GIFアニメやスクリーンショットでアプリの体験価値をわかりやすく伝える。OSSとしての認知・Star獲得を促進する。

### 背景・動機

GitHubリポジトリの第一印象がREADMEで決まる。競合OSSプロジェクト（Habitica等）はスクリーンショットやデモGIFで直感的に価値を伝えている。

### ゴール

- [x] ヒーロー画像 or ロゴの作成・配置（デザインリソース作成後に追加）
- [x] 操作GIFアニメの作成（ScreenToGifでキャプチャ、Phase 2以降）
- [x] スクリーンショットギャラリー（Phase 2以降）
- [x] バッジ追加（ライセンス、SvelteKit、TypeScript、SQLite、テスト数）
- [x] 英語版READMEの並記（README.en.md + 相互リンク）
- [x] CONTRIBUTING.md更新（ライセンス言及、セットアップ手順改善）
- [x] セットアップガイド充実（Docker手順追加、ディレクトリ構成詳細化）
- [x] ライセンス変更: MIT → AGPL-3.0（LICENSE、package.json、README）

### 対応方針

#### README構成案
```markdown
# がんばりクエスト 🏆

> 子供の「がんばり」をゲームに変える - 家庭内専用ゲーミフィケーションWebアプリ

[デモを試す](https://xxx.github.io/ganbari-quest/) | [ドキュメント](#) | [Discord](#)

![バッジ群]

## スクリーンショット
[GIF: 子供が活動を記録してポイントを獲得する様子]
[GIF: レベルアップの演出]
[GIF: 親の管理画面]

## 特徴
- 🎮 RPG風のゲーミフィケーション
- 👶 年齢に合わせたUI（0歳〜15歳対応）
- 🏠 家庭内完結・プライバシー重視
- 📱 レスポンシブ（タブレット最適化）
- 🎯 セルフホスト可能 + SaaS版あり

## クイックスタート
...

## セットアップ
...

## ライセンス
MIT License
```

#### GIF作成方法
1. ScreenToGif（Windows）でキャプチャ
2. 解像度: 800x600程度
3. FPS: 15
4. 最適化してファイルサイズ1MB以下に
5. 配置先: `docs/assets/` or 外部（GitHub CDN）

#### バッジ候補
- License: MIT
- Build: GitHub Actions CI
- Tests: Vitest passing
- Svelte: 5
- SvelteKit: 2
- TypeScript: strict

### 成果・結果

README拡充・ライセンスAGPL v3変更。コミット: dafac02

### 残課題・次のアクション

- デモサイト（#0060）のURLをREADMEに追加
- GitHub Sponsors（#0062）のバッジ追加
