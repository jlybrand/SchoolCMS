# Phase 6 — Media, documents and search

How the file library and search work mechanically. Phase 6 opened 2026-11-13 with Jason's
decisions:

- **One Resources library** for images and documents, as Finalsite's, in place of the spec's
  separate `media` and `documents`.
- **Schools upload** to their own school with **no approval**.
- **YouTube only**, so no video uploads.
- **Staff-only visibility waits for Entra.**

| Slice                                  | State         |
| -------------------------------------- | ------------- |
| A1. The library: files, folders, rules | §1 (#101)     |
| A2. The school's "Upload a file" task  | §2 (#102)     |
| B1. Image and Hero blocks              | §3 (#103)     |
| B2. An announcement's image            | §4 (#104)     |
| C1. The Document list block            | §5 (#106)     |
| C2. The not-attested work queue        | §6 (#107)     |
| D1. The search index and query         | §8 (#109)     |
| D2. The search page and header box     | §9 (#110)     |
| E. Exit check and close-out            | §10 (#111)    |
| After the close: replace a file        | §11 (this PR) |

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

## 8. The search index and query (Jason, 2026-11-16)

Site search runs on Postgres full-text search (ADR-14) over an index of every public, published
page, announcement, event and document. This slice (D1) is the index and the query; D2 adds the
`/search` page and the header box.

**What is searched** (Jason): pages, with all their words; announcements; events; documents by
title and description (not the words inside the file). A school searches **its own site**, and can
re-run across **every DD2 site**. An announcement shared to a school is found there, labelled with
its home site and linking home.

### The index: `@payloadcms/plugin-search`

`src/collections/search-index.ts` configures the plugin for `pages`, `posts`, `events` and
`resources`. It keeps one `search` row per published document: written on publish, removed on
unpublish or delete (`syncDrafts: false`, `deleteDrafts: true`). CLAUDE.md lists it among the
adopted plugins.

- **Each row** gets `toSearchEntry(collection, doc)` (`src/content/search-entry.ts`, pure), set
  through `beforeSync`:

  | Field                    | Holds                                                                                                                                                                                                                                              |
  | ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
  | `title`, `text`          | the words: a page's sections, Columns included (Text, Button, Cards, Accordion, Image caption, Hero words, data sections' headings); a post's summary and body; an event's location and notes; a document's description. At most 50,000 characters |
  | `tenant`, `kind`         | the site; `page`, `post`, `event` or `document`                                                                                                                                                                                                    |
  | `excluded`               | true for a staff-only page or post, a page with "Hide from site search", an image, or anything with no site or title                                                                                                                               |
  | `reachAll`, `reachSites` | an announcement's sharing: district-wide, or the chosen sites                                                                                                                                                                                      |
  | `lastDate`               | an event's last day: `repeatUntil`, else `end`, else `start`                                                                                                                                                                                       |
  | `href`                   | a document's file                                                                                                                                                                                                                                  |

- **`excluded`, not `skipSync`.** The plugin's `skipSync` returns before touching an existing
  row, so a live post switched to staff-only would stay findable. The row is rewritten, marked.
- **Closed to every route.** The collection's access is `false` for read, create, update and
  delete, and its admin is hidden. The plugin writes as the platform; `searchSite` reads with
  access overridden and scopes itself. So the plugin's own reindex endpoint also refuses everyone.
- **Not registered with the tenant plugin.** A site can't be deleted while it has content, and
  deleting content removes its rows.
- **A row must always be valid.** The plugin catches and logs its own errors, but a failed
  statement inside the save's transaction still aborts the save. `tenant` is passed as a number
  for this reason: the relationship refused the string id.
- **Auto-approved announcements** are indexed: the publish inside the send runs the sync first.

### The backfill: `pnpm search:reindex`

`reindexSearch(payload)` clears the index and writes a row for every published page, post and
event and every library file, with the same `entryFields` as `beforeSync`. It writes directly
rather than re-saving documents, which would fire the audit log, revalidation and review state.
It is safe to re-run. **Run it once** on `dd2_dev`, and on production at the deploy that brings
search. The seed needs no backfill: it publishes through Payload, so the hooks index as it goes.

### The query: `searchSite(ctx, { query, scope, page })`

`src/content/search.ts`, on the Payload side of the boundary, returns `SearchResults` (hand-written
types in `src/content/types.ts`).

1. `normalizeQuery` (`src/lib/search.ts`, pure): trimmed, one space between words, control
   characters removed, at most 200 characters. Nothing left means no query is run.
2. **One parameterized statement** through Payload's own Drizzle connection (`sql` from
   `@payloadcms/db-postgres/drizzle`). The visitor's words are a bound value.
   - matches `websearch_to_tsquery('english', q)` against the title (weight A) and text (weight B);
   - **scope in the WHERE clause:** not `excluded`; events no older than a year; and either "every
     site", or this site's own rows, or posts shared district-wide or to this site by name;
   - ranked by `ts_rank_cd`, then title; 10 a page with the total; a `ts_headline` snippet whose
     matches are marked with control characters.
3. **Shaping:**
   - a **page** links to its path, read from the site's published path index at query time, so
     a moved parent never leaves a stale link;
   - a **post** uses `postHref`, so it links home when shared;
   - a **document** links to its file, with its type and size;
   - an **event** shows its next time (or its last), and its location, and links to the first
     published page of its site whose Calendar section shows its calendar (found in
     `pages_rels`, Columns included), or to nothing;
   - another site's result is labelled with that site's name, and its link is that site's
     address (`publicUrlFor`);
   - `splitSnippet` turns the snippet into parts, so a match is rendered in `<mark>` as text,
     never as HTML.

**No index on the vectors yet.** Push mode can't create an expression index, and 28 sites' content
is small. Add a GIN index on the weighted vector in Phase 8 hardening, when migrations start.

### Files

| File                              | Does                                           |
| --------------------------------- | ---------------------------------------------- |
| `src/collections/search-index.ts` | the plugin's config; `reindexSearch`           |
| `src/content/search-entry.ts`     | pure `toSearchEntry`                           |
| `src/content/search.ts`           | `searchSite`                                   |
| `src/lib/search.ts`               | pure `normalizeQuery`, `splitSnippet`          |
| `scripts/reindex-search.ts`       | `pnpm search:reindex`                          |
| `src/content/types.ts`            | `SearchResult`, `SearchResults`, `SearchScope` |

### Tests

- `tests/unit/content/search-entry.test.ts`: every block's words, Columns, lists; staff-only and
  hidden excluded; sharing; an event's last day; documents only; the cap
- `tests/unit/lib/search.test.ts`: the query's cleaning and cap; snippet parts, markup kept as text
- `tests/integration/search.test.ts`:
  - **the index:** published in, draft out; unpublish and delete remove; staff marks excluded; a
    document with its file; an image excluded
  - **the query:**
    - found by its words and linked;
    - **this site never returns another site's content**, while every site does, labelled;
    - drafts, staff-only, hidden pages and images are never found;
    - a title ranks above the words;
    - a shared post is found where it's shared and nowhere else;
    - an auto-approved post is found;
    - an event's details, with a link once a page shows its calendar;
    - a year-old event is left out;
    - an empty query searches nothing; ten to a page;
    - typed search syntax and SQL never error
  - **the backfill:** rebuilds from published content; running it twice gives the same result
- `tests/integration/tenant-isolation.test.ts`: nobody reads the index through Payload's access
  (a visitor, a manager, the district), and a manager can't write or change a row

## 9. The search page and the header box (Jason, 2026-11-16)

**The header box.** `SiteHeader` puts a `SearchForm` in its tools column, after the languages
(name → quick links → languages → search → main menu, in both the DOM and visual order):

- a plain GET form to `localizedPath('/search', locale)`, so it works with no JavaScript;
- a `search` landmark named "Site search";
- a read-only label "Search this site" beside a visible "Search" button whose name matches it
  (2.5.3);
- `type="search"`, `name="q"`, at most 200 characters.

**The page:** `/search` (`src/app/(frontend)/sites/[hostname]/[locale]/search/page.tsx`), rendered per
request because it reads the query, and `noindex, follow`. `search` is a reserved top-level slug
(`src/lib/slug.ts`).

- **The request:** `parseSearchParams` (`src/lib/search.ts`, pure) reads `q`, `scope` and `page`
  (at most 100). Anything unreadable falls back to the default. The default scope is the
  site's own: a school searches **itself**, the district site **everything**.
  `searchHref` builds the addresses, naming the scope only when it isn't the default and the page
  only after the first.
- **The layout:**
  - `h1` "Search";
  - the page's own `SearchForm`: a visible label ("Search {site}" or "Search all DD2 sites"), a
    landmark named "Search again", the words kept, and a hidden `scope` when it isn't the
    default;
  - with no words: a hint, "Type a word or two…";
  - otherwise "N results for “q” on {site}" (or "across all DD2 sites"), with a link to the
    other scope that keeps the words: "Search all DD2 sites" or "Search only {site}";
  - the results;
  - Previous/Next pagination in a `nav` named "Search result pages", with "Page n of m".
- **`SearchResults`** (`src/components/SearchResults/`): an `<ol>` numbered from the page's
  first result (`start`), so 11 follows 10. Each result has:
  - a line saying what it is, in words: Page, Announcement, Event or Document, a document's
    type and size, and another site's name;
  - its title as an `h2`, linking to it. An event without a calendar page has no link;
  - an event's time and place;
  - the snippet, with matches in `<mark>` as text, never HTML.
- **Site names** are what the site's own pages call it: its settings' `siteTitle`, else the
  tenant's name. `searchSite` reads them with the results.
- **The highlight** is a token, `--color-highlight` (#fff2a8), with `--color-text` on it as a
  checked pair (`REQUIRED_CONTRAST_PAIRS`, about 16:1).

### Files

| File                                                   | Does                                             |
| ------------------------------------------------------ | ------------------------------------------------ |
| `src/components/SearchForm/`                           | the box: component, CSS, stories                 |
| `src/components/SearchResults/`                        | the list: component, CSS, stories                |
| `src/components/SiteHeader/SiteHeader.tsx`             | the box in every header                          |
| `src/app/(frontend)/sites/[hostname]/[locale]/search/` | the page and its CSS                             |
| `src/lib/search.ts`                                    | `SEARCH_PATH`, `parseSearchParams`, `searchHref` |
| `src/lib/slug.ts`                                      | `search` reserved at the top                     |
| `src/content/search.ts`                                | site names from settings                         |
| `src/styles/tokens.css`, `src/lib/contrast.ts`         | `--color-highlight` and its pair                 |

### Tests

- `tests/unit/lib/search.test.ts`: addresses (scope and page named only when needed, the locale
  prefix) and reading them back (defaults, junk, the page cap)
- `tests/unit/slug.test.ts`: `search` reserved
- `tests/unit/components/search.test.tsx`: the form keeps the words and scope; the results'
  numbering, linked headings, marks as text, kind/file/site in words, and an event without a link
- `tests/unit/components/site-chrome.test.tsx`: the header's named search landmark, sending to
  `/search` or `/es/search`
- `tests/e2e/site-search.spec.ts`:
  - from the header box to the results, this site only (its page and document, not School
    A's), then every site (labelled), with axe in both themes;
  - nothing found offers every site, and no words shows the hint, with both landmarks named apart;
  - the results page in Arabic (RTL), with axe
- Storybook `Components/SearchForm` and `Components/SearchResults`: the component axe gate, LTR and RTL

## 10. Phase 6 exit check and close-out (2026-11-16)

### Files

| File                             | Holds                                                                                                                                                                                                                                                                                                                                                             |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tests/e2e/phase-6-exit.spec.ts` | (1) The REST API, over real HTTP, refuses an image with no alt, or blank alt, from the district **and** from a school; alt or "decorative" passes. (2) One search journey: a school publishes; its own site's search finds it; another school's doesn't; every-site search does, labelled with its site; axe on each results page. Timed as `publish-to-findable` |

Measured locally: **publish-to-findable 328–355 ms** over three runs. That's the time from
publish to the page appearing in its site's results.

### Exit criterion (`05`)

| Clause                                                                                             | Where it is proven                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| -------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **An image cannot be uploaded without alt or a decorative flag**                                   | **The rule, every route:** `resources.test.ts`. It is refused even with access overridden, and removing alt later is refused too; field validation and a `beforeValidate` hook ask the same `resourceProblems` (CLAUDE.md rule 7). **The REST API:** `phase-6-exit.spec.ts`, for the district and a school. **The district's Files form:** `resources.spec.ts`. **The school's "Upload a file":** `school-upload.spec.ts`                                                                 |
| ~~A staff-visibility document is invisible to the public and visible to a signed-in staff member~~ | **Moved to the Entra switch** (Jason, 2026-11-13): only school managers have accounts until then. Before the Phase 9 pilot                                                                                                                                                                                                                                                                                                                                                                |
| **Search returns scoped, accessible results**                                                      | **Scoped:** `search.test.ts`. This site never returns another site's content, and every site does, labelled; drafts, staff-only, hidden pages and images are never found; shared announcements reach only their sites. `tenant-isolation.test.ts`: nobody reads the index through Payload's access. **Accessible:** `site-search.spec.ts` (axe in both themes and in Arabic RTL); the Storybook gate (`SearchForm`, `SearchResults`, LTR and RTL). **End to end:** `phase-6-exit.spec.ts` |

The roadmap's other Phase 6 bullets:

| Item                               | Proof                                                                                                                                      |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| The Resources library, derivatives | `resources.test.ts` (400/800/1600 webp sizes). §1                                                                                          |
| R2                                 | Wired through `@payloadcms/storage-s3` when `R2_*` is set; local disk otherwise. **Not exercised against a real bucket** (carried forward) |
| Remediation attestation            | `resources.test.ts` (required; who and when recorded). Two answers since 2026-11-16 (§7)                                                   |
| The `not-attested` work queue      | `dashboard.test.ts` (unit and integration), `district-dashboard.spec.ts`. §6                                                               |
| No validation pipeline (`01` §4.4) | None built; the attestation records the status                                                                                             |
| pgvector left switchable           | Nothing in the index or query prevents it; ADR-14 unchanged                                                                                |

### Definition of done (`05`)

| Item                                        | State                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Types; unit, integration, e2e               | Green on 2026-11-16: typecheck and lint clean; unit 1949, integration 540, e2e **353/353** on a fresh database, no flakes; Storybook gate green; `pnpm audit --audit-level high` clean                                                                                                                                                                                                                                |
| Zero critical/serious axe, public and admin | **Component gate**, LTR and RTL: Image, Hero, Document list, NewsList thumbnails, SearchForm, SearchResults. **Whole-screen admin**, both themes: the Files list and form, uploading, a page with a hero, an image and a document list, a post with an image, the dashboard with "Documents to check", the school's "Upload a file". **Public**, both themes: images, a hero, a post's image, a document list, search |
| RTL for new layout                          | The component gate's RTL pass; Arabic search results in e2e. All CSS uses logical properties only (stylelint)                                                                                                                                                                                                                                                                                                         |
| Isolation tests                             | Green. Extended to the library (A1), and to the search index, which nobody reads through Payload's access                                                                                                                                                                                                                                                                                                             |
| New surfaces against `07`                   | Automated axe; labelled native controls (the upload form, the search box); link text that names a document's type and size; `<mark>` as text. The screen-reader smoke test is a manual release check, not yet run                                                                                                                                                                                                     |
| Content-access boundary lint                | Green. Search and the library are read through `src/content/`                                                                                                                                                                                                                                                                                                                                                         |
| ADRs and docs                               | ADR-14 as built (`05` note); CLAUDE.md's plugin list (`plugin-search`); `03`, `04`, `07` updated where Phase 6 changed them; this document §1–§10; CLAUDE.md status                                                                                                                                                                                                                                                   |
| Add-on register (`01` §4.4)                 | Reviewed 2026-11-16: none requested, none dead                                                                                                                                                                                                                                                                                                                                                                        |
| Migration mapper stub per slice             | **Deferred (Jason, 2026-11-16)**, as Phase 5's were (2026-11-13): built once a real Finalsite export is captured (`10` §2), since a stub would map an invented shape of Finalsite's Resources                                                                                                                                                                                                                         |
| Behind preview until acceptance             | Nothing is deployed; applies from the pilot (Phase 9)                                                                                                                                                                                                                                                                                                                                                                 |
| Dependency audit                            | Green at `--audit-level high` since #105                                                                                                                                                                                                                                                                                                                                                                              |

### Carried forward

| Item                                                                                                          | Where it lands / who decides                                                                      |
| ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| **Staff-only visibility** on pages and documents                                                              | The Entra switch, before the Phase 9 pilot                                                        |
| **Replace a file** with one of the same kind, keeping its place (Jason, 2026-11-16)                           | **Built** after the close: §11                                                                    |
| **R2 against a real bucket**                                                                                  | Hosting work (`09` §1)                                                                            |
| **A GIN index** on the weighted search vector                                                                 | Phase 8 hardening, when migrations start (§8)                                                     |
| **Search UI words**, and stemming beyond English                                                              | Phase 7 (`08`): the results page's labels are English; the index uses the `english` configuration |
| An event's search link is the **first** page, by path, showing its calendar                                   | As built; revisit if a school has several calendar pages                                          |
| The other two **work queues** in `04` §3.1 item 5 (bulk-decorative images, translation verification)          | Not built; translation verification with Phase 7                                                  |
| **The feed calendar's admin form (dark)** still flakes under full-suite load, despite one calendar per scheme | Test fix, separately                                                                              |
| **The dev server rewrites `importMap.js`** mid-branch switch (twice on 2026-11-16)                            | Check `git status` before each commit; restore from main                                          |
| Migration mapper for library files                                                                            | See the definition of done above                                                                  |
| Screen-reader smoke test of the new screens                                                                   | Manual release check; Phase 8 AT audit                                                            |
| Earlier phases' open items (`05` §41, `04` §19)                                                               | Unchanged unless noted above                                                                      |

## 11. Replace a file (Jason, 2026-11-16)

A file in the library can be replaced by a **new file of the same kind**: an image for an image,
a document for a document. It keeps its library entry, so every Image and Hero section,
announcement image, Document list and search entry using it shows the new file, with no page
edits. That's how an updated lunch menu or form goes up. Jason's decisions:

- an image's **description is asked again**;
- a document is **marked not checked**;
- schools replace their own files with **no approval**;
- the school plane has a **"Replace a file"** task.

**The rules (`src/collections/Resources.ts`, on every route).** A replacement is an update that
carries a new file (`req.file`).

- **`checkFile`** (beforeValidate) also asks `replacementProblems(old, new)`
  (`src/lib/resources.ts`, pure). A different kind is refused at the file: "Replace an image with
  an image, or a document with a document." This holds even with access overridden. The usual
  rules still apply to the result: an image's description can't be emptied as it's replaced.
- **`settle`** (beforeChange): a replaced **document** gets `remediationStatus: not-attested`,
  and `attestedBy`/`attestedAt` are cleared. This is unconditional, since Payload's form re-sends
  the old answer. The document joins "Documents to check" (§6).
- **Payload's own update** keeps the id, makes the new sizes and **deletes the old file and its
  sizes** (`deleteAssociatedFiles`). The new file has a new name, so **its address changes**.
  Links on our pages follow by themselves; a link to the old file pasted elsewhere, like an
  email, stops working.
- **The activity log** (`forResource` in `src/lib/audit.ts`): a change of filename reads
  "Replaced the file: old.pdf → new.pdf".
- **The search entry** follows: the plugin re-syncs on save.

**Refreshing the pages (`revalidateFile`).** Because the old file is deleted, a cached page would
show a broken image or link. `makeRevalidateFile`
(`src/collections/hooks/revalidate-on-publish.ts`) runs after **every** change to a file and
after its deletion: replacement, description, title. It refreshes `fileRevalidationTargets`
(pure):

- the file's own site, where its Image, Hero and Document list sections live;
- every site listing an announcement that uses it as its `heroImage`
  (`syndicationTargets`), so shared thumbnails follow.

It never fails the write. This also fixes an older gap: an edited description used to wait for
the hourly refresh.

**The school's task: "Replace a file"** (`/admin/replace-file`; `ReplaceFileView`,
`ReplaceFileForm`, `replace-file.ts`).

1. **Which file:** the school's files by title, each with its kind, size and folder, read as the
   user (`listMyFiles` in `school-data.ts`).
2. **The form** (`?file=<id>`, `getMyFile`; another school's id reads as not found):
   - "Now": a thumbnail for an image, the type and size, and a link to open it;
   - "The new file": the picker offers only that kind's types (`mimeTypesFor`);
   - **an image:** "Describe the new image", **prefilled** with the current description, with
     the decorative checkbox. Sending it is the confirmation;
   - **a document:** "The new document will be marked not checked for accessibility until
     someone checks it."
   - `checkReplace` (pure) gives the form's messages in the library's own words. It sends
     `PATCH /api/resources/<id>` as multipart. On success: "Replaced “…”. Pages using it show the
     new file."
3. **A file's own page:** "Replace this file" (`ReplaceFileLink`, in `beforeDocumentControls`)
   opens the form for that file, for a school and for the district.

**The district uses the same form** (Jason, 2026-11-16, "option 2"), from a file's own page, so
it gets the prefilled description and the not-checked note too. Only the form: a district admin
at `/admin/replace-file` without `?file` goes to the Files list, since a list of every school's
files is no use to them. The form's way back is "Back to the file", and an unknown id reads
"That file isn't in the library." Payload's own form still replaces a file as well, under the
same server rules.

### Files

| File                                                                                  | Does                                                              |
| ------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| `src/lib/resources.ts`                                                                | `replacementProblems`, `mimeTypesFor`                             |
| `src/collections/Resources.ts`                                                        | the kind rule, the document's reset, the refresh hooks, the link  |
| `src/collections/hooks/revalidate-on-publish.ts`                                      | `fileRevalidationTargets`, `makeRevalidateFile`, `revalidateFile` |
| `src/lib/audit.ts`                                                                    | "Replaced the file: old → new"                                    |
| `src/admin/SchoolPlane/replace-file.ts`, `ReplaceFileView.tsx`, `ReplaceFileForm.tsx` | the task                                                          |
| `src/admin/SchoolPlane/school-data.ts`, `school-plane.ts`                             | `listMyFiles`, `getMyFile`; the task in the list                  |
| `src/admin/Resources/ReplaceFileLink.tsx`                                             | "Replace this file" on a file's page                              |

### Tests

- **Unit:**
  - `lib/resources.test.ts`: the kind rule;
  - `admin/replace-file.test.ts`: the form's checks;
  - `access/revalidate-on-publish.test.ts`: the targets, and the hook refreshing each site once
    without ever failing the write;
  - `lib/audit.test.ts`: the log's wording;
  - `admin/school-plane.test.ts`: the task.
- **Integration, `resources.test.ts`:**
  - the same id, new sizes, the old file gone;
  - a document reset even when the old answer is re-sent;
  - the other kind refused with access overridden;
  - a description can't be emptied;
  - a school replaces its own file, not another's;
  - the log and the search entry follow.
- **Isolation suite:** a school can't put a new file in another school's place.
- **E2E, `replace-file.spec.ts`:**
  - from the start screen to the list and the prefilled form, replacing an image; the public page
    shows the new image and description within seconds; axe on both screens in both themes;
  - a document marked not checked;
  - the other kind refused at the file;
  - the file page's link.

## 12. Where a file is used (Jason, 2026-11-17)

A file's sidebar lists the **published** pages and announcements that show it, on both planes, so
an editor sees what a replace or a delete affects. Jason's decisions: published only, no drafts;
a school also sees the other sites a shared announcement reaches.

**Worked out, never stored.** A library file can be used only by its own site's pages and
announcements: `libraryImageField` offers only this site's images and checks it on save. So the
uses are a function of that site's rows, read when the file's page opens. There's no reference
table, no migration and no hook to keep in step.

**The rule: `findFileUses` (`src/lib/file-uses.ts`, pure).** It's given the file, the site's
published pages and announcements, and the pages on other sites that reuse one of them. It returns:

- **pages**, A–Z, each with its address (`pathIndex` from `src/content/page-tree.ts`; null under
  an unpublished parent), how it uses the file (`Hero`, `Image`, `Document list`) and whether it's
  staff only. It walks `layout` and every Columns column's `content`:
  - an Image or Hero section whose `image` is the file;
  - for a **document** only, a Document list whose `folder` is the file's folder (the list shows
    the whole folder). An image is never "used" by a list.
- **announcements**, A–Z, whose `heroImage` is the file, each with **alsoOn**: the other sites it
  reaches by name (`syndicationTargets`, so "district-wide" is every other site).
- **linked**: a page on another site with `linkMode: 'reuse'` whose `districtLinkTarget` is one of
  those pages. A district file shows on a school site this way.

Not found, because it isn't stored as a reference: a file's address typed into text as a link. Rich
text links only to pages (`src/lib/editor.ts`).

`usesSummary` gives one line: "Used on 3 pages and 1 announcement." / "Not used on any published
page or announcement." Linked pages count as pages.

**The queries: `getFileUses` (`src/admin/Resources/file-uses-data.ts`).**

1. The file is read **as the user** (`overrideAccess: false`). A file the user can't see, such as
   another school's, gives null, as `getMyFile` does.
2. Then, with access overridden and **scoped to the file's own tenant**: its published pages
   (`title, slug, parent, visibility, layout`), and its published announcements with `heroImage =
file`. Tenant names come from `tenants`.
3. Only if a page uses the file: the published `reuse` pages on other sites pointing at one.

Every read filters `_status: published`. The main tables hold the published version, and a newer
draft lives only in the versions table, so a draft that adds or drops the file changes nothing
until it's published.

**Where it shows.**

- **`UsedOnField`**: a `ui` field in the Files sidebar (`usedOn` in `src/collections/Resources.ts`),
  a server component given `req` and `id`. "Where it's used", with Pages, Shown on other sites and
  Announcements, each linking to its editor. Nothing on a new file's screen.
- **The replace form**: under "Now", the `usesSummary` line (`#replace-used-on`), read by
  `ReplaceFileView`. It refreshes with the view after a replace.

**Tests.** `tests/unit/lib/file-uses.test.ts` (the rule), `tests/integration/file-uses.test.ts`
(published only, including a newer draft either way; Columns; a document via its folder; a shared
announcement's sites; a reuse page; a school can't read another school's file's uses), and
`tests/e2e/file-uses.spec.ts` (the panel for a school and the district, axe in both themes, and
the replace form's line). Whole-screen axe already opens a file's page.
