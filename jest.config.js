/** @type {import('jest').Config} */
module.exports = {
    testEnvironment: 'jsdom',
    testMatch: ['**/*.test.js'],
    verbose: true,
    collectCoverageFrom: [
        'script.js',
        'server.js'
    ],
    coverageDirectory: 'coverage',
    coverageReporters: ['text', 'lcov'],
    setupFilesAfterEnv: ['<rootDir>/jest.setup.js'],
    modulePathIgnorePatterns: [
        '<rootDir>/dist/',
        '<rootDir>/electron/',
        '<rootDir>/android/',
        '<rootDir>/node_modules/'
    ]
};
