import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as apigwv2 from 'aws-cdk-lib/aws-apigatewayv2';
import * as apigwv2Integrations from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import * as apigwv2Authorizers from 'aws-cdk-lib/aws-apigatewayv2-authorizers';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as route53Targets from 'aws-cdk-lib/aws-route53-targets';
import * as path from 'path';

export class CcdAuthChatStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // -----------------------------------------------------------------------
    // Cognito User Pool
    // -----------------------------------------------------------------------
    const userPool = new cognito.UserPool(this, 'CcdUserPool', {
      userPoolName: 'ccd-elections-users',
      selfSignUpEnabled: true,
      signInAliases: { email: true },
      autoVerify: { email: true },
      passwordPolicy: {
        minLength: 8,
        requireUppercase: true,
        requireLowercase: true,
        requireDigits: true,
        requireSymbols: false,
      },
      accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    const userPoolClient = new cognito.UserPoolClient(this, 'CcdUserPoolClient', {
      userPool,
      userPoolClientName: 'ccd-web-client',
      generateSecret: false,
      authFlows: {
        userSrp: true,
      },
    });

    // -----------------------------------------------------------------------
    // Lambda — Bedrock Chat Handler
    // -----------------------------------------------------------------------
    const bedrockModelId = new cdk.CfnParameter(this, 'BedrockModelId', {
      type: 'String',
      default: 'anthropic.claude-3-5-sonnet-20241022-v2:0',
      description: 'Bedrock model ID for chat',
    });

    const chatFn = new lambda.Function(this, 'ChatHandler', {
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: 'chat_handler.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '..', 'lambda')),
      timeout: cdk.Duration.seconds(60),
      memorySize: 256,
      environment: {
        BEDROCK_MODEL_ID: bedrockModelId.valueAsString,
        BEDROCK_REGION: cdk.Stack.of(this).region,
      },
    });

    chatFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['bedrock:InvokeModel'],
        resources: ['*'],
      })
    );

    // -----------------------------------------------------------------------
    // HTTP API (API Gateway v2)
    // -----------------------------------------------------------------------
    const httpApi = new apigwv2.HttpApi(this, 'CcdChatApi', {
      apiName: 'ccd-chat-api',
      corsPreflight: {
        allowOrigins: ['http://localhost:3000', 'https://*'],
        allowMethods: [apigwv2.CorsHttpMethod.POST, apigwv2.CorsHttpMethod.OPTIONS],
        allowHeaders: ['Content-Type', 'Authorization'],
        maxAge: cdk.Duration.hours(1),
      },
    });

    const jwtAuthorizer = new apigwv2Authorizers.HttpJwtAuthorizer(
      'CognitoAuthorizer',
      `https://cognito-idp.${cdk.Stack.of(this).region}.amazonaws.com/${userPool.userPoolId}`,
      {
        jwtAudience: [userPoolClient.userPoolClientId],
      }
    );

    httpApi.addRoutes({
      path: '/chat',
      methods: [apigwv2.HttpMethod.POST],
      integration: new apigwv2Integrations.HttpLambdaIntegration('ChatIntegration', chatFn),
      authorizer: jwtAuthorizer,
    });

    // -----------------------------------------------------------------------
    // S3 Bucket for Static Hosting
    // -----------------------------------------------------------------------
    const domainName = 'collincountyelections.com';

    const siteBucket = new s3.Bucket(this, 'SiteBucket', {
      bucketName: domainName,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    // -----------------------------------------------------------------------
    // ACM Certificate (must be us-east-1 for CloudFront)
    // -----------------------------------------------------------------------
    const hostedZone = route53.HostedZone.fromLookup(this, 'Zone', {
      domainName,
    });

    const certificate = new acm.Certificate(this, 'SiteCert', {
      domainName,
      subjectAlternativeNames: [`www.${domainName}`],
      validation: acm.CertificateValidation.fromDns(hostedZone),
    });

    // -----------------------------------------------------------------------
    // CloudFront Distribution
    // -----------------------------------------------------------------------
    const distribution = new cloudfront.Distribution(this, 'SiteDistribution', {
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(siteBucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
      },
      domainNames: [domainName, `www.${domainName}`],
      certificate,
      defaultRootObject: 'index.html',
      errorResponses: [
        {
          httpStatus: 404,
          responseHttpStatus: 200,
          responsePagePath: '/index.html',
        },
      ],
    });

    // -----------------------------------------------------------------------
    // Route53 DNS Records
    // -----------------------------------------------------------------------
    new route53.ARecord(this, 'SiteARecord', {
      zone: hostedZone,
      recordName: domainName,
      target: route53.RecordTarget.fromAlias(
        new route53Targets.CloudFrontTarget(distribution),
      ),
    });

    new route53.ARecord(this, 'WwwARecord', {
      zone: hostedZone,
      recordName: `www.${domainName}`,
      target: route53.RecordTarget.fromAlias(
        new route53Targets.CloudFrontTarget(distribution),
      ),
    });

    // -----------------------------------------------------------------------
    // Outputs
    // -----------------------------------------------------------------------
    new cdk.CfnOutput(this, 'UserPoolId', { value: userPool.userPoolId });
    new cdk.CfnOutput(this, 'UserPoolClientId', { value: userPoolClient.userPoolClientId });
    new cdk.CfnOutput(this, 'ApiUrl', { value: httpApi.apiEndpoint! });
    new cdk.CfnOutput(this, 'SiteBucketName', { value: siteBucket.bucketName });
    new cdk.CfnOutput(this, 'DistributionId', { value: distribution.distributionId });
    new cdk.CfnOutput(this, 'SiteUrl', { value: `https://${domainName}` });
  }
}
