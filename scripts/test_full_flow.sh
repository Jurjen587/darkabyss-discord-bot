#!/usr/bin/env bash
TOKEN="9b1cbbf0-8a7e-4c3d-9b2e-5a1f0c2d3e4f"
BASE="https://darkabyss.nl/api/discord/shop"

echo "=== Simulating full buy flow (user lookup + purchase) ==="

echo "--- GET /users/123456789 ---"
curl -s -w "\nHTTP %{http_code}\n" \
  -H "X-Discord-Shop-Token: $TOKEN" \
  -H "Accept: application/json" \
  "$BASE/users/123456789"

echo ""
echo "--- POST /purchase ---"
curl -s -w "\nHTTP %{http_code}\n" \
  -X POST \
  -H "X-Discord-Shop-Token: $TOKEN" \
  -H "Accept: application/json" \
  -H "Content-Type: application/json" \
  -d '{"package_id":1,"discord_user_id":"123456789","discord_username":"test#1234","eos_id":"abc123","specimen":"TestDino"}' \
  "$BASE/purchase"

echo ""
echo "=== Now rapid browsing: 10 GET /categories back to back ==="
for i in $(seq 1 10); do
  code=$(curl -s -o /dev/null -w "%{http_code}" \
    -H "X-Discord-Shop-Token: $TOKEN" \
    -H "Accept: application/json" \
    "$BASE/categories")
  echo "Request $i: HTTP $code"
done

echo ""
echo "=== Now 10 x parallel pairs (categories + packages) like the bot does ==="
for i in $(seq 1 10); do
  c1=$(curl -s -o /dev/null -w "%{http_code}" -H "X-Discord-Shop-Token: $TOKEN" -H "Accept: application/json" "$BASE/categories" &)
  c2=$(curl -s -o /dev/null -w "%{http_code}" -H "X-Discord-Shop-Token: $TOKEN" -H "Accept: application/json" "$BASE/packages?category_id=1" &)
  wait
  echo "Pair $i: categories=$c1 packages=$c2"
done
