import { initializeApp } from 'firebase/app';
import {
  getAuth,
  signInWithPopup,
  signInWithCredential,
  GoogleAuthProvider,
  onAuthStateChanged,
} from 'firebase/auth';
import firebaseConfig from '../../firebase-applet-config.json';

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);

export const DRIVE_SCOPES = ['https://www.googleapis.com/auth/drive.file'] as const;
const IDENTITY_SCOPES = [
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile',
] as const;

const provider = new GoogleAuthProvider();
for (const scope of DRIVE_SCOPES) {
  provider.addScope(scope);
}

export interface AuthUser {
  uid: string;
  email: string | null;
  displayName: string | null;
  photoURL: string | null;
}

interface TokenResponse {
  access_token?: string;
  expires_in?: number | string;
  scope?: string;
  error?: string;
  error_description?: string;
}

interface TokenClient {
  requestAccessToken: (overrideConfig?: { prompt?: string; scope?: string }) => void;
}

interface TokenClientError {
  type?: string;
  message?: string;
}

interface GoogleIdentityGlobal {
  google?: {
    accounts?: {
      oauth2?: {
        initTokenClient: (config: {
          client_id: string;
          scope: string;
          callback: (response: TokenResponse) => void;
          error_callback?: (error: TokenClientError) => void;
        }) => TokenClient;
        revoke?: (token: string, done?: () => void) => void;
      };
    };
  };
}

let isSigningIn = false;
let activeSignInPromise: Promise<{ user: AuthUser; accessToken: string } | null> | null = null;
// Access token and user session state are kept strictly in memory only (never localStorage or sessionStorage).
let cachedAccessToken: string | null = null;
let tokenExpiresAt = 0;
let cachedUser: AuthUser | null = null;

let gsiScriptPromise: Promise<void> | null = null;

function loadGsiScript(): Promise<void> {
  if (typeof window === 'undefined') {
    return Promise.reject(new Error('Google Sign-In requires a browser environment.'));
  }

  const win = window as unknown as GoogleIdentityGlobal;
  if (win.google?.accounts?.oauth2?.initTokenClient) {
    return Promise.resolve();
  }

  if (gsiScriptPromise) {
    return gsiScriptPromise;
  }

  gsiScriptPromise = new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(
      'script[src^="https://accounts.google.com/gsi/client"]'
    );

    const startedAt = Date.now();
    const waitForGlobal = () => {
      const currentWin = window as unknown as GoogleIdentityGlobal;
      if (currentWin.google?.accounts?.oauth2?.initTokenClient) {
        resolve();
        return;
      }
      if (Date.now() - startedAt > 8000) {
        gsiScriptPromise = null;
        reject(new Error('Timed out loading Google Identity Services.'));
        return;
      }
      window.setTimeout(waitForGlobal, 50);
    };

    if (existing) {
      existing.addEventListener('load', waitForGlobal, { once: true });
      existing.addEventListener(
        'error',
        () => {
          gsiScriptPromise = null;
          reject(new Error('Failed to load Google Identity Services script.'));
        },
        { once: true }
      );
      waitForGlobal();
      return;
    }

    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.defer = true;
    script.onload = waitForGlobal;
    script.onerror = () => {
      gsiScriptPromise = null;
      reject(new Error('Failed to load Google Identity Services script.'));
    };
    document.head.appendChild(script);
  });

  return gsiScriptPromise;
}

export const initAuth = (
  onAuthSuccess?: (user: AuthUser, token: string) => void,
  onAuthFailure?: () => void
) => {
  // Eagerly warm up GIS script so sign-in popups can open synchronously on click
  void loadGsiScript().catch(() => {
    // Fallback will handle unavailable GIS script if needed
  });

  return onAuthStateChanged(auth, (fbUser) => {
    const activeToken = getAccessToken();
    if (cachedUser && activeToken) {
      if (!isSigningIn) {
        onAuthSuccess?.(cachedUser, activeToken);
      }
      return;
    }

    if (fbUser && activeToken) {
      const normalized: AuthUser = {
        uid: fbUser.uid,
        email: fbUser.email,
        displayName: fbUser.displayName,
        photoURL: fbUser.photoURL,
      };
      cachedUser = normalized;
      if (!isSigningIn) {
        onAuthSuccess?.(normalized, activeToken);
      }
      return;
    }

    if (!isSigningIn && !activeToken) {
      cachedAccessToken = null;
      cachedUser = null;
      tokenExpiresAt = 0;
      onAuthFailure?.();
    }
  });
};

