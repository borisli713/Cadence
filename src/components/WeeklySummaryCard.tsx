import React, { useMemo } from 'react';
import { ArrowRight, CalendarDays } from 'lucide-react';
import { Shift, StaffDirectoryEntry, UserProfile } from '../types';
import {
  formatIsoDateLocal,
  getMondayOfWeek,
  getWeekDates,
  parseIsoDateLocal,
} from '../utils/calendarExport';

interface WeeklySummaryCardProps {
  profile: UserProfile;
  shifts: Shift[];
  staffDirectory: StaffDirectoryEntry[];
  onNavigateToSchedule: () => void;
}

interface ProgressBarProps {
  label: string;
  summaryText: string;
  completedValue: number;
  upcomingValue: number;
  targetValue: number;
  footnote?: string;
}

const WeeklyProgressBar: React.FC<ProgressBarProps> = ({
  label,
  summaryText,
  completedValue,
  upcomingValue,
  targetValue,
  footnote,
}) => {
  const safeTarget = Math.max(1, targetValue);
  const totalValue = completedValue + upcomingValue;
  const rawPct = Math.round((totalValue / safeTarget) * 100);
  const completedWidth = Math.min(100, (completedValue / safeTarget) * 100);
  const upcomingWidth = Math.min(100 - completedWidth, (upcomingValue / safeTarget) * 100);
  const isOverTarget = totalValue > safeTarget + 0.05;

  return (
    <div className="space-y-2">
      <div className="flex flex-col sm:flex-row sm:items-baseline sm:justify-between gap-1">
        <span className="text-xs font-medium text-slate-700">{label}</span>
        <span className="text-xs text-slate-600 font-mono tabular-nums">{summaryText}</span>
      </div>

      <div
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.min(100, rawPct)}
        className="h-2.5 w-full bg-slate-100 rounded-md overflow-hidden flex"
      >
        {completedWidth > 0 && (
          <div
            style={{ width: `${completedWidth}%` }}
            className="h-full bg-slate-900 transition-all duration-200"
          />
        )}
        {upcomingWidth > 0 && (
          <div
            style={{ width: `${upcomingWidth}%` }}
            className={`h-full transition-all duration-200 ${
              isOverTarget ? 'bg-amber-600' : 'bg-blue-700'
            }`}
          />
        )}
      </div>

      {footnote && (
        <div className="text-[11px] text-slate-500 font-mono tabular-nums">{footnote}</div>
      )}
    </div>
  );
};

