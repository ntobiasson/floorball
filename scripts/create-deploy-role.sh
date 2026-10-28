#!/usr/bin/env bash
#
# Creates the IAM role GitHub Actions assumes to deploy this application.
#
# Run once, locally, with credentials that can create IAM roles. Everything it
# makes is idempotent: running it twice updates rather than duplicates.
#
#   REPO=yourname/yourrepo ./scripts/create-deploy-role.sh
#
# Prerequisite: the account and region must be CDK-bootstrapped first, because
# this role works by assuming the roles that bootstrap creates:
#
#   npx cdk bootstrap aws://<account>/<region>
#
set -euo pipefail

# Required, and deliberately without a default. This value is the whole of the
# trust policy: whatever repository it names may assume the role and deploy
# into this account. A default would quietly point a fork's role at the
# upstream repository, so it has to be stated.
REPO="${REPO:-}"
if [ -z "$REPO" ]; then
  echo "set REPO to the owner/name of the repository that deploys, e.g." >&2
  echo "  REPO=yourname/yourrepo ./scripts/create-deploy-role.sh" >&2
  exit 1
fi
if [ "${REPO#*/}" = "$REPO" ]; then
  echo "REPO must be owner/name, got '$REPO'" >&2
  exit 1
fi

ROLE_NAME="${ROLE_NAME:-floorball-deploy}"
REGION="${AWS_REGION:-eu-north-1}"
# The CDK's default bootstrap qualifier. Change only if you bootstrapped with
# --qualifier.
QUALIFIER="${CDK_QUALIFIER:-hnb659fds}"
ACCOUNT="$(aws sts get-caller-identity --query Account --output text)"

GITHUB_OIDC="arn:aws:iam::${ACCOUNT}:oidc-provider/token.actions.githubusercontent.com"

echo "account ${ACCOUNT}, region ${REGION}, repo ${REPO}"

# --- 1. The OIDC provider -----------------------------------------------------
# One per account. It is what lets AWS trust a token minted by GitHub, so no
# long-lived access key ever has to exist.
if aws iam get-open-id-connect-provider --open-id-connect-provider-arn "$GITHUB_OIDC" >/dev/null 2>&1; then
  echo "OIDC provider already present"
else
  echo "creating the GitHub OIDC provider"
  aws iam create-open-id-connect-provider \
    --url https://token.actions.githubusercontent.com \
    --client-id-list sts.amazonaws.com \
    --thumbprint-list 6938fd4d98bab03faadb97b34396831e3780aea1 >/dev/null
fi

# --- 2. Who may assume the role ----------------------------------------------
# Scoped to one repository AND one environment, so a workflow on a branch — or
# in any other repository — cannot assume this role even if it is in your
# account.
#
# The subject claim is read from GitHub rather than assembled from the
# owner/repo names, because GitHub does not always send the documented
# `repo:owner/name:environment:x` form. This repository gets
# `repo:owner@<ownerId>/name@<repoId>:environment:x`, embedding numeric ids so
# that deleting a repository and recreating it under the same name does not
# inherit its trust. A policy written against the names alone is rejected,
# with nothing in the Actions log to say why — CloudTrail is where the real
# subject shows up.
#
# Override SUBJECT if you need a different scope, e.g. a branch:
#   SUBJECT='repo:owner/name:ref:refs/heads/main'
if [ -z "${SUBJECT:-}" ]; then
  if command -v gh >/dev/null 2>&1; then
    SUBJECT="$(gh api "repos/${REPO}" \
      --jq '"repo:\(.owner.login)@\(.owner.id)/\(.name)@\(.id):environment:production"')"
  else
    echo "gh is not installed; set SUBJECT explicitly (see the comment above)" >&2
    exit 1
  fi
fi
echo "trusting subject: ${SUBJECT}"
TRUST=$(cat <<JSON
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Principal": { "Federated": "${GITHUB_OIDC}" },
    "Action": "sts:AssumeRoleWithWebIdentity",
    "Condition": {
      "StringEquals": {
        "token.actions.githubusercontent.com:aud": "sts.amazonaws.com",
        "token.actions.githubusercontent.com:sub": "${SUBJECT}"
      }
    }
  }]
}
JSON
)

if aws iam get-role --role-name "$ROLE_NAME" >/dev/null 2>&1; then
  echo "updating the trust policy on ${ROLE_NAME}"
  aws iam update-assume-role-policy --role-name "$ROLE_NAME" --policy-document "$TRUST"
else
  echo "creating ${ROLE_NAME}"
  aws iam create-role \
    --role-name "$ROLE_NAME" \
    --description "GitHub Actions deploys ${REPO}" \
    --max-session-duration 3600 \
    --assume-role-policy-document "$TRUST" >/dev/null
fi

# --- 3. What the role may do -------------------------------------------------
# Deliberately small. The CDK does its work through the roles that `cdk
# bootstrap` created, so this role mostly needs permission to assume those —
# it never gets CloudFormation or IAM powers itself. The rest is the handful
# of calls the workflow makes directly: syncing the built site into the
# bucket, and invalidating the distribution.
POLICY=$(cat <<JSON
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "AssumeTheCdkBootstrapRoles",
      "Effect": "Allow",
      "Action": "sts:AssumeRole",
      "Resource": "arn:aws:iam::${ACCOUNT}:role/cdk-${QUALIFIER}-*-${ACCOUNT}-${REGION}"
    },
    {
      "Sid": "ReadTheBootstrapVersion",
      "Effect": "Allow",
      "Action": "ssm:GetParameter",
      "Resource": "arn:aws:ssm:${REGION}:${ACCOUNT}:parameter/cdk-bootstrap/${QUALIFIER}/version"
    },
    {
      "Sid": "PublishTheBuiltSite",
      "Effect": "Allow",
      "Action": ["s3:ListBucket", "s3:GetObject", "s3:PutObject", "s3:DeleteObject"],
      "Resource": [
        "arn:aws:s3:::sahlykanta-sitebucket*",
        "arn:aws:s3:::sahlykanta-sitebucket*/*"
      ]
    },
    {
      "Sid": "InvalidateTheDistribution",
      "Effect": "Allow",
      "Action": ["cloudfront:CreateInvalidation", "cloudfront:GetInvalidation"],
      "Resource": "arn:aws:cloudfront::${ACCOUNT}:distribution/*"
    }
  ]
}
JSON
)

aws iam put-role-policy \
  --role-name "$ROLE_NAME" \
  --policy-name floorball-deploy \
  --policy-document "$POLICY"

ROLE_ARN="arn:aws:iam::${ACCOUNT}:role/${ROLE_NAME}"
echo
echo "role ready: ${ROLE_ARN}"
echo
echo "Set it, and the budget address, on the repository:"
echo "  gh secret set AWS_DEPLOY_ROLE_ARN --body '${ROLE_ARN}'"
echo "  gh variable set SAHLYKANTA_BUDGET_EMAIL --body 'you@example.fi'"
echo
echo "Then create a 'production' environment on the repository if it does not"
echo "exist, since the trust policy is scoped to it:"
echo "  gh api -X PUT repos/${REPO}/environments/production"
