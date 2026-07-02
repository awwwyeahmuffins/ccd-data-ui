// authConfig.js
// --------------------------------------------------------------------------------
// Cognito configuration. Values from CDK stack outputs.
// Pool ID and Client ID are public identifiers (not secrets).

const AUTH_CONFIG = {
  region: 'us-east-1',
  userPoolId: 'us-east-1_nw1GorcMg',
  userPoolClientId: '13b0eeir4e9ga8cquc686hagkr',
};

export function getAuthConfig() {
  return { ...AUTH_CONFIG };
}
