# Source

Payload's official agent skill, copied verbatim from the release this repo pins:

- Repo: https://github.com/payloadcms/payload
- Tag: `v3.87.0` — path `tools/claude-plugin/skills/payload/`
- Matches `payload` 3.87.0 in `package.json`.

Not the copy at `packages/payload/skills/payload/` on Payload's main branch: that targets
4.0 (beta) and differs, e.g. it recommends a `{ type: 'slug' }` field that 3.87 does not have
(3.87 uses `slugField()`).

When Payload is bumped (always its own PR — `09` §2), replace this folder with the copy from the
new tag in the same PR.

Where it disagrees with CLAUDE.md or `starterDocs/`, the project wins: e.g. no `plugin-seo`,
no MongoDB, the public layer never imports the SDK.
