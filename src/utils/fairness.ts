import {
  FairnessResolutionItem,
  Shift,
  ShiftSubmission,
  StaffDirectoryEntry,
  StaffFairnessMetric,
  TimeOffRequest,
} from '../types';

export const WORKDAY_START_TIME = '08:00';
export const WORKDAY_END_TIME = '22:00';

export function parseTimeToMinutes(timeStr: string): number {
  const [hStr, mStr] = timeStr.split(':');
  const h = Number(hStr);
  const m = Number(mStr);
  if (Number.isNaN(h) || Number.isNaN(m)) return 0;
  return h * 60 + m;
}

export function minutesToTimeStr(totalMinutes: number): string {
  const clamped = Math.max(0, Math.min(24 * 60 - 1, Math.round(totalMinutes)));
  const h = Math.floor(clamped / 60);
  const m = clamped % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export function computeDurationHours(startTime: string, endTime: string, breakMinutes = 0): number {
  const start = parseTimeToMinutes(startTime);
  let end = parseTimeToMinutes(endTime);
  if (end <= start) {
    end += 24 * 60;
  }
  const netMinutes = Math.max(15, end - start - Math.max(0, breakMinutes));
  return Math.round((netMinutes / 60) * 100) / 100;
}

export function timesOverlap(startA: string, endA: string, startB: string, endB: string): boolean {
  const a1 = parseTimeToMinutes(startA);
  let a2 = parseTimeToMinutes(endA);
  if (a2 <= a1) a2 += 1440;

  const b1 = parseTimeToMinutes(startB);
  let b2 = parseTimeToMinutes(endB);
  if (b2 <= b1) b2 += 1440;

  return a1 < b2 && b1 < a2;
}

export function buildStaffFairnessMetrics(
  staff: StaffDirectoryEntry[],
  shifts: Shift[]
): StaffFairnessMetric[] {
  const scheduledMap = new Map<string, number>();
  for (const s of shifts) {
    if (
      s.assignedUid &&
      (s.status === 'scheduled' || s.status === 'pending_change' || s.status === 'conflict')
    ) {
      scheduledMap.set(s.assignedUid, (scheduledMap.get(s.assignedUid) || 0) + s.durationHours);
    }
  }

  return staff
    .map((member) => {
      const workedHours = Math.round(member.totalHoursWorked * 100) / 100;
      const scheduledHours = Math.round((scheduledMap.get(member.uid) || 0) * 100) / 100;
      const effectiveTotalHours = Math.round((workedHours + scheduledHours) * 100) / 100;
      const target = Math.max(1, member.weeklyHoursTarget || 40);
      const utilizationRatio = Math.round((effectiveTotalHours / target) * 1000) / 1000;
      return {
        uid: member.uid,
        displayName: member.displayName,
        department: member.department,
        workedHours,
        scheduledHours,
        effectiveTotalHours,
        weeklyHoursTarget: target,
        utilizationRatio,
        lastAssignedAt: member.lastAssignedAt || '',
      };
    })
    .sort((a, b) => a.utilizationRatio - b.utilizationRatio || a.effectiveTotalHours - b.effectiveTotalHours);
}

export function isStaffOffOnDate(
  uid: string,
  date: string,
  timeOffRequests: TimeOffRequest[] = []
): boolean {
  if (!uid || !date || timeOffRequests.length === 0) return false;
  return timeOffRequests.some(
    (req) =>
      req.staffUid === uid &&
      req.status === 'approved' &&
      date >= req.startDate &&
      date <= req.endDate
  );
}

/**
 * Picks the fairest staff member from a list of candidate UIDs based on
 * lowest working-time utilization ratio, then lowest total effective hours,
 * then oldest lastAssignedAt timestamp, excluding anyone with approved time off.
 */
export function selectFairestCandidate(
  candidateUids: string[],
  metricsMap: Map<string, StaffFairnessMetric>,
  offCheck?: { date: string; timeOffRequests?: TimeOffRequest[] }
): StaffFairnessMetric | null {
  const validCandidates = candidateUids
    .map((uid) => metricsMap.get(uid))
    .filter((m): m is StaffFairnessMetric => {
      if (!m) return false;
      if (offCheck?.date && isStaffOffOnDate(m.uid, offCheck.date, offCheck.timeOffRequests)) {
        return false;
      }
      return true;
    });

  if (validCandidates.length === 0) return null;

  validCandidates.sort((a, b) => {
    if (Math.abs(a.utilizationRatio - b.utilizationRatio) > 0.005) {
      return a.utilizationRatio - b.utilizationRatio;
    }
    if (Math.abs(a.effectiveTotalHours - b.effectiveTotalHours) > 0.05) {
      return a.effectiveTotalHours - b.effectiveTotalHours;
    }
    return a.lastAssignedAt.localeCompare(b.lastAssignedAt);
  });

  return validCandidates[0];
}

export interface DetectedOverlapSummary {
  multiCandidateShifts: Shift[];
  concurrentShiftGroups: Shift[][];
  totalOverlappingShifts: number;
}

/**
 * Enforces "only 1 worker every time, no time overlap":
 * detects any concurrent overlapping active shifts on the same date across ALL departments.
 */
export function detectOverlaps(shifts: Shift[]): DetectedOverlapSummary {
  const activeShifts = shifts.filter(
    (s) => s.status !== 'completed' && s.status !== 'open' && Boolean(s.assignedUid)
  );
  const multiCandidateShifts = activeShifts.filter(
    (s) => s.candidateUids.length > 1 || s.status === 'conflict'
  );

  const visited = new Set<string>();
  const concurrentShiftGroups: Shift[][] = [];

  for (let i = 0; i < activeShifts.length; i++) {
    const a = activeShifts[i];
    if (visited.has(a.id)) continue;

    const group: Shift[] = [a];
    for (let j = i + 1; j < activeShifts.length; j++) {
      const b = activeShifts[j];
      if (a.date === b.date && timesOverlap(a.startTime, a.endTime, b.startTime, b.endTime)) {
        group.push(b);
      }
    }

    if (group.length > 1) {
      group.forEach((s) => visited.add(s.id));
      concurrentShiftGroups.push(group);
    }
  }

  const uniqueOverlapIds = new Set<string>();
  multiCandidateShifts.forEach((s) => uniqueOverlapIds.add(s.id));
  concurrentShiftGroups.forEach((g) => g.forEach((s) => uniqueOverlapIds.add(s.id)));

  return {
    multiCandidateShifts,
    concurrentShiftGroups,
    totalOverlappingShifts: uniqueOverlapIds.size,
  };
}

/**
 * Generates an actionable Fairness Arrangement Plan for all shifts that have
 * multiple people scheduled for the same time (either via candidateUids > 1
 * or concurrent overlapping shifts on the same date).
 */
export function buildFairnessArrangementPlan(
  shifts: Shift[],
  staff: StaffDirectoryEntry[],
  timeOffRequests: TimeOffRequest[] = []
): FairnessResolutionItem[] {
  const metrics = buildStaffFairnessMetrics(staff, shifts);
  const metricsMap = new Map<string, StaffFairnessMetric>(metrics.map((m) => [m.uid, m]));
  const resolutions: FairnessResolutionItem[] = [];
  const handledShiftIds = new Set<string>();

  const activeShifts = shifts
    .filter((s) => s.status !== 'completed' && s.status !== 'open' && Boolean(s.assignedUid))
    .sort((a, b) => a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime));

  // Track occupied intervals per date across the whole workplace (only 1 worker at any time)
  const occupiedByDate = new Map<string, Array<{ shiftId: string; startMin: number; endMin: number }>>();
  for (const s of activeShifts) {
    const startMin = parseTimeToMinutes(s.startTime);
    let endMin = parseTimeToMinutes(s.endTime);
    if (endMin <= startMin) endMin += 1440;
    const arr = occupiedByDate.get(s.date) || [];
    arr.push({ shiftId: s.id, startMin, endMin });
    occupiedByDate.set(s.date, arr);
  }

  const findNextAvailableSlot = (
    initialDate: string,
    preferredStartMin: number,
    durationMin: number,
    ignoreShiftId: string
  ): { date: string; startMin: number; endMin: number } => {
    let checkDate = initialDate;
    let cursorMin = preferredStartMin;
    const endOfDayMin = parseTimeToMinutes(WORKDAY_END_TIME);
    const startOfDayMin = parseTimeToMinutes(WORKDAY_START_TIME);

    for (let dayOffset = 0; dayOffset < 7; dayOffset++) {
      const existing = (occupiedByDate.get(checkDate) || [])
        .filter((iv) => iv.shiftId !== ignoreShiftId)
        .sort((a, b) => a.startMin - b.startMin);

      let candidateStart = Math.max(startOfDayMin, cursorMin);
      for (const iv of existing) {
        if (candidateStart < iv.endMin && candidateStart + durationMin > iv.startMin) {
          candidateStart = iv.endMin;
        }
      }

      if (candidateStart + durationMin <= endOfDayMin) {
        return {
          date: checkDate,
          startMin: candidateStart,
          endMin: candidateStart + durationMin,
        };
      }

      const d = new Date(`${checkDate}T12:00:00Z`);
      d.setUTCDate(d.getUTCDate() + 1);
      checkDate = d.toISOString().slice(0, 10);
      cursorMin = startOfDayMin;
    }

    return {
      date: checkDate,
      startMin: startOfDayMin,
      endMin: startOfDayMin + durationMin,
    };
  };

  // 1. Resolve concurrent overlapping shifts on the same date (only 1 worker at any time)
  for (let i = 0; i < activeShifts.length; i++) {
    const anchor = activeShifts[i];
    if (handledShiftIds.has(anchor.id)) continue;

    const overlapping = activeShifts.filter(
      (s) =>
        !handledShiftIds.has(s.id) &&
        s.date === anchor.date &&
        timesOverlap(anchor.startTime, anchor.endTime, s.startTime, s.endTime)
    );

    if (overlapping.length <= 1) continue;

    const competingUidSet = new Set<string>();
    overlapping.forEach((s) => {
      if (s.assignedUid) competingUidSet.add(s.assignedUid);
      s.candidateUids.forEach((u) => {
        if (u) competingUidSet.add(u);
      });
    });

    const primaryShift = overlapping[0];
    const allCompeting = Array.from(competingUidSet);
    const fairest = selectFairestCandidate(allCompeting, metricsMap, {
      date: primaryShift.date,
      timeOffRequests,
    });
    if (!fairest) continue;

    const competingSummary = allCompeting
      .map((uid) => metricsMap.get(uid))
      .filter((m): m is StaffFairnessMetric => Boolean(m))
      .map((m) => `${m.displayName} (${m.effectiveTotalHours.toFixed(1)}h/${m.weeklyHoursTarget}h)`);

    resolutions.push({
      shiftId: primaryShift.id,
      shiftTitle: primaryShift.title,
      date: primaryShift.date,
      timeWindow: `${primaryShift.startTime}-${primaryShift.endTime}`,
      department: primaryShift.department,
      overlapType: 'concurrent_overlap',
      previousAssigneeUid: primaryShift.assignedUid,
      previousAssigneeName: primaryShift.assignedName,
      selectedAssigneeUid: fairest.uid,
      selectedAssigneeName: fairest.displayName,
      competingNames: competingSummary,
      action: 'assign_fairest',
      reason: `Fairness selected ${fairest.displayName} (${fairest.effectiveTotalHours.toFixed(1)}h / ${fairest.weeklyHoursTarget}h = ${Math.round(fairest.utilizationRatio * 100)}%) so only 1 worker covers this window.`,
    });

    fairest.effectiveTotalHours = Math.round((fairest.effectiveTotalHours + primaryShift.durationHours) * 100) / 100;
    fairest.utilizationRatio = Math.round((fairest.effectiveTotalHours / fairest.weeklyHoursTarget) * 1000) / 1000;
    handledShiftIds.add(primaryShift.id);

    // Move secondary overlapping shifts to non-overlapping later gap or next day
    for (let k = 1; k < overlapping.length; k++) {
      const sec = overlapping[k];
      handledShiftIds.add(sec.id);

      const primaryEndMin = parseTimeToMinutes(primaryShift.endTime);
      const secDurationMin = Math.round(sec.durationHours * 60);
      const slot = findNextAvailableSlot(sec.date, primaryEndMin, secDurationMin, sec.id);

      const dateList = (occupiedByDate.get(slot.date) || []).filter((iv) => iv.shiftId !== sec.id);
      dateList.push({ shiftId: sec.id, startMin: slot.startMin, endMin: slot.endMin });
      occupiedByDate.set(slot.date, dateList);

      const remainingCandidates = allCompeting.filter((uid) => uid !== fairest.uid);
      const nextPerson =
        selectFairestCandidate(
          remainingCandidates.length > 0 ? remainingCandidates : allCompeting,
          metricsMap,
          { date: slot.date, timeOffRequests }
        ) ||
        selectFairestCandidate(allCompeting, metricsMap, { date: slot.date, timeOffRequests });

      if (!nextPerson) continue;

      const newStartTime = minutesToTimeStr(slot.startMin);
      const newEndTime = minutesToTimeStr(slot.endMin);

      resolutions.push({
        shiftId: sec.id,
        shiftTitle: sec.title,
        date: sec.date,
        timeWindow: `${sec.startTime}-${sec.endTime}`,
        department: sec.department,
        overlapType: 'concurrent_overlap',
        previousAssigneeUid: sec.assignedUid,
        previousAssigneeName: sec.assignedName,
        selectedAssigneeUid: nextPerson.uid,
        selectedAssigneeName: nextPerson.displayName,
        competingNames: competingSummary,
        action: 'rebalance_secondary',
        newDate: slot.date,
        newStartTime,
        newEndTime,
        reason: `Overlap cleared: moved to ${slot.date} ${newStartTime}-${newEndTime} and assigned to ${nextPerson.displayName} (${nextPerson.effectiveTotalHours.toFixed(1)}h/${nextPerson.weeklyHoursTarget}h).`,
      });

      nextPerson.effectiveTotalHours = Math.round((nextPerson.effectiveTotalHours + sec.durationHours) * 100) / 100;
      nextPerson.utilizationRatio = Math.round((nextPerson.effectiveTotalHours / nextPerson.weeklyHoursTarget) * 1000) / 1000;
    }
  }

  // 2. Resolve single shifts that have multiple candidateUids scheduled on them
  for (const shift of activeShifts) {
    if (handledShiftIds.has(shift.id)) continue;
    if (shift.candidateUids.length <= 1 && shift.status !== 'conflict') continue;

    const fairest = selectFairestCandidate(shift.candidateUids, metricsMap, {
      date: shift.date,
      timeOffRequests,
    });
    if (!fairest) continue;

    const competingSummary = shift.candidateUids
      .map((uid) => metricsMap.get(uid))
      .filter((m): m is StaffFairnessMetric => Boolean(m))
      .map((m) => `${m.displayName} (${m.effectiveTotalHours.toFixed(1)}h/${m.weeklyHoursTarget}h)`);

    resolutions.push({
      shiftId: shift.id,
      shiftTitle: shift.title,
      date: shift.date,
      timeWindow: `${shift.startTime}-${shift.endTime}`,
      department: shift.department,
      overlapType: 'multi_candidate',
      previousAssigneeUid: shift.assignedUid,
      previousAssigneeName: shift.assignedName,
      selectedAssigneeUid: fairest.uid,
      selectedAssigneeName: fairest.displayName,
      competingNames: competingSummary,
      action: 'assign_fairest',
      reason: `Fairness arranged among ${shift.candidateUids.length} candidates: ${fairest.displayName} (${fairest.effectiveTotalHours.toFixed(1)}h / ${fairest.weeklyHoursTarget}h = ${Math.round(fairest.utilizationRatio * 100)}%) had the lowest working-time load.`,
    });

    fairest.effectiveTotalHours = Math.round((fairest.effectiveTotalHours + shift.durationHours) * 100) / 100;
    fairest.utilizationRatio = Math.round((fairest.effectiveTotalHours / fairest.weeklyHoursTarget) * 1000) / 1000;
    handledShiftIds.add(shift.id);
  }

  return resolutions;
}

