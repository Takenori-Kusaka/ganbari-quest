#!/bin/bash
# ==============================================================================
# GCP Workload Identity Federation ブートストラップスクリプト
# ==============================================================================
# 使い方:
#   gcloud auth login  (事前にログイン済みであること)
#   bash scripts/bootstrap-gcp-wif.sh
#
# このスクリプトが作成するもの:
#   1. 必要なAPIの有効化
#   2. GitHub Actions用サービスアカウント
#   3. Workload Identity Pool + Provider
#   4. Terraform state用GCSバケット
#
# 完了後、画面に表示される3つの値をGitHub Secretsに登録してください。
# ==============================================================================

set -euo pipefail

PROJECT_ID="ganbari-quest-oauth"
REPO="Takenori-Kusaka/ganbari-quest"
REGION="asia-northeast1"

echo "=========================================="
echo "GCP WIF Bootstrap — $PROJECT_ID"
echo "=========================================="
echo ""

# --- Step 1: プロジェクト設定 ---
echo "[1/6] プロジェクトを設定中..."
gcloud config set project "$PROJECT_ID"

# --- Step 2: API有効化 ---
echo "[2/6] 必要なAPIを有効化中..."
gcloud services enable \
  iam.googleapis.com \
  iamcredentials.googleapis.com \
  cloudresourcemanager.googleapis.com \
  sts.googleapis.com \
  secretmanager.googleapis.com \
  serviceusage.googleapis.com

# --- Step 3: サービスアカウント作成 ---
echo "[3/6] サービスアカウントを作成中..."
if gcloud iam service-accounts describe "github-actions@${PROJECT_ID}.iam.gserviceaccount.com" > /dev/null 2>&1; then
  echo "  → 既に存在します（スキップ）"
else
  gcloud iam service-accounts create github-actions \
    --display-name="GitHub Actions" \
    --project="$PROJECT_ID"
fi

# --- Step 4: WIF Pool 作成 ---
echo "[4/6] Workload Identity Pool を作成中..."
if gcloud iam workload-identity-pools describe github-pool --location=global --project="$PROJECT_ID" > /dev/null 2>&1; then
  echo "  → 既に存在します（スキップ）"
else
  gcloud iam workload-identity-pools create github-pool \
    --location=global \
    --display-name="GitHub Actions Pool" \
    --description="GitHub Actions OIDC federation for CI/CD" \
    --project="$PROJECT_ID"
fi

# WIF Provider 作成
echo "[5/6] Workload Identity Provider を作成中..."
if gcloud iam workload-identity-pools providers describe github-provider --location=global --workload-identity-pool=github-pool --project="$PROJECT_ID" > /dev/null 2>&1; then
  echo "  → 既に存在します（スキップ）"
else
  gcloud iam workload-identity-pools providers create-oidc github-provider \
    --location=global \
    --workload-identity-pool=github-pool \
    --issuer-uri="https://token.actions.githubusercontent.com" \
    --attribute-mapping="google.subject=assertion.sub,attribute.repository=assertion.repository,attribute.actor=assertion.actor" \
    --attribute-condition="assertion.repository=='${REPO}'" \
    --project="$PROJECT_ID"
fi

# IAMバインディング
PROJECT_NUMBER=$(gcloud projects describe "$PROJECT_ID" --format="value(projectNumber)")

gcloud iam service-accounts add-iam-policy-binding \
  "github-actions@${PROJECT_ID}.iam.gserviceaccount.com" \
  --role=roles/iam.workloadIdentityUser \
  --member="principalSet://iam.googleapis.com/projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/github-pool/attribute.repository/${REPO}" \
  --project="$PROJECT_ID" \
  --condition=None \
  2>/dev/null || true

gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:github-actions@${PROJECT_ID}.iam.gserviceaccount.com" \
  --role=roles/editor \
  --condition=None \
  2>/dev/null || true

# --- Step 6: Terraform state バケット ---
echo "[6/6] Terraform state バケットを作成中..."
if gcloud storage buckets describe "gs://${PROJECT_ID}-tfstate" > /dev/null 2>&1; then
  echo "  → 既に存在します（スキップ）"
else
  gcloud storage buckets create "gs://${PROJECT_ID}-tfstate" \
    --location="$REGION" \
    --project="$PROJECT_ID"
fi

# ==============================================================================
# 結果表示
# ==============================================================================
WIF_PROVIDER="projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/github-pool/providers/github-provider"
SA_EMAIL="github-actions@${PROJECT_ID}.iam.gserviceaccount.com"

echo ""
echo "=========================================="
echo "  ブートストラップ完了！"
echo "=========================================="
echo ""
echo "以下の3つの値を GitHub Secrets に登録してください:"
echo ""
echo "  Secret名: GCP_PROJECT_ID"
echo "  値: $PROJECT_ID"
echo ""
echo "  Secret名: GCP_WORKLOAD_IDENTITY_PROVIDER"
echo "  値: $WIF_PROVIDER"
echo ""
echo "  Secret名: GCP_SERVICE_ACCOUNT_EMAIL"
echo "  値: $SA_EMAIL"
echo ""
echo "=========================================="
echo "GitHub Secrets 登録ページ:"
echo "  https://github.com/${REPO}/settings/secrets/actions"
echo "=========================================="
