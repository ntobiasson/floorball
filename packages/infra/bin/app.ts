#!/usr/bin/env node
import { App } from 'aws-cdk-lib';
import { SahlykantaStack } from '../lib/sahlykanta-stack.js';

function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.length === 0) {
    throw new Error(`${name} must be set to deploy (see docs/runbook.md)`);
  }
  return value;
}

const app = new App();

new SahlykantaStack(app, 'Sahlykanta', {
  env: {
    account: required('CDK_DEFAULT_ACCOUNT'),
    // CloudFront certificates must live in us-east-1, so the stack is deployed
    // there and DynamoDB/Lambda follow. Everything is regional-free-tier either way.
    region: 'us-east-1',
  },
  domainName: required('SAHLYKANTA_DOMAIN'),
  hostedZoneId: required('SAHLYKANTA_HOSTED_ZONE_ID'),
  budgetEmail: required('SAHLYKANTA_BUDGET_EMAIL'),
});
