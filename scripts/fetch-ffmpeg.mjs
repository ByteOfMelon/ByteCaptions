// Downloads the pinned ffmpeg build that ByteCaptions bundles as a Tauri sidecar, verifies
// it, and puts it where tauri.conf.json's externalBin expects it. Skips the download when the
// right binary is already in place. Run with: npm run fetch:ffmpeg
//
// FFmpeg is LGPL-licensed (src-tauri/licenses/FFMPEG-LICENSE.txt). BtbN deletes old
// autobuilds after a while, so for releases consider re-hosting the zip as an asset on
// ByteCaptions' own GitHub release and pointing `url` there (the checksums stay the same).

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	renameSync,
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
	// macOS and Linux builds still to be chosen and pinned.
};

// Windows' own bsdtar reads zips; a GNU tar earlier on PATH (Git Bash) doesn't.
const tar =
	process.platform === 'win32' ? join(process.env.SystemRoot, 'System32', 'tar.exe') : 'tar';

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

const key = `${process.platform}-${process.arch}`;
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
if (sha256(zip) !== build.zipSha256) throw new Error('Downloaded zip has the wrong checksum.');

const work = mkdtempSync(join(tmpdir(), 'bc-ffmpeg-'));
try {
	const zipPath = join(work, 'ffmpeg.zip');
	writeFileSync(zipPath, zip);
	// Extract just the one binary.
	execFileSync(tar, ['-xf', zipPath, '-C', work, build.member]);
	const exe = join(work, build.member);
	if (sha256(readFileSync(exe)) !== build.exeSha256)
		throw new Error('Extracted ffmpeg has the wrong checksum.');
	mkdirSync(dirname(target), { recursive: true });
	renameSync(exe, target);
	console.log(`ffmpeg ready: ${target}`);
} finally {
	rmSync(work, { recursive: true, force: true });
}
