import React, { useMemo, useState } from 'react';
import {
  ArrowRightLeft,
  CalendarPlus,
  Check,
  ChevronLeft,
  ChevronRight,
  Download,
  Hand,
  Pencil,
  Trash2,
  X,
} from 'lucide-react';
import { Shift, ShiftSubmission, UserProfile } from '../types';
import {
  doesSubmissionMatchSlot,
  parseTimeToMinutes,
  partitionDayTimeline,
} from '../utils/fairness';
import {
  addDaysIso,
  buildGoogleCalendarUrl,
  downloadIcsFile,
  formatIsoDateLocal,
  getMondayOfWeek,
  getMonthGridDates,
  getWeekDates,
  parseIsoDateLocal,
} from '../utils/calendarExport';

interface ShiftCalendarViewProps {
  profile: UserProfile;
  shifts: Shift[];
  allShiftsForOverlapCheck?: Shift[];
  shiftSubmissions: ShiftSubmission[];
  selectedWeekMonday: string;
  isFullScheduleView?: boolean;
  onChangeWeekMonday: (mondayIso: string) => void;
  onEditShift: (shift: Shift) => void;
  onDeleteShift: (shift: Shift) => void;
  onRequestChange: (shift: Shift) => void;
  onSubmitForShift: (shift: Shift) => Promise<void>;
  onWithdrawSubmission: (submissionId: string) => Promise<void>;
  onQuickSelectOpenWindow?: (window: {
    date: string;
    startTime: string;
    endTime: string;
  }) => void;
  onNotifyBanner: (msg: string) => void;
}

type DayTimelineBlock =
  | {
      kind: 'shift';
      key: string;
      shift: Shift;
      startTime: string;
      endTime: string;
      durationMinutes: number;
    }
  | {
      kind: 'virtual_open';
      key: string;
      date: string;
      startTime: string;
      endTime: string;
      durationHours: number;
      durationMinutes: number;
      isFullDay: boolean;
    };

