# Gemini画像生成連携

### ステータス

`Done`

---

### 概要

Gemini API (Nano Banana Pro) を使用したキャラクター画像生成機能を実装する。

### 背景・動機

ステータスに応じたキャラクター（ヒーロー、勉強中など）を動的に生成し、ゲーミフィケーション体験を強化する。

### ゴール

- [x] `$lib/server/services/image-service.ts` — メインサービス（生成・キャッシュ・フォールバック）
- [x] Gemini API クライアント実装（@google/generative-ai SDK）
- [x] キャラクター生成プロンプトテンプレート（image-prompt.ts）
- [x] 生成画像のキャッシュ・保存ロジック（character_images テーブル + static/generated/）
- [x] .env への GEMINI_API_KEY 設定（.env.example 既存）
- [x] フォールバック画像（API失敗時はSVGプレースホルダー）
- [x] favicon SVG（static/favicon.svg）+ app.html リンク追加
- [x] API エンドポイント（POST /api/v1/images）
- [x] 親管理画面にアバター生成ボタン追加

### 作業メモ

- docs/reference/gemini_image_generation_guide.md を参照
- 子供ごとに異なるキャラクターテーマ
- favicon もGemini API (Nano Banana Pro) で自動生成する（アプリアイコン）

### 成果・結果

- `image-service.ts`: Gemini API による画像生成 + DB キャッシュ + SVG フォールバック
- `image-prompt.ts`: キャラクタータイプ別・テーマ色別のプロンプトテンプレート
- `POST /api/v1/images`: avatar/favicon 生成エンドポイント
- `static/favicon.svg`: がんばりクエスト星キャラクターアイコン
- 親管理画面の子供詳細からアバター生成が可能

### 残課題・次のアクション

- 実際の GEMINI_API_KEY 設定後の動作確認
- 子供画面でのキャラクター表示（現在はHeader avatarUrlのみ）
- キャラクターのバリエーション増加（レベルアップ時の再生成）

