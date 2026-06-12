#!/bin/bash
# Reads .env and pushes all listed keys as Cloudflare Pages secrets.
# Usage: bash scripts/push-secrets.sh
# Requires: wrangler logged in, .env in project root.

PROJECT="photo"
ENV_FILE="$(dirname "$0")/../.env"

KEYS=(
  CLOUDFLARE_ACCOUNT_ID
  CF_D1_DATABASE_ID
  CF_D1_API_TOKEN
  CF_ACCESS_TEAM_DOMAIN
  CF_ACCESS_AUD
  PUBLIC_CLOUDINARY_CLOUD_NAME
  PUBLIC_CLOUDINARY_API_KEY
  SECRET_CLOUDINARY_API_KEY
)

if [ ! -f "$ENV_FILE" ]; then
  echo "Error: .env not found at $ENV_FILE"
  exit 1
fi

for KEY in "${KEYS[@]}"; do
  VALUE=$(grep "^${KEY}=" "$ENV_FILE" | cut -d'=' -f2-)
  if [ -z "$VALUE" ]; then
    echo "⚠️  Skipping $KEY (not found in .env)"
    continue
  fi
  echo "→ Pushing $KEY..."
  echo "$VALUE" | wrangler pages secret put "$KEY" --project-name "$PROJECT"
done

echo "✓ Done"
