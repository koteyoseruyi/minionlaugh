# MinionLaugh

MinionLaugh is a small, browser-based GIF recoloring tool. Preview a Minion animation, choose a palette color or enter a custom hex value, sample the original Minion color from the preview, adjust the color range, and download the recolored GIF.

**Try it:** [minionlaugh](https://koteyoseruyi.github.io/minionlaugh/)

## Run locally

Open `index.html` from a local web server. The GIF engine is loaded from the pinned `omggif` 1.0.10 release on jsDelivr, so an internet connection is needed when the page first opens. GIF uploads and recoloring happen locally in the browser; files are not sent to a server.

## Publish with GitHub Pages

Create a repository named `minionlaugh`, add these files to its root, then choose **Settings → Pages → Deploy from a branch → main → /(root)**.

## Credits

GIF decoding and encoding is provided by [omggif](https://github.com/deanm/omggif), copyright Dean McNamee, under the MIT License. See `OMGGIF-LICENSE.txt`.
