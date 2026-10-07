# The releases page

`/releases` is public. It has three parts:

- **What's new:** the latest release.
- **Feature guide:** every feature, with how to use it and a link into the app.
- **All releases:** every release so far.

Everything on it comes from one data file, `apps/web/src/releases/content.ts`. The landing page links to it from its
menu and footer, and the app links to it from ⌘K → What's new.

## Adding a release

Add the release when you deploy it:

1. Add the release at the **top** of `RELEASES`:
   - the next version (`0.5`, `0.6`, …);
   - the deploy date (`YYYY-MM-DD`);
   - a short title and a one-paragraph summary;
   - its changes. Each change links to a guide entry where there is one (`guide: '<id>'`).
2. For each new feature, add a `GUIDE` entry with `since` set to the new version. That marks it New on the page.
   Each entry has:
   - what the feature does, in a sentence or two;
   - numbered steps that use the exact names in the app;
   - an `open` link to the page in the app.
3. For a feature that changed, update its steps.
4. Run `pnpm test`. The checks in `apps/web/src/releases/releases.test.tsx` keep the data consistent:
   - releases are newest first, and each version appears once;
   - every change links to a real guide entry;
   - every guide entry belongs to a release and an area;
   - every "Open" link is a real page in the app.

Write in plain, present-tense words about what works today. Nothing unbuilt goes on this page. Use examples from the
same business as the landing page (an online crystal shop).
