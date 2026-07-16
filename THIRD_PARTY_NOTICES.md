# ToolDock Third-Party Notices

ToolDock's original source code is released under the MIT License. The
following independently distributed executable keeps its own license.

## FFmpeg

ToolDock release packages include an FFmpeg command-line executable used for
screen-recording encoding.

- Package: `ffmpeg-static`
- Package version: `5.3.0`
- Binary release tag: `b6.1.1`
- Upstream project: <https://ffmpeg.org/>
- Packaging source: <https://github.com/eugeneware/ffmpeg-static/tree/5.3.0>
- Binary and build information: <https://github.com/eugeneware/ffmpeg-static/releases/tag/b6.1.1>
- FFmpeg source: <https://git.ffmpeg.org/ffmpeg.git>

The bundled builds contain GPL components, including x264 on supported
platforms, and are distributed under the GNU General Public License terms
provided with each platform package. ToolDock communicates with FFmpeg as a
separate command-line process and does not link FFmpeg libraries into the
ToolDock application.

The build-specific `LICENSE` and `README` files shipped beside the FFmpeg
sidecar identify the exact binary provider, enabled components, license, and
available source information. SHA-256 digests are pinned in
`scripts/prepare-ffmpeg-sidecar.mjs` and verified before each package build.

No warranty is provided for third-party software.
