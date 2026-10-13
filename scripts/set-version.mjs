// Sets the app version everywhere it's stored
import { readFileSync, writeFileSync } from 'node:fs';

const version = process.argv[2];

if (!/^\d+\.\d+\.\d+$/.test(version ?? '')) {
	console.error('Usage: set-version <major.minor.patch>, e.g. set-version 0.9.1');
	process.exit(1);
}

/** Replaces the first match of each pattern */
function edit(file, ...patterns) {
	let text = readFileSync(file, 'utf8');

	for (const re of patterns) {
		if (!re.test(text)) throw new Error(`No version found in ${file} (${re})`);

		text = text.replace(re, (_, before) => `${before}${version}"`);
	}

	writeFileSync(file, text);
	console.log(`  ${file}`);
}

const json = /("version":\s*")[^"]*"/;

console.log(`Setting version to ${version}:`);
edit('package.json', json);
// The top-level version and the root package's entry under "packages"
edit('package-lock.json', json, /("packages":\s*\{\s*"":\s*\{[^}]*?"version":\s*")[^"]*"/);
edit('src-tauri/tauri.conf.json', json);
edit('src-tauri/Cargo.toml', /(\[package\][^[]*?\nversion\s*=\s*")[^"]*"/);
edit('src-tauri/Cargo.lock', /(\nname = "app"\nversion = ")[^"]*"/);
