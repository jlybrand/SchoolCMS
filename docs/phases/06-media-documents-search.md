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
| A1. The library: files, folders, rules | §1 (#101)    |
| A2. The school's "Upload a file" task  | §2 (#102)    |
| B1. Image and Hero blocks              | §3 (#103)    |
| B2. An announcement's image            | §4 (#104)    |
| C1. The Document list block            | §5 (#106)    |
| C2. The not-attested work queue        | §6 (this PR) |
| D. Search                              | —            |

---

## 1. The Resources library (Jason, 2026-11-13)

**`resources`** is a Payload upload collection, tenant-scoped by the multi-tenant plugin. Each
file has a `title` (required), a `description`, tags and a `folder`, plus:

| Kind (`kind`, from the type) | Accepted types                                     | Its rule                                                                                                                                                   |
| ---------------------------- | -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `image`                      | JPEG, PNG, GIF, WebP                               | `alt`, unless `isDecorative`: "Describe the image for people who can't see it, or mark it decorative." (CLAUDE.md rule 7)                                  |
| `document`                   | PDF, Word, Excel, PowerPoint (old and new formats) | `remediationStatus` (attested / not-attested; no "not needed" since 2026-11-16): "Say whether this document has been checked for accessibility." (`07` §5) |

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

---

## 2. "Upload a file" on the school plane (Jason, 2026-11-13)

A school manager's upload to their own library, with **no approval**. Payload's own upload
screen refuses school managers: its access check runs before a school is known
(`resourcesCreateAccess` needs the target site). So the school plane has its own task, like
"Add an event".

- **Where it starts:**
  - the start screen's fifth task, **Upload a file** ("Add an image or a document to your
    school's library.", `SCHOOL_TASKS`);
  - the Files list's **Upload a file** button, which sends a school manager to `/admin/upload-file`
    and the district to Payload's screen (`UploadFileButton`, by `sendsForApproval`);
  - `listTaskFor('resources')`.

  The district visiting `/admin/upload-file` is redirected to Payload's screen.

- **The form** (`UploadFileForm`) asks:
  - the school, only when the manager has several;
  - the file, through a native picker limited to the library's types;
  - a title, which starts from the file's name (`titleFromFilename`) and can be changed;
  - then **only what the file's kind needs**, read from its type in the browser:
    - an image: "Describe the image", or "This image is decorative", which disables the box;
    - a document: "Has this document been checked for accessibility?" with two answers;
  - a folder, a native `<select>` of the chosen school's folders, shown only if it has any;
  - a description and tags.
- **Checked before sending** by `checkUpload` (`upload-file.ts`), in the library's own words
  (`resourceProblems`):
  - a file, at most **25 MB** (`MAX_UPLOAD_BYTES`; Payload's `upload.limits.fileSize` refuses
    bigger too);
  - a title and a school;
  - the folder must be the school's;
  - the kind's own question answered.

  Each error sits beside its field, linked by `aria-describedby`, and focus moves to the first.

- **Sent** as `POST /api/resources` multipart: the file, plus `_payload` holding `checkUpload`'s
  data. A server refusal goes back to its fields (`explainUploadError` reads Payload's
  `errors[].data.errors`); anything else is one plain sentence.
- **On success:** "Uploaded "…" to your school's library. You can upload another." (`role=status`,
  focused), and the form clears.

### Files

| File                                       | Does                                                                                               |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------- |
| `src/admin/SchoolPlane/upload-file.ts`     | pure: `checkUpload`, `titleFromFilename`, `explainUploadError`, `MAX_UPLOAD_BYTES`, `FolderOption` |
| `src/admin/SchoolPlane/UploadFileView.tsx` | `/admin/upload-file` (school plane; the district is redirected)                                    |
| `src/admin/SchoolPlane/UploadFileForm.tsx` | the form                                                                                           |
| `src/admin/SchoolPlane/school-data.ts`     | `listMyFolders(req)`, read as the user                                                             |
| `src/admin/SchoolPlane/school-plane.ts`    | the task; `listTaskFor('resources')`                                                               |
| `src/admin/Resources/UploadFileButton.tsx` | by role: the school's task or Payload's screen                                                     |
| `src/payload.config.ts`                    | the `uploadFile` view; `upload.limits.fileSize`                                                    |

### Tests

- `tests/unit/admin/upload-file.test.ts`:
  - an image with alt, a decorative image, a document with everything;
  - each missing answer in the library's words;
  - video and over-size refused;
  - several schools; another school's folder; no school;
  - the starting title; server errors placed beside their fields
- `tests/unit/admin/school-plane.test.ts`: the fifth task; `listTaskFor('resources')`
- `tests/e2e/school-upload.spec.ts`:
  - from the start screen: an empty send shows what's missing, with focus on the file;
  - an image starts its title from its name, asks for alt text and uploads to School A, with
    axe in both themes at each step;
  - a document asks the accessibility question and uploads;
  - the Files list's button leads to the school's task

## 3. The Image and Hero blocks (Jason, 2026-11-13)

Two blocks that show a file from **this site's library**. The alt text is the library's, never
re-entered on a page, so rule 7 holds at upload. A decorative image gets empty alt text.

| Block   | Fields                                                                                                                  | Who                                                         |
| ------- | ----------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| `image` | `image` (required), `caption`                                                                                           | **In the school palette** (`SCHOOL_BLOCKS`), and in Columns |
| `hero`  | `image` (required); optional `heading`, `subheading`, and a button (`linkFields` with "Nothing", `linkLabel`, `newTab`) | **District only**                                           |

- **The picker** (`libraryImageField`, `src/collections/fields/library-image.ts`) is Payload's upload field on `resources`. It is filtered to
  images **of the page's own site**, and Payload checks the same filter on save. With
  `allowCreate: false` it can't make files: they are uploaded in the library ("Upload a file").
- **Settings → data → render.**
  1. **Settings:** `toImage` / `toHero` keep the file's ID; a block without one is dropped. A hero's
     button needs both its address and its words, or there is none.
  2. **Data:** the resolve pass calls `getImageAsset(id)` (`src/content/resources.ts`, read as
     the platform) → `toImageAsset`:
     - `src` is the largest size (`hero`, 1600);
     - `srcSet` lists every size with its width, the original last;
     - `alt` is the library's, or empty if decorative.

     A missing file, or one that isn't an image, drops the block.

  3. **Render:**
     - `LibraryImage` (named so the alt lint doesn't take it for an `<img>`) is a `<figure>`
       with a lazy `<img>` (width and height set, `sizes` for the text column) and a
       `<figcaption>`.
     - `Hero` breaks out to the wide measure, at least `--space-xl` from the screen's edges (the
       staff list's breakout), with a priority-loaded image.
- **The hero's words** (Jason: "images will not always have a heading") sit on a
  `--color-surface-raised` band **under** the image, or **beside** it from 60rem. So they meet
  contrast whatever the photo, and the button is `Link`'s button. With no words, the hero is the
  image alone. The heading takes the block's level.
- **Files load on every site's own hostname:** `/api` is outside the edge rewrite (`proxy.ts`).
- **The approval diff** names them: "Image" with its caption, and "Hero" with its heading. It also
  now names "Calendar" and "Staff list", which were shown as "Section".
- **Admin accessibility:**
  - A11yPatch names the chosen file's icon-only buttons: "Edit the file's details" and "Take
    the file out of this section". Remove only clears the field; the file stays in the library.
  - `admin-overrides.css` darkens its size/type line.

### Files

| File                                                     | Does                                                                               |
| -------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `src/collections/blocks/index.ts`                        | `imageBlock`, `heroBlock`, using the shared `libraryImageField` picker             |
| `src/access/school-layout.ts`                            | `image` in `SCHOOL_BLOCKS`                                                         |
| `src/content/types.ts`                                   | `ImageAsset`, `ImageBlock`, `ResolvedImageBlock`, `HeroBlock`, `ResolvedHeroBlock` |
| `src/content/blocks.ts`                                  | `toImage`, `toHero`                                                                |
| `src/content/image-asset.ts`, `src/content/resources.ts` | pure `toImageAsset`; `getImageAsset`                                               |
| `src/content/resolve-blocks.ts`                          | the `image` and `hero` cases                                                       |
| `src/blocks/LibraryImage/`, `src/blocks/Hero/`           | components, CSS, stories                                                           |
| `src/admin/Approvals/page-diff.ts`                       | the four section names                                                             |

### Tests

- `tests/unit/blocks.test.ts`: both mappers (no image dropped; optional words; the button rule)
- `tests/unit/content/image-asset.test.ts`: `src`, `srcSet`, alt, decorative, no sizes, not an
  image
- `tests/unit/access/school-layout.test.ts`: Image in the palette, Hero not
- `tests/unit/admin/layout-diff.test.ts`, `a11y-patch.test.ts`: the names; the picker's buttons
- `tests/integration/image-blocks.test.ts`:
  - resolved sizes and alt; decorative gives empty alt; a hero resolves the same way
  - a missing file or a document drops the block
  - another school's image is refused on save
  - a school may add an Image but not a Hero
- `tests/e2e/image-blocks.spec.ts`: a public page with a hero with words, a captioned image and
  an image-only hero — alt text, the heading level, the button — with axe in both themes
- `tests/e2e/admin-planes-axe.spec.ts`: a page holding a hero and an image, in both themes
- Storybook `Blocks/Image`, `Blocks/Hero`: the component axe gate, LTR and RTL

## 4. An announcement's image (Jason, 2026-11-13)

An announcement may have one image from **its own site's library**. It shows at the top of the
announcement and as the thumbnail in news lists. The alt text is the library's, as in §3.

- **The field:** `heroImage` on `posts`, labelled "Image" and not required. It is the §3 picker
  (`libraryImageField`) under another name: this site's images only, checked on save, with no
  uploading from the picker. Schools choose it too, and it goes through approval with the rest of
  the post.
- **Data:**
  1. `listPosts` and `getPostBySlug` collect the posts' `heroImage` ids and read them in **one**
     query: `getImageAssets(ids)` (`src/content/resources.ts`, as the platform) →
     `toImageAsset` → id → `ImageAsset`. A shared post's image is from its home site's library;
     files are public.
  2. `toPost(row, paths, images)` stays pure: `Post.image` is the image the map holds for that
     id. No image chosen, a file that is gone or one that isn't an image is `null`.
- **Render:**
  - **The announcement's page** (`/news/{slug}`): `LibraryImage`, under the headline and date
    and above the body, with the library's alt text. `priority` loads it eagerly with
    `fetchPriority="high"`, because it is at the top of the page.
  - **News lists** (the `/news` page and the News feed block): `toNewsItems` makes `thumbnail`,
    the image with **empty alt text**, because the headline beside it says what it is.
    `NewsList` puts it at the inline start, 6rem wide on a phone and 8rem from 40rem, cropped to
    4:3. An announcement without an image keeps the plain layout.
- **Auto-approval:** `heroImage` is on `posts`' never list (`src/access/auto-approval.ts`, since
  Phase 4), so under a `posts.routine` grant a submission that sets or changes the image queues
  in full (`04` §4.3).
- **The approval diff:** an "Image" row, named by the file's library title. The queue reads the
  titles with the boards and tags (`withPostNames`).

### Files

| File                                                        | Does                                             |
| ----------------------------------------------------------- | ------------------------------------------------ |
| `src/collections/fields/library-image.ts`                   | `libraryImageField`, shared with §3's blocks     |
| `src/collections/Posts.ts`                                  | the `heroImage` field                            |
| `src/content/types.ts`, `src/content/post-mapper.ts`        | `Post.image`; `toPost`'s `images` map            |
| `src/content/resources.ts`, `src/content/posts.ts`          | `getImageAssets`; `imagesFor` in both reads      |
| `src/lib/post-url.ts`                                       | `NewsItem.thumbnail`, alt emptied                |
| `src/components/NewsList/`                                  | the thumbnail layout; the `WithThumbnails` story |
| `src/blocks/LibraryImage/LibraryImage.tsx`                  | the `priority` prop                              |
| `src/app/(frontend)/sites/[hostname]/[locale]/news/[slug]/` | the image on the announcement's page             |
| `src/admin/Approvals/page-diff.ts`, `queue-data.ts`         | the "Image" row; resource titles                 |

### Tests

- `tests/unit/post-mapper.test.ts`: the image by bare id or populated row; none, gone, or not
  an image is null
- `tests/unit/lib/post-url.test.ts`: the thumbnail has empty alt; no image means no thumbnail
- `tests/unit/admin/page-diff.test.ts`: the image named by its title; the same file is no change
- `tests/unit/components/blocks.test.tsx`: a feed's thumbnail has empty alt beside its headline;
  no image means no `<img>`
- `tests/integration/post-image.test.ts`:
  - the post page and the list receive sizes and alt
  - none chosen, or a deleted file, means no image, and the post still shows
  - another school's image, or a document, is refused on save
  - a school manager may choose their own school's image
- `tests/integration/auto-approval.test.ts`: under `posts.routine`, a new announcement with an
  image and an image added to a live one both wait in the queue. `heroImage` was already on the
  never list (`04` §4.3); these cases prove it with a real field.
- `tests/e2e/post-image.spec.ts`: the image under the headline (eager), the list's thumbnail
  with `alt=""`, and axe on both pages in both themes
- `tests/e2e/admin-planes-axe.spec.ts`: the district's post form with an image chosen
- Storybook `Components/NewsList` → `WithThumbnails`: the component axe gate, LTR and RTL

## 5. The Document list block (Jason, 2026-11-16)

A block that lists **every document in one folder** of this site's library, A–Z by title. It
follows the folder: add or remove a file there and the list changes, with no page edit.

| Block          | Fields                                    | Who                                                         |
| -------------- | ----------------------------------------- | ----------------------------------------------------------- |
| `documentList` | `heading` (optional), `folder` (required) | **In the school palette** (`SCHOOL_BLOCKS`), and in Columns |

- **The folder picker** is a relationship to `resource-folders`, filtered to **this site's**
  folders. Payload checks the same filter on save, and `allowCreate: false` means folders are
  made in the library, not here.
- **Only that folder:** its subfolders are not included, and neither are the images in it.
- **Settings → data → render.**
  1. **Settings:** `toDocumentList` keeps the folder's id; a block without one is dropped.
  2. **Data:** the resolve pass calls `listFolderDocuments(tenantId, folderId)`
     (`src/content/resources.ts`, as the platform). It asks for this site's documents in that
     folder, so a stored id pointing at another site's folder lists nothing (`03` §6.4). Each
     file goes through `toDocumentItem` (`src/content/document-item.ts`, pure):
     - `fileType` is what a visitor calls it ("PDF", "Word", "Excel", "PowerPoint", else
       "File"), and `fileSize` is "240 KB" or "3.5 MB";
     - `unchecked` is true for `not-attested`;
     - anything that isn't a document, or has no address or title, is left out.

     The block gets `contactName`, the site's name. An empty folder, or one that is gone, drops
     the block, and `BlockList` filters an empty one too, as it does an empty feed.

  3. **Render** (`src/blocks/DocumentList/`): a list, under a named region when there's a
     heading at the block's level. Each item:
     - a link whose text is the title then the type and size, "Allergy plan (PDF, 240 KB)", so
       the link says what it opens (WCAG 2.4.4);
     - the description, if any;
     - for an **unchecked** document only (Jason): "This document may not be fully accessible.
       Contact {site name} for an accessible copy." A checked document gets no note.
       The platform records the status; it does not remediate (`07` §5).
- **The approval diff** names it "Document list", with its heading.

### Files

| File                                                        | Does                                                             |
| ----------------------------------------------------------- | ---------------------------------------------------------------- |
| `src/collections/blocks/index.ts`                           | `documentListBlock`, in the library and in Columns               |
| `src/access/school-layout.ts`                               | `documentList` in `SCHOOL_BLOCKS`                                |
| `src/content/types.ts`                                      | `DocumentListBlock`, `DocumentItem`, `ResolvedDocumentListBlock` |
| `src/content/blocks.ts`                                     | `toDocumentList`                                                 |
| `src/content/document-item.ts`                              | pure `toDocumentItem`, `fileTypeLabel`, `fileSizeLabel`          |
| `src/content/resources.ts`, `src/content/resolve-blocks.ts` | `listFolderDocuments`; the `documentList` case                   |
| `src/blocks/DocumentList/`, `src/blocks/BlockList.tsx`      | the component, CSS, stories; the case and the empty filter       |
| `src/admin/Approvals/page-diff.ts`                          | the section name                                                 |

### Tests

- `tests/unit/content/document-item.test.ts`: the row; the note only for not-attested; images,
  no address and no title left out; type and size labels
- `tests/unit/blocks.test.ts`: the mapper (no folder dropped) and the complete-row guard
- `tests/unit/access/school-layout.test.ts`, `tests/unit/admin/layout-diff.test.ts`: in the
  palette; named in the diff
- `tests/unit/components/blocks.test.tsx`: the region, the link text, the note on the unchecked
  one only, no heading, and empty renders nothing
- `tests/integration/document-list.test.ts`:
  - A–Z with type, the unchecked flag and the site's name
  - only that folder: no neighbours, no folder-less files, no images
  - an empty or missing folder drops the block
  - another site's folder lists nothing, even by stored id
  - another school's folder is refused on save
  - a school manager may add one
- `tests/e2e/document-list.spec.ts`: a public page with A–Z links naming type and size, the note
  on the unchecked document only, and axe in both themes
- `tests/e2e/admin-planes-axe.spec.ts`: the page form with a hero, an image and a document list,
  in both themes
- Storybook `Blocks/DocumentList`: the component axe gate, LTR and RTL

## 6. The not-checked work queue (Jason, 2026-11-16)

A **district-only** panel on the district dashboard, "Documents to check": every document whose
`remediationStatus` is `not-attested`, oldest first (`07` §5; `04` §3.1 item 5). It sits under
"Needs freshening". The platform records the status; it does not remediate.

- **Read** (`findUncheckedDocuments`, `src/admin/Dashboard/dashboard-data.ts`): `resources` where
  `kind` is `document` and `remediationStatus` is `not-attested`, sorted by `createdAt`, at most
  `UNCHECKED_SHOWN` (10), with `totalDocs`. It runs **as the user**, like every dashboard read,
  so a school manager would get their own school's or nothing. The dashboard renders only for
  the district anyway.
- **Shape** (`uncheckedDocuments`, `src/lib/dashboard.ts`, pure):
  - the lead: "2 documents haven't been checked for accessibility. Oldest first.", or "…The
    oldest 10 are shown." when there are more;
  - each row: the site, the document's title as a link to its file
    (`/admin/collections/resources/{id}`), and the day it was uploaded. Marking it checked there
    takes it off the list;
  - more than 10: a "See all N" link to the Files list, filtered by
    `where[remediationStatus][equals]=not-attested`;
  - none: "Every document has been checked for accessibility."
- **Render:** Payload's `Table`, as in "Needs freshening".

### Files

| File                                        | Does                                                           |
| ------------------------------------------- | -------------------------------------------------------------- |
| `src/admin/Dashboard/dashboard-data.ts`     | `findUncheckedDocuments`                                       |
| `src/lib/dashboard.ts`                      | `uncheckedDocuments`, `UNCHECKED_SHOWN`, `UNCHECKED_LIST_HREF` |
| `src/admin/Dashboard/DistrictDashboard.tsx` | the "Documents to check" panel                                 |

### Tests

- `tests/unit/lib/dashboard.test.ts`: none waiting; the count and oldest first with site, link
  and day; one is one; more than 10 gives the "See all" link; no title or an unknown site in
  words
- `tests/integration/dashboard.test.ts`: not-attested documents only (not checked, not "not
  needed", not images), the total, leaving the queue once checked, and a school manager never
  reads another school's
- `tests/e2e/district-dashboard.spec.ts`: the panel order, and an unchecked document listed
  with a link to its file (or the "See all" link), with axe in both themes

## 7. Two answers, not three (Jason, 2026-11-16)

A document's accessibility question has **two** answers: "Yes — checked and fixed" (`attested`)
or "No — not checked yet" (`not-attested`). The third, "Not needed — it's a form to print, or
similar" (`not-applicable`), is gone from the Files form, the school's "Upload a file" form and
`REMEDIATION_STATUSES` (`src/lib/resources.ts`). So `resourceProblems` refuses it on every route,
as it refuses no answer. A form to print is now listed for checking, with the public note, until
someone checks it.

- **Existing rows:** the enum loses a value, and Postgres will not convert a column that still
  holds it. Before the schema change reaches a database with data, map every `not-applicable` to
  `not-attested` (the conservative choice: the note shows and the document joins the queue).
  `dd2_dev` had none, and there is no production yet.
- **Tests:** `tests/unit/lib/resources.test.ts` and `tests/integration/resources.test.ts` refuse
  `not-applicable`. Fixtures that used it as a stand-in now use `attested`.
  `tests/e2e/school-upload.spec.ts` answers "No — not checked yet".