export interface WeeklySlotTemplate {
  title: string;
  department: string;
  startTime: string;
  endTime: string;
  includeWeekends: boolean;
}

export interface GeneratedWeeklyShiftDraft {
  title: string;
  department: string;
  date: string;
  startTime: string;
  endTime: string;
  durationHours: number;
  assignedUid: string;
  assignedName: string;
  status: 'scheduled' | 'open';
  fairnessNote: string;
}

/**
 * Default non-overlapping daily shift templates spanning the 08:00–22:00 operating day.
 */
export const DEFAULT_WEEKLY_TEMPLATES: WeeklySlotTemplate[] = [
  {
    title: 'Morning Operations Shift',
    department: 'Operations',
    startTime: '08:00',
    endTime: '16:00',
    includeWeekends: true,
  },
  {
    title: 'Evening Operations Coverage',
    department: 'Operations',
    startTime: '16:00',
    endTime: '22:00',
    includeWeekends: true,
  },
];

export function doesSubmissionMatchSlot(
  sub: ShiftSubmission,
  slot: { date: string; startTime: string; endTime: string; department: string }
): boolean {
  if (sub.status !== 'submitted') return false;
  if (sub.date !== slot.date) return false;

  const subDept = sub.department.trim().toLowerCase();
  const slotDept = slot.department.trim().toLowerCase();
  if (subDept !== 'any' && slotDept !== 'any' && subDept !== slotDept) {
    return false;
  }

  const subStart = parseTimeToMinutes(sub.startTime);
  let subEnd = parseTimeToMinutes(sub.endTime);
  if (subEnd <= subStart) subEnd += 1440;

  const slotStart = parseTimeToMinutes(slot.startTime);
  let slotEnd = parseTimeToMinutes(slot.endTime);
  if (slotEnd <= slotStart) slotEnd += 1440;

  return subStart <= slotStart && subEnd >= slotEnd;
}

