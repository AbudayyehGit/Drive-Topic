import { initializeApp } from 'firebase/app';
import {
  getAuth,
  signInWithPopup,
  GoogleAuthProvider,
  onAuthStateChanged,
  User,
} from 'firebase/auth';
import firebaseConfig from '../../firebase-applet-config.json';

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);

export const DRIVE_SCOPES = ['https://www.googleapis.com/auth/drive.file'] as const;

const provider = new GoogleAuthProvider();
for (const scope of DRIVE_SCOPES) {
  provider.addScope(scope);
}

let isSigningIn = false;
let activeSignInPromise: Promise<{ user: User; accessToken: string } | null> | null = null;
// Access token is strictly kept in memory only (never localStorage or sessionStorage).
let cachedAccessToken: string | null = null;

export const initAuth = (
  onAuthSuccess?: (user: User, token: string) => void,
  onAuthFailure?: () => void
) => {
  return onAuthStateChanged(auth, (user: User | null) => {
    if (user) {
      if (cachedAccessToken) {
        onAuthSuccess?.(user, cachedAccessToken);
      } else if (!isSigningIn) {
        cachedAccessToken = null;
        onAuthFailure?.();
      }
    } else {
      cachedAccessToken = null;
      onAuthFailure?.();
    }
  });
};

export const googleSignIn = async (): Promise<{ user: User; accessToken: string } | null> => {
  if (activeSignInPromise) {
    return activeSignInPromise;
  }

  activeSignInPromise = (async () => {
    try {
      isSigningIn = true;
      const result = await signInWithPopup(auth, provider);
      const credential = GoogleAuthProvider.credentialFromResult(result);
      if (!credential?.accessToken) {
        throw new Error(
          'Google Drive access permission was not granted. Please allow Drive access when signing in.'
        );
      }
      cachedAccessToken = credential.accessToken;
      return { user: result.user, accessToken: cachedAccessToken };
    } catch (error: unknown) {
      const code =
        typeof error === 'object' && error !== null && 'code' in error
          ? String((error as { code?: unknown }).code)
          : '';

      if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') {
        return null;
      }
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
      throw error;
    } finally {
      isSigningIn = false;
      activeSignInPromise = null;
    }
  })();

  return activeSignInPromise;
};

export const getAccessToken = (): string | null => {
  return cachedAccessToken;
};

export const logout = async (): Promise<void> => {
  await auth.signOut();
  cachedAccessToken = null;
};

// Optional Google Picker loader for selecting existing Drive files under drive.file scope
interface PickerGlobal {
  gapi?: {
    load: (api: string, callback: () => void) => void;
  };
  google?: {
    picker?: {
      PickerBuilder: new () => {
        addView: (view: unknown) => unknown;
        setOAuthToken: (token: string) => unknown;
        setCallback: (cb: (data: { action: string; docs?: Array<{ id: string; name: string; mimeType: string }> }) => void) => unknown;
        setOrigin: (origin: string) => unknown;
        setAppId: (appId: string) => unknown;
        build: () => { setVisible: (visible: boolean) => void };
      };
      DocsView: new (viewId?: unknown) => {
        setIncludeFolders: (include: boolean) => unknown;
        setMimeTypes: (mimeTypes: string) => unknown;
      };
      ViewId: { DOCS: unknown };
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
        reject(new Error('Google API script did not initialize.'));
        return;
      }
      gapi.load('picker', () => resolve());
    };
    script.onerror = () => reject(new Error('Failed to load Google Picker script.'));
    document.head.appendChild(script);
  });
  return gapiScriptPromise;
}

export async function openGoogleDrivePicker(accessToken: string): Promise<boolean> {
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
    docsView.setMimeTypes(
      'application/vnd.google-apps.document,text/plain,text/markdown,text/csv,application/json,text/html'
    );

    const builder = new pickerApi.PickerBuilder();
    (builder.addView(docsView) as typeof builder);
    (builder.setOAuthToken(accessToken) as typeof builder);
    if (firebaseConfig.messagingSenderId) {
      (builder.setAppId(firebaseConfig.messagingSenderId) as typeof builder);
    }
    (builder.setOrigin(pickerOrigin) as typeof builder);
    (builder.setCallback((data) => {
      if (data.action === pickerApi.Action.PICKED) {
        resolve(true);
      } else if (data.action === pickerApi.Action.CANCEL) {
        resolve(false);
      }
    }) as typeof builder);

    const picker = builder.build();
    picker.setVisible(true);
  });
}
