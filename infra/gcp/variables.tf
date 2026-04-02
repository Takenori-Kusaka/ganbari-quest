# ==============================================================================
# 変数定義 — GCP OAuth 基盤
# ==============================================================================

variable "project_id" {
  description = "GCP プロジェクト ID"
  type        = string
}

variable "region" {
  description = "デフォルトリージョン"
  type        = string
  default     = "asia-northeast1"
}

variable "github_repository" {
  description = "GitHub リポジトリ（owner/repo 形式）"
  type        = string
  default     = "Takenori-Kusaka/ganbari-quest"
}

# OAuth設定（Terraform管理下で参照値として保持）
variable "oauth_callback_urls" {
  description = "Cognito OAuth コールバック URL 一覧"
  type        = list(string)
  default = [
    "https://ganbari-quest.auth.us-east-1.amazoncognito.com/oauth2/idpresponse",
  ]
}

variable "oauth_scopes" {
  description = "OAuth スコープ一覧"
  type        = list(string)
  default     = ["openid", "email", "profile"]
}
