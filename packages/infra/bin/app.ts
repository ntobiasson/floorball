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
    // Stockholm: closest region to the people using this. The stack used to
    // be pinned to us-east-1 because a CloudFront certificate has to live
    // there, and with no custom domain there is no certificate. CloudFront
    // itself is global either way; this only moves the Lambda and the table.
    region: process.env.SAHLYKANTA_REGION ?? 'eu-north-1',
  },
  budgetEmail: required('SAHLYKANTA_BUDGET_EMAIL'),
});
