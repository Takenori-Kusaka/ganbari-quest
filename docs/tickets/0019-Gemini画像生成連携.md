# Gemini画像生成連携

### ステータス

`Backlog`

---

### 概要

Gemini API (Nano Banana Pro) を使用したキャラクター画像生成機能を実装する。

### 背景・動機

ステータスに応じたキャラクター（ヒーロー、勉強中など）を動的に生成し、ゲーミフィケーション体験を強化する。

### ゴール

- [ ] `$lib/server/services/image-service.ts`
- [ ] Gemini API クライアント実装
- [ ] キャラクター生成プロンプトテンプレート
- [ ] 生成画像のキャッシュ・保存ロジック
- [ ] .env への GEMINI_API_KEY 設定
- [ ] フォールバック画像（API失敗時）

### 作業メモ

- docs/reference/gemini_image_generation_guide.md を参照
- 子供ごとに異なるキャラクターテーマ
- favicon もGemini API (Nano Banana Pro) で自動生成する（アプリアイコン）

### 成果・結果

### 残課題・次のアクション

