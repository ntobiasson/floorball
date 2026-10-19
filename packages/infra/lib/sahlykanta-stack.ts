import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  CfnOutput,
  Duration,
  RemovalPolicy,
  Stack,
  type StackProps,
} from 'aws-cdk-lib';
import { AttributeType, BillingMode, Table, TableEncryption } from 'aws-cdk-lib/aws-dynamodb';
import { Architecture, Runtime } from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction, OutputFormat } from 'aws-cdk-lib/aws-lambda-nodejs';
import { LogGroup, RetentionDays } from 'aws-cdk-lib/aws-logs';
import { HttpApi, HttpMethod } from 'aws-cdk-lib/aws-apigatewayv2';
import type { CfnStage } from 'aws-cdk-lib/aws-apigatewayv2';
import { HttpLambdaIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import {
  AllowedMethods,
  CachePolicy,
  Distribution,
  Function as CloudFrontFunction,
  FunctionCode,
  FunctionEventType,
  OriginRequestPolicy,
  PriceClass,
  ViewerProtocolPolicy,
} from 'aws-cdk-lib/aws-cloudfront';
import { HttpOrigin, S3BucketOrigin } from 'aws-cdk-lib/aws-cloudfront-origins';
import { BlockPublicAccess, Bucket, BucketEncryption } from 'aws-cdk-lib/aws-s3';
import { CfnBudget } from 'aws-cdk-lib/aws-budgets';
import type { Construct } from 'constructs';

const here = path.dirname(fileURLToPath(import.meta.url));
const apiEntry = path.join(here, '../../api/src/handler.ts');

export interface SahlykantaStackProps extends StackProps {
  /** Where the budget alarm goes. */
  budgetEmail: string;
  /** Monthly ceiling, in USD, before the alarm fires. */
  monthlyBudgetUsd?: number;
}

export class SahlykantaStack extends Stack {
  constructor(scope: Construct, id: string, props: SahlykantaStackProps) {
    super(scope, id, props);

    // ---- Data -------------------------------------------------------------
    const table = new Table(this, 'Table', {
      partitionKey: { name: 'PK', type: AttributeType.STRING },
      sortKey: { name: 'SK', type: AttributeType.STRING },
      billingMode: BillingMode.PAY_PER_REQUEST,
      encryption: TableEncryption.AWS_MANAGED,
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
      timeToLiveAttribute: 'ttl',
      // 25 years of history must survive a mistaken `cdk destroy`.
      removalPolicy: RemovalPolicy.RETAIN,
    });

    table.addGlobalSecondaryIndex({
      indexName: 'GSI1',
      partitionKey: { name: 'GSI1PK', type: AttributeType.STRING },
      sortKey: { name: 'GSI1SK', type: AttributeType.STRING },
    });

    // ---- API --------------------------------------------------------------
    const apiLogs = new LogGroup(this, 'ApiLogs', {
      retention: RetentionDays.ONE_MONTH,
      removalPolicy: RemovalPolicy.DESTROY,
    });

    const api = new NodejsFunction(this, 'ApiFn', {
      entry: apiEntry,
      handler: 'handler',
      runtime: Runtime.NODEJS_24_X,
      architecture: Architecture.ARM_64,
      memorySize: 512,
      timeout: Duration.seconds(10),
      logGroup: apiLogs,
      environment: {
        TABLE_NAME: table.tableName,
        NODE_OPTIONS: '--enable-source-maps',
      },
      bundling: {
        format: OutputFormat.ESM,
        target: 'node24',
        sourceMap: true,
        minify: true,
      },
    });

    // Scoped to this table and its indexes — never dynamodb:* on *.
    table.grantReadWriteData(api);

    const httpApi = new HttpApi(this, 'HttpApi', {
      // No corsPreflight: the SPA and the API are served from one CloudFront
      // origin, so the browser never makes a cross-origin request.
      createDefaultStage: true,
    });

    httpApi.addRoutes({
      path: '/{proxy+}',
      methods: [HttpMethod.ANY],
      integration: new HttpLambdaIntegration('ApiIntegration', api),
    });

    const stage = httpApi.defaultStage?.node.defaultChild as CfnStage | undefined;
    if (stage === undefined) {
      throw new Error('the HTTP API has no default stage to throttle');
    }
    // The form is open to the internet with no login; this is the ceiling.
    stage.defaultRouteSettings = { throttlingBurstLimit: 20, throttlingRateLimit: 10 };

    // ---- Site -------------------------------------------------------------
    const site = new Bucket(this, 'SiteBucket', {
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
      encryption: BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      removalPolicy: RemovalPolicy.RETAIN,
    });

    const apiDomain = `${httpApi.apiId}.execute-api.${this.region}.${this.urlSuffix}`;

    /**
     * SPA deep links are served by rewriting extensionless paths to
     * /index.html on the way in, attached to the default behavior only.
     *
     * The obvious alternative — a distribution-level `errorResponses` rule
     * mapping 404 to /index.html with status 200 — cannot be scoped to one
     * behavior, so it also rewrites every API 404 into an HTML document with
     * a success status. `GET /api/players/:unknown` and a DELETE for a name
     * someone else already removed would both come back as index.html/200,
     * and the client, which parses every body as JSON, would fail on the
     * `<!DOCTYPE` instead of showing the real message.
     */
    const spaRewrite = new CloudFrontFunction(this, 'SpaRewrite', {
      comment: 'Rewrite SPA deep links to /index.html',
      code: FunctionCode.fromInline(`
function handler(event) {
  var request = event.request;
  var uri = request.uri;
  // Anything with a file extension is a real asset; everything else is a
  // client-side route. /api/* never reaches this function.
  if (uri !== '/' && uri.indexOf('.') === -1) {
    request.uri = '/index.html';
  }
  return request;
}
      `),
    });

    const distribution = new Distribution(this, 'Distribution', {
      defaultRootObject: 'index.html',
      // No custom domain: the distribution answers on its own
      // d<id>.cloudfront.net name, with the certificate CloudFront provides.
      // That keeps DNS out of the picture entirely — no hosted zone, no ACM
      // certificate, nothing to renew or validate — and it is why this stack
      // is not pinned to us-east-1.
      priceClass: PriceClass.PRICE_CLASS_100,
      defaultBehavior: {
        origin: S3BucketOrigin.withOriginAccessControl(site),
        viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: CachePolicy.CACHING_OPTIMIZED,
        functionAssociations: [
          { function: spaRewrite, eventType: FunctionEventType.VIEWER_REQUEST },
        ],
      },
      additionalBehaviors: {
        '/api/*': {
          origin: new HttpOrigin(apiDomain),
          viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          allowedMethods: AllowedMethods.ALLOW_ALL,
          // Honour the Cache-Control the API sets, so GET /api/players is
          // cached at the edge and GET /api/today never is.
          cachePolicy: new CachePolicy(this, 'ApiCachePolicy', {
            defaultTtl: Duration.seconds(0),
            minTtl: Duration.seconds(0),
            maxTtl: Duration.minutes(5),
            enableAcceptEncodingGzip: true,
          }),
          originRequestPolicy: OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
        },
      },
      // Deliberately no errorResponses: see spaRewrite above.
    });

    // ---- Cost guard -------------------------------------------------------
    new CfnBudget(this, 'MonthlyBudget', {
      budget: {
        budgetName: `${this.stackName}-monthly`,
        budgetType: 'COST',
        timeUnit: 'MONTHLY',
        budgetLimit: { amount: props.monthlyBudgetUsd ?? 10, unit: 'USD' },
      },
      notificationsWithSubscribers: [
        {
          notification: {
            comparisonOperator: 'GREATER_THAN',
            notificationType: 'ACTUAL',
            threshold: 80,
            thresholdType: 'PERCENTAGE',
          },
          subscribers: [{ subscriptionType: 'EMAIL', address: props.budgetEmail }],
        },
      ],
    });

    new CfnOutput(this, 'SiteBucketName', { value: site.bucketName });
    new CfnOutput(this, 'DistributionId', { value: distribution.distributionId });
    new CfnOutput(this, 'TableName', { value: table.tableName });
    new CfnOutput(this, 'SiteUrl', { value: `https://${distribution.distributionDomainName}` });
    new CfnOutput(this, 'SiteDomain', { value: distribution.distributionDomainName });
  }
}
