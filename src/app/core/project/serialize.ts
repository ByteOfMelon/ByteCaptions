/** Project file (.bcproj) save/load with schema versioning. */
import { defaultSettings } from '../model/defaults';
import { Project, SCHEMA_VERSION } from '../model/types';

export const PROJECT_EXTENSION = 'bcproj';

export class ProjectFileError extends Error {}

type Migration = (raw: Record<string, unknown>) => Record<string, unknown>;

/**
 * migrations[n] upgrades a file from schema n to n + 1. Add an entry whenever SCHEMA_VERSION is bumped
 */
const migrations: Record<number, Migration> = {};

export function serializeProject(project: Project): string {
	return JSON.stringify({ ...project, schemaVersion: SCHEMA_VERSION });
}

export function parseProject(json: string): Project {
	let raw: Record<string, unknown>;

	try {
		raw = JSON.parse(json);
	} catch {
		throw new ProjectFileError('Project file is not valid JSON');
	}

	if (typeof raw !== 'object' || raw === null)
		throw new ProjectFileError('Project file is empty');

	let version = typeof raw['schemaVersion'] === 'number' ? raw['schemaVersion'] : 0;

	if (version > SCHEMA_VERSION) {
		throw new ProjectFileError(
			`This project was saved by a newer version of ByteCaptions (schema ${version}). Please update the app.`,
		);
	}

	while (version < SCHEMA_VERSION) {
		const m = migrations[version];

		if (!m) throw new ProjectFileError(`Cannot upgrade project from schema ${version}`);

		raw = m(raw);
		version++;
	}

	const p = raw as unknown as Project;

	if (
		!Array.isArray(p.tracks) ||
		typeof p.styles !== 'object' ||
		p.styles === null ||
		typeof p.positions !== 'object' ||
		p.positions === null
	) {
		throw new ProjectFileError('Project file is missing tracks, styles or positions');
	}

	// Fill settings and markers added later without needing a migration
	p.settings = { ...defaultSettings(), ...(p.settings ?? {}) };
	p.markers = Array.isArray(p.markers) ? p.markers.sort((a, b) => a.at - b.at) : [];

	for (const t of p.tracks) {
		if (typeof t !== 'object' || t === null)
			throw new ProjectFileError('Project file has a track that is not an object');

		if (!Array.isArray(t.cues))
			throw new ProjectFileError(`Track "${t.name}" has no cues array`);

		t.cues.sort((a, b) => a.start - b.start || a.end - b.end);
	}

	p.schemaVersion = SCHEMA_VERSION;

	return p;
}