export interface DayOpenGapInterval {
  date: string;
  startTime: string;
  endTime: string;
  durationHours: number;
}

export interface DayPartitionResult {
  assignedShifts: Shift[];
  openGaps: DayOpenGapInterval[];
  matchingOpenShifts: Map<string, Shift>; // key = `${startTime}-${endTime}`
  staleOpenShiftIds: string[];
}

/**
 * Dynamically splits a single day's operating timeline into non-overlapping blocks:
 * - If no one has an assigned shift on that date -> 1 single full-day open block (08:00–22:00).
 * - If 1 or more assigned shifts exist on that date -> keeps the assigned shift(s) and fills
 *   only the non-overlapping uncovered gap intervals before/between/after them.
 */
export function partitionDayTimeline(
  date: string,
  dayShifts: Shift[],
  dayStartTime = WORKDAY_START_TIME,
  dayEndTime = WORKDAY_END_TIME
): DayPartitionResult {
  const assignedRaw = dayShifts
    .filter((s) => s.status !== 'open' && Boolean(s.assignedUid))
    .sort(
      (a, b) =>
        parseTimeToMinutes(a.startTime) - parseTimeToMinutes(b.startTime) ||
        a.id.localeCompare(b.id)
    );

  const openShiftsRaw = dayShifts.filter(
    (s) => s.status === 'open' || !s.assignedUid
  );

  // Merge/sort assigned intervals to compute exact uncovered non-overlapping gaps
  let horizonStart = parseTimeToMinutes(dayStartTime);
  let horizonEnd = parseTimeToMinutes(dayEndTime);

  const assignedIntervals = assignedRaw.map((s) => {
    const startMin = parseTimeToMinutes(s.startTime);
    let endMin = parseTimeToMinutes(s.endTime);
    if (endMin <= startMin) endMin += 1440;
    if (startMin < horizonStart) horizonStart = startMin;
    if (endMin > horizonEnd) horizonEnd = Math.min(24 * 60 - 1, endMin);
    return { startMin, endMin };
  });

  const openGaps: DayOpenGapInterval[] = [];

  if (assignedIntervals.length === 0) {
    // Nobody got a shift on this day -> ONE full-day column/slot
    openGaps.push({
      date,
      startTime: minutesToTimeStr(horizonStart),
      endTime: minutesToTimeStr(horizonEnd),
      durationHours: computeDurationHours(
        minutesToTimeStr(horizonStart),
        minutesToTimeStr(horizonEnd),
        0
      ),
    });
  } else {
    let cursor = horizonStart;
    for (const iv of assignedIntervals) {
      if (iv.startMin - cursor >= 30) {
        const sTime = minutesToTimeStr(cursor);
        const eTime = minutesToTimeStr(iv.startMin);
        openGaps.push({
          date,
          startTime: sTime,
          endTime: eTime,
          durationHours: computeDurationHours(sTime, eTime, 0),
        });
      }
      cursor = Math.max(cursor, iv.endMin);
    }

    if (horizonEnd - cursor >= 30) {
      const sTime = minutesToTimeStr(cursor);
      const eTime = minutesToTimeStr(horizonEnd);
      openGaps.push({
        date,
        startTime: sTime,
        endTime: eTime,
        durationHours: computeDurationHours(sTime, eTime, 0),
      });
    }
  }

  // Match existing Firestore 'open' shift docs to the clean non-overlapping gaps
  const matchingOpenShifts = new Map<string, Shift>();
  const usedOpenIds = new Set<string>();

  for (const gap of openGaps) {
    const key = `${gap.startTime}-${gap.endTime}`;
    const exactMatch = openShiftsRaw.find(
      (s) =>
        !usedOpenIds.has(s.id) &&
        s.startTime === gap.startTime &&
        s.endTime === gap.endTime
    );
    if (exactMatch) {
      matchingOpenShifts.set(key, exactMatch);
      usedOpenIds.add(exactMatch.id);
    }
  }

  const staleOpenShiftIds = openShiftsRaw
    .filter((s) => !usedOpenIds.has(s.id))
    .map((s) => s.id);

  return {
    assignedShifts: assignedRaw,
    openGaps,
    matchingOpenShifts,
    staleOpenShiftIds,
  };
}

