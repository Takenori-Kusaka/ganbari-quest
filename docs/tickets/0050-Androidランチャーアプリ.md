# Androidランチャーアプリ

### ステータス

`Backlog`

---

### 概要

子供用Androidタブレットでがんばりクエストに簡単にアクセスするための最小構成Androidアプリを作成する。Chromeのリンクショートカットが子供用アカウントでは配置できないため、WebViewで `http://k-serv.local:3000` を開くだけのネイティブアプリとしてAPKを生成し、直接インストールする。

### 背景・動機

- 子供用Androidアカウントでは、Chromeの「ホーム画面に追加」機能が制限されている
- 毎回ブラウザを開いてURLを入力するのは子供には難しい
- ホーム画面にアプリアイコンを置いて1タップで起動できる体験が必要

### ゴール

- [ ] WebViewで `http://k-serv.local:3000` を開くAndroidアプリ
- [ ] アプリアイコン（がんばりクエストのロゴ）
- [ ] APKファイルを生成し、タブレットに直接インストール
- [ ] フルスクリーン表示（ステータスバー非表示推奨）
- [ ] ネットワーク未接続時のエラー表示

### 技術方針

#### 方式の選択肢

1. **Android Studio + Kotlin（推奨）**
   - 最小構成: MainActivity + WebView + AndroidManifest.xml
   - APK直接生成
   - 100行以下で実装可能

2. **TWA (Trusted Web Activity)**
   - PWA対応が前提
   - Chrome Custom Tabs ベース
   - 設定が複雑

3. **Capacitor / Cordova**
   - Web技術でラップ
   - フレームワーク依存が増える
   - オーバースペック

#### 推奨: Kotlin WebView最小構成

```kotlin
class MainActivity : AppCompatActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val webView = WebView(this)
        webView.settings.javaScriptEnabled = true
        webView.settings.domStorageEnabled = true
        webView.loadUrl("http://k-serv.local:3000")
        setContentView(webView)
    }
}
```

#### AndroidManifest.xml

```xml
<uses-permission android:name="android.permission.INTERNET" />
<application android:usesCleartextTraffic="true">
  <!-- HTTP通信を許可（LAN内のみ） -->
</application>
```

### 依存

なし（独立プロジェクト）

### 作業メモ

- Android Studio のインストールが前提
- `usesCleartextTraffic=true` が必要（HTTP通信のため）
- mDNS（k-serv.local）の名前解決がAndroidで動作するか要検証
  - 動作しない場合は IP アドレス直指定（192.168.68.79:3000）にフォールバック
- 署名なしAPK（デバッグビルド）で十分（Google Play配布なし）
