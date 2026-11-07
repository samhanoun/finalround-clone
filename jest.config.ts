import type { Config } from 'jest';

const config: Config = {
  testEnvironment: 'jsdom',
  setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'],
  testMatch: ['<rootDir>/src/**/*.test.(ts|tsx)'],
  moduleNameMapper: {
    '\\.css$': '<rootDir>/jest.styleMock.js',
    // Before the @/ alias: the locale-aware navigation helpers are ES modules too.
    '^@/i18n/routing$': '<rootDir>/test/i18nRoutingMock.tsx',
    '^@/(.*)$': '<rootDir>/src/$1',
    // next-intl ships ES modules; tests translate with the real English messages instead.
    '^next-intl$': '<rootDir>/test/nextIntlMock.tsx',
    '^next-intl/server$': '<rootDir>/test/nextIntlMock.tsx',
  },
  transform: {
    '^.+\\.(t|j)sx?$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.json' }],
  },
};

export default config;
