# Source

Payload's official agent skill, copied verbatim from the release this repo pins:

- Repo: https://github.com/payloadcms/payload
- Tag: `v3.93.0` — path `tools/claude-plugin/skills/payload/`
- Matches `payload` 3.93.0 in `package.json`. (Installed from `v3.87.0`; on the 3.93.0 bump,
  2026-11-11, the tag's copy was byte-for-byte identical, so only this note changed.)

Not the copy at `packages/payload/skills/payload/` on Payload's main branch: that targets
4.0 (beta) and differs, e.g. it recommends a `{ type: 'slug' }` field that 3.x does not have
(3.x uses `slugField()`).

When Payload is bumped (always its own PR — `09` §2), replace this folder with the copy from the
new tag in the same PR.

Where it disagrees with CLAUDE.md or `starterDocs/`, the project wins: e.g. no `plugin-seo`,
no MongoDB, the public layer never imports the SDK.
