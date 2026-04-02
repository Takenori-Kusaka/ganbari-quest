# ==============================================================================
# 出力 — GCP OAuth 基盤
# ==============================================================================

output "project_id" {
  description = "GCP プロジェクト ID"
  value       = var.project_id
}

output "service_account_email" {
  description = "GitHub Actions 用サービスアカウントのメール（ブートストラップ済み）"
  value       = data.google_service_account.github_actions.email
}

output "oauth_callback_urls" {
  description = "GCPコンソールでOAuthクライアント作成時に設定するリダイレクトURI"
  value       = var.oauth_callback_urls
}

output "oauth_scopes" {
  description = "GCPコンソールでOAuth同意画面に設定するスコープ"
  value       = var.oauth_scopes
}

output "next_steps" {
  description = "Terraform適用後の手動手順"
  value       = <<-EOT
    ==========================================
    次の手順（GCP コンソールで手動実施）:
    ==========================================
    1. GCP Console → 「APIとサービス」→「OAuth同意画面」を設定
       - ユーザータイプ: External
       - アプリ名: がんばりクエスト
       - 認可済みドメイン: ganbari-quest.com, amazoncognito.com
    2. 「認証情報」→「OAuth クライアント ID」を作成
       - 種類: ウェブアプリケーション
       - リダイレクトURI: ${join(", ", var.oauth_callback_urls)}
    3. Client ID と Client Secret を GitHub Secrets に登録:
       - GOOGLE_OAUTH_CLIENT_ID
       - GOOGLE_OAUTH_CLIENT_SECRET
    4. main に push して AWS デプロイ → Cognito に Google IdP が自動追加される
  EOT
}
