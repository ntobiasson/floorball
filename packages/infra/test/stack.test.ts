import { describe, expect, test } from 'vitest';
import { App } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { SahlykantaStack } from '../lib/sahlykanta-stack.js';

function synth(): Template {
  const app = new App();
  const stack = new SahlykantaStack(app, 'TestStack', {
    env: { account: '123456789012', region: 'eu-north-1' },
    domainName: 'sahly.example',
    hostedZoneId: 'Z0123456789ABCDEFGHIJ',
    budgetEmail: 'ops@example.test',
  });
  return Template.fromStack(stack);
}

describe('the table', () => {
  test('is on-demand billing', () => {
    synth().hasResourceProperties('AWS::DynamoDB::Table', {
      BillingMode: 'PAY_PER_REQUEST',
    });
  });

  test('has point-in-time recovery enabled', () => {
    synth().hasResourceProperties('AWS::DynamoDB::Table', {
      PointInTimeRecoverySpecification: { PointInTimeRecoveryEnabled: true },
    });
  });

  test('is retained if the stack is deleted', () => {
    // 25 years of history must not vanish with a cdk destroy.
    synth().hasResource('AWS::DynamoDB::Table', {
      DeletionPolicy: 'Retain',
      UpdateReplacePolicy: 'Retain',
    });
  });

  test('has the PK/SK key schema', () => {
    synth().hasResourceProperties('AWS::DynamoDB::Table', {
      KeySchema: [
        { AttributeName: 'PK', KeyType: 'HASH' },
        { AttributeName: 'SK', KeyType: 'RANGE' },
      ],
    });
  });

  test('has GSI1 keyed on GSI1PK/GSI1SK', () => {
    synth().hasResourceProperties('AWS::DynamoDB::Table', {
      GlobalSecondaryIndexes: Match.arrayWith([
        Match.objectLike({
          IndexName: 'GSI1',
          KeySchema: [
            { AttributeName: 'GSI1PK', KeyType: 'HASH' },
            { AttributeName: 'GSI1SK', KeyType: 'RANGE' },
          ],
        }),
      ]),
    });
  });

  test('expires audit rows via the ttl attribute', () => {
    synth().hasResourceProperties('AWS::DynamoDB::Table', {
      TimeToLiveSpecification: { AttributeName: 'ttl', Enabled: true },
    });
  });
});

describe('the API Lambda', () => {
  test('runs Node 22 on arm64', () => {
    synth().hasResourceProperties('AWS::Lambda::Function', {
      Runtime: 'nodejs22.x',
      Architectures: ['arm64'],
    });
  });

  test('receives the table name', () => {
    synth().hasResourceProperties('AWS::Lambda::Function', {
      Environment: { Variables: Match.objectLike({ TABLE_NAME: Match.anyValue() }) },
    });
  });

  test('reads the announcement PIN hash from an SSM parameter, not from source', () => {
    const template = synth();
    const functions = template.findResources('AWS::Lambda::Function');
    const envs = Object.values(functions).map(
      (fn) => (fn.Properties as { Environment?: { Variables?: Record<string, unknown> } })
        .Environment?.Variables ?? {},
    );
    expect(envs.some((env) => 'ANNOUNCEMENT_PIN_HASH' in env)).toBe(true);
    // A literal 64-char hex hash in the template would mean the secret was
    // committed; it must arrive as a resolved SSM reference instead.
    const rendered = JSON.stringify(envs);
    expect(rendered).not.toMatch(/"[0-9a-f]{64}"/);
  });
});

describe('the HTTP API', () => {
  test('throttles the stage so an open form cannot be hammered', () => {
    synth().hasResourceProperties('AWS::ApiGatewayV2::Stage', {
      DefaultRouteSettings: Match.objectLike({
        ThrottlingBurstLimit: Match.anyValue(),
        ThrottlingRateLimit: Match.anyValue(),
      }),
    });
  });
});

describe('the site bucket', () => {
  test('blocks all public access', () => {
    synth().hasResourceProperties('AWS::S3::Bucket', {
      PublicAccessBlockConfiguration: {
        BlockPublicAcls: true,
        BlockPublicPolicy: true,
        IgnorePublicAcls: true,
        RestrictPublicBuckets: true,
      },
    });
  });

  test('is encrypted', () => {
    synth().hasResourceProperties('AWS::S3::Bucket', {
      BucketEncryption: Match.anyValue(),
    });
  });
});

describe('the distribution', () => {
  const distribution = () => {
    const resources = synth().findResources('AWS::CloudFront::Distribution');
    const only = Object.values(resources)[0];
    expect(only).toBeDefined();
    return only!.Properties as {
      DistributionConfig: {
        Origins: unknown[];
        CustomErrorResponses?: Array<Record<string, unknown>>;
        CacheBehaviors?: Array<Record<string, unknown>>;
        DefaultRootObject?: string;
        Aliases?: string[];
        ViewerCertificate?: unknown;
      };
    };
  };

  test('has two origins: the bucket and the API', () => {
    expect(distribution().DistributionConfig.Origins).toHaveLength(2);
  });

  test('routes /api/* to a separate behavior so the SPA and API share an origin', () => {
    const behaviors = distribution().DistributionConfig.CacheBehaviors ?? [];
    expect(behaviors.map((b) => b.PathPattern)).toContain('/api/*');
  });

  test('rewrites 403 and 404 to the SPA entry point', () => {
    const errors = distribution().DistributionConfig.CustomErrorResponses ?? [];
    const byCode = new Map(errors.map((e) => [e.ErrorCode, e]));
    for (const code of [403, 404]) {
      expect(byCode.get(code)).toMatchObject({
        ResponseCode: 200,
        ResponsePagePath: '/index.html',
      });
    }
  });

  test('serves the configured domain over its own certificate', () => {
    expect(distribution().DistributionConfig.Aliases).toEqual(['sahly.example']);
    expect(distribution().DistributionConfig.ViewerCertificate).toBeDefined();
  });

  test('serves index.html at the root', () => {
    expect(distribution().DistributionConfig.DefaultRootObject).toBe('index.html');
  });
});

describe('cost guard', () => {
  test('has a budget so a surprise bill is noticed', () => {
    synth().resourceCountIs('AWS::Budgets::Budget', 1);
  });
});

describe('least privilege', () => {
  test('the Lambda is not granted a wildcard action on all resources', () => {
    const policies = synth().findResources('AWS::IAM::Policy');
    const statements = Object.values(policies).flatMap(
      (policy) =>
        (policy.Properties as { PolicyDocument: { Statement: Array<Record<string, unknown>> } })
          .PolicyDocument.Statement,
    );
    for (const statement of statements) {
      const actions = [statement.Action].flat();
      expect(actions).not.toContain('*');
      expect(actions).not.toContain('dynamodb:*');
    }
  });
});
