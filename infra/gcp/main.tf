# ==============================================================================
# GCP OAuth 基盤 — がんばりクエスト
# ==============================================================================
# このTerraformは以下を管理する:
# - 必要なAPIの有効化
# - Workload Identity Federation（GitHub Actions用）
# - Secret Manager（OAuth認証情報保存用）
#
# 以下はGCPコンソールで手動作成:
# - OAuth同意画面（ブランド情報、スコープ設定）
# - OAuth 2.0 クライアントID（WebアプリケーションタイプGo）
# ==============================================================================

terraform {
  required_version = ">= 1.6.0"

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 5.0"
    }
  }
}

provider "google" {
  project = var.project_id
  region  = var.region
}

# ------------------------------------------------------------------------------
# API 有効化
# ------------------------------------------------------------------------------
locals {
  enabled_apis = [
    "iam.googleapis.com",
    "iamcredentials.googleapis.com",
    "cloudresourcemanager.googleapis.com",
    "sts.googleapis.com",
    "secretmanager.googleapis.com",
    "serviceusage.googleapis.com",
  ]
}

resource "google_project_service" "this" {
  for_each = toset(local.enabled_apis)

  project            = var.project_id
  service            = each.key
  disable_on_destroy = false
}

# ------------------------------------------------------------------------------
# Workload Identity Federation（GitHub Actions → GCP 認証）
# ------------------------------------------------------------------------------
resource "google_iam_workload_identity_pool" "github" {
  project                   = var.project_id
  workload_identity_pool_id = "github-pool"
  display_name              = "GitHub Actions Pool"
  description               = "GitHub Actions OIDC federation for CI/CD"

  depends_on = [google_project_service.this["iam.googleapis.com"]]
}

resource "google_iam_workload_identity_pool_provider" "github" {
  project                            = var.project_id
  workload_identity_pool_id          = google_iam_workload_identity_pool.github.workload_identity_pool_id
  workload_identity_pool_provider_id = "github-provider"
  display_name                       = "GitHub OIDC Provider"

  oidc {
    issuer_uri = "https://token.actions.githubusercontent.com"
  }

  attribute_mapping = {
    "google.subject"       = "assertion.sub"
    "attribute.repository" = "assertion.repository"
    "attribute.actor"      = "assertion.actor"
  }

  attribute_condition = "assertion.repository == '${var.github_repository}'"
}

# サービスアカウント（GitHub Actions が使用）
resource "google_service_account" "github_actions" {
  project      = var.project_id
  account_id   = "github-actions"
  display_name = "GitHub Actions Service Account"
  description  = "Used by GitHub Actions via Workload Identity Federation"

  depends_on = [google_project_service.this["iam.googleapis.com"]]
}

# サービスアカウントに WIF バインド
resource "google_service_account_iam_member" "wif_binding" {
  service_account_id = google_service_account.github_actions.name
  role               = "roles/iam.workloadIdentityUser"
  member             = "principalSet://iam.googleapis.com/${google_iam_workload_identity_pool.github.name}/attribute.repository/${var.github_repository}"
}

# サービスアカウントにプロジェクト編集権限
resource "google_project_iam_member" "github_actions_editor" {
  project = var.project_id
  role    = "roles/editor"
  member  = "serviceAccount:${google_service_account.github_actions.email}"
}

# ------------------------------------------------------------------------------
# Secret Manager（OAuth Client Secret 保存用）
# コンソールでOAuth Client IDを作成後、secretの値をセットする
# ------------------------------------------------------------------------------
resource "google_secret_manager_secret" "oauth_client_id" {
  project   = var.project_id
  secret_id = "oauth-client-id"

  replication {
    auto {}
  }

  depends_on = [google_project_service.this["secretmanager.googleapis.com"]]
}

resource "google_secret_manager_secret" "oauth_client_secret" {
  project   = var.project_id
  secret_id = "oauth-client-secret"

  replication {
    auto {}
  }

  depends_on = [google_project_service.this["secretmanager.googleapis.com"]]
}
