import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_EXAM_TIMEZONE,
  addMinutesToLocalDateTime,
  getDefaultExamScheduleValues,
  localDateTimeToUtcIso,
  roundUpExamStart,
  utcIsoToLocalDateTimeInput,
} from './exam-datetime';

test('6:30 PM IST stores as 13:00 UTC and displays back as 18:30', () => {
  const iso = localDateTimeToUtcIso('2026-09-21T18:30', DEFAULT_EXAM_TIMEZONE);
  assert.equal(iso, '2026-09-21T13:00:00.000Z');
  assert.equal(utcIsoToLocalDateTimeInput(iso, DEFAULT_EXAM_TIMEZONE), '2026-09-21T18:30');
});

test('roundUpExamStart at 6:26 IST becomes 6:30, not now', () => {
  const now = new Date('2026-09-21T12:56:00Z'); // 6:26 PM IST
  const start = roundUpExamStart(now);
  assert.equal(start.toISOString(), '2026-09-21T13:00:00.000Z');
  assert.equal(utcIsoToLocalDateTimeInput(start.toISOString(), DEFAULT_EXAM_TIMEZONE), '2026-09-21T18:30');
});

test('default exam schedule values round start up instead of using the current minute', () => {
  const now = new Date('2026-09-09T10:15:00Z'); // 15:45 IST — already on a 5-min mark
  const values = getDefaultExamScheduleValues(DEFAULT_EXAM_TIMEZONE, 60, now);
  assert.equal(values.timezone, 'Asia/Kolkata');
  assert.equal(values.durationMinutes, 60);
  assert.equal(values.startTime, '2026-09-09T15:50');
  assert.equal(values.endTime, '2026-09-09T16:50');
});

test('addMinutesToLocalDateTime keeps the exam timezone wall clock', () => {
  assert.equal(
    addMinutesToLocalDateTime('2026-09-21T18:30', 90, DEFAULT_EXAM_TIMEZONE),
    '2026-09-21T20:00',
  );
});
