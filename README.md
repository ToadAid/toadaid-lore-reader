# ToadAid Lore Reader

Static reader foundation for the historical lore archive. This repository is a
generated consumer, not an independently authored lore archive.

Canonical source: `ToadAid/toadaid.github.io`, `lore/data.json`, commit
`041c2ea6fda8284f61fb35c7101d083623d235ba`.

## Local commands

```sh
npm test
npm run import:canonical -- --source /path/to/data.json --repository ToadAid/toadaid.github.io --source-path lore/data.json --commit 041c2ea6fda8284f61fb35c7101d083623d235ba
npm run build
```

The importer writes derived JSON only under `generated/`. Do not hand-edit
those files.

