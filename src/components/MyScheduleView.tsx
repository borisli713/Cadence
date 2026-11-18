import React, { useMemo, useState } from 'react';
import {
  AlertCircle,
  ArrowRightLeft,
  Calendar,
  CalendarDays,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Clock,
  Download,
  ExternalLink,
  List,
  RotateCcw,
  Scale,
  X,
} from 'lucide-react';
import {
  ScheduleChangeType,
  Shift,
  StaffDirectoryEntry,
  UserProfile,
} from '../types';
import { createScheduleChangeRequest } from '../services/firestoreService';
import {
  addDaysIso,
  buildGoogleCalendarUrl,
  downloadIcsFile,
  formatIsoDateLocal,
  getMondayOfWeek,
  getWeekDates,
  parseIsoDateLocal,
} from '../utils/calendarExport';

interface MyScheduleViewProps {
  profile: UserProfile;
  assignedShifts: Shift[];
  staffDirectory: StaffDirectoryEntry[];
  onOpenShiftReports: () => void;
  onOpenTeamSchedule: () => void;
  onNotifyBanner: (msg: string) => void;
}

type TimeScope = 'upcoming' | 'week' | 'completed' | 'all';
type LayoutMode = 'list' | 'week';

const WEEKDAY_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export const MyScheduleView: React.FC<MyScheduleViewProps> = ({
  profile,
  assignedShifts,
  staffDirectory,
  onOpenShiftReports,
  onOpenTeamSchedule,
  onNotifyBanner,
}) => {
  const todayIso = useMemo(() => formatIsoDateLocal(new Date()), []);
  const currentWeekMonday = useMemo(() => getMondayOfWeek(todayIso), [todayIso]);

  const [selectedWeekMonday, setSelectedWeekMonday] = useState(currentWeekMonday);
  const [scope, setScope] = useState<TimeScope>('upcoming');
  const [layoutMode, setLayoutMode] = useState<LayoutMode>('list');
  const [search, setSearch] = useState('');

  // Schedule Change Request Modal State
  const [changeTargetShift, setChangeTargetShift] = useState<Shift | null>(null);
  const [changeType, setChangeType] = useState<ScheduleChangeType>('time_change');
  const [proposedDate, setProposedDate] = useState('');
  const [proposedStart, setProposedStart] = useState('');
  const [proposedEnd, setProposedEnd] = useState('');
  const [proposedAssigneeUid, setProposedAssigneeUid] = useState('');
  const [changeReason, setChangeReason] = useState('');
  const [submittingChange, setSubmittingChange] = useState(false);

  const myShifts = useMemo(() => {
    return assignedShifts
      .filter((s) => s.assignedUid === profile.uid && s.status !== 'open')
      .sort(
        (a, b) =>
          a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime)
      );
  }, [assignedShifts, profile.uid]);

  const weekDates = useMemo(
    () => getWeekDates(selectedWeekMonday),
    [selectedWeekMonday]
  );

  const periodLabel = useMemo(() => {
    const start = parseIsoDateLocal(weekDates[0]);
    const end = parseIsoDateLocal(weekDates[6]);
    const startTxt = start.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
    });
    const endTxt = end.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
    return `${startTxt} – ${endTxt}`;
  }, [weekDates]);

  const stats = useMemo(() => {
    const upcoming = myShifts.filter(
      (s) => s.date >= todayIso && s.status !== 'completed'
    );
    const completed = myShifts.filter((s) => s.status === 'completed');

    const currentWeekDates = getWeekDates(currentWeekMonday);
    const weekStart = currentWeekDates[0];
    const weekEnd = currentWeekDates[currentWeekDates.length - 1];
    const thisWeekShifts = myShifts.filter(
      (s) => s.date >= weekStart && s.date <= weekEnd
    );

    const upcomingHours = upcoming.reduce((acc, s) => acc + s.durationHours, 0);
    const completedHours = completed.reduce((acc, s) => acc + s.durationHours, 0);
    const thisWeekHours = thisWeekShifts.reduce(
      (acc, s) => acc + s.durationHours,
      0
    );

    return {
      nextShift: upcoming[0] || null,
      upcomingCount: upcoming.length,
      upcomingHours,
      completedCount: completed.length,
      completedHours,
      thisWeekCount: thisWeekShifts.length,
      thisWeekHours,
    };
  }, [myShifts, todayIso, currentWeekMonday]);

  const filteredListShifts = useMemo(() => {
    const currentWeekSet = new Set(getWeekDates(currentWeekMonday));
    const q = search.trim().toLowerCase();

    const matched = myShifts.filter((s) => {
      if (scope === 'upcoming' && (s.date < todayIso || s.status === 'completed')) {
        return false;
      }
      if (scope === 'week' && !currentWeekSet.has(s.date)) {
        return false;
      }
      if (scope === 'completed' && s.status !== 'completed') {
        return false;
      }
      if (q) {
        const hit =
          s.title.toLowerCase().includes(q) ||
          s.department.toLowerCase().includes(q) ||
          s.date.includes(q) ||
          (s.fairnessNote || '').toLowerCase().includes(q);
        if (!hit) return false;
      }
      return true;
    });

    if (scope === 'completed' || scope === 'all') {
      return [...matched].sort(
        (a, b) =>
          b.date.localeCompare(a.date) || b.startTime.localeCompare(a.startTime)
      );
    }

    return matched;
  }, [myShifts, scope, search, todayIso, currentWeekMonday]);

  const weekShiftsByDate = useMemo(() => {
    const q = search.trim().toLowerCase();
    const map = new Map<string, Shift[]>();
    for (const s of myShifts) {
      if (q) {
        const hit =
          s.title.toLowerCase().includes(q) ||
          s.department.toLowerCase().includes(q) ||
          s.date.includes(q);
        if (!hit) continue;
      }
      const list = map.get(s.date) || [];
      list.push(s);
      map.set(s.date, list);
    }
    return map;
  }, [myShifts, search]);

  const handleExportMyShifts = () => {
    const toExport =
      layoutMode === 'week'
        ? myShifts.filter((s) => weekDates.includes(s.date))
        : filteredListShifts.length > 0
        ? filteredListShifts
        : myShifts;

    if (toExport.length === 0) {
      onNotifyBanner('You have no assigned shifts in this view to export.');
      return;
    }

    downloadIcsFile(
      toExport,
      `cadence-my-schedule-${selectedWeekMonday}.ics`,
      `${profile.displayName} Assigned Shifts`
    );
    onNotifyBanner(
      `Exported ${toExport.length} assigned shift(s) to .ics calendar file.`
    );
  };

  const openChangeModal = (shift: Shift) => {
    setChangeTargetShift(shift);
    setChangeType('time_change');
    setProposedDate(shift.date);
    setProposedStart(shift.startTime);
    setProposedEnd(shift.endTime);
    setProposedAssigneeUid(shift.assignedUid || profile.uid);
    setChangeReason('');
  };

  const handleSubmitChange = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!changeTargetShift || !changeReason.trim()) return;
    setSubmittingChange(true);
    try {
      const assignee = staffDirectory.find((s) => s.uid === proposedAssigneeUid);
      await createScheduleChangeRequest({
        shift: changeTargetShift,
        requesterUid: profile.uid,
        requesterName: profile.displayName,
        type: changeType,
        proposedDate,
        proposedStartTime: proposedStart,
        proposedEndTime: proposedEnd,
        proposedAssigneeUid:
          changeType === 'swap' || changeType === 'claim'
            ? proposedAssigneeUid || profile.uid
            : changeTargetShift.assignedUid,
        proposedAssigneeName:
          changeType === 'swap' || changeType === 'claim'
            ? assignee?.displayName || profile.displayName
            : changeTargetShift.assignedName,
        reason: changeReason,
      });
      setChangeTargetShift(null);
      onNotifyBanner(
        'Schedule change request submitted to managers and synced to Firebase.'
      );
    } finally {
      setSubmittingChange(false);
    }
  };

  const renderShiftStatus = (shift: Shift) => {
    if (shift.status === 'completed') {
      return (
        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-700">
          <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
          <span>Completed</span>
        </span>
      );
    }
    if (shift.status === 'pending_change') {
      return (
        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-amber-700">
          <AlertCircle className="w-3.5 h-3.5 shrink-0" />
          <span>Change Pending</span>
        </span>
      );
    }
    if (shift.status === 'conflict' || shift.candidateUids.length > 1) {
      return (
        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-amber-700">
          <Scale className="w-3.5 h-3.5 shrink-0" />
          <span>Overlap Review</span>
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-blue-700">
        <Clock className="w-3.5 h-3.5 shrink-0" />
        <span>Assigned</span>
      </span>
    );
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900 tracking-tight">
            My Schedule
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            Personal assigned shifts for {profile.displayName} · {profile.department} · synced in real time with Firebase and the Android app.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={handleExportMyShifts}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-slate-800 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Download className="w-3.5 h-3.5" />
            Export My Shifts (.ics)
          </button>
          <button
            type="button"
            onClick={onOpenTeamSchedule}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-white bg-blue-700 rounded-lg hover:bg-blue-800 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <CalendarDays className="w-3.5 h-3.5" />
            Team Schedule
          </button>
        </div>
      </div>

      {/* 4-Column Personal KPI Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-1.5">
          <div className="text-xs font-medium text-slate-500">Next Assigned Shift</div>
          {stats.nextShift ? (
            <>
              <div className="text-base font-semibold font-mono tabular-nums text-slate-900">
                {stats.nextShift.date} · {stats.nextShift.startTime}–{stats.nextShift.endTime}
              </div>
              <div className="text-xs text-slate-500 truncate">
                {stats.nextShift.title} ({stats.nextShift.durationHours.toFixed(1)}h)
              </div>
            </>
          ) : (
            <>
              <div className="text-base font-semibold text-slate-900">None upcoming</div>
              <div className="text-xs text-slate-500">No upcoming shifts assigned</div>
            </>
          )}
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-1.5">
          <div className="text-xs font-medium text-slate-500">Upcoming Assigned</div>
          <div className="text-2xl font-semibold font-mono tabular-nums text-slate-900">
            {stats.upcomingCount}
          </div>
          <div className="text-xs text-slate-500 font-mono tabular-nums">
            {stats.upcomingHours.toFixed(1)}h scheduled ahead
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-1.5">
          <div className="text-xs font-medium text-slate-500">This Week Assigned</div>
          <div className="text-2xl font-semibold font-mono tabular-nums text-slate-900">
            {stats.thisWeekHours.toFixed(1)}h
          </div>
          <div className="text-xs text-slate-500 font-mono tabular-nums">
            {stats.thisWeekCount} {stats.thisWeekCount === 1 ? 'shift' : 'shifts'} · Target{' '}
            {profile.weeklyHoursTarget}h
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-1.5">
          <div className="text-xs font-medium text-slate-500">Completed Shifts</div>
          <div className="text-2xl font-semibold font-mono tabular-nums text-slate-900">
            {stats.completedCount}
          </div>
          <div className="text-xs text-slate-500 font-mono tabular-nums">
            {stats.completedHours.toFixed(1)}h completed
          </div>
        </div>
      </div>

      {/* Toolbar: Layout Switch, Scope Filter, Search */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <div className="inline-flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
            <button
              type="button"
              onClick={() => setLayoutMode('list')}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                layoutMode === 'list'
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <List className="w-3.5 h-3.5" />
              List View
            </button>
            <button
              type="button"
              onClick={() => setLayoutMode('week')}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                layoutMode === 'week'
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Calendar className="w-3.5 h-3.5" />
              Week Calendar
            </button>
          </div>

          {layoutMode === 'list' && (
            <div className="inline-flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
              {(
                [
                  { key: 'upcoming', label: `Upcoming (${stats.upcomingCount})` },
                  { key: 'week', label: `This Week (${stats.thisWeekCount})` },
                  { key: 'completed', label: `Completed (${stats.completedCount})` },
                  { key: 'all', label: `All (${myShifts.length})` },
                ] as const
              ).map((tab) => (
                <button
                  key={tab.key}
                  type="button"
                  onClick={() => setScope(tab.key)}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    scope === tab.key
                      ? 'bg-white text-slate-900 shadow-sm'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          )}
        </div>

        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search my shifts by title, dept, or date..."
          className="w-full lg:w-72 px-3 py-1.5 text-sm bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
        />
      </div>

      {/* Main Schedule Content */}
      {layoutMode === 'week' ? (
        <div className="space-y-4">
          <div className="bg-white border border-slate-200 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <div className="inline-flex items-center border border-slate-200 rounded-lg overflow-hidden bg-white">
                <button
                  type="button"
                  onClick={() =>
                    setSelectedWeekMonday(addDaysIso(selectedWeekMonday, -7))
                  }
                  className="p-2 text-slate-600 hover:bg-slate-50 cursor-pointer"
                  aria-label="Previous week"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedWeekMonday(currentWeekMonday)}
                  className="px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 border-x border-slate-200 cursor-pointer"
                >
                  Today
                </button>
                <button
                  type="button"
                  onClick={() =>
                    setSelectedWeekMonday(addDaysIso(selectedWeekMonday, 7))
                  }
                  className="p-2 text-slate-600 hover:bg-slate-50 cursor-pointer"
                  aria-label="Next week"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
              <span className="text-sm font-semibold text-slate-900 font-mono tabular-nums ml-2">
                {periodLabel}
              </span>
            </div>

            <div className="text-xs text-slate-500 font-mono tabular-nums">
              {
                myShifts.filter((s) => weekDates.includes(s.date)).length
              }{' '}
              assigned shift(s) this week ·{' '}
              {myShifts
                .filter((s) => weekDates.includes(s.date))
                .reduce((acc, s) => acc + s.durationHours, 0)
                .toFixed(1)}
              h total
            </div>
          </div>

          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="grid grid-cols-1 md:grid-cols-7 divide-y md:divide-y-0 md:divide-x divide-slate-200">
              {weekDates.map((dateIso, idx) => {
                const dateObj = parseIsoDateLocal(dateIso);
                const isToday = dateIso === todayIso;
                const dayList = weekShiftsByDate.get(dateIso) || [];

                return (
                  <div key={dateIso} className="min-h-[220px] flex flex-col">
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
                        {dateObj.getDate()}
                      </span>
                    </div>

                    <div className="p-2.5 flex-1 flex flex-col gap-2">
                      {dayList.length === 0 ? (
                        <div className="flex-1 border border-dashed border-slate-200 rounded-lg p-3 flex items-center justify-center text-center text-[11px] text-slate-400">
                          No shift assigned
                        </div>
                      ) : (
                        dayList.map((shift) => (
                          <div
                            key={shift.id}
                            className={`rounded-lg border p-3 flex flex-col justify-between gap-2.5 ${
                              shift.status === 'completed'
                                ? 'bg-slate-50 border-slate-200'
                                : 'bg-blue-50/40 border-blue-200'
                            }`}
                          >
                            <div className="space-y-1">
                              <div className="flex items-center justify-between gap-1 text-[11px] font-mono tabular-nums text-slate-700">
                                <span>
                                  {shift.startTime}–{shift.endTime}
                                </span>
                                <span>{shift.durationHours.toFixed(1)}h</span>
                              </div>
                              <div className="text-xs font-semibold text-slate-900">
                                {shift.title}
                              </div>
                              <div className="text-[11px] text-slate-500">
                                {shift.department}
                              </div>
                            </div>

                            <div className="space-y-2 pt-1 border-t border-slate-200/70">
                              <div>{renderShiftStatus(shift)}</div>
                              <div className="flex flex-wrap items-center gap-1.5">
                                <a
                                  href={buildGoogleCalendarUrl(shift)}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium text-slate-700 bg-white border border-slate-200 rounded hover:bg-slate-50"
                                >
                                  <span>Cal</span>
                                  <ExternalLink className="w-2.5 h-2.5" />
                                </a>
                                {shift.status !== 'completed' && (
                                  <button
                                    type="button"
                                    onClick={() => openChangeModal(shift)}
                                    className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium text-slate-700 bg-white border border-slate-200 rounded hover:bg-slate-50 cursor-pointer"
                                  >
                                    <ArrowRightLeft className="w-2.5 h-2.5" />
                                    <span>Change</span>
                                  </button>
                                )}
                              </div>
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      ) : (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          {filteredListShifts.length === 0 ? (
            <div className="p-10 text-center space-y-3">
              <Calendar className="w-6 h-6 text-slate-300 mx-auto" />
              <div className="space-y-1">
                <p className="text-sm font-medium text-slate-700">
                  {myShifts.length === 0
                    ? 'No shifts are currently assigned to you.'
                    : 'No assigned shifts match your current filter.'}
                </p>
                <p className="text-xs text-slate-500">
                  {myShifts.length === 0
                    ? 'When a manager assigns you to a shift on Web or Android, it will appear here immediately.'
                    : 'Try switching timeframe tabs or clearing your search query.'}
                </p>
              </div>
              {myShifts.length === 0 ? (
                <button
                  type="button"
                  onClick={onOpenTeamSchedule}
                  className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-white bg-slate-900 rounded-lg hover:bg-slate-800 cursor-pointer"
                >
                  <CalendarDays className="w-3.5 h-3.5" />
                  Submit Availability in Team Schedule
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    setScope('all');
                    setSearch('');
                  }}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-slate-800 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 cursor-pointer"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  Show All Assigned Shifts
                </button>
              )}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50/60 text-xs font-medium text-slate-500">
                    <th className="py-3 px-4">Shift &amp; Department</th>
                    <th className="py-3 px-4">Date &amp; Time Window</th>
                    <th className="py-3 px-4 text-right">Duration</th>
                    <th className="py-3 px-4">Status &amp; Notes</th>
                    <th className="py-3 px-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-sm">
                  {filteredListShifts.map((shift) => {
                    const dateLabel = parseIsoDateLocal(shift.date).toLocaleDateString(
                      'en-US',
                      { weekday: 'short', month: 'short', day: 'numeric' }
                    );
                    return (
                      <tr
                        key={shift.id}
                        className="hover:bg-slate-50/70 transition-colors"
                      >
                        <td className="py-3.5 px-4">
                          <div className="font-medium text-slate-900">
                            {shift.title}
                          </div>
                          <div className="text-xs text-slate-500 mt-0.5">
                            {shift.department}
                          </div>
                        </td>

                        <td className="py-3.5 px-4 whitespace-nowrap">
                          <div className="text-xs font-mono tabular-nums font-medium text-slate-900">
                            {shift.date} · {shift.startTime}–{shift.endTime}
                          </div>
                          <div className="text-[11px] text-slate-500 mt-0.5">
                            {dateLabel}
                          </div>
                        </td>

                        <td className="py-3.5 px-4 text-right font-mono tabular-nums text-xs font-medium text-slate-900 whitespace-nowrap">
                          {shift.durationHours.toFixed(1)}h
                        </td>

                        <td className="py-3.5 px-4 max-w-xs">
                          <div>{renderShiftStatus(shift)}</div>
                          {shift.fairnessNote && (
                            <div
                              className="text-[11px] text-slate-500 truncate mt-0.5"
                              title={shift.fairnessNote}
                            >
                              {shift.fairnessNote}
                            </div>
                          )}
                        </td>

                        <td className="py-3.5 px-4 text-right whitespace-nowrap">
                          <div className="inline-flex items-center gap-1.5">
                            <a
                              href={buildGoogleCalendarUrl(shift)}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-md hover:bg-slate-50"
                            >
                              <span>Google Cal</span>
                              <ExternalLink className="w-3 h-3" />
                            </a>

                            {shift.status !== 'completed' && (
                              <>
                                <button
                                  type="button"
                                  onClick={() => openChangeModal(shift)}
                                  className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-md hover:bg-slate-50 cursor-pointer"
                                >
                                  <ArrowRightLeft className="w-3.5 h-3.5" />
                                  Request Change
                                </button>
                                <button
                                  type="button"
                                  onClick={onOpenShiftReports}
                                  className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-blue-700 bg-blue-50/70 border border-blue-200 rounded-md hover:bg-blue-100/70 cursor-pointer"
                                >
                                  <ClipboardList className="w-3.5 h-3.5" />
                                  Log Report
                                </button>
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Modal: Request Schedule Change */}
      {changeTargetShift && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-xl max-w-lg w-full p-6 space-y-5">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold text-slate-900">
                Request Schedule Change
              </h2>
              <button
                type="button"
                onClick={() => setChangeTargetShift(null)}
                className="p-1 text-slate-400 hover:text-slate-700 cursor-pointer"
                aria-label="Close modal"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="text-xs text-slate-600 bg-slate-50 border border-slate-200 rounded-lg p-3">
              <div className="font-semibold text-slate-900">
                {changeTargetShift.title}
              </div>
              <div className="font-mono tabular-nums mt-0.5">
                Current: {changeTargetShift.date} · {changeTargetShift.startTime}–
                {changeTargetShift.endTime} ·{' '}
                <span className="font-sans">{changeTargetShift.department}</span>
              </div>
            </div>

            <form onSubmit={handleSubmitChange} className="space-y-4">
              <div className="space-y-1">
                <label className="block text-xs font-medium text-slate-700">
                  Change Type
                </label>
                <select
                  value={changeType}
                  onChange={(e) =>
                    setChangeType(e.target.value as ScheduleChangeType)
                  }
                  className="w-full px-3 py-2 text-sm bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
                >
                  <option value="time_change">Time / Date Adjustment</option>
                  <option value="swap">Shift Swap with Teammate</option>
                  <option value="drop">Drop Shift</option>
                </select>
              </div>

              {changeType === 'swap' && (
                <div className="space-y-1">
                  <label className="block text-xs font-medium text-slate-700">
                    Swap With Teammate
                  </label>
                  <select
                    value={proposedAssigneeUid}
                    onChange={(e) => setProposedAssigneeUid(e.target.value)}
                    className="w-full px-3 py-2 text-sm bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
                  >
                    {staffDirectory.map((member) => (
                      <option key={member.uid} value={member.uid}>
                        {member.displayName} ({member.department})
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-1">
                  <label className="block text-xs font-medium text-slate-700">
                    Proposed Date
                  </label>
                  <input
                    type="date"
                    required
                    value={proposedDate}
                    onChange={(e) => setProposedDate(e.target.value)}
                    className="w-full px-3 py-2 text-sm font-mono border border-slate-200 rounded-lg"
                  />
                </div>
                <div className="space-y-1">
                  <label className="block text-xs font-medium text-slate-700">
                    Start
                  </label>
                  <input
                    type="time"
                    required
                    value={proposedStart}
                    onChange={(e) => setProposedStart(e.target.value)}
                    className="w-full px-3 py-2 text-sm font-mono border border-slate-200 rounded-lg"
                  />
                </div>
                <div className="space-y-1">
                  <label className="block text-xs font-medium text-slate-700">
                    End
                  </label>
                  <input
                    type="time"
                    required
                    value={proposedEnd}
                    onChange={(e) => setProposedEnd(e.target.value)}
                    className="w-full px-3 py-2 text-sm font-mono border border-slate-200 rounded-lg"
                  />
                </div>
              </div>

              <div className="space-y-1">
                <label className="block text-xs font-medium text-slate-700">
                  Reason
                </label>
                <textarea
                  required
                  rows={3}
                  maxLength={400}
                  value={changeReason}
                  onChange={(e) => setChangeReason(e.target.value)}
                  placeholder="Provide context for your manager..."
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
                />
              </div>

              <div className="pt-2 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setChangeTargetShift(null)}
                  className="px-4 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submittingChange}
                  className="px-4 py-2 text-xs font-medium text-white bg-blue-700 rounded-lg hover:bg-blue-800 disabled:opacity-50 cursor-pointer"
                >
                  {submittingChange ? 'Submitting...' : 'Submit for Approval'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
