/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_CE_API?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
