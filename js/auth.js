// auth.js
// --------------------------------------------------------------------------------
// Auth service using amazon-cognito-identity-js. Handles sign-up, sign-in,
// verification, session persistence, and token refresh.

import {
  CognitoUserPool,
  CognitoUser,
  AuthenticationDetails,
  CognitoUserAttribute,
} from 'amazon-cognito-identity-js';
import { getAuthConfig } from './authConfig.js';

let userPool = null;
let authChangeCallbacks = [];

// ---------------------------------------------------------------------------
// Initialization
// ---------------------------------------------------------------------------

export function initAuth() {
  const cfg = getAuthConfig();
  userPool = new CognitoUserPool({
    UserPoolId: cfg.userPoolId,
    ClientId: cfg.userPoolClientId,
  });
}

// ---------------------------------------------------------------------------
// Sign Up
// ---------------------------------------------------------------------------

export function signUp(email, password) {
  return new Promise((resolve, reject) => {
    const attributes = [
      new CognitoUserAttribute({ Name: 'email', Value: email }),
    ];

    userPool.signUp(email, password, attributes, null, (err, result) => {
      if (err) {
        reject(err);
        return;
      }
      resolve(result);
    });
  });
}

// ---------------------------------------------------------------------------
// Confirm Sign Up (verification code)
// ---------------------------------------------------------------------------

export function confirmSignUp(email, code) {
  return new Promise((resolve, reject) => {
    const user = new CognitoUser({
      Username: email,
      Pool: userPool,
    });

    user.confirmRegistration(code, true, (err, result) => {
      if (err) {
        reject(err);
        return;
      }
      resolve(result);
    });
  });
}

// ---------------------------------------------------------------------------
// Sign In
// ---------------------------------------------------------------------------

export function signIn(email, password) {
  return new Promise((resolve, reject) => {
    const user = new CognitoUser({
      Username: email,
      Pool: userPool,
    });

    const authDetails = new AuthenticationDetails({
      Username: email,
      Password: password,
    });

    user.authenticateUser(authDetails, {
      onSuccess: (session) => {
        _notifyAuthChange(true);
        resolve(session);
      },
      onFailure: (err) => {
        reject(err);
      },
    });
  });
}

// ---------------------------------------------------------------------------
// Sign Out
// ---------------------------------------------------------------------------

export function signOut() {
  const user = userPool.getCurrentUser();
  if (user) {
    user.signOut();
  }
  _notifyAuthChange(false);
}

// ---------------------------------------------------------------------------
// Session / Token
// ---------------------------------------------------------------------------

export function isAuthenticated() {
  return new Promise((resolve) => {
    const user = userPool.getCurrentUser();
    if (!user) {
      resolve(false);
      return;
    }

    user.getSession((err, session) => {
      if (err || !session || !session.isValid()) {
        resolve(false);
        return;
      }
      resolve(true);
    });
  });
}

// ---------------------------------------------------------------------------
// Auth State Change
// ---------------------------------------------------------------------------

export function onAuthStateChange(callback) {
  authChangeCallbacks.push(callback);
}

function _notifyAuthChange(authenticated) {
  for (const cb of authChangeCallbacks) {
    try {
      cb(authenticated);
    } catch (e) {
      console.error('Auth state change callback error:', e);
    }
  }
}
