# ==============================================================================
# Terraform バックエンド設定
# ==============================================================================
# GCS バケットは事前に作成が必要:
#   gcloud storage buckets create gs://PROJECT_ID-tfstate \
#     --location=asia-northeast1 --project=PROJECT_ID
#
# 初回実行時はローカルバックエンドでも可:
#   terraform init（backend ブロックをコメントアウト）
# ==============================================================================

terraform {
  backend "gcs" {
    bucket = "ganbari-quest-oauth-tfstate"
    prefix = "terraform/state"
  }
}
