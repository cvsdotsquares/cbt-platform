declare namespace NodeJS {
  interface ProcessEnv {
    API_PROXY_URL?: string;
    NEXT_PUBLIC_TENANT_ID?: string;
    NEXT_PUBLIC_API_URL?: string;
    NEXT_PUBLIC_WS_URL?: string;
    NEXT_PUBLIC_ALLOW_PUBLIC_REGISTRATION?: string;
    ALLOW_PUBLIC_REGISTRATION?: string;
    ALLOWED_REGISTRATION_EMAIL_DOMAINS?: string;
    JWT_ACCESS_SECRET?: string;
    NODE_ENV?: 'development' | 'production' | 'test';
    [key: string]: string | undefined;
  }
}

declare const process: {
  env: NodeJS.ProcessEnv;
};
