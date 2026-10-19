import { afterAll, beforeAll, expect, test, vi } from 'vitest';
import type { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { createTestTable, dropTestTable, localClient } from './harness.js';

let client: DynamoDBDocumentClient;
let tableName: string;

beforeAll(async () => {
  client = localClient();
  tableName = await createTestTable(client);
  process.env.TABLE_NAME = tableName;
  process.env.DYNAMODB_ENDPOINT = process.env.DYNAMODB_ENDPOINT ?? 'http://127.0.0.1:8001';
  process.env.AWS_ACCESS_KEY_ID = 'local';
  process.env.AWS_SECRET_ACCESS_KEY = 'local';
  process.env.AWS_REGION = process.env.AWS_REGION ?? 'eu-north-1';
});

afterAll(async () => {
  await dropTestTable(client, tableName);
  vi.unstubAllEnvs();
});

const event = (path: string) => ({
  version: '2.0',
  routeKey: '$default',
  rawPath: path,
  rawQueryString: '',
  headers: { host: 'example.test' },
  requestContext: {
    http: { method: 'GET', path, protocol: 'HTTP/1.1', sourceIp: '127.0.0.1', userAgent: 'test' },
  },
  isBase64Encoded: false,
});

test('the Lambda handler serves the today route from the configured table', async () => {
  const { handler } = await import('../src/handler.js');

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const response = await (handler as any)(event('/api/today'), {});

  expect(response.statusCode).toBe(200);
  const body = JSON.parse(response.body);
  expect(body).toMatchObject({ date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) });
  expect(typeof body.isGameDay).toBe('boolean');
});

test('the handler refuses to start without a table name', async () => {
  const previous = process.env.TABLE_NAME;
  delete process.env.TABLE_NAME;
  vi.resetModules();
  try {
    await expect(import('../src/handler.js')).rejects.toThrow(/TABLE_NAME/);
  } finally {
    process.env.TABLE_NAME = previous;
    vi.resetModules();
  }
});
