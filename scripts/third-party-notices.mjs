// Writes src-tauri/licenses/THIRD-PARTY-NOTICES.txt, containing the license texts of every Rust crate compiled into the app, plus the npm packages Angular bundles

import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const tauriDir = join(root, 'src-tauri');
const out = join(tauriDir, 'licenses', 'THIRD-PARTY-NOTICES.txt');
const npmNotices = join(root, 'dist', 'bytecaptions', '3rdpartylicenses.txt');
const LICENSE_FILE = /^(licen[cs]e|copying|notice|unlicense)/i;
const RULE = '-'.repeat(80);

const run = (cmd, args) =>
	execFileSync(cmd, args, { cwd: tauriDir, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });

// Tauri sets this for its build hooks; otherwise use the host's
const target =
	process.env.TAURI_ENV_TARGET_TRIPLE ?? /^host: (.+)$/m.exec(run('rustc', ['-vV']))[1];

// Crates compiled into the app
const used = new Set(
	run('cargo', ['tree', '-e', 'normal', '--target', target, '--prefix', 'none', '-f', '{p}'])
		.split('\n')
		.map((line) => /^(\S+) v(\S+)/.exec(line))
		.filter(Boolean)
		.map(([, name, version]) => `${name}@${version}`),
);

const metadata = JSON.parse(run('cargo', ['metadata', '--format-version', '1']));
const crates = metadata.packages
	.filter((p) => used.has(`${p.name}@${p.version}`) && !metadata.workspace_members.includes(p.id))
	.sort((a, b) => a.name.localeCompare(b.name));

/** License texts, each with the crates that ship that exact text */
const texts = new Map();
const missing = [];

const addText = (text, who) => {
	const key = text.replace(/\r\n?/g, '\n').trim();
	texts.set(key, [...(texts.get(key) ?? []), who]);
};

for (const p of crates) {
	const dir = dirname(p.manifest_path);
	const who = `${p.name} ${p.version} (${p.license ?? 'see license'})`;
	const files = readdirSync(dir).filter((f) => LICENSE_FILE.test(f));

	if (!files.length) missing.push(`${who}${p.repository ? ` - ${p.repository}` : ''}`);

	for (const f of files) addText(readFileSync(join(dir, f), 'utf8'), who);

	// whisper-rs-sys compiles in whisper.cpp and ggml, which have their own license
	const bundled = join(dir, 'whisper.cpp', 'LICENSE');

	if (existsSync(bundled))
		addText(readFileSync(bundled, 'utf8'), `whisper.cpp / ggml (in ${p.name} ${p.version})`);
}

const sections = [
	'ByteCaptions third-party notices',
	'',
	'ByteCaptions is free software under the GNU GPL, version 3 or later (see BYTECAPTIONS-LICENSE.txt).',
	'It includes the open source software listed below, under the licenses that follow each list.',
	'ONNX Runtime, FFmpeg and the other bundled components have their own files next to this one.',
	'',
	RULE,
	`Rust crates (${crates.length}, built for ${target})`,
	RULE,
];

for (const [text, who] of texts) sections.push('', ...who, '', text, '', RULE);

if (missing.length)
	sections.push(
		'',
		'These crates publish no license file. They are used under the license listed (MIT or Apache-2.0 where there is a choice), whose full text is above:',
		'',
		...missing,
		'',
		RULE,
	);

sections.push('', 'npm packages in the app interface', RULE, '');

if (existsSync(npmNotices)) sections.push(readFileSync(npmNotices, 'utf8').trim());
else {
	console.warn('No frontend build yet (run `npm run build`); leaving out the npm notices.');
	sections.push('(Added in release builds.)');
}

writeFileSync(out, sections.join('\n') + '\n');
console.log(
	`Wrote ${out}: ${crates.length} crates, ${texts.size} license texts, ${missing.length} without a file.`,
);
