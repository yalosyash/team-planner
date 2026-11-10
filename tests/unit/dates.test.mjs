import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { bindCalendar } from '../../app/js/core/calendar.js';
import {
  iso, todayISO, parseISO, addDays, diffDays, isWeekend, isWorkday,
  nextWorkday, workdaysBetween, addWorkdays, fmt, eachDay,
} from '../../app/js/core/dates.js';

beforeEach(() => bindCalendar(() => ({})));
afterEach(() => {
  bindCalendar(() => ({}));
  vi.useRealTimers();
});

// QA-DATE-001: local YYYY-MM-DD representation and civil date boundaries.
describe('QA-DATE-001: local dates in Europe/Moscow', () => {
  test('fixed timezone and local midnight roundtrip', () => {
    expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe('Europe/Moscow');
    const date = parseISO('2026-11-16');
    expect([date.getFullYear(), date.getMonth(), date.getDate(), date.getHours()])
      .toEqual([2026, 10, 16, 0]);
    expect(iso(date)).toBe('2026-11-16');
    expect(iso(new Date('2026-12-31T21:30:00Z'))).toBe('2027-01-01');
  });
  test('today follows the local date across UTC midnight boundary', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-12-31T20:59:59Z'));
    expect(todayISO()).toBe('2026-12-31');
    vi.setSystemTime(new Date('2026-12-31T21:00:00Z'));
    expect(todayISO()).toBe('2027-01-01');
  });
  test.each([
    ['2026-01-31', 1, '2026-02-01'],
    ['2026-03-01', -1, '2026-02-28'],
    ['2024-02-28', 1, '2024-02-29'],
    ['2024-02-29', 1, '2024-03-01'],
    ['2000-02-28', 2, '2000-03-01'],
    ['2100-02-28', 1, '2100-03-01'],
    ['2026-12-31', 1, '2027-01-01'],
    ['2027-01-01', -1, '2026-12-31'],
    ['2026-11-16', 0, '2026-11-16'],
  ])('addDays(%s, %s) = %s', (from, count, expected) => {
    expect(addDays(from, count)).toBe(expected);
    expect(diffDays(from, expected)).toBe(count);
    expect(diffDays(expected, from)).toBe(count === 0 ? 0 : -count);
  });
  test.each([
    ['2024-02-28', '2024-03-01', ['2024-02-28', '2024-02-29', '2024-03-01']],
    ['2026-12-31', '2027-01-02', ['2026-12-31', '2027-01-01', '2027-01-02']],
    ['2026-11-16', '2026-11-16', ['2026-11-16']],
    ['2026-11-17', '2026-11-16', []],
  ])('inclusive eachDay(%s, %s)', (from, to, expected) => {
    expect(eachDay(from, to)).toEqual(expected);
  });
  test('board labels preserve leading zeros', () => {
    expect(fmt('2026-01-02')).toBe('02.01');
    expect(fmt('2024-02-29')).toBe('29.02');
  });
});

// BR-CALENDAR-001: fallback Mon–Fri, inclusive release range.
describe('QA-DATE-002: fallback workdays', () => {
  test.each([
    ['2026-11-16', false], ['2026-11-17', false], ['2026-11-18', false],
    ['2026-11-19', false], ['2026-11-20', false],
    ['2026-11-21', true], ['2026-11-22', true],
  ])('%s weekend=%s', (day, weekend) => {
    expect(isWeekend(day)).toBe(weekend);
    expect(isWorkday(day)).toBe(!weekend);
  });
  test.each([
    ['2026-11-16', '2026-11-20', 5],
    ['2026-11-20', '2026-11-23', 2],
    ['2026-11-21', '2026-11-22', 0],
    ['2026-11-16', '2026-11-16', 1],
    ['2026-11-21', '2026-11-21', 0],
    ['2026-11-20', '2026-11-16', 0],
    ['2024-02-28', '2024-03-01', 3],
    ['2026-12-31', '2027-01-04', 3],
  ])('workdaysBetween(%s, %s) = %s', (from, to, expected) => {
    expect(workdaysBetween(from, to)).toBe(expected);
  });
  test('next workday includes the starting day', () => {
    expect(nextWorkday('2026-11-20')).toBe('2026-11-20');
    expect(nextWorkday('2026-11-21')).toBe('2026-11-23');
    expect(nextWorkday('2026-11-22')).toBe('2026-11-23');
  });
  test('workday offsets start at the first eligible day (offset zero)', () => {
    expect(addWorkdays('2026-11-20', 0)).toBe('2026-11-20');
    expect(addWorkdays('2026-11-20', 1)).toBe('2026-11-23');
    expect(addWorkdays('2026-11-21', 0)).toBe('2026-11-23');
    expect(addWorkdays('2026-12-31', 2)).toBe('2027-01-04');
  });
});

// BR-CALENDAR-001 / EX-08: artificial calendar, not Russian holiday data.
describe('QA-DATE-003: loaded calendar overrides and per-year fallback', () => {
  function syntheticCalendar() {
    // All days working, except Nov 20 (index 323); Nov 21 is shortened.
    const days = Array(365).fill('0');
    days[323] = '1';
    days[324] = '2';
    bindCalendar(() => ({ years: { 2026: { days: days.join('') } } }));
  }
  test('holiday Friday and working shortened Saturday', () => {
    syntheticCalendar();
    expect(isWorkday('2026-11-20')).toBe(false);
    expect(isWeekend('2026-11-21')).toBe(true);
    expect(isWorkday('2026-11-21')).toBe(true);
    expect(nextWorkday('2026-11-20')).toBe('2026-11-21');
    expect(workdaysBetween('2026-11-20', '2026-11-21')).toBe(1);
    expect(addWorkdays('2026-11-19', 1)).toBe('2026-11-21');
  });
  test('year boundary uses loaded year and fallback independently', () => {
    syntheticCalendar();
    expect(workdaysBetween('2026-12-31', '2027-01-04')).toBe(3);
    expect(isWorkday('2027-01-02')).toBe(false);
  });
  test('invalid loaded year falls back, rather than treating every day as working', () => {
    bindCalendar(() => ({ years: { 2026: { days: '0' } } }));
    expect(isWorkday('2026-11-21')).toBe(false);
    expect(workdaysBetween('2026-11-16', '2026-11-22')).toBe(5);
  });
});
