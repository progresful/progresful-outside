/** Build-time settings, read by Vite from the environment when the extension is built. */
interface ImportMetaEnv {
  /** The hosted server a release build talks to by default; unset in development. */
  readonly WXT_SERVER_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