async function fetchGoogleUserProfile(accessToken: string): Promise<AuthUser> {
  const res = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!res.ok) {
    return {
      uid: 'google-drive-user',
      email: null,
      displayName: 'Google Drive User',
      photoURL: null,
    };
  }

  const profile = (await res.json()) as {
    sub?: string;
    email?: string;
    name?: string;
    picture?: string;
  };

  return {
    uid: profile.sub || 'google-drive-user',
    email: profile.email ?? null,
    displayName: profile.name ?? profile.email ?? 'Google Drive User',
    photoURL: profile.picture ?? null,
  };
}

function requestGisAccessToken(clientId: string): Promise<TokenResponse> {
  const win = window as unknown as GoogleIdentityGlobal;
  const oauth2 = win.google?.accounts?.oauth2;
  if (!oauth2?.initTokenClient) {
    return Promise.reject(new Error('Google Identity Services is not ready yet.'));
  }

  return new Promise<TokenResponse>((resolve, reject) => {
    let settled = false;

    const tokenClient = oauth2.initTokenClient({
      client_id: clientId,
      scope: [...DRIVE_SCOPES, ...IDENTITY_SCOPES].join(' '),
      callback: (response) => {
        if (settled) return;
        settled = true;
        resolve(response);
      },
      error_callback: (err) => {
        if (settled) return;
        settled = true;
        const type = err?.type || 'unknown';
        if (type === 'popup_failed_to_open') {
          reject(
            new Error(
              'Your browser blocked the Google Sign-In popup. Please allow popups for this site and try again.'
            )
          );
          return;
        }
        if (type === 'popup_closed') {
          resolve({ error: 'popup_closed_by_user' });
          return;
        }
        reject(new Error(err?.message || `Google Sign-In failed (${type}).`));
      },
    });

    // Must be called as directly as possible after user click
    tokenClient.requestAccessToken({ prompt: 'select_account' });
  });
}

async function signInWithFirebasePopup(): Promise<{ user: AuthUser; accessToken: string } | null> {
  try {
    const result = await signInWithPopup(auth, provider);
    const credential = GoogleAuthProvider.credentialFromResult(result);
    if (!credential?.accessToken) {
      throw new Error(
        'Google Drive access permission was not granted. Please allow Drive access when signing in.'
      );
    }
    const authUser: AuthUser = {
      uid: result.user.uid,
      email: result.user.email,
      displayName: result.user.displayName,
      photoURL: result.user.photoURL,
    };
    cachedAccessToken = credential.accessToken;
    tokenExpiresAt = Date.now() + 55 * 60 * 1000;
    cachedUser = authUser;
    return { user: authUser, accessToken: cachedAccessToken };
  } catch (error: unknown) {
    const code =
      typeof error === 'object' && error !== null && 'code' in error
        ? String((error as { code?: unknown }).code)
        : '';

    if (code === 'auth/popup-blocked') {
      throw new Error(
        'Your browser blocked the Google Sign-In popup. Please enable popups for this site and try again.'
      );
    }
    if (code === 'auth/unauthorized-domain') {
      throw new Error(
        'This domain is not authorized for Google Sign-In in Firebase Authentication settings.'
      );
    }
    if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') {
      return null;
    }
    throw error;
  }
}

