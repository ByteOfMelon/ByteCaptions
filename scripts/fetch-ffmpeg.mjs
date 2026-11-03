// Downloads the pinned ffmpeg build that ByteCaptions bundles as a Tauri sidecar, verifies it, and puts it where tauri.conf.json's externalBin expects it
//
// Licensing: The Windows and Linux builds are LGPL (src-tauri/licenses/FFMPEG-LICENSE.txt), the macOS ones GPLv3 (FFMPEG-MACOS.txt)

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
	// BtbN deletes daily autobuilds after ~2 weeks but keeps each month's last one, so pin a month-end build
	'win32-x64': {
		triple: 'x86_64-pc-windows-msvc',
		url: 'https://github.com/BtbN/FFmpeg-Builds/releases/download/autobuild-2026-10-31-12-59/ffmpeg-n8.1.3-27-g8dca1586f4-win64-lgpl-8.1.zip',
		zipSha256: 'd4c2a42673917b4a97104a3e9f082729a9730796b98664e37c0b7eba6c6c613d',
		member: 'ffmpeg-n8.1.3-27-g8dca1586f4-win64-lgpl-8.1/bin/ffmpeg.exe',
		exeSha256: '04d0c351e53dde1cc45ba437c28d20a0b382df2798999def5d4110e23d74e62c',
		ext: '.exe',
	},
	// Martin Riedl's static macOS builds (GPLv3, see licenses/FFMPEG-MACOS.txt)
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
		url: 'https://github.com/BtbN/FFmpeg-Builds/releases/download/autobuild-2026-10-31-12-59/ffmpeg-n8.1.3-27-g8dca1586f4-linux64-lgpl-8.1.tar.xz',
		zipSha256: 'a64f3171e6ad1f7d358d28890a907ee478c331d1177ec696a93418f79ac3f1f3',
		member: 'ffmpeg-n8.1.3-27-g8dca1586f4-linux64-lgpl-8.1/bin/ffmpeg',
		exeSha256: '09225778e63bb602f377cc9038d4556b5bd18b78d8bd5994a842ad5e262f72e3',
		ext: '',
	},
};

const tar =
	process.platform === 'win32' ? join(process.env.SystemRoot, 'System32', 'tar.exe') : 'tar';

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

// A build for another target than the machine's - npm run fetch:ffmpeg -- linux-x64
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
	execFileSync(tar, ['-xf', zipPath, '-C', work, build.member]);
	const exe = join(work, build.member);

	if (sha256(readFileSync(exe)) !== build.exeSha256)
		throw new Error('Extracted ffmpeg has the wrong checksum.');

	mkdirSync(dirname(target), { recursive: true });
	copyFileSync(exe, target);

	if (process.platform !== 'win32') chmodSync(target, 0o755);

	console.log(`ffmpeg ready: ${target}`);
} finally {
	rmSync(work, { recursive: true, force: true });
}