const WEEKDAY_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export const ShiftCalendarView: React.FC<ShiftCalendarViewProps> = ({
  profile,
  shifts,
  allShiftsForOverlapCheck,
  shiftSubmissions,
  selectedWeekMonday,
  isFullScheduleView = true,
  onChangeWeekMonday,
  onEditShift,
  onDeleteShift,
  onRequestChange,
  onSubmitForShift,
  onWithdrawSubmission,
  onQuickSelectOpenWindow,
  onNotifyBanner,
}) => {
  const isManager = profile.role === 'manager';
  const [granularity, setGranularity] = useState<'week' | 'month'>('week');
  const [inspectedShift, setInspectedShift] = useState<Shift | null>(null);

  const todayIso = useMemo(() => formatIsoDateLocal(new Date()), []);
  const weekDates = useMemo(() => getWeekDates(selectedWeekMonday), [selectedWeekMonday]);

  const anchorDate = useMemo(
    () => parseIsoDateLocal(selectedWeekMonday),
    [selectedWeekMonday]
  );
  const monthGridDates = useMemo(
    () => getMonthGridDates(anchorDate.getFullYear(), anchorDate.getMonth()),
    [anchorDate]
  );

  const shiftsByDate = useMemo(() => {
    const map = new Map<string, Shift[]>();
    for (const s of shifts) {
      const arr = map.get(s.date) || [];
      arr.push(s);
      map.set(s.date, arr);
    }
    for (const [k, arr] of map.entries()) {
      arr.sort((a, b) => a.startTime.localeCompare(b.startTime));
      map.set(k, arr);
    }
    return map;
  }, [shifts]);

  const referenceByDate = useMemo(() => {
    const source = allShiftsForOverlapCheck || shifts;
    const map = new Map<string, Shift[]>();
    for (const s of source) {
      const arr = map.get(s.date) || [];
      arr.push(s);
      map.set(s.date, arr);
    }
    return map;
  }, [allShiftsForOverlapCheck, shifts]);

  const visibleShiftsForExport = useMemo(() => {
    const allowedDates = new Set(granularity === 'week' ? weekDates : monthGridDates);
    return shifts.filter((s) => allowedDates.has(s.date));
  }, [shifts, granularity, weekDates, monthGridDates]);

  const myVisibleShifts = useMemo(
    () => visibleShiftsForExport.filter((s) => s.assignedUid === profile.uid),
    [visibleShiftsForExport, profile.uid]
  );

  const periodLabel = useMemo(() => {
    if (granularity === 'month') {
      return anchorDate.toLocaleDateString('en-US', {
        month: 'long',
        year: 'numeric',
      });
    }
    const start = parseIsoDateLocal(weekDates[0]);
    const end = parseIsoDateLocal(weekDates[6]);
    const startTxt = start.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    const endTxt = end.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
    return `${startTxt} – ${endTxt}`;
  }, [granularity, anchorDate, weekDates]);

  const handleStep = (dir: -1 | 1) => {
    if (granularity === 'week') {
      onChangeWeekMonday(addDaysIso(selectedWeekMonday, dir * 7));
    } else {
      const nextMonth = new Date(
        anchorDate.getFullYear(),
        anchorDate.getMonth() + dir,
        1,
        12,
        0,
        0
      );
      onChangeWeekMonday(getMondayOfWeek(formatIsoDateLocal(nextMonth)));
    }
  };

  const handleExportVisible = () => {
    if (visibleShiftsForExport.length === 0) {
      onNotifyBanner('No shifts in the current view to export.');
      return;
    }
    downloadIcsFile(
      visibleShiftsForExport,
      `cadence-team-${selectedWeekMonday}.ics`,
      'Cadence Team Shift Schedule'
    );
    onNotifyBanner(`Exported ${visibleShiftsForExport.length} shift(s) to .ics calendar file.`);
  };

  const handleExportMine = () => {
    const source =
      myVisibleShifts.length > 0
        ? myVisibleShifts
        : shifts.filter((s) => s.assignedUid === profile.uid);
    if (source.length === 0) {
      onNotifyBanner('You do not have any assigned shifts to export yet.');
      return;
    }
    downloadIcsFile(
      source,
      `cadence-my-shifts-${selectedWeekMonday}.ics`,
      `${profile.displayName} Shifts`
    );
    onNotifyBanner(`Exported ${source.length} of your shift(s) to .ics calendar file.`);
  };

  const [submittingShiftId, setSubmittingShiftId] = useState<string | null>(null);

  const getMyMatchingSubmission = (shift: {
    date: string;
    startTime: string;
    endTime: string;
    department: string;
  }) =>
    shiftSubmissions.find(
      (sub) =>
        sub.staffUid === profile.uid &&
        doesSubmissionMatchSlot(sub, {
          date: shift.date,
          startTime: shift.startTime,
          endTime: shift.endTime,
          department: shift.department,
        })
    );

  const getMatchingSubmissionsCount = (shift: {
    date: string;
    startTime: string;
    endTime: string;
    department: string;
  }) =>
    shiftSubmissions.filter((sub) =>
      doesSubmissionMatchSlot(sub, {
        date: shift.date,
        startTime: shift.startTime,
        endTime: shift.endTime,
        department: shift.department,
      })
    ).length;

  const renderStatusText = (shift: Shift) => {
    if (shift.status === 'open' || !shift.assignedUid) {
      const mySub = getMyMatchingSubmission(shift);
      const count = getMatchingSubmissionsCount(shift);
      if (mySub) {
        return <span className="text-blue-700 font-medium">Open · You Submitted</span>;
      }
      if (isManager && count > 0) {
        return <span className="text-blue-700 font-medium">Open · {count} Submitted</span>;
      }
      return <span className="text-slate-500">Open (Unassigned)</span>;
    }
    if (shift.status === 'conflict' || shift.candidateUids.length > 1) {
      return <span className="text-amber-700 font-medium">Overlap</span>;
    }
    if (shift.status === 'pending_change') {
      return <span className="text-amber-700 font-medium">Change Pending</span>;
    }
    if (shift.status === 'completed') {
      return <span className="text-emerald-700 font-medium">Completed</span>;
    }
    return <span className="text-slate-500">Scheduled</span>;
  };

  const buildDayTimelineBlocks = (dateIso: string): DayTimelineBlock[] => {
    const dayShifts = shiftsByDate.get(dateIso) || [];

    if (!isFullScheduleView) {
      // Filtered mode (e.g. My Shifts, Open / Blank, Completed, or search)
      const refShifts = referenceByDate.get(dateIso) || dayShifts;
      const partition = partitionDayTimeline(dateIso, refShifts);
      const filteredSet = new Set(dayShifts.map((s) => s.id));
      const blocks: DayTimelineBlock[] = [];

      // Always keep matching assigned shifts
      for (const s of dayShifts) {
        if (s.status !== 'open' && Boolean(s.assignedUid)) {
          blocks.push({
            kind: 'shift',
            key: s.id,
            shift: s,
            startTime: s.startTime,
            endTime: s.endTime,
            durationMinutes: Math.max(60, Math.round(s.durationHours * 60)),
          });
        }
      }

      // Only show open gaps that do not overlap assigned shifts
      const hasOpenInFilter = dayShifts.some((s) => s.status === 'open' || !s.assignedUid);
      if (hasOpenInFilter) {
        for (const gap of partition.openGaps) {
          const match = partition.matchingOpenShifts.get(`${gap.startTime}-${gap.endTime}`);
          if (match && filteredSet.has(match.id)) {
            blocks.push({
              kind: 'shift',
              key: match.id,
              shift: match,
              startTime: match.startTime,
              endTime: match.endTime,
              durationMinutes: Math.max(60, Math.round(match.durationHours * 60)),
            });
          } else {
            blocks.push({
              kind: 'virtual_open',
              key: `vopen_${dateIso}_${gap.startTime}_${gap.endTime}`,
              date: dateIso,
              startTime: gap.startTime,
              endTime: gap.endTime,
              durationHours: gap.durationHours,
              durationMinutes: Math.max(60, Math.round(gap.durationHours * 60)),
              isFullDay: partition.assignedShifts.length === 0,
            });
          }
        }
      }

      blocks.sort(
        (a, b) => parseTimeToMinutes(a.startTime) - parseTimeToMinutes(b.startTime)
      );
      return blocks;
    }

    // Full schedule view: dynamic non-overlapping split per day!
    // - 0 assigned shifts -> 1 full-day column (08:00–22:00)
    // - >=1 assigned shifts -> split around assigned shift(s) with zero time overlap
    const partition = partitionDayTimeline(dateIso, dayShifts);
    const blocks: DayTimelineBlock[] = [];

    for (const s of partition.assignedShifts) {
      blocks.push({
        kind: 'shift',
        key: s.id,
        shift: s,
        startTime: s.startTime,
        endTime: s.endTime,
        durationMinutes: Math.max(60, Math.round(s.durationHours * 60)),
      });
    }

    for (const gap of partition.openGaps) {
      const gapKey = `${gap.startTime}-${gap.endTime}`;
      const existingDoc = partition.matchingOpenShifts.get(gapKey);
      if (existingDoc) {
        blocks.push({
          kind: 'shift',
          key: existingDoc.id,
          shift: existingDoc,
          startTime: existingDoc.startTime,
          endTime: existingDoc.endTime,
          durationMinutes: Math.max(60, Math.round(existingDoc.durationHours * 60)),
        });
      } else {
        blocks.push({
          kind: 'virtual_open',
          key: `vopen_${dateIso}_${gap.startTime}_${gap.endTime}`,
          date: dateIso,
          startTime: gap.startTime,
          endTime: gap.endTime,
          durationHours: gap.durationHours,
          durationMinutes: Math.max(60, Math.round(gap.durationHours * 60)),
          isFullDay: partition.assignedShifts.length === 0,
        });
      }
    }

    blocks.sort(
      (a, b) => parseTimeToMinutes(a.startTime) - parseTimeToMinutes(b.startTime)
    );
    return blocks;
  };

  return (
    <div className="space-y-4">
      {/* Calendar Toolbar */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="inline-flex items-center border border-slate-200 rounded-lg overflow-hidden">
            <button
              type="button"
              onClick={() => handleStep(-1)}
              className="p-2 text-slate-600 hover:bg-slate-50 hover:text-slate-900 cursor-pointer"
              aria-label="Previous period"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={() => onChangeWeekMonday(getMondayOfWeek(todayIso))}
              className="px-3 py-1.5 text-xs font-medium text-slate-700 border-x border-slate-200 hover:bg-slate-50 cursor-pointer"
            >
              Today
            </button>
            <button
              type="button"
              onClick={() => handleStep(1)}
              className="p-2 text-slate-600 hover:bg-slate-50 hover:text-slate-900 cursor-pointer"
              aria-label="Next period"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>

          <h2 className="text-sm font-semibold text-slate-900 tabular-nums">
            {periodLabel}
          </h2>

          <div className="inline-flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
            <button
              type="button"
              onClick={() => setGranularity('week')}
              className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors cursor-pointer ${
                granularity === 'week'
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Week
            </button>
            <button
              type="button"
              onClick={() => setGranularity('month')}
              className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors cursor-pointer ${
                granularity === 'month'
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Month
            </button>
          </div>
        </div>

        {/* Export Controls */}
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={handleExportMine}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 whitespace-nowrap cursor-pointer"
          >
            <Download className="w-3.5 h-3.5" />
            Export My Shifts (.ics)
          </button>
          <button
            type="button"
            onClick={handleExportVisible}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-900 bg-slate-100 rounded-lg hover:bg-slate-200 whitespace-nowrap cursor-pointer"
          >
            <Download className="w-3.5 h-3.5" />
            Export {granularity === 'week' ? 'Week' : 'Month'} (.ics)
          </button>
        </div>
      </div>

      {/* Week Grid — Dynamic Non-Overlapping Column Splitting */}
      {granularity === 'week' ? (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="grid grid-cols-1 md:grid-cols-7 divide-y md:divide-y-0 md:divide-x divide-slate-200">
            {weekDates.map((dateIso, idx) => {
              const blocks = buildDayTimelineBlocks(dateIso);
              const dateObj = parseIsoDateLocal(dateIso);
              const isToday = dateIso === todayIso;
              const dayNum = dateObj.getDate();

              return (
                <div key={dateIso} className="flex flex-col">
                  <div
                    className={`px-3 py-2.5 border-b border-slate-200 flex items-center justify-between ${
                      isToday ? 'bg-blue-50/70' : 'bg-slate-50/60'
                    }`}
                  >
                    <span className="text-xs font-medium text-slate-600">
                      {WEEKDAY_SHORT[idx]}
                    </span>
                    <span
                      className={`text-xs font-mono tabular-nums font-semibold ${
                        isToday ? 'text-blue-700' : 'text-slate-900'
                      }`}
                    >
                      {dayNum}
                    </span>
                  </div>

                  <div className="p-2 flex flex-col gap-2 flex-1 min-h-[380px]">
                    {blocks.length === 0 ? (
                      <div className="flex-1 flex items-center justify-center text-[11px] text-slate-400">
                        No matching shifts
                      </div>
                    ) : (
                      blocks.map((block) => {
                        if (block.kind === 'virtual_open') {
                          const mySub = getMyMatchingSubmission({
                            date: block.date,
                            startTime: block.startTime,
                            endTime: block.endTime,
                            department: 'Operations',
                          });
                          const subCount = getMatchingSubmissionsCount({
                            date: block.date,
                            startTime: block.startTime,
                            endTime: block.endTime,
                            department: 'Operations',
                          });

                          return (
                            <button
                              key={block.key}
                              type="button"
                              style={{
                                flexGrow: block.durationMinutes,
                                flexBasis: 0,
                                minHeight: block.isFullDay ? '180px' : '76px',
                              }}
                              onClick={() => {
                                if (onQuickSelectOpenWindow) {
                                  onQuickSelectOpenWindow({
                                    date: block.date,
                                    startTime: block.startTime,
                                    endTime: block.endTime,
                                  });
                                }
                              }}
                              className="w-full text-left p-2.5 rounded-lg border border-dashed border-slate-300 bg-slate-50/70 hover:bg-slate-100/80 transition-colors flex flex-col justify-between gap-2 cursor-pointer"
                            >
                              <div className="space-y-1 min-w-0">
                                <div className="flex items-center justify-between gap-1 text-[11px] font-mono tabular-nums text-slate-600">
                                  <span>
                                    {block.startTime}–{block.endTime}
                                  </span>
                                  <span>{block.durationHours.toFixed(1)}h</span>
                                </div>
                                <div className="text-xs font-semibold text-slate-900 truncate">
                                  {block.isFullDay
                                    ? 'Full Day Coverage (Open)'
                                    : 'Open Shift Gap'}
                                </div>
                                <div className="text-[11px] text-slate-600 truncate">
                                  Unassigned · 1 worker max
                                </div>
                              </div>

                              <div className="text-[11px]">
                                {mySub ? (
                                  <span className="text-blue-700 font-medium">
                                    Open · You Submitted
                                  </span>
                                ) : isManager && subCount > 0 ? (
                                  <span className="text-blue-700 font-medium">
                                    Open · {subCount} Submitted
                                  </span>
                                ) : (
                                  <span className="text-slate-500">
                                    {isManager
                                      ? 'Open · Click to assign'
                                      : 'Open · Click to submit'}
                                  </span>
                                )}
                              </div>
                            </button>
                          );
                        }

                        const shift = block.shift;
                        const isOpen = shift.status === 'open' || !shift.assignedUid;
                        const isMine = !isOpen && shift.assignedUid === profile.uid;
                        const isConflict =
                          !isOpen &&
                          (shift.status === 'conflict' || shift.candidateUids.length > 1);
                        const isFullOpenDay = isOpen && blocks.length === 1;

                        return (
                          <button
                            key={block.key}
                            type="button"
                            style={{
                              flexGrow: block.durationMinutes,
                              flexBasis: 0,
                              minHeight: isFullOpenDay ? '180px' : '76px',
                            }}
                            onClick={() => setInspectedShift(shift)}
                            className={`w-full text-left p-2.5 rounded-lg border transition-colors flex flex-col justify-between gap-2 cursor-pointer ${
                              isOpen
                                ? 'bg-slate-50/70 border-dashed border-slate-300 hover:bg-slate-100/80'
                                : isConflict
                                ? 'bg-amber-50/70 border-amber-200 hover:bg-amber-50'
                                : isMine
                                ? 'bg-blue-50/50 border-blue-200 hover:bg-blue-50'
                                : 'bg-white border-slate-200 hover:bg-slate-50'
                            }`}
                          >
                            <div className="space-y-1 min-w-0">
                              <div className="flex items-center justify-between gap-1 text-[11px] font-mono tabular-nums text-slate-600">
                                <span>
                                  {shift.startTime}–{shift.endTime}
                                </span>
                                <span>{shift.durationHours.toFixed(1)}h</span>
                              </div>
                              <div className="text-xs font-semibold text-slate-900 truncate">
                                {shift.title}
                              </div>
                              <div className="text-[11px] text-slate-600 truncate">
                                {shift.assignedName || 'Unassigned'} · {shift.department}
                              </div>
                            </div>
                            <div className="text-[11px]">{renderStatusText(shift)}</div>
                          </button>
                        );
                      })
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        /* Month Grid */
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="grid grid-cols-7 border-b border-slate-200 bg-slate-50/60">
            {WEEKDAY_SHORT.map((d) => (
              <div key={d} className="py-2 px-3 text-xs font-medium text-slate-500 text-center">
                {d}
              </div>
            ))}
          </div>
          <div className="grid grid-cols-7 divide-x divide-y divide-slate-200">
            {monthGridDates.map((dateIso) => {
              const dateObj = parseIsoDateLocal(dateIso);
              const inCurrentMonth = dateObj.getMonth() === anchorDate.getMonth();
              const isToday = dateIso === todayIso;
              const blocks = buildDayTimelineBlocks(dateIso);

              return (
                <div
                  key={dateIso}
                  className={`min-h-[112px] p-2 space-y-1.5 ${
                    inCurrentMonth ? 'bg-white' : 'bg-slate-50/60'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span
                      className={`text-xs font-mono tabular-nums ${
                        isToday
                          ? 'font-bold text-blue-700'
                          : inCurrentMonth
                          ? 'font-medium text-slate-800'
                          : 'text-slate-400'
                      }`}
                    >
                      {dateObj.getDate()}
                    </span>
                    {blocks.length > 0 && (
                      <span className="text-[10px] font-mono tabular-nums text-slate-400">
                        {blocks.length}
                      </span>
                    )}
                  </div>

                  <div className="space-y-1">
                    {blocks.slice(0, 3).map((block) => {
                      if (block.kind === 'virtual_open') {
                        return (
                          <button
                            key={block.key}
                            type="button"
                            onClick={() => {
                              if (onQuickSelectOpenWindow) {
                                onQuickSelectOpenWindow({
                                  date: block.date,
                                  startTime: block.startTime,
                                  endTime: block.endTime,
                                });
                              }
                            }}
                            className="w-full text-left px-1.5 py-1 rounded text-[11px] truncate border bg-slate-50 border-dashed border-slate-300 text-slate-600 cursor-pointer"
                          >
                            <span className="font-mono tabular-nums">{block.startTime}</span> Open
                          </button>
                        );
                      }

                      const shift = block.shift;
                      const isOpen = shift.status === 'open' || !shift.assignedUid;
                      return (
                        <button
                          key={shift.id}
                          type="button"
                          onClick={() => setInspectedShift(shift)}
                          className={`w-full text-left px-1.5 py-1 rounded text-[11px] truncate border cursor-pointer ${
                            isOpen
                              ? 'bg-slate-50 border-dashed border-slate-300 text-slate-600'
                              : shift.status === 'conflict' || shift.candidateUids.length > 1
                              ? 'bg-amber-50 border-amber-200 text-amber-900'
                              : shift.assignedUid === profile.uid
                              ? 'bg-blue-50 border-blue-200 text-blue-900'
                              : 'bg-slate-50 border-slate-200 text-slate-800'
                          }`}
                        >
                          <span className="font-mono tabular-nums">{shift.startTime}</span>{' '}
                          {isOpen ? 'Open' : shift.assignedName.split(' ')[0]}
                        </button>
                      );
                    })}
                    {blocks.length > 3 && (
                      <button
                        type="button"
                        onClick={() => {
                          onChangeWeekMonday(getMondayOfWeek(dateIso));
                          setGranularity('week');
                        }}
                        className="text-[10px] font-medium text-blue-700 hover:underline px-1 cursor-pointer"
                      >
                        +{blocks.length - 3} more
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Shift Inspection Modal (Edit, Request Change, Google Calendar / .ics Export) */}
      {inspectedShift && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-xl max-w-md w-full p-6 space-y-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-base font-semibold text-slate-900">
                  {inspectedShift.title}
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  {inspectedShift.department} ·{' '}
                  <span className="font-mono tabular-nums">
                    {inspectedShift.date} {inspectedShift.startTime}–{inspectedShift.endTime}
                  </span>{' '}
                  ({inspectedShift.durationHours.toFixed(1)}h)
                </p>
              </div>
              <button
                type="button"
                onClick={() => setInspectedShift(null)}
                className="p-1 text-slate-400 hover:text-slate-700 cursor-pointer"
                aria-label="Close shift details"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-lg space-y-1.5 text-xs">
              <div className="flex items-center justify-between">
                <span className="text-slate-500">Assigned Staff</span>
                <span className="font-medium text-slate-900">
                  {inspectedShift.assignedName || 'Unassigned (Left Blank)'}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-500">Status</span>
                {renderStatusText(inspectedShift)}
              </div>
              {inspectedShift.fairnessNote && (
                <div className="pt-1.5 border-t border-slate-200 text-slate-600 leading-relaxed">
                  {inspectedShift.fairnessNote}
                </div>
              )}
            </div>

            {/* Submit / Withdraw for Open Blank Shifts */}
            {(inspectedShift.status === 'open' || !inspectedShift.assignedUid) &&
              (() => {
                const mySub = getMyMatchingSubmission(inspectedShift);
                const isBusy = submittingShiftId === inspectedShift.id;
                return (
                  <div className="p-3.5 bg-blue-50/50 border border-blue-200 rounded-lg flex items-center justify-between gap-3">
                    <div className="text-xs text-slate-700">
                      {mySub ? (
                        <span>You submitted availability for this shift.</span>
                      ) : (
                        <span>This slot is open. Submit to become eligible for assignment.</span>
                      )}
                    </div>
                    {mySub ? (
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={async () => {
                          setSubmittingShiftId(inspectedShift.id);
                          try {
                            await onWithdrawSubmission(mySub.id);
                          } finally {
                            setSubmittingShiftId(null);
                          }
                        }}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 whitespace-nowrap shrink-0 cursor-pointer"
                      >
                        <Check className="w-3.5 h-3.5 text-blue-700" />
                        {isBusy ? 'Updating...' : 'Withdraw'}
                      </button>
                    ) : (
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={async () => {
                          setSubmittingShiftId(inspectedShift.id);
                          try {
                            await onSubmitForShift(inspectedShift);
                          } finally {
                            setSubmittingShiftId(null);
                          }
                        }}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-blue-700 rounded-lg hover:bg-blue-800 whitespace-nowrap shrink-0 cursor-pointer"
                      >
                        <Hand className="w-3.5 h-3.5" />
                        {isBusy ? 'Submitting...' : 'Submit for Shift'}
                      </button>
                    )}
                  </div>
                );
              })()}

            {/* Calendar Export Options */}
            <div className="space-y-2">
              <div className="text-xs font-medium text-slate-700">Export this shift</div>
              <div className="grid grid-cols-2 gap-2">
                <a
                  href={buildGoogleCalendarUrl(inspectedShift)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50"
                >
                  <CalendarPlus className="w-3.5 h-3.5" />
                  Google Calendar
                </a>
                <button
                  type="button"
                  onClick={() => {
                    downloadIcsFile(
                      [inspectedShift],
                      `shift-${inspectedShift.date}-${inspectedShift.id}.ics`,
                      inspectedShift.title
                    );
                    onNotifyBanner('Downloaded .ics calendar event.');
                  }}
                  className="inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 cursor-pointer"
                >
                  <Download className="w-3.5 h-3.5" />
                  Download .ics
                </button>
              </div>
            </div>

            {/* Operational Actions */}
            <div className="pt-2 border-t border-slate-200 flex flex-wrap items-center justify-between gap-2">
              {isManager ? (
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      const target = inspectedShift;
                      setInspectedShift(null);
                      onEditShift(target);
                    }}
                    className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-white bg-slate-900 rounded-lg hover:bg-slate-800 cursor-pointer"
                  >
                    <Pencil className="w-3.5 h-3.5" />
                    Edit Shift
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const target = inspectedShift;
                      setInspectedShift(null);
                      onDeleteShift(target);
                    }}
                    className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-red-700 bg-white border border-red-200 rounded-lg hover:bg-red-50 cursor-pointer"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    Delete
                  </button>
                </div>
              ) : (
                <div />
              )}

              {inspectedShift.status !== 'completed' &&
                inspectedShift.status !== 'open' &&
                Boolean(inspectedShift.assignedUid) && (
                  <button
                    type="button"
                    onClick={() => {
                      const target = inspectedShift;
                      setInspectedShift(null);
                      onRequestChange(target);
                    }}
                    className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 cursor-pointer"
                  >
                    <ArrowRightLeft className="w-3.5 h-3.5" />
                    Request Change
                  </button>
                )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
