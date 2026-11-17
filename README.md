Data and charts for the download graph in the main README, and the script that draws them.

`download-stats.mjs` is run daily by the `Download stats` workflow on `master`; nothing else belongs on this branch.

    node --test                              # the script's tests
    node download-stats.mjs update           # add today's total (needs GITHUB_TOKEN for the release list)
    node download-stats.mjs render           # redraw downloads-light.svg and downloads-dark.svg
