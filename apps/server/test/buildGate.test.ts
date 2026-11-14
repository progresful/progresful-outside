import { describe, expect, it } from 'vitest';
import { createBuildGate } from '../src/jobs/buildGate';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const START = Date.UTC(2026, 10, 14, 12);

describe('createBuildGate', () => {
  it('lets a visitor start as many videos an hour as they are allowed, then says the allowance is spent', () => {
    const gate = createBuildGate({ perVisitorPerHour: 2, concurrent: 10, perDay: 100 });

    expect(gate.admit('203.0.113.7', START)).toBe('ok');
    expect(gate.admit('203.0.113.7', START + 1_000)).toBe('ok');
    expect(gate.admit('203.0.113.7', START + 2_000)).toBe('spent');
    expect(gate.admit('198.51.100.9', START + 2_000)).toBe('ok');
  });

  it('gives the allowance back as the hour passes', () => {
    const gate = createBuildGate({ perVisitorPerHour: 1, concurrent: 10, perDay: 100 });

    expect(gate.admit('203.0.113.7', START)).toBe('ok');
    expect(gate.admit('203.0.113.7', START + HOUR - 1)).toBe('spent');
    expect(gate.admit('203.0.113.7', START + HOUR + 1)).toBe('ok');
  });

  it('says busy while it is building as many as it builds at once, and frees a place when one is finished', () => {
    const gate = createBuildGate({ perVisitorPerHour: 10, concurrent: 2, perDay: 100 });

    expect(gate.admit('a', START)).toBe('ok');
    expect(gate.admit('b', START)).toBe('ok');
    expect(gate.admit('c', START)).toBe('busy');
    gate.release();
    expect(gate.admit('c', START)).toBe('ok');
  });

  it('stops once the budget for the day is used, and starts again a day later', () => {
    const gate = createBuildGate({ perVisitorPerHour: 10, concurrent: 10, perDay: 2 });

    expect(gate.admit('a', START)).toBe('ok');
    expect(gate.admit('b', START)).toBe('ok');
    expect(gate.admit('c', START + HOUR)).toBe('spent');
    expect(gate.admit('c', START + DAY + 1)).toBe('ok');
  });

  it('does not count a refusal against the visitor or the day', () => {
    const gate = createBuildGate({ perVisitorPerHour: 2, concurrent: 1, perDay: 2 });

    expect(gate.admit('a', START)).toBe('ok');
    expect([gate.admit('a', START), gate.admit('a', START), gate.admit('a', START)]).toEqual(['busy', 'busy', 'busy']);
    gate.release();
    expect(gate.admit('a', START)).toBe('ok');
  });

  it('never frees more places than were taken', () => {
    const gate = createBuildGate({ perVisitorPerHour: 10, concurrent: 1, perDay: 100 });

    gate.release();
    gate.release();
    expect(gate.admit('a', START)).toBe('ok');
    expect(gate.admit('b', START)).toBe('busy');
  });

  it('forgets a visitor once their hour has passed, so the list cannot grow without end', () => {
    const gate = createBuildGate({ perVisitorPerHour: 5, concurrent: 1_000, perDay: 10_000 });
    for (let visitor = 0; visitor < 50; visitor += 1) {
      gate.admit(`198.51.100.${visitor}`, START);
    }

    expect(gate.remembered()).toBe(50);
    gate.admit('203.0.113.7', START + HOUR + 1);
    expect(gate.remembered()).toBe(1);
  });
});
