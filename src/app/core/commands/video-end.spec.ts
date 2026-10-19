import { produce } from 'immer';
import { createCue, createProject } from '../model/defaults';
import { Project } from '../model/types';
import { keepInVideo } from './video-end';

function project(videoMs: number | null): Project {
	const p = createProject();
	p.tracks[0].cues = [{ ...createCue(1000, 3000, 'hi'), id: 'a' }];

	if (videoMs !== null)
		p.media = { path: 'v.mp4', hash: '', durationMs: videoMs, width: 1, height: 1 };

	return p;
}

/** Apply `edit` the way ProjectStore.apply does */
const edit = (before: Project, change: (p: Project) => void) =>
	produce(before, (p) => {
		change(p as Project);
		keepInVideo(before, p);
	});

describe('keepInVideo', () => {
	it('stops a cue end at the end of the video', () => {
		const after = edit(project(5000), (p) => (p.tracks[0].cues[0].end = 8000));

		expect(after.tracks[0].cues[0].end).toBe(5000);
	});

	it('allows edits inside the video', () => {
		const after = edit(project(5000), (p) => (p.tracks[0].cues[0].end = 4000));

		expect(after.tracks[0].cues[0].end).toBe(4000);
	});

	it('limits new cues too', () => {
		const after = edit(project(5000), (p) =>
			p.tracks[0].cues.push({ ...createCue(4000, 7000, 'new'), id: 'b' }),
		);

		expect(after.tracks[0].cues[1].end).toBe(5000);
	});

	it("doesn't extend a cue that already ran past the end, but leaves it there", () => {
		// Captions made first, then a shorter video linked
		const long = edit(project(null), (p) => (p.tracks[0].cues[0].end = 8000));
		const before = produce(long, (p) => {
			p.media = { path: 'v.mp4', hash: '', durationMs: 5000, width: 1, height: 1 };
		});

		const longer = edit(before, (p) => (p.tracks[0].cues[0].end = 9000));
		const unchanged = edit(before, (p) => (p.tracks[0].cues[0].start = 1500));

		expect(longer.tracks[0].cues[0].end).toBe(8000);
		expect(unchanged.tracks[0].cues[0].end).toBe(8000);
	});

	it('has no limit without a video', () => {
		const after = edit(project(null), (p) => (p.tracks[0].cues[0].end = 99000));

		expect(after.tracks[0].cues[0].end).toBe(99000);
	});
});
