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

## LibreHardwareMonitor

Windows packages include a small ToolDock hardware-monitor sidecar that uses
the unmodified `LibreHardwareMonitorLib` NuGet package to read optional CPU
temperature and fan sensors.

- Package: `LibreHardwareMonitorLib`
- Package version: `0.9.6`
- Upstream project: <https://github.com/LibreHardwareMonitor/LibreHardwareMonitor>
- Package source: <https://www.nuget.org/packages/LibreHardwareMonitorLib/0.9.6>
- License: Mozilla Public License 2.0

LibreHardwareMonitor remains licensed under the Mozilla Public License 2.0.
The corresponding upstream source and license are available from the links
above. ToolDock does not modify the LibreHardwareMonitor source code.

## PawnIO

Windows packages redistribute the unmodified official PawnIO installer.
LibreHardwareMonitor uses its signed kernel driver to access CPU and
motherboard sensor registers. ToolDock installs the standard edition only.

- Package: `PawnIO_setup.exe`
- Package version: `2.2.0`
- Upstream project: <https://pawnio.eu/>
- Official releases: <https://github.com/namazso/PawnIO.Setup/releases/tag/2.2.0>
- SHA-256: `1f519a22e47187f70a1379a48ca604981c4fcf694f4e65b734aaa74a9fba3032`

The PawnIO installer states that it may be redistributed unmodified. The
installer and driver retain their upstream terms and warranty disclaimer.
ToolDock verifies the pinned SHA-256 digest before every Windows package build.
