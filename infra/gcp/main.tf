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

# ------------------------------------------------------------------------------
# IAM バインディング（bootstrap-gcp-wif.sh で管理）
# ------------------------------------------------------------------------------
# SA 自身の権限（editor, workloadIdentityUser, workloadIdentityPoolAdmin）は
# ブートストラップスクリプトで付与済み。SA が自分自身の IAM ポリシーを変更するには
# resourcemanager.projects.setIamPolicy / iam.serviceAccounts.setIamPolicy が
# 必要だが、これらは roles/editor に含まれない（循環依存）。
# GCP Terraform ベストプラクティスに従い、SA の権限管理はブートストラップに委譲する。

# ------------------------------------------------------------------------------
# Import: ブートストラップスクリプトで作成済みリソースを Terraform 管理下に取り込む
# 初回 apply 時に import され、以降は通常の Terraform 管理となる
# ------------------------------------------------------------------------------
import {
  to = google_iam_workload_identity_pool.github
  id = "projects/${var.project_id}/locations/global/workloadIdentityPools/github-pool"
}

import {
  to = google_iam_workload_identity_pool_provider.github
  id = "projects/${var.project_id}/locations/global/workloadIdentityPools/github-pool/providers/github-provider"
}

import {
  to = google_service_account.github_actions
  id = "projects/${var.project_id}/serviceAccounts/github-actions@${var.project_id}.iam.gserviceaccount.com"
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
