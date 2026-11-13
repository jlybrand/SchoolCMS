# Phase 6 — Media, documents and search

How the file library and search work mechanically. Phase 6 opened 2026-11-13 with Jason's
decisions:

- **One Resources library** for images and documents, as Finalsite's, in place of the spec's
  separate `media` and `documents`.
- **Schools upload** to their own school with **no approval**.
- **YouTube only**, so no video uploads.
- **Staff-only visibility waits for Entra.**

| Slice                                  | State        |
| -------------------------------------- | ------------ |
| A1. The library: files, folders, rules | §1 (this PR) |
| A2. The school's "Add a file" task     | —            |
| B. Image and Hero blocks; `heroImage`  | —            |
| C. Document list; not-attested queue   | —            |
| D. Search                              | —            |

---

## 1. The Resources library (Jason, 2026-11-13)

**`resources`** is a Payload upload collection, tenant-scoped by the multi-tenant plugin. Each
file has a `title` (required), a `description`, tags and a `folder`, plus:

| Kind (`kind`, from the type) | Accepted types                                     | Its rule                                                                                                                                  |
| ---------------------------- | -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `image`                      | JPEG, PNG, GIF, WebP                               | `alt`, unless `isDecorative`: "Describe the image for people who can't see it, or mark it decorative." (CLAUDE.md rule 7)                 |
| `document`                   | PDF, Word, Excel, PowerPoint (old and new formats) | `remediationStatus` (attested / not-attested / not-applicable): "Say whether this document has been checked for accessibility." (`07` §5) |

- **Anything else is refused.** Payload's `mimeTypes` allowlist (`ACCEPTED_MIME_TYPES`) stops it
  before anything is stored. There is no video (YouTube only) and no SVG, which can carry
  script. Payload also checks the content itself: a PDF must have its header, an xref table and
  `%%EOF`.
- **Rule 7 on every route.** `resourceProblems` (`src/lib/resources.ts`) is asked by the `alt`
  and `remediationStatus` fields' own validation _and_ by the collection's `beforeValidate`
  hook. The hook runs even with access overridden, and on a later edit that clears the alt
  text.
- **Fields by kind.** Alt and Decorative show for images, the attestation for documents, and
  all of them on a new file until its type is known.
- **On save** (`beforeChange`):
  - `kind` is set from the type, and `tagsText` becomes `tags` (`parseTags`: split on commas,
    trimmed, no empties, no repeats in any case).
  - The folder must belong to the same school.
  - Marking a document **attested** records `attestedBy` and `attestedAt`; any other answer
    clears them.
- **Sizes:** `thumbnail` 400, `card` 800 and `hero` 1600 wide, as WebP, with a focal point.
  Resizing needs `sharp` passed into Payload's config, which this PR adds; nothing used image
  sizes before.
- **Storage:** files go on local disk under `media/` (gitignored). When `R2_BUCKET` and
  `R2_ACCOUNT_ID` are set, `@payloadcms/storage-s3` stores them on Cloudflare R2 (S3-compatible)
  instead.

**`resource-folders`** holds a school's folders: `name`, and `parent` for folders inside folders,
nesting as deep as needed. A folder sits only inside its own school's folders, and never inside
itself or anything inside it (`folderMovesUnder`). `label` stores the folder's path, e.g. "Forms ›
Enrollment › 2026", and both lists sort by it. Payload's built-in upload folders were not used:
they are not tenant-scoped, and isolation here is a guarantee, not a convenience.

**Access** (`src/access/resources.ts`, shared by both collections):

| Who            | Read                                                                | Upload                           | Change / remove           |
| -------------- | ------------------------------------------------------------------- | -------------------------------- | ------------------------- |
| Public         | every file (`{ tenant: { exists: true } }`) — they're the website's | —                                | —                         |
| School manager | own school(s) — `{ tenant: { in: […] } }`                           | into own school, **no approval** | own school's (constraint) |
| District       | all                                                                 | any site                         | any                       |
| Sync           | none                                                                | none                             | none                      |

A school manager can't move their own file to another school, or put it, or a folder, in another
school's folder. The isolation suite proves both.

**Elsewhere:**