export const WeeklySummaryCard: React.FC<WeeklySummaryCardProps> = ({
  profile,
  shifts,
  staffDirectory,
  onNavigateToSchedule,
}) => {
  const summary = useMemo(() => {
    const todayIso = formatIsoDateLocal(new Date());
    const mondayIso = getMondayOfWeek(todayIso);
    const weekDates = getWeekDates(mondayIso);
    const sundayIso = weekDates[weekDates.length - 1];

    const startLabel = parseIsoDateLocal(mondayIso).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
    });
    const endLabel = parseIsoDateLocal(sundayIso).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
    });

    const weekShifts = shifts.filter(
      (s) => s.date >= mondayIso && s.date <= sundayIso
    );

    const upcomingTeamShifts = weekShifts.filter(
      (s) =>
        s.date >= todayIso &&
        s.status !== 'completed' &&
        s.status !== 'open' &&
        Boolean(s.assignedUid)
    );
    const completedTeamShifts = weekShifts.filter(
      (s) => s.status === 'completed'
    );
    const openUpcomingShifts = weekShifts.filter(
      (s) => s.date >= todayIso && (s.status === 'open' || !s.assignedUid)
    );

    const myUpcomingShifts = upcomingTeamShifts.filter(
      (s) => s.assignedUid === profile.uid
    );
    const myCompletedShifts = completedTeamShifts.filter(
      (s) => s.assignedUid === profile.uid
    );

    const teamUpcomingHours = upcomingTeamShifts.reduce(
      (acc, s) => acc + s.durationHours,
      0
    );
    const teamCompletedHours = completedTeamShifts.reduce(
      (acc, s) => acc + s.durationHours,
      0
    );
    const openUpcomingHours = openUpcomingShifts.reduce(
      (acc, s) => acc + s.durationHours,
      0
    );

    const myUpcomingHours = myUpcomingShifts.reduce(
      (acc, s) => acc + s.durationHours,
      0
    );
    const myCompletedHours = myCompletedShifts.reduce(
      (acc, s) => acc + s.durationHours,
      0
    );

    const myTarget = Math.max(1, profile.weeklyHoursTarget || 40);
    const teamTarget = Math.max(
      myTarget,
      staffDirectory.reduce((acc, m) => acc + (m.weeklyHoursTarget || 40), 0)
    );

    return {
      rangeLabel: `${startLabel} – ${endLabel}`,
      totalWeekShifts: weekShifts.length,
      upcomingTeamCount: upcomingTeamShifts.length,
      upcomingTeamHours: teamUpcomingHours,
      completedTeamCount: completedTeamShifts.length,
      completedTeamHours: teamCompletedHours,
      openUpcomingCount: openUpcomingShifts.length,
      openUpcomingHours,
      myUpcomingCount: myUpcomingShifts.length,
      myUpcomingHours,
      myCompletedCount: myCompletedShifts.length,
      myCompletedHours,
      myTarget,
      teamTarget,
    };
  }, [shifts, staffDirectory, profile.uid, profile.weeklyHoursTarget]);

  const myCombinedHours = summary.myCompletedHours + summary.myUpcomingHours;
  const myPct = Math.round((myCombinedHours / summary.myTarget) * 100);
  const teamCombinedHours = summary.completedTeamHours + summary.upcomingTeamHours;
  const teamPct = Math.round((teamCombinedHours / summary.teamTarget) * 100);

  return (
    <section
      aria-label="Weekly Summary"
      className="bg-white border border-slate-200 rounded-xl p-5 space-y-5"
    >
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="space-y-0.5">
          <div className="flex items-center gap-2">
            <CalendarDays className="w-4 h-4 text-slate-500" />
            <h2 className="text-sm font-semibold text-slate-900">Weekly Summary</h2>
            <span aria-hidden="true" className="text-slate-300">
              ·
            </span>
            <span className="text-xs text-slate-500 font-mono tabular-nums">
              {summary.rangeLabel}
            </span>
          </div>
          <p className="text-xs text-slate-500">
            Current week upcoming shift counts, scheduled hours, and weekly target progress.
          </p>
        </div>

        <button
          type="button"
          onClick={onNavigateToSchedule}
          className="inline-flex items-center gap-1 text-xs font-medium text-blue-700 hover:underline whitespace-nowrap shrink-0 cursor-pointer"
        >
          Open weekly schedule
          <ArrowRight className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Top Inline Metrics Strip (hairline divided, no nested cards) */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 py-3.5 border-y border-slate-100">
        <div className="space-y-0.5">
          <div className="text-xs text-slate-500">Upcoming Shifts (Week)</div>
          <div className="text-lg font-semibold font-mono tabular-nums text-slate-900">
            {summary.upcomingTeamCount}
          </div>
          <div className="text-[11px] text-slate-500 font-mono tabular-nums">
            {summary.myUpcomingCount} assigned to you
          </div>
        </div>

        <div className="space-y-0.5">
          <div className="text-xs text-slate-500">Upcoming Hours (Week)</div>
          <div className="text-lg font-semibold font-mono tabular-nums text-slate-900">
            {summary.upcomingTeamHours.toFixed(1)}h
          </div>
          <div className="text-[11px] text-slate-500 font-mono tabular-nums">
            {summary.myUpcomingHours.toFixed(1)}h assigned to you
          </div>
        </div>

        <div className="space-y-0.5">
          <div className="text-xs text-slate-500">Completed This Week</div>
          <div className="text-lg font-semibold font-mono tabular-nums text-slate-900">
            {summary.completedTeamHours.toFixed(1)}h
          </div>
          <div className="text-[11px] text-slate-500 font-mono tabular-nums">
            {summary.completedTeamCount} completed{' '}
            {summary.completedTeamCount === 1 ? 'shift' : 'shifts'}
          </div>
        </div>

        <div className="space-y-0.5">
          <div className="text-xs text-slate-500">Open / Blank Slots</div>
          <div className="text-lg font-semibold font-mono tabular-nums text-slate-900">
            {summary.openUpcomingCount}
          </div>
          <div className="text-[11px] text-slate-500 font-mono tabular-nums">
            {summary.openUpcomingHours.toFixed(1)}h awaiting submission
          </div>
        </div>
      </div>

      {/* Progress Bars */}
      {summary.totalWeekShifts === 0 ? (
        <div className="py-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 text-xs text-slate-500">
          <span>
            No shifts are scheduled yet for the current week ({summary.rangeLabel}).
          </span>
          <button
            type="button"
            onClick={onNavigateToSchedule}
            className="px-3.5 py-2 text-xs font-medium text-white bg-slate-900 rounded-lg hover:bg-slate-800 whitespace-nowrap shrink-0 cursor-pointer"
          >
            Schedule Current Week
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          <WeeklyProgressBar
            label="My Weekly Hours Progress"
            summaryText={`${myCombinedHours.toFixed(1)}h / ${summary.myTarget.toFixed(0)}h target (${myPct}%)`}
            completedValue={summary.myCompletedHours}
            upcomingValue={summary.myUpcomingHours}
            targetValue={summary.myTarget}
            footnote={`${summary.myCompletedHours.toFixed(1)}h completed · ${summary.myUpcomingHours.toFixed(1)}h upcoming (${summary.myUpcomingCount} ${summary.myUpcomingCount === 1 ? 'shift' : 'shifts'})`}
          />

          <WeeklyProgressBar
            label="Team Weekly Capacity Progress"
            summaryText={`${teamCombinedHours.toFixed(1)}h / ${summary.teamTarget.toFixed(0)}h team target (${teamPct}%)`}
            completedValue={summary.completedTeamHours}
            upcomingValue={summary.upcomingTeamHours}
            targetValue={summary.teamTarget}
            footnote={`${summary.completedTeamHours.toFixed(1)}h completed · ${summary.upcomingTeamHours.toFixed(1)}h upcoming (${summary.upcomingTeamCount} ${summary.upcomingTeamCount === 1 ? 'shift' : 'shifts'})`}
          />

          {/* Compact Bar Key */}
          <div className="flex flex-wrap items-center gap-4 pt-1 text-[11px] text-slate-500">
            <span className="inline-flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-sm bg-slate-900 inline-block" />
              Completed this week
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-sm bg-blue-700 inline-block" />
              Upcoming scheduled
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-sm bg-slate-200 inline-block" />
              Remaining weekly target
            </span>
          </div>
        </div>
      )}
    </section>
  );
};
