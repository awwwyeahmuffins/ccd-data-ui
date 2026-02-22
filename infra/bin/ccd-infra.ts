#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { CcdAuthChatStack } from '../lib/ccd-auth-chat-stack';

const app = new cdk.App();
new CcdAuthChatStack(app, 'CcdAuthChatStack', {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION ?? 'us-east-1',
  },
});
