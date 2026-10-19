import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  CreateTableCommand,
  DeleteTableCommand,
  DescribeTableCommand,
} from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { GSI1 } from '../src/table.js';

const endpoint = process.env.DYNAMODB_ENDPOINT ?? 'http://127.0.0.1:8001';

export function localClient(): DynamoDBDocumentClient {
  const base = new DynamoDBClient({
    endpoint,
    region: process.env.AWS_REGION ?? 'eu-north-1',
    credentials: { accessKeyId: 'local', secretAccessKey: 'local' },
  });
  return DynamoDBDocumentClient.from(base, {
    marshallOptions: { removeUndefinedValues: true },
  });
}

/**
 * Mirrors the CDK table definition. A test table per suite, named uniquely so
 * suites running in parallel against the shared local instance cannot collide.
 */
export async function createTestTable(client: DynamoDBDocumentClient): Promise<string> {
  const tableName = `sahlykanta-test-${Math.random().toString(36).slice(2, 10)}`;
  await client.send(
    new CreateTableCommand({
      TableName: tableName,
      BillingMode: 'PAY_PER_REQUEST',
      KeySchema: [
        { AttributeName: 'PK', KeyType: 'HASH' },
        { AttributeName: 'SK', KeyType: 'RANGE' },
      ],
      AttributeDefinitions: [
        { AttributeName: 'PK', AttributeType: 'S' },
        { AttributeName: 'SK', AttributeType: 'S' },
        { AttributeName: 'GSI1PK', AttributeType: 'S' },
        { AttributeName: 'GSI1SK', AttributeType: 'S' },
      ],
      GlobalSecondaryIndexes: [
        {
          IndexName: GSI1,
          KeySchema: [
            { AttributeName: 'GSI1PK', KeyType: 'HASH' },
            { AttributeName: 'GSI1SK', KeyType: 'RANGE' },
          ],
          Projection: {
            ProjectionType: 'INCLUDE',
            NonKeyAttributes: ['playerId', 'displayName', 'total', 'mergedInto'],
          },
        },
      ],
    }),
  );
  await client.send(new DescribeTableCommand({ TableName: tableName }));
  return tableName;
}

export async function dropTestTable(
  client: DynamoDBDocumentClient,
  tableName: string,
): Promise<void> {
  await client.send(new DeleteTableCommand({ TableName: tableName }));
}