export interface WeekReconciliationPlan {
  staleOpenShiftIds: string[];
  missingOpenDrafts: GeneratedWeeklyShiftDraft[];
}

export function buildWeekReconciliationPlan(params: {
  weekDates: string[];
  existingShifts: Shift[];
  dayStartTime?: string;
  dayEndTime?: string;
}): WeekReconciliationPlan {
  const {
    weekDates,
    existingShifts,
    dayStartTime = WORKDAY_START_TIME,
    dayEndTime = WORKDAY_END_TIME,
  } = params;

  const staleOpenShiftIds: string[] = [];
  const missingOpenDrafts: GeneratedWeeklyShiftDraft[] = [];

  for (const date of weekDates) {
    const dayShifts = existingShifts.filter((s) => s.date === date);
    const partition = partitionDayTimeline(date, dayShifts, dayStartTime, dayEndTime);
    staleOpenShiftIds.push(...partition.staleOpenShiftIds);

    for (const gap of partition.openGaps) {
      const key = `${gap.startTime}-${gap.endTime}`;
      if (!partition.matchingOpenShifts.has(key)) {
        const isFullDay =
          partition.assignedShifts.length === 0 &&
          gap.startTime === dayStartTime &&
          gap.endTime === dayEndTime;

        missingOpenDrafts.push({
          title: isFullDay ? 'Full Day Coverage (Open)' : 'Open Shift Coverage',
          department: 'Operations',
          date,
          startTime: gap.startTime,
          endTime: gap.endTime,
          durationHours: gap.durationHours,
          assignedUid: '',
          assignedName: '',
          status: 'open',
          fairnessNote: isFullDay
            ? 'Full-day open slot — no staff assigned yet.'
            : 'Remaining non-overlapping open time slot.',
        });
      }
    }
  }

  return {
    staleOpenShiftIds,
    missingOpenDrafts,
  };
}