export const googleSignIn = async (): Promise<{ user: AuthUser; accessToken: string } | null> => {
  if (activeSignInPromise) {
    return activeSignInPromise;
  }

  const runSignIn = async (): Promise<{ user: AuthUser; accessToken: string } | null> => {
    try {
      isSigningIn = true;
      const clientId = (firebaseConfig as { oAuthClientId?: string }).oAuthClientId;

      if (clientId) {
        const win = window as unknown as GoogleIdentityGlobal;
        let gisReady = Boolean(win.google?.accounts?.oauth2?.initTokenClient);

        if (!gisReady) {
          try {
            await loadGsiScript();
            gisReady = Boolean(
              (window as unknown as GoogleIdentityGlobal).google?.accounts?.oauth2?.initTokenClient
            );
          } catch {
            gisReady = false;
          }
        }

        if (gisReady) {
          const tokenResponse = await requestGisAccessToken(clientId);

          if (tokenResponse.error === 'popup_closed_by_user') {
            return null;
          }
          if (tokenResponse.error) {
            if (tokenResponse.error === 'access_denied') {
              throw new Error(
                'Google Drive access permission was declined. Please approve Drive access to continue.'
              );
            }
            throw new Error(
              tokenResponse.error_description ||
                `Google Sign-In failed (${tokenResponse.error}).`
            );
          }

          if (!tokenResponse.access_token) {
            throw new Error('Google did not return an OAuth access token.');
          }

          if (tokenResponse.scope) {
            const grantedScopes = tokenResponse.scope.split(/\s+/);
            const hasDriveScope = DRIVE_SCOPES.every((s) => grantedScopes.includes(s));
            if (!hasDriveScope) {
              throw new Error(
                'Google Drive permission was not granted. Please check the Google Drive access checkbox on the consent screen and try again.'
              );
            }
          }

          const accessToken = tokenResponse.access_token;
          const expiresInSec = Number(tokenResponse.expires_in) || 3600;
          cachedAccessToken = accessToken;
          tokenExpiresAt = Date.now() + Math.max(60, expiresInSec - 30) * 1000;

          // Sync Firebase Auth session if possible, and always resolve Google profile
          let resolvedUser: AuthUser | null = null;
          try {
            const fbCred = GoogleAuthProvider.credential(null, accessToken);
            const fbResult = await signInWithCredential(auth, fbCred);
            resolvedUser = {
              uid: fbResult.user.uid,
              email: fbResult.user.email,
              displayName: fbResult.user.displayName,
              photoURL: fbResult.user.photoURL,
            };
          } catch {
            resolvedUser = await fetchGoogleUserProfile(accessToken);
          }

          cachedUser = resolvedUser;
          return { user: resolvedUser, accessToken };
        }
      }

      // Fallback to Firebase Auth popup if GIS or oAuthClientId is unavailable
      return await signInWithFirebasePopup();
    } finally {
      isSigningIn = false;
      activeSignInPromise = null;
    }
  };

  activeSignInPromise = runSignIn();
  return activeSignInPromise;
};

export const getAccessToken = (): string | null => {
  if (!cachedAccessToken) return null;
  if (tokenExpiresAt > 0 && Date.now() >= tokenExpiresAt) {
    cachedAccessToken = null;
    cachedUser = null;
    tokenExpiresAt = 0;
    return null;
  }
  return cachedAccessToken;
};

export const logout = async (): Promise<void> => {
  const tokenToRevoke = cachedAccessToken;
  cachedAccessToken = null;
  cachedUser = null;
  tokenExpiresAt = 0;

  if (tokenToRevoke) {
    const win = window as unknown as GoogleIdentityGlobal;
    win.google?.accounts?.oauth2?.revoke?.(tokenToRevoke);
  }

  try {
    await auth.signOut();
  } catch {
    // Ignore Firebase signOut error if user only held a GIS token
  }
};

// Optional Google Picker loader for selecting existing Drive files and folders under drive.file scope
export interface PickedDriveDoc {
  id: string;
  name: string;
  mimeType: string;
}

