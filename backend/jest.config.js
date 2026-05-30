'use strict';

/**
 * Jest configuration for the EMS backend.
 * Tests live under backend/tests and run in the Node environment.
 */
module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/tests/**/*.test.js'],
  clearMocks: true,
  verbose: true
};
