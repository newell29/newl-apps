#!/bin/sh
set -eu

: "${NEWL_APPS_URL:?NEWL_APPS_URL is required}"
: "${OPENCLAW_WEBSITE_GROWTH_TOKEN:?OPENCLAW_WEBSITE_GROWTH_TOKEN is required}"

curl --fail --silent --show-error \
  --request POST \
  --header "Authorization: Bearer ${OPENCLAW_WEBSITE_GROWTH_TOKEN}" \
  "${NEWL_APPS_URL%/}/api/website-growth/scout/produce"
