// authConfig.js
// --------------------------------------------------------------------------------
// Cognito + API Gateway configuration. Values from CDK stack outputs.
// Pool ID and Client ID are public identifiers (not secrets).

const AUTH_CONFIG = {
  region: 'us-east-1',
  userPoolId: 'us-east-1_nw1GorcMg',
  userPoolClientId: '13b0eeir4e9ga8cquc686hagkr',
  apiUrl: 'https://3oydo881j5.execute-api.us-east-1.amazonaws.com',
};

export function getAuthConfig() {
  return { ...AUTH_CONFIG };
}

export function getApiConfig() {
  return {
    chatEndpoint: `${AUTH_CONFIG.apiUrl}/chat`,
  };
}
