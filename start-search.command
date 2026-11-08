#!/bin/zsh
cd -- "$(dirname -- "$0")" || exit 1
if ! command -v node >/dev/null || ! command -v npm >/dev/null; then
  print 'Install Node.js 20 or later first.'
  read 'reply?Press Enter to close: '
  exit 1
fi
if [[ ! -d node_modules/playwright ]]; then
  npm ci --cache .npm-cache --no-audit --no-fund || exit 1
fi
npm run search
query_exit=$?
print 'Progress and reports are saved in the data folder. Double-click again to resume.'
read 'reply?Press Enter to close: '
exit $query_exit