export function needsScheduleNormalization(
  weekDates: string[],
  existingShifts: Shift[]
): boolean {
  // Only flag normalization if there are shifts in this week that create overlaps or fragmented open slots
  const weekSet = new Set(weekDates);
  const weekShifts = existingShifts.filter((s) => weekSet.has(s.date));
  if (weekShifts.length === 0) return false;

  const plan = buildWeekReconciliationPlan({ weekDates, existingShifts });
  return plan.staleOpenShiftIds.length > 0;
}

/**
 * Matches open/blank shifts against active ShiftSubmissions and produces
 * fairness-based assignment plans ONLY for open shifts that have >= 1 matching submission,
 * strictly enforcing: 1 worker at any time across the entire day (no time overlap).
 */
export function buildOpenShiftAssignmentPlan(params: {
  shifts: Shift[];
  submissions: ShiftSubmission[];
  staff: StaffDirectoryEntry[];
  timeOffRequests?: TimeOffRequest[];
}): FairnessResolutionItem[] {
  const { shifts, submissions, staff, timeOffRequests = [] } = params;
  const openShifts = shifts
    .filter((s) => s.status === 'open' || !s.assignedUid)
    .sort((a, b) => a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime));

  if (openShifts.length === 0) return [];

  const metrics = buildStaffFairnessMetrics(staff, shifts);
  const metricsMap = new Map<string, StaffFairnessMetric>(metrics.map((m) => [m.uid, { ...m }]));

  // Workplace-wide occupied intervals per date (only 1 worker every time)
  const dayOccupiedIntervals = new Map<string, { startTime: string; endTime: string }[]>();
  const addDayInterval = (date: string, startTime: string, endTime: string) => {
    const list = dayOccupiedIntervals.get(date) || [];
    list.push({ startTime, endTime });
    dayOccupiedIntervals.set(date, list);
  };

  for (const s of shifts) {
    if (s.assignedUid && s.status !== 'completed' && s.status !== 'open') {
      addDayInterval(s.date, s.startTime, s.endTime);
    }
  }

  const resolutions: FairnessResolutionItem[] = [];

  for (const shift of openShifts) {
    // Skip if any worker already occupies an overlapping window on this date
    const dayOccupied = dayOccupiedIntervals.get(shift.date) || [];
    const overlapsExistingWorker = dayOccupied.some((iv) =>
      timesOverlap(iv.startTime, iv.endTime, shift.startTime, shift.endTime)
    );
    if (overlapsExistingWorker) continue;

    const matchingUids = new Set(
      submissions
        .filter((sub) =>
          doesSubmissionMatchSlot(sub, {
            date: shift.date,
            startTime: shift.startTime,
            endTime: shift.endTime,
            department: shift.department,
          })
        )
        .map((sub) => sub.staffUid)
    );

    if (matchingUids.size === 0) continue;

    const eligible = Array.from(matchingUids)
      .map((uid) => metricsMap.get(uid))
      .filter((m): m is StaffFairnessMetric => {
        if (!m) return false;
        return !isStaffOffOnDate(m.uid, shift.date, timeOffRequests);
      });

    if (eligible.length === 0) continue;

    eligible.sort((a, b) => {
      if (Math.abs(a.utilizationRatio - b.utilizationRatio) > 0.005) {
        return a.utilizationRatio - b.utilizationRatio;
      }
      if (Math.abs(a.effectiveTotalHours - b.effectiveTotalHours) > 0.05) {
        return a.effectiveTotalHours - b.effectiveTotalHours;
      }
      const aDeptMatch = a.department.toLowerCase() === shift.department.toLowerCase() ? 0 : 1;
      const bDeptMatch = b.department.toLowerCase() === shift.department.toLowerCase() ? 0 : 1;
      if (aDeptMatch !== bDeptMatch) return aDeptMatch - bDeptMatch;
      return a.lastAssignedAt.localeCompare(b.lastAssignedAt);
    });

    const chosen = eligible[0];
    const beforeHours = chosen.effectiveTotalHours;
    const beforePct = Math.round(chosen.utilizationRatio * 100);
    const competingSummary = eligible.map(
      (m) => `${m.displayName} (${m.effectiveTotalHours.toFixed(1)}h/${m.weeklyHoursTarget}h)`
    );

    resolutions.push({
      shiftId: shift.id,
      shiftTitle: shift.title,
      date: shift.date,
      timeWindow: `${shift.startTime}-${shift.endTime}`,
      department: shift.department,
      overlapType: 'multi_candidate',
      previousAssigneeUid: '',
      previousAssigneeName: 'Unassigned',
      selectedAssigneeUid: chosen.uid,
      selectedAssigneeName: chosen.displayName,
      competingNames: competingSummary,
      action: 'assign_fairest',
      reason:
        eligible.length === 1
          ? `Assigned to ${chosen.displayName} (submitted for this open shift).`
          : `Fairness selected ${chosen.displayName} (${beforeHours.toFixed(1)}h/${chosen.weeklyHoursTarget}h, ${beforePct}% load) from ${eligible.length} submissions.`,
    });

    chosen.effectiveTotalHours = Math.round((chosen.effectiveTotalHours + shift.durationHours) * 100) / 100;
    chosen.utilizationRatio = Math.round((chosen.effectiveTotalHours / chosen.weeklyHoursTarget) * 1000) / 1000;
    chosen.lastAssignedAt = `${shift.date}T${shift.startTime}`;
    addDayInterval(shift.date, shift.startTime, shift.endTime);
  }

  return resolutions;
}

