import { describe, expect, test } from 'vitest';
import { App } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { SahlykantaStack } from '../lib/sahlykanta-stack.js';

function synth(): Template {
  const app = new App();
  const stack = new SahlykantaStack(app, 'TestStack', {
    env: { account: '123456789012', region: 'eu-north-1' },
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
  test('runs Node 24 on arm64', () => {
    synth().hasResourceProperties('AWS::Lambda::Function', {
      Runtime: 'nodejs24.x',
      Architectures: ['arm64'],
    });
  });

  test('receives the table name', () => {
    synth().hasResourceProperties('AWS::Lambda::Function', {
      Environment: { Variables: Match.objectLike({ TABLE_NAME: Match.anyValue() }) },
    });
  });

  test('carries no secret in its environment', () => {
    // Nothing here should be a credential. The Turnstile secret is the one
    // thing this application has that could be, and it is deliberately not
    // here: the function is given the ARN and reads the value at runtime.
    // An ARN is a pointer — it is in the template, in CloudTrail and on the
    // console already — so it is named explicitly rather than waved through
    // by loosening the pattern for everything else.
    const allowedReferences = new Set(['TURNSTILE_SECRET_ARN']);

    const functions = synth().findResources('AWS::Lambda::Function');
    const envs = Object.values(functions).map(
      (fn) =>
        (fn.Properties as { Environment?: { Variables?: Record<string, unknown> } }).Environment
          ?.Variables ?? {},
    );

    for (const env of envs) {
      for (const [name, value] of Object.entries(env)) {
        const rendered = JSON.stringify(value);
        // No literal that looks like a key, whatever it is called.
        expect(rendered).not.toMatch(/"[0-9a-f]{64}"/);

        if (allowedReferences.has(name)) {
          // And the one allowed name really is a reference, not a value.
          expect(rendered).toMatch(/Ref|Fn::|arn:/);
          continue;
        }
        expect(name).not.toMatch(/PIN|SECRET|PASSWORD/i);
      }
    }
  });

  test('reads the Turnstile secret from Secrets Manager rather than its environment', () => {
    const template = synth();

    /**
     * The secret is created and filled in by hand, outside this stack. Owning
     * it here too would make CloudFormation refuse to adopt the entry that
     * already holds the real key, so the stack must import rather than
     * create — and this is the assertion that keeps it that way.
     */
    expect(Object.keys(template.findResources('AWS::SecretsManager::Secret'))).toHaveLength(0);

    template.hasResourceProperties('AWS::Lambda::Function', {
      Environment: { Variables: Match.objectLike({ TURNSTILE_SECRET_ARN: Match.anyValue() }) },
    });
  });

  test('is pointed at the secret that actually holds the key', () => {
    // A stack pointed at the wrong name deploys perfectly and then refuses
    // every registration, which is a bad way to find out.
    const functions = Object.values(synth().findResources('AWS::Lambda::Function'));
    const arns = functions
      .map(
        (fn) =>
          (fn.Properties as { Environment?: { Variables?: Record<string, unknown> } }).Environment
            ?.Variables?.TURNSTILE_SECRET_ARN,
      )
      .filter((value) => value !== undefined);

    expect(arns).toHaveLength(1);
    expect(JSON.stringify(arns[0])).toContain('prod/floorball/turnstile');
  });

  test('may read that secret and nothing else, and may not write it', () => {
    const policies = Object.values(synth().findResources('AWS::IAM::Policy'));
    const statements = policies.flatMap(
      (policy) =>
        (
          policy.Properties as {
            PolicyDocument: { Statement: { Action?: unknown; Resource?: unknown }[] };
          }
        ).PolicyDocument.Statement,
    );

    const secretStatements = statements.filter((statement) =>
      JSON.stringify(statement.Action ?? '').includes('secretsmanager:'),
    );
    expect(secretStatements.length).toBeGreaterThan(0);

    for (const statement of secretStatements) {
      const actions = JSON.stringify(statement.Action);
      expect(actions).not.toMatch(/secretsmanager:\*/);
      expect(actions).not.toMatch(/PutSecretValue|UpdateSecret|DeleteSecret/);
      // Never a wildcard resource: one secret, by ARN.
      expect(JSON.stringify(statement.Resource)).not.toBe('"*"');
    }
  });

  test('accepts tokens only for this distribution, never for a local page', () => {
    const functions = Object.values(synth().findResources('AWS::Lambda::Function'));
    const hostnames = functions
      .map(
        (fn) =>
          (
            fn.Properties as {
              Environment?: { Variables?: Record<string, unknown> };
            }
          ).Environment?.Variables?.TURNSTILE_HOSTNAMES,
      )
      .filter((value) => value !== undefined);

    expect(hostnames).toHaveLength(1);
    // The distribution's own name, resolved at deploy time.
    expect(JSON.stringify(hostnames[0])).toMatch(/Fn::GetAtt|Ref/);
    expect(JSON.stringify(hostnames[0])).not.toMatch(/localhost|127\.0\.0\.1/);
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
        DefaultCacheBehavior: Record<string, unknown>;
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

  test('does NOT rewrite errors distribution-wide, which would swallow API 404s', () => {
    // CustomErrorResponses is distribution-level with no per-behavior
    // override, so a 404 -> /index.html/200 rule turns every API 404 into an
    // HTML document with a success status. The client parses every body as
    // JSON, so a second person tapping x on an already-removed name would get
    // a parse error instead of "nimeä ei löytynyt".
    expect(distribution().DistributionConfig.CustomErrorResponses).toBeUndefined();
  });

  test('serves SPA deep links through a viewer-request rewrite on the default behavior only', () => {
    const template = synth();
    template.resourceCountIs('AWS::CloudFront::Function', 1);
    const config = distribution().DistributionConfig;
    const functions = (config.DefaultCacheBehavior as {
      FunctionAssociations?: Array<{ EventType: string }>;
    }).FunctionAssociations;
    expect(functions?.map((f) => f.EventType)).toContain('viewer-request');
  });

  test('the /api/* behavior carries no function association', () => {
    const behaviors = distribution().DistributionConfig.CacheBehaviors ?? [];
    const api = behaviors.find((b) => b.PathPattern === '/api/*');
    expect(api?.FunctionAssociations).toBeUndefined();
  });

  test('answers on its own cloudfront.net name, with no custom domain', () => {
    // No aliases, so CloudFront serves its default certificate and there is
    // no DNS or ACM anywhere in this stack.
    expect(distribution().DistributionConfig.Aliases).toBeUndefined();
  });

  test('carries no certificate of its own', () => {
    // With no alias, CDK omits ViewerCertificate altogether and CloudFront
    // serves the certificate for *.cloudfront.net. Nothing to renew.
    expect(distribution().DistributionConfig.ViewerCertificate).toBeUndefined();
  });

  test('still serves over HTTPS', () => {
    expect(
      (distribution().DistributionConfig.DefaultCacheBehavior as { ViewerProtocolPolicy: string })
        .ViewerProtocolPolicy,
    ).toBe('redirect-to-https');
  });

  test('serves index.html at the root', () => {
    expect(distribution().DistributionConfig.DefaultRootObject).toBe('index.html');
  });
});

describe('no DNS or certificate management', () => {
  test('creates no ACM certificate', () => {
    // A certificate would mean a domain, which would mean a hosted zone and
    // something to renew. The whole point of the default domain is that none
    // of that exists.
    synth().resourceCountIs('AWS::CertificateManager::Certificate', 0);
  });

  test('creates no Route 53 record', () => {
    synth().resourceCountIs('AWS::Route53::RecordSet', 0);
  });

  test('publishes the address it actually answers on', () => {
    const outputs = synth().findOutputs('*');
    expect(Object.keys(outputs)).toContain('SiteUrl');
    expect(Object.keys(outputs)).toContain('SiteDomain');
  });
});

describe('cost guard', () => {
  test('carries no budget, which cannot exist outside us-east-1', () => {
    // AWS Budgets is global and only deployable to us-east-1. A budget here
    // would fail the changeset with "Unrecognized resource types", or pin the
    // whole application to Virginia. scripts/create-budget.sh creates it.
    synth().resourceCountIs('AWS::Budgets::Budget', 0);
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
