const root = require('../../eslint.config.js');

module.exports = [
  ...root,
  {
    settings: {
      'import/resolver': {
        typescript: { alwaysTryTypes: true, project: './tsconfig.json' },
      },
    },
  },
];