export interface GeneratedWeeklyPlanResult {
  drafts: GeneratedWeeklyShiftDraft[];
  staleOpenShiftIds: string[];
}

/**
 * Generates a dynamic, non-overlapping 7-day weekly schedule starting on weekDates[0]:
 * - Only 1 worker at any time on any day (no concurrent time overlaps across any department).
 * - Strictly considers ONLY staff who submitted availability AND do NOT have approved time off.
 * - If nobody is assigned on a day -> leaves ONE full-day blank ('open') column (08:00–22:00).
 * - If someone gets a shift on that day (e.g. 08:00–16:00) -> splits the remaining uncovered
 *   non-overlapping portion(s) of the day into open shift(s) (e.g. 16:00–22:00), never creating
 *   an overlapping 12:00–20:00 block.
 * - Identifies stale/overlapping open shift IDs in Firestore so they are cleaned up atomically.
 */
export function generateWeeklyFairnessSchedule(params: {
  weekDates: string[];
  templates: WeeklySlotTemplate[];
  existingShifts: Shift[];
  staff: StaffDirectoryEntry[];
  submissions: ShiftSubmission[];
  timeOffRequests?: TimeOffRequest[];
}): GeneratedWeeklyShiftDraft[] {
  return generateWeeklyFairnessPlan(params).drafts;
}

