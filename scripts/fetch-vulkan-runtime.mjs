// Downloads the pinned Vulkan loader (vulkan-1.dll) that the Windows build bundles, verifies
// it, and puts it where tauri.windows.conf.json's resources expect it. Skips the download when
// the right file is already in place. Run with: npm run fetch:vulkan
//
// Transcription runs on the GPU through Vulkan. GPU drivers install the loader, so the app
// normally uses the system's copy; the bundled one is only loaded when a PC has none (no GPU
// driver, VMs), so whisper.cpp can find no GPU and fall back to the CPU instead of failing
// (src-tauri/src/gpu.rs). The loader is open source (src-tauri/licenses/VULKAN-RUNTIME-LICENSE.txt).

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	copyFileSync,
	rmSync,
	writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const URL =
	'https://sdk.lunarg.com/sdk/download/1.4.363.0/windows/VulkanRT-X64-1.4.363.0-Components.zip';
const ZIP_SHA256 = 'a25a927aa8b9f0371048f1861cf88ac3b9bc9b1fb332c42d897c8ab32695769a';
const MEMBER = 'VulkanRT-X64-1.4.363.0-Components/x64/vulkan-1.dll';
const DLL_SHA256 = 'e1fcfc9489beefa6a6d9d11d6c7517f6a2b7f16e0d3fb8f4103bee0210f314a3';

// Windows' own bsdtar reads zips; a GNU tar earlier on PATH (Git Bash) doesn't.
const tar =
	process.platform === 'win32' ? join(process.env.SystemRoot, 'System32', 'tar.exe') : 'tar';

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

if (process.platform !== 'win32') {
	console.log('The Vulkan loader is only bundled on Windows; nothing to do.');
	process.exit(0);
}

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const target = join(root, 'src-tauri', 'binaries', 'vulkan', 'vulkan-1.dll');

if (existsSync(target) && sha256(readFileSync(target)) === DLL_SHA256) {
	console.log(`Vulkan loader already in place: ${target}`);
	process.exit(0);
}

console.log(`Downloading ${URL}`);
const res = await fetch(URL);
if (!res.ok) throw new Error(`Download failed: ${res.status} ${res.statusText}`);
const zip = Buffer.from(await res.arrayBuffer());
if (sha256(zip) !== ZIP_SHA256) throw new Error('Downloaded zip has the wrong checksum.');

const work = mkdtempSync(join(tmpdir(), 'bc-vulkan-'));
try {
	const zipPath = join(work, 'vulkan.zip');
	writeFileSync(zipPath, zip);
	execFileSync(tar, ['-xf', zipPath, '-C', work, MEMBER]);
	const dll = join(work, MEMBER);
	if (sha256(readFileSync(dll)) !== DLL_SHA256)
		throw new Error('Extracted vulkan-1.dll has the wrong checksum.');
	mkdirSync(dirname(target), { recursive: true });
	// Copy, not rename: the temp folder can be on another drive (as on CI).
	copyFileSync(dll, target);
	console.log(`Vulkan loader ready: ${target}`);
} finally {
	rmSync(work, { recursive: true, force: true });
}
