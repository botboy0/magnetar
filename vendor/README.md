# Vendored dependencies

Third-party libraries committed directly to the repo to avoid runtime CDN dependencies and pin exact versions.

## anime.js

- File: `anime.umd.min.js`
- Version: 4.3.6
- Source: https://unpkg.com/animejs@4.3.6/dist/bundles/anime.umd.min.js
- License: MIT
- Used by: the Navigator top-strip component, to drive the open/close unfurl animation (max-height, item bloom, plasma border flare, chevron rotation). The sequence is coordinated enough that CSS can't express it cleanly.

### Updating

    curl -o vendor/anime.umd.min.js https://unpkg.com/animejs@<version>/dist/bundles/anime.umd.min.js

Bump the version above to match.