export function generateWeeklyFairnessPlan(params: {
  weekDates: string[];
  templates: WeeklySlotTemplate[];
  existingShifts: Shift[];
  staff: StaffDirectoryEntry[];
  submissions: ShiftSubmission[];
  timeOffRequests?: TimeOffRequest[];
}): GeneratedWeeklyPlanResult {
  const { weekDates, templates, existingShifts, staff, submissions, timeOffRequests = [] } = params;
  if (weekDates.length === 0) {
    return { drafts: [], staleOpenShiftIds: [] };
  }

  const metrics = buildStaffFairnessMetrics(staff, existingShifts);
  const metricsMap = new Map<string, StaffFairnessMetric>(metrics.map((m) => [m.uid, { ...m }]));

  const minTemplateStart =
    templates.length > 0
      ? templates.reduce(
          (min, t) => (t.startTime < min ? t.startTime : min),
          WORKDAY_START_TIME
        )
      : WORKDAY_START_TIME;
  const maxTemplateEnd =
    templates.length > 0
      ? templates.reduce(
          (max, t) => (t.endTime > max ? t.endTime : max),
          WORKDAY_END_TIME
        )
      : WORKDAY_END_TIME;

  const drafts: GeneratedWeeklyShiftDraft[] = [];
  const staleOpenShiftIds: string[] = [];

  for (let dayIdx = 0; dayIdx < weekDates.length; dayIdx++) {
    const date = weekDates[dayIdx];
    const isWeekend = dayIdx >= 5;

    const existingDayShifts = existingShifts.filter((s) => s.date === date);
    const existingAssigned = existingDayShifts.filter(
      (s) => s.status !== 'open' && Boolean(s.assignedUid)
    );
    const existingOpen = existingDayShifts.filter(
      (s) => s.status === 'open' || !s.assignedUid
    );

    // Track all assigned time intervals on this date (1 worker at any time!)
    const dayOccupied: Array<{ startTime: string; endTime: string }> = existingAssigned.map((s) => ({
      startTime: s.startTime,
      endTime: s.endTime,
    }));

    const isTimeFreeOnDay = (startTime: string, endTime: string) =>
      !dayOccupied.some((iv) => timesOverlap(iv.startTime, iv.endTime, startTime, endTime));

    const newAssignedForDay: Shift[] = [];

    // 1. Try matching non-overlapping template windows with explicit staff submissions
    const dayTemplates = templates
      .filter((tpl) => !(isWeekend && !tpl.includeWeekends))
      .sort((a, b) => a.startTime.localeCompare(b.startTime));

    for (const tpl of dayTemplates) {
      if (!isTimeFreeOnDay(tpl.startTime, tpl.endTime)) continue;

      const matchingSubUids = new Set(
        submissions
          .filter((sub) =>
            doesSubmissionMatchSlot(sub, {
              date,
              startTime: tpl.startTime,
              endTime: tpl.endTime,
              department: tpl.department,
            })
          )
          .map((sub) => sub.staffUid)
      );

      const eligibleMetrics = Array.from(matchingSubUids)
        .map((uid) => metricsMap.get(uid))
        .filter((m): m is StaffFairnessMetric => {
          if (!m) return false;
          return !isStaffOffOnDate(m.uid, date, timeOffRequests);
        });

      if (eligibleMetrics.length === 0) continue;

      eligibleMetrics.sort((a, b) => {
        if (Math.abs(a.utilizationRatio - b.utilizationRatio) > 0.005) {
          return a.utilizationRatio - b.utilizationRatio;
        }
        if (Math.abs(a.effectiveTotalHours - b.effectiveTotalHours) > 0.05) {
          return a.effectiveTotalHours - b.effectiveTotalHours;
        }
        const aDeptMatch = a.department.toLowerCase() === tpl.department.toLowerCase() ? 0 : 1;
        const bDeptMatch = b.department.toLowerCase() === tpl.department.toLowerCase() ? 0 : 1;
        if (aDeptMatch !== bDeptMatch) return aDeptMatch - bDeptMatch;
        return a.lastAssignedAt.localeCompare(b.lastAssignedAt);
      });

      const chosen = eligibleMetrics[0];
      const beforeHours = chosen.effectiveTotalHours;
      const beforePct = Math.round(chosen.utilizationRatio * 100);
      const durationHours = computeDurationHours(tpl.startTime, tpl.endTime, 0);

      chosen.effectiveTotalHours = Math.round((chosen.effectiveTotalHours + durationHours) * 100) / 100;
      chosen.utilizationRatio = Math.round((chosen.effectiveTotalHours / chosen.weeklyHoursTarget) * 1000) / 1000;
      chosen.lastAssignedAt = `${date}T${tpl.startTime}`;
      dayOccupied.push({ startTime: tpl.startTime, endTime: tpl.endTime });

      const draft: GeneratedWeeklyShiftDraft = {
        title: tpl.title,
        department: tpl.department,
        date,
        startTime: tpl.startTime,
        endTime: tpl.endTime,
        durationHours,
        assignedUid: chosen.uid,
        assignedName: chosen.displayName,
        status: 'scheduled',
        fairnessNote:
          eligibleMetrics.length === 1
            ? `Assigned to ${chosen.displayName} (submitted for this shift).`
            : `Fairness selected ${chosen.displayName} (${beforeHours.toFixed(1)}h/${chosen.weeklyHoursTarget}h, ${beforePct}% load) from ${eligibleMetrics.length} submissions.`,
      };
      drafts.push(draft);
      newAssignedForDay.push({
        id: `draft_${date}_${tpl.startTime}`,
        ...draft,
        candidateUids: [chosen.uid],
        visibility: 'team',
        createdBy: '',
        createdAt: null,
        updatedAt: null,
      });
    }

    // 2. Also assign any remaining explicit submissions whose windows don't overlap already-assigned shifts
    const daySubmissions = submissions
      .filter((sub) => sub.status === 'submitted' && sub.date === date)
      .sort((a, b) => a.startTime.localeCompare(b.startTime));

    for (const sub of daySubmissions) {
      if (!isTimeFreeOnDay(sub.startTime, sub.endTime)) continue;
      if (isStaffOffOnDate(sub.staffUid, date, timeOffRequests)) continue;

      const sameWindowSubs = daySubmissions.filter(
        (other) =>
          other.startTime === sub.startTime &&
          other.endTime === sub.endTime &&
          !isStaffOffOnDate(other.staffUid, date, timeOffRequests)
      );
      const candidateMetrics = Array.from(new Set(sameWindowSubs.map((s) => s.staffUid)))
        .map((uid) => metricsMap.get(uid))
        .filter((m): m is StaffFairnessMetric => Boolean(m));

      if (candidateMetrics.length === 0) continue;

      candidateMetrics.sort((a, b) => {
        if (Math.abs(a.utilizationRatio - b.utilizationRatio) > 0.005) {
          return a.utilizationRatio - b.utilizationRatio;
        }
        return a.effectiveTotalHours - b.effectiveTotalHours;
      });

      const chosen = candidateMetrics[0];
      const winningSub = sameWindowSubs.find((s) => s.staffUid === chosen.uid) || sub;
      const durationHours = computeDurationHours(sub.startTime, sub.endTime, 0);

      chosen.effectiveTotalHours = Math.round((chosen.effectiveTotalHours + durationHours) * 100) / 100;
      chosen.utilizationRatio = Math.round((chosen.effectiveTotalHours / chosen.weeklyHoursTarget) * 1000) / 1000;
      dayOccupied.push({ startTime: sub.startTime, endTime: sub.endTime });

      const draft: GeneratedWeeklyShiftDraft = {
        title: winningSub.shiftTitle || 'Submitted Shift Coverage',
        department: winningSub.department || chosen.department,
        date,
        startTime: sub.startTime,
        endTime: sub.endTime,
        durationHours,
        assignedUid: chosen.uid,
        assignedName: chosen.displayName,
        status: 'scheduled',
        fairnessNote: `Assigned to ${chosen.displayName} from submitted availability.`,
      };
      drafts.push(draft);
      newAssignedForDay.push({
        id: `draft_sub_${date}_${sub.startTime}`,
        ...draft,
        candidateUids: [chosen.uid],
        visibility: 'team',
        createdBy: '',
        createdAt: null,
        updatedAt: null,
      });
    }

    // 3. Dynamically split the remaining uncovered non-overlapping day gaps & clean stale open shifts
    const combinedDayShifts: Shift[] = [...existingAssigned, ...existingOpen, ...newAssignedForDay];
    const partition = partitionDayTimeline(
      date,
      combinedDayShifts,
      minTemplateStart,
      maxTemplateEnd
    );

    staleOpenShiftIds.push(...partition.staleOpenShiftIds);

    for (const gap of partition.openGaps) {
      const key = `${gap.startTime}-${gap.endTime}`;
      if (partition.matchingOpenShifts.has(key)) continue;

      const isFullDay =
        partition.assignedShifts.length === 0 &&
        gap.startTime === minTemplateStart &&
        gap.endTime === maxTemplateEnd;

      drafts.push({
        title: isFullDay ? 'Full Day Coverage (Open)' : 'Open Shift Coverage',
        department: templates[0]?.department || 'Operations',
        date,
        startTime: gap.startTime,
        endTime: gap.endTime,
        durationHours: gap.durationHours,
        assignedUid: '',
        assignedName: '',
        status: 'open',
        fairnessNote: isFullDay
          ? 'Full-day open column — no staff submitted or assigned yet.'
          : 'Non-overlapping open shift gap after assigned shift.',
      });
    }
  }

  return { drafts, staleOpenShiftIds };
}
