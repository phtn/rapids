```zsh

BASE_URL='http://localhost:3000'
ADMIN_API_KEY='replace-with-your-admin-api-key'

# Open endpoints
curl -i "$BASE_URL/health"
curl -i "$BASE_URL/ready"

# Create an API key and capture its id + raw key
KEY_JSON=$(curl -sS -X POST "$BASE_URL/v1/keys" \
  -H "Authorization: Bearer $ADMIN_API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{
    "prefix": "sk_test_",
    "length": 24,
    "charset": "base64url",
    "name": "curl-test",
    "scopes": ["read", "write"],
    "rateLimit": 60,
    "metadata": { "suite": "curl" }
  }')
echo "$KEY_JSON"

KEY_ID=$(printf '%s' "$KEY_JSON" | jq -r '.id')
RAW_KEY=$(printf '%s' "$KEY_JSON" | jq -r '.key')

# Validate the newly created API key
curl -i -X POST "$BASE_URL/v1/keys/validate" \
  -H "Authorization: Bearer $ADMIN_API_KEY" \
  -H 'Content-Type: application/json' \
  -d "{\"key\":\"$RAW_KEY\"}"

# List keys
curl -i "$BASE_URL/v1/keys" \
  -H "Authorization: Bearer $ADMIN_API_KEY"

# List keys with filters
curl -i "$BASE_URL/v1/keys?active=true&prefix=sk_test_&includeExpired=false&offset=0&limit=10" \
  -H "Authorization: Bearer $ADMIN_API_KEY"

# Get key by id
curl -i "$BASE_URL/v1/keys/$KEY_ID" \
  -H "Authorization: Bearer $ADMIN_API_KEY"

# Update key
curl -i -X PATCH "$BASE_URL/v1/keys/$KEY_ID" \
  -H "Authorization: Bearer $ADMIN_API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{
    "name": "curl-test-renamed",
    "scopes": ["read"],
    "metadata": { "suite": "curl", "step": "patched" }
  }'

# Protected endpoint with the raw API key
curl -i "$BASE_URL/v1/protected" \
  -H "Authorization: Bearer $RAW_KEY"

# Stats
curl -i "$BASE_URL/v1/keys/stats" \
  -H "Authorization: Bearer $ADMIN_API_KEY"

# Revoke the key
curl -i -X POST "$BASE_URL/v1/keys/$KEY_ID/revoke" \
  -H "Authorization: Bearer $ADMIN_API_KEY"

# Optional: confirm the revoked key no longer works
curl -i "$BASE_URL/v1/protected" \
  -H "Authorization: Bearer $RAW_KEY"

# Delete the key
curl -i -X DELETE "$BASE_URL/v1/keys/$KEY_ID" \
  -H "Authorization: Bearer $ADMIN_API_KEY"

# Apps
APP_ID='app_test_001'
PRIVATE_KEY='private_test_001'
PUBLIC_KEY='public_test_001'

curl -i -X POST "$BASE_URL/v1/apps" \
  -H "Authorization: Bearer $ADMIN_API_KEY" \
  -H 'Content-Type: application/json' \
  -d "{
    \"app_id\": \"$APP_ID\",
    \"name\": \"Test App\",
    \"public_key\": \"$PUBLIC_KEY\",
    \"private_key\": \"$PRIVATE_KEY\"
  }"

curl -i "$BASE_URL/v1/apps" \
  -H "Authorization: Bearer $ADMIN_API_KEY"

curl -i "$BASE_URL/v1/apps/$APP_ID" \
  -H "Authorization: Bearer $ADMIN_API_KEY"

curl -i -X PATCH "$BASE_URL/v1/apps/$APP_ID" \
  -H "Authorization: Bearer $ADMIN_API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{
    "name": "Test App v2",
    "public_key": "public_test_002"
  }'

curl -i -X DELETE "$BASE_URL/v1/apps/$APP_ID" \
  -H "Authorization: Bearer $ADMIN_API_KEY"

# Shared secrets
curl -i -X POST "$BASE_URL/v1/shared-secret" \
  -H "Authorization: Bearer $ADMIN_API_KEY" \
  -H 'Content-Type: application/json' \
  -d "{
    \"private_key\": \"$PRIVATE_KEY\",
    \"public_key\": \"$PUBLIC_KEY\"
  }"

curl -i "$BASE_URL/v1/shared-secret/$PRIVATE_KEY" \
  -H "Authorization: Bearer $ADMIN_API_KEY"

curl -i -X DELETE "$BASE_URL/v1/shared-secret/$PRIVATE_KEY" \
  -H "Authorization: Bearer $ADMIN_API_KEY"

```
