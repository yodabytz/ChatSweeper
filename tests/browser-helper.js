'use strict';
const { chromium, firefox } = require('playwright');
exports.launch = function (options = {}) {
  if (process.env.TEST_BROWSER === 'firefox') return firefox.launch({ headless: true, ...options });
  return chromium.launch({ executablePath: process.env.CHROME_PATH || '/usr/bin/chromium-browser', headless: true, args: ['--no-sandbox'], ...options });
};
