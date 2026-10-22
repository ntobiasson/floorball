import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { handle } from 'hono/aws-lambda';
import { createApp } from './app.js';
import { createRepo } from './repo.js';
import { createSecretReader } from './secret.js';
import { TABLE_NAME_ENV } from './table.js';
import { createTurnstile, isTestingSecret, parseHostnames } from './turnstile.js';

const tableName = process.env[TABLE_NAME_ENV];
if (tableName === undefined || tableName.length === 0) {
  // Fail at cold start rather than serving 500s: a Lambda without a table is
  // a deployment mistake, and the alarm should fire immediately.
  throw new Error(`${TABLE_NAME_ENV} is not set`);
}

/**
 * Both of these fail at cold start when missing, for the same reason the
 * table name does: a function that cannot verify a submission would refuse
 * every registration, and that should surface as a deployment failure rather
 * than as a form nobody can use.
 *
 * Only the ARN is read here. The secret itself is fetched on the first gated
 * write — see secret.ts.
 */
const secretArn = process.env.TURNSTILE_SECRET_ARN;
if (secretArn === undefined || secretArn.length === 0) {
  throw new Error('TURNSTILE_SECRET_ARN is not set');
}

const hostnames = parseHostnames(process.env.TURNSTILE_HOSTNAMES);
if (hostnames.length === 0) {
  // An empty allowlist has nothing to compare siteverify's hostname against,
  // which would accept a widget solved on a copy of this page hosted
  // anywhere at all.
  throw new Error('TURNSTILE_HOSTNAMES is not set');
}
if (hostnames.some((hostname) => hostname === 'localhost' || hostname === '127.0.0.1')) {
  throw new Error('TURNSTILE_HOSTNAMES must not contain a local hostname in a deployment');
}

/** Only set when pointing at DynamoDB Local; in AWS the SDK resolves it. */
const endpoint = process.env.DYNAMODB_ENDPOINT;

const client = DynamoDBDocumentClient.from(
  new DynamoDBClient(endpoint === undefined ? {} : { endpoint }),
  { marshallOptions: { removeUndefinedValues: true } },
);

const readSecret = createSecretReader(secretArn);

export const app = createApp({
  repo: createRepo({ client, tableName }),
  verifyTurnstile: createTurnstile({
    hostnames,
    secret: async () => {
      const secret = await readSecret();
      if (isTestingSecret(secret)) {
        // Cloudflare's always-passes dummy would wave every script through.
        // It belongs in local development and nowhere near this function.
        throw new Error('TURNSTILE_SECRET_ARN holds a Cloudflare testing secret');
      }
      return secret;
    },
  }),
});

export const handler = handle(app);
