// Downloads the pinned ffmpeg build that ByteCaptions bundles as a Tauri sidecar, verifies
// it, and puts it where tauri.conf.json's externalBin expects it. Skips the download when the
// right binary is already in place. Run with: npm run fetch:ffmpeg
//
// The Windows and Linux builds are LGPL (src-tauri/licenses/FFMPEG-LICENSE.txt), the macOS
// ones GPLv3 (FFMPEG-MACOS.txt). Old builds get deleted, so for releases, re-host the zips
// on our own GitHub release and point `url` there (the checksums don't change).

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import {
	chmodSync,
	copyFileSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const BUILDS = {
	'win32-x64': {
		triple: 'x86_64-pc-windows-msvc',
		url: 'https://github.com/BtbN/FFmpeg-Builds/releases/download/autobuild-2026-10-08-13-05/ffmpeg-n8.1.3-14-g330caae0c1-win64-lgpl-8.1.zip',
		zipSha256: '293bc44ded938a6900060b7d622dc330675fdec0f028f8b2ea6735c64be02b12',
		member: 'ffmpeg-n8.1.3-14-g330caae0c1-win64-lgpl-8.1/bin/ffmpeg.exe',
		exeSha256: '2818280f1325c966a81f13fcc7222070930fc8df1012bc017c755bed1c180b42',
		ext: '.exe',
	},
	// Martin Riedl's static macOS builds (GPLv3, see licenses/FFMPEG-MACOS.txt): BtbN has none.
	'darwin-arm64': {
		triple: 'aarch64-apple-darwin',
		url: 'https://ffmpeg.martin-riedl.de/download/macos/arm64/1789931890_9.0.2/ffmpeg.zip',
		zipSha256: 'c8ed4c4e6978a03c485edbfe4e0a5dc2380f8a30bba5150531b31b094492d924',
		member: 'ffmpeg',
		exeSha256: '2e11c6f90993cdb79fff84d3f90044d28316b310e75b3e030cfc9a54f2c9d384',
		ext: '',
	},
	'darwin-x64': {
		triple: 'x86_64-apple-darwin',
		url: 'https://ffmpeg.martin-riedl.de/download/macos/amd64/1789931006_9.0.2/ffmpeg.zip',
		zipSha256: '7c6b4125b191cbf773832dc51f424cf2b6bb7da43007d1e066f95909e47cacd4',
		member: 'ffmpeg',
		exeSha256: 'b25689cf2211c0582d317e849912769a1f1c93904fe102c485b5364a425633d1',
		ext: '',
	},
	'linux-x64': {
		triple: 'x86_64-unknown-linux-gnu',
		url: 'https://github.com/BtbN/FFmpeg-Builds/releases/download/autobuild-2026-10-08-13-05/ffmpeg-n8.1.3-14-g330caae0c1-linux64-lgpl-8.1.tar.xz',
		zipSha256: 'efc5f0db8b76a2b2dd0bc26feb5ffce38dc252af21fd60457ec6ece62797c930',
		member: 'ffmpeg-n8.1.3-14-g330caae0c1-linux64-lgpl-8.1/bin/ffmpeg',
		exeSha256: 'b64e072271e8e14f0c97a953e28ce2773a484cd5a4232019105681a98cadae73',
		ext: '',
	},
};

// Windows' own bsdtar reads zips; a GNU tar earlier on PATH (Git Bash) doesn't.
const tar =
	process.platform === 'win32' ? join(process.env.SystemRoot, 'System32', 'tar.exe') : 'tar';

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

// A build for another target than the machine's: npm run fetch:ffmpeg -- linux-x64
const key = process.argv[2] ?? `${process.platform}-${process.arch}`;
const build = BUILDS[key];
if (!build) {
	console.error(`No pinned ffmpeg build for ${key} yet; add one to scripts/fetch-ffmpeg.mjs.`);
	process.exit(1);
}

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const target = join(root, 'src-tauri', 'binaries', `ffmpeg-${build.triple}${build.ext}`);

if (existsSync(target) && sha256(readFileSync(target)) === build.exeSha256) {
	console.log(`ffmpeg already in place: ${target}`);
	process.exit(0);
}

console.log(`Downloading ${build.url}`);
const res = await fetch(build.url);
if (!res.ok) throw new Error(`Download failed: ${res.status} ${res.statusText}`);
const zip = Buffer.from(await res.arrayBuffer());
if (sha256(zip) !== build.zipSha256) throw new Error('Downloaded archive has the wrong checksum.');

const work = mkdtempSync(join(tmpdir(), 'bc-ffmpeg-'));
try {
	const zipPath = join(work, 'ffmpeg-archive');
	writeFileSync(zipPath, zip);
	// Extract just the one binary.
	execFileSync(tar, ['-xf', zipPath, '-C', work, build.member]);
	const exe = join(work, build.member);
	if (sha256(readFileSync(exe)) !== build.exeSha256)
		throw new Error('Extracted ffmpeg has the wrong checksum.');
	mkdirSync(dirname(target), { recursive: true });
	// Copy, not rename: the temp folder can be on another drive (as on CI).
	copyFileSync(exe, target);
	if (process.platform !== 'win32') chmodSync(target, 0o755);
	console.log(`ffmpeg ready: ${target}`);
} finally {
	rmSync(work, { recursive: true, force: true });
}