interface PickerGlobal {
  gapi?: {
    load: (api: string, callback: () => void) => void;
  };
  google?: {
    picker?: {
      PickerBuilder: new () => {
        addView: (view: unknown) => unknown;
        enableFeature?: (feature: unknown) => unknown;
        setOAuthToken: (token: string) => unknown;
        setCallback: (
          cb: (data: {
            action: string;
            docs?: Array<{ id: string; name: string; mimeType: string }>;
          }) => void
        ) => unknown;
        setOrigin: (origin: string) => unknown;
        setAppId: (appId: string) => unknown;
        build: () => { setVisible: (visible: boolean) => void };
      };
      DocsView: new (viewId?: unknown) => {
        setIncludeFolders: (include: boolean) => unknown;
        setSelectFolderEnabled?: (enabled: boolean) => unknown;
        setMode?: (mode: unknown) => unknown;
        setMimeTypes: (mimeTypes: string) => unknown;
      };
      DocsViewMode?: { LIST?: unknown; GRID?: unknown };
      ViewId: { DOCS: unknown };
      Feature?: { MULTISELECT_ENABLED?: unknown };
      Action: { PICKED: string; CANCEL: string };
    };
  };
}

let gapiScriptPromise: Promise<void> | null = null;

function loadGapiScript(): Promise<void> {
  if (gapiScriptPromise) return gapiScriptPromise;
  gapiScriptPromise = new Promise((resolve, reject) => {
    const win = window as unknown as PickerGlobal;
    if (win.gapi && win.google?.picker) {
      resolve();
      return;
    }
    const script = document.createElement('script');
    script.src = 'https://apis.google.com/js/api.js';
    script.async = true;
    script.onload = () => {
      const gapi = (window as unknown as PickerGlobal).gapi;
      if (!gapi) {
        gapiScriptPromise = null;
        reject(new Error('Google API script did not initialize.'));
        return;
      }
      gapi.load('picker', () => resolve());
    };
    script.onerror = () => {
      gapiScriptPromise = null;
      reject(new Error('Failed to load Google Picker script.'));
    };
    document.head.appendChild(script);
  });
  return gapiScriptPromise;
}

export async function openGoogleDrivePicker(
  accessToken: string
): Promise<{ picked: boolean; docs: PickedDriveDoc[] }> {
  await loadGapiScript();
  const win = window as unknown as PickerGlobal;
  if (!win.google?.picker) {
    throw new Error('Google Picker library is unavailable.');
  }

  const pickerOrigin =
    window.location.ancestorOrigins && window.location.ancestorOrigins.length > 0
      ? window.location.ancestorOrigins[window.location.ancestorOrigins.length - 1]
      : window.location.origin;

  return new Promise((resolve) => {
    const pickerApi = win.google!.picker!;
    const docsView = new pickerApi.DocsView(pickerApi.ViewId.DOCS);
    if (pickerApi.DocsViewMode?.LIST && typeof docsView.setMode === 'function') {
      docsView.setMode(pickerApi.DocsViewMode.LIST);
    }
    docsView.setIncludeFolders(true);
    if (typeof docsView.setSelectFolderEnabled === 'function') {
      docsView.setSelectFolderEnabled(true);
    }

    const builder = new pickerApi.PickerBuilder();
    builder.addView(docsView);
    if (pickerApi.Feature?.MULTISELECT_ENABLED && typeof builder.enableFeature === 'function') {
      builder.enableFeature(pickerApi.Feature.MULTISELECT_ENABLED);
    }
    builder.setOAuthToken(accessToken);
    if (firebaseConfig.messagingSenderId) {
      builder.setAppId(firebaseConfig.messagingSenderId);
    }
    builder.setOrigin(pickerOrigin);
    builder.setCallback((data) => {
      if (data.action === pickerApi.Action.PICKED) {
        resolve({ picked: true, docs: data.docs || [] });
      } else if (data.action === pickerApi.Action.CANCEL) {
        resolve({ picked: false, docs: [] });
      }
    });

    const picker = builder.build();
    picker.setVisible(true);
  });
}
