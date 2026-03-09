#!/usr/bin/env node

/**
 * Cebus CLI Entry Point
 * This file is the npm bin entry point for global installation
 */

// Suppress ExperimentalWarning (SQLite etc.) before any modules load
process.removeAllListeners('warning');
process.on('warning', (w) => {
  if (w.name === 'ExperimentalWarning') return;
  console.warn(w);
});

// Set terminal window/tab title before anything else
process.title = 'Cebus';
process.stdout.write('\x1b]0;Cebus\x07');

import('../dist/cli/index.js')
  .then(({ main }) => main())
  .catch((error) => {
    console.error('Error:', error.message);
    process.exit(1);
  });
