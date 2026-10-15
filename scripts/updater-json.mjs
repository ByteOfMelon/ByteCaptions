// Writes latest.json, the file the app's updater checks, from a release's update packages and their .sig files
// The release workflow runs this once after every platform is built (see .github/workflows/build.yml)

import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const [tag, dir, notesFile] = process.argv.slice(2);
const version = tag.replace(/^v/, '');
const base = `https://github.com/ByteOfMelon/ByteCaptions/releases/download/${tag}/`;

// Platform keys the updater asks for, and the package each one installs
const PACKAGES = [
	[/_aarch64\.app\.tar\.gz$/, ['darwin-aarch64', 'darwin-aarch64-app']],
	[/_x64\.app\.tar\.gz$/, ['darwin-x86_64', 'darwin-x86_64-app']],
	[/_x64-setup\.exe$/, ['windows-x86_64', 'windows-x86_64-nsis']],
	[/_x64_en-US\.msi$/, ['windows-x86_64-msi']],
	[/_amd64\.AppImage$/, ['linux-x86_64', 'linux-x86_64-appimage']],
	[/_amd64\.deb$/, ['linux-x86_64-deb']],
	[/\.x86_64\.rpm$/, ['linux-x86_64-rpm']],
];

const platforms = {};

for (const sig of readdirSync(dir).filter((f) => f.endsWith('.sig'))) {
	const file = sig.slice(0, -'.sig'.length);
	const keys = PACKAGES.find(([pattern]) => pattern.test(file))?.[1];

	if (!keys) continue;

	for (const key of keys)
		platforms[key] = {
			signature: readFileSync(join(dir, sig), 'utf8').trim(),
			url: base + file,
		};
}

const expected = PACKAGES.flatMap(([, keys]) => keys);
const missing = expected.filter((key) => !platforms[key]);

if (missing.length) {
	console.error(`No update package for: ${missing.join(', ')}`);
	process.exit(1);
}

writeFileSync(
	'latest.json',
	JSON.stringify(
		{
			version,
			notes: readFileSync(notesFile, 'utf8').trim(),
			pub_date: new Date().toISOString(),
			platforms,
		},
		null,
		2,
	) + '\n',
);
console.log(`Wrote latest.json for ${version}: ${Object.keys(platforms).length} platform entries`);
