#!/usr/bin/env bash
#
# Creates the monthly cost alarm for this account.
#
#   BUDGET_EMAIL=you@example.fi ./scripts/create-budget.sh
#
# Not part of the CDK stack, and not an oversight: AWS Budgets is a global
# service that exists only in us-east-1. Declaring it in the regional stack
# makes CloudFormation reject the whole changeset with "Unrecognized resource
# types: [AWS::Budgets::Budget]", and the alternative — pinning the entire
# application to Virginia for one alarm — is a worse trade than running this
# once by hand.
#
# Safe to re-run: it updates the existing budget rather than duplicating it.
set -euo pipefail

BUDGET_NAME="${BUDGET_NAME:-floorball-monthly}"
LIMIT_USD="${LIMIT_USD:-10}"
THRESHOLD_PERCENT="${THRESHOLD_PERCENT:-80}"
EMAIL="${BUDGET_EMAIL:-${SAHLYKANTA_BUDGET_EMAIL:-}}"

if [ -z "$EMAIL" ]; then
  echo "set BUDGET_EMAIL to the address the alarm should reach" >&2
  exit 1
fi

ACCOUNT="$(aws sts get-caller-identity --query Account --output text)"
echo "account ${ACCOUNT}: ${BUDGET_NAME} at \$${LIMIT_USD}/month, alerting ${EMAIL} at ${THRESHOLD_PERCENT}%"

BUDGET=$(cat <<JSON
{
  "BudgetName": "${BUDGET_NAME}",
  "BudgetLimit": { "Amount": "${LIMIT_USD}", "Unit": "USD" },
  "TimeUnit": "MONTHLY",
  "BudgetType": "COST"
}
JSON
)

NOTIFICATIONS=$(cat <<JSON
[{
  "Notification": {
    "NotificationType": "ACTUAL",
    "ComparisonOperator": "GREATER_THAN",
    "Threshold": ${THRESHOLD_PERCENT},
    "ThresholdType": "PERCENTAGE"
  },
  "Subscribers": [{ "SubscriptionType": "EMAIL", "Address": "${EMAIL}" }]
}]
JSON
)

# Budgets is global; its API is only served from us-east-1 whatever region the
# rest of the application runs in.
if aws budgets describe-budget --account-id "$ACCOUNT" --budget-name "$BUDGET_NAME" \
     --region us-east-1 >/dev/null 2>&1; then
  echo "budget exists; updating the limit"
  aws budgets update-budget --account-id "$ACCOUNT" --new-budget "$BUDGET" --region us-east-1
else
  aws budgets create-budget \
    --account-id "$ACCOUNT" \
    --budget "$BUDGET" \
    --notifications-with-subscribers "$NOTIFICATIONS" \
    --region us-east-1
  echo "budget created"
fi

echo
echo "AWS emails ${EMAIL} once actual spend passes ${THRESHOLD_PERCENT}% of \$${LIMIT_USD}."
echo "At this application's traffic, expect well under a dollar a month."
