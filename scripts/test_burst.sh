#!/usr/bin/env bash
TOKEN="9b1cbbf0-8a7e-4c3d-9b2e-5a1f0c2d3e4f"
URL="https://darkabyss.nl/api/discord/shop/categories"

for i in $(seq 1 20); do
  code=$(curl -s -o /dev/null -w "%{http_code}" -H "X-Discord-Shop-Token: $TOKEN" -H "Accept: application/json" "$URL")
  echo "Request $i: HTTP $code"
done
