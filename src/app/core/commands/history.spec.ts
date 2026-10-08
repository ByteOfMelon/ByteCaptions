import { createCue, createProject, createTrack } from '../model/defaults';
import { cueText } from '../model/cue';
import { Project } from '../model/types';
import * as edits from './edits';
import { History } from './history';

function setup() {
	const p = createProject();
	p.tracks[0].id = 't1';
	p.tracks[0].cues = [
		{ ...createCue(0, 1000, 'one two three four'), id: 'a' },
		{ ...createCue(2000, 3000, 'second'), id: 'b' },
	];
	return new History<Project>(p);
}

const cues = (h: History<Project>, t = 0) => h.current.tracks[t].cues;

describe('History', () => {
	it('undoes and redoes', () => {
		const h = setup();
		h.apply('Edit text', edits.setText('a', 'changed'));
		expect(cueText(cues(h)[0])).toBe('changed');
		expect(h.undoLabel).toBe('Edit text');
		h.undo();
		expect(cueText(cues(h)[0])).toBe('one two three four');
		h.redo();
		expect(cueText(cues(h)[0])).toBe('changed');
	});

	it('groups a drag into one undo step', () => {
		const h = setup();
		h.begin('Move');
		for (let i = 0; i < 10; i++) h.apply('Move', edits.moveCues(['b'], 10));
		h.end();
		expect(cues(h)[1].start).toBe(2100);
		h.undo();
		expect(cues(h)[1].start).toBe(2000);
		expect(h.canUndo).toBe(false);
	});

	it('clears redo after a new edit and keeps states immutable', () => {
		const h = setup();
		const before = h.current;
		h.apply('x', edits.setText('a', 'x'));
		h.undo();
		h.apply('y', edits.setText('a', 'y'));
		expect(h.canRedo).toBe(false);
		expect(cueText(before.tracks[0].cues[0])).toBe('one two three four');
	});

	it('ignores no-op edits', () => {
		const h = setup();
		h.apply('noop', edits.splitCue('a', 5000));
		expect(h.canUndo).toBe(false);
	});
});

describe('edits', () => {
	it('splits by time ratio at a word boundary', () => {
		const h = setup();
		h.apply('Split', edits.splitCue('a', 500));
		expect(cues(h).map((c) => [c.start, c.end, cueText(c)])).toEqual([
			[0, 500, 'one two'],
			[500, 1000, 'three four'],
			[2000, 3000, 'second'],
		]);
	});

	it('splits by word timing when available', () => {
		const h = setup();
		h.apply('words', (p) => {
			p.tracks[0].cues[0].words = [
				{ text: 'one', start: 0, end: 200 },
				{ text: 'two', start: 200, end: 300 },
				{ text: 'three', start: 300, end: 400 },
				{ text: 'four', start: 800, end: 1000 },
			];
		});
		h.apply('Split', edits.splitCue('a', 600));
		expect(cueText(cues(h)[0])).toBe('one two three');
		expect(cueText(cues(h)[1])).toBe('four');
		expect(cues(h)[1].words).toHaveLength(1);
	});

	it('merges cues on a track', () => {
		const h = setup();
		h.apply('Merge', edits.mergeCues(['b', 'a']));
		expect(cues(h)).toHaveLength(1);
		expect(cues(h)[0]).toMatchObject({ id: 'a', start: 0, end: 3000 });
		expect(cueText(cues(h)[0])).toBe('one two three four second');
	});

	it('moves across tracks, keeps order, clamps at zero', () => {
		const h = setup();
		const t2 = createTrack('Two');
		t2.id = 't2';
		h.apply('Add track', edits.addTrack(t2));
		h.apply('Move', edits.moveCues(['b'], -5000, 't2'));
		expect(cues(h, 0).map((c) => c.id)).toEqual(['a']);
		expect(cues(h, 1)[0]).toMatchObject({ id: 'b', start: 0, end: 1000 });
	});

	it('refuses to edit locked tracks', () => {
		const h = setup();
		h.apply('Lock', edits.updateTrack('t1', { locked: true }));
		expect(() => h.apply('Edit', edits.setText('a', 'x'))).toThrow(/locked/);
		h.apply('Delete', edits.deleteCues(['a']));
		expect(cues(h)).toHaveLength(2);
	});

	it('ripple deletes, closing the deleted time on that track only', () => {
		const h = setup();
		const t2 = createTrack('Two');
		t2.id = 't2';
		t2.cues = [{ ...createCue(2000, 2500, 'other'), id: 'x' }];
		h.apply('Add track', edits.addTrack(t2));
		h.apply('w', (p) => {
			p.tracks[0].cues[1].words = [{ text: 'second', start: 2000, end: 3000 }];
		});
		h.apply('Ripple', edits.rippleDeleteCues(['a']));
		expect(cues(h)).toMatchObject([{ id: 'b', start: 1000, end: 2000 }]);
		expect(cues(h)[0].words![0].start).toBe(1000);
		expect(cues(h, 1)[0]).toMatchObject({ start: 2000, end: 2500 });
	});

	it('shifts cues after a time', () => {
		const h = setup();
		h.apply('Shift', edits.shiftAfter(1500, 250));
		expect(cues(h).map((c) => c.start)).toEqual([0, 2250]);
	});

	it('trims without moving words, moves with words', () => {
		const h = setup();
		h.apply('w', (p) => {
			p.tracks[0].cues[0].words = [{ text: 'x', start: 100, end: 200 }];
		});
		h.apply('trim', edits.setTiming('a', 0, 800));
		expect(cues(h)[0].words![0].start).toBe(100);
		h.apply('move', edits.setTiming('a', 50, 850));
		expect(cues(h)[0].words![0].start).toBe(150);
	});
});
