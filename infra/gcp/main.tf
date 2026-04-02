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
# Workload Identity Federation / サービスアカウント（ブートストラップ済み、参照のみ）
# ------------------------------------------------------------------------------
# WIF Pool, Provider, SA は bootstrap-gcp-wif.sh で作成済み。
# SA の roles/editor では iam.workloadIdentityPools.create 権限がないため、
# Terraform では data source として参照のみ行う。

data "google_service_account" "github_actions" {
  account_id = "github-actions"
  project    = var.project_id
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
