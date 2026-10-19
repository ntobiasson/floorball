import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { handle } from 'hono/aws-lambda';
import { createApp } from './app.js';
import { createRepo } from './repo.js';
import { TABLE_NAME_ENV } from './table.js';

const tableName = process.env[TABLE_NAME_ENV];
if (tableName === undefined || tableName.length === 0) {
  // Fail at cold start rather than serving 500s: a Lambda without a table is
  // a deployment mistake, and the alarm should fire immediately.
  throw new Error(`${TABLE_NAME_ENV} is not set`);
}

/** Only set when pointing at DynamoDB Local; in AWS the SDK resolves it. */
const endpoint = process.env.DYNAMODB_ENDPOINT;

const client = DynamoDBDocumentClient.from(
  new DynamoDBClient(endpoint === undefined ? {} : { endpoint }),
  { marshallOptions: { removeUndefinedValues: true } },
);

export const app = createApp({ repo: createRepo({ client, tableName }) });

export const handler = handle(app);