- **Activity log:** `forResource` (`src/lib/audit.ts`) records an upload or a change as a publish
  and a removal as a delete, for the file's school, named by its title or else its filename.
  The dashboard calls it a "file".
- **Deleting a site** is refused while its library has files ("still has 1 file"). Its empty
  folders are removed with it (`tenant-delete.ts`).
- **The test seed** clears files, then folders.
- **The district** uploads through Payload's own upload screen. The multi-tenant plugin asks
  whose file it is ("Assigned Tenant"). The school's own upload task is A2: Payload's screen
  refuses school managers, whose upload access needs a site.
- **"Upload a file", never "create"** (Jason, 2026-11-13). Payload's wording is the same for
  every collection, so for files only:
  - its "Create New" button, the empty list's "Create new File" and "Creating new File" are
    hidden (`admin-overrides.css`, scoped by `collection-list--resources` /
    `collection-edit--resources`);
  - DD2's **"Upload a file"** button (`UploadFileButton`, the list's `beforeListTable`) and an
    **"Uploading a file"** heading (`UploadingHeading`, `beforeDocumentControls`) take their place;
  - the breadcrumb's last step reads "Upload a file" (generated content, found with `:has()`).

**Admin accessibility** (`docs/phases/04` §18 approach):

- A11yPatch names the file's icon-only buttons: "Copy the file's address" (its only words are
  a hidden tooltip) and "Remove the file".
- `admin-overrides.css` darkens the upload dropzone's "Drag and drop a file" and "Or" to the
  help-text token.

### Files

| File                                                                      | Does                                                                                                      |
| ------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `src/lib/resources.ts`                                                    | pure: `ACCEPTED_MIME_TYPES`, `kindOf`, `resourceProblems`, `parseTags`, `folderMovesUnder`, `folderLabel` |
| `src/access/resources.ts`                                                 | `resourcesReadAccess`, `resourcesCreateAccess`, `resourcesWriteAccess`, `PUBLIC_RESOURCE_CONSTRAINT`      |
| `src/collections/Resources.ts`                                            | the upload collection, its fields and hooks                                                               |
| `src/collections/ResourceFolders.ts`                                      | folders, the same-school and not-inside-itself checks, `label`                                            |
| `src/payload.config.ts`                                                   | both registered and tenant-scoped; `sharp`; R2 when configured                                            |
| `src/collections/hooks/tenant-delete.ts`                                  | files are content; folders are setup                                                                      |
| `src/lib/audit.ts`, `src/lib/dashboard.ts`                                | `forResource`; "file"                                                                                     |
| `src/admin/A11yPatch/repairs.ts`, `src/app/(payload)/admin-overrides.css` | the upload controls' names and contrast                                                                   |
| `tests/helpers/files.ts`                                                  | real tiny files for tests: `tinyPdf`, `tinyPng`                                                           |

### Tests

- `tests/unit/lib/resources.test.ts`: kinds, the allowlist (no video, no SVG), the alt and
  attestation rules, tags, folder cycles and labels
- `tests/unit/access/resources.test.ts`: the access table, role by role
- `tests/unit/lib/audit.test.ts`: a file's upload, change and removal in the log
- `tests/unit/admin/a11y-patch.test.ts`: the upload buttons named
- `tests/integration/resources.test.ts`:
  - no alt is refused even with access overridden, and clearing it later too
  - alt or decorative is kept, and the sizes are made
  - the attestation is required, and who and when are recorded
  - video and SVG are refused
  - a school uploads to its own school only, and reads, changes and removes only its own
  - the public reads all
  - folders nest with labels, never inside themselves or in another school's
  - tags are tidied; the log records each change
- `tests/integration/tenant-isolation.test.ts` "the file library": invariants 1 and 2, the
  move to another school, and another school's folders
- `tests/integration/tenant-delete.test.ts`: a site with a file is refused; its folders go with
  it
- `tests/e2e/resources.spec.ts`: the list and new-file screen say "Upload a file", never
  "create"; the district uploads through the admin, is refused without alt text, then succeeds
  once it's described
- `tests/e2e/admin-planes-axe.spec.ts`: the files list, an image's form, a new upload and the
  folders list, in both themes
