import React, { useMemo, useState } from 'react';
import {
  CheckCircle2,
  Download,
  History,
  RotateCcw,
  XCircle,
} from 'lucide-react';
import {
  ScheduleChangeRequest,
  TimeOffRequest,
  UserProfile,
} from '../types';
import {
  formatDateTimeCompact,
  formatTimestampHuman,
  getTimestampMillis,
} from '../utils/timestamps';

interface ShiftHistoryViewProps {
  profile: UserProfile;
  scheduleChanges: ScheduleChangeRequest[];
  timeOffRequests: TimeOffRequest[];
  onNotifyBanner: (msg: string) => void;
}

type DecisionFilter = 'all' | 'approved' | 'denied';
type SourceFilter = 'all' | 'shift_change' | 'time_off';

interface UnifiedHistoryItem {
  key: string;
  id: string;
  source: 'shift_change' | 'time_off';
  kindLabel: string;
  title: string;
  department: string;
  staffName: string;
  scheduleSummary: string;
  reason: string;
  decision: 'approved' | 'denied';
  reviewedByName: string;
  reviewNote: string;
  submittedAt: unknown;
  decidedAt: unknown;
  decidedMillis: number;
}

const CHANGE_TYPE_LABELS: Record<ScheduleChangeRequest['type'], string> = {
  time_change: 'Time Adjustment',
  swap: 'Shift Swap',
  drop: 'Shift Drop',
  claim: 'Shift Claim',
};

function escapeCsvCell(value: string): string {
  const escaped = value.replace(/"/g, '""');
  return `"${escaped}"`;
}

export const ShiftHistoryView: React.FC<ShiftHistoryViewProps> = ({
  profile,
  scheduleChanges,
  timeOffRequests,
  onNotifyBanner,
}) => {
  const isManager = profile.role === 'manager';
  const [decisionFilter, setDecisionFilter] = useState<DecisionFilter>('all');
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>('all');
  const [search, setSearch] = useState('');

  const allResolvedItems = useMemo<UnifiedHistoryItem[]>(() => {
    const items: UnifiedHistoryItem[] = [];

    for (const chg of scheduleChanges) {
      if (chg.status !== 'approved' && chg.status !== 'denied') continue;
      if (
        !isManager &&
        chg.requesterUid !== profile.uid &&
        chg.proposedAssigneeUid !== profile.uid
      ) {
        continue;
      }

      const currentSlot = `${chg.currentDate} ${chg.currentStartTime}–${chg.currentEndTime}`;
      const proposedSlot = `${chg.proposedDate} ${chg.proposedStartTime}–${chg.proposedEndTime}`;
      const assigneeInfo =
        (chg.type === 'swap' || chg.type === 'claim') && chg.proposedAssigneeName
          ? ` → ${chg.proposedAssigneeName}`
          : '';

      const decidedAt = chg.updatedAt || chg.createdAt;
      items.push({
        key: `chg_${chg.id}`,
        id: chg.id,
        source: 'shift_change',
        kindLabel: CHANGE_TYPE_LABELS[chg.type] || 'Shift Change',
        title: chg.shiftTitle,
        department: '',
        staffName: chg.requesterName,
        scheduleSummary:
          currentSlot === proposedSlot
            ? `${currentSlot}${assigneeInfo}`
            : `${currentSlot} → ${proposedSlot}${assigneeInfo}`,
        reason: chg.reason,
        decision: chg.status,
        reviewedByName: chg.reviewedByName || 'Manager',
        reviewNote: chg.reviewNote || '',
        submittedAt: chg.createdAt,
        decidedAt,
        decidedMillis: getTimestampMillis(decidedAt) || getTimestampMillis(chg.createdAt),
      });
    }

    for (const pto of timeOffRequests) {
      if (pto.status !== 'approved' && pto.status !== 'denied') continue;
      if (!isManager && pto.staffUid !== profile.uid) continue;

      const dateRange =
        pto.startDate === pto.endDate
          ? pto.startDate
          : `${pto.startDate} to ${pto.endDate}`;

      const decidedAt = pto.updatedAt || pto.createdAt;
      items.push({
        key: `pto_${pto.id}`,
        id: pto.id,
        source: 'time_off',
        kindLabel: 'Time Off Request',
        title: `Unavailable Dates (${dateRange})`,
        department: pto.department,
        staffName: pto.staffName,
        scheduleSummary: dateRange,
        reason: pto.reason,
        decision: pto.status,
        reviewedByName: pto.reviewedByName || 'Manager',
        reviewNote: pto.reviewNote || '',
        submittedAt: pto.createdAt,
        decidedAt,
        decidedMillis: getTimestampMillis(decidedAt) || getTimestampMillis(pto.createdAt),
      });
    }

    items.sort(
      (a, b) => b.decidedMillis - a.decidedMillis || b.id.localeCompare(a.id)
    );
    return items;
  }, [scheduleChanges, timeOffRequests, isManager, profile.uid]);

  const counts = useMemo(() => {
    const sourceScoped =
      sourceFilter === 'all'
        ? allResolvedItems
        : allResolvedItems.filter((item) => item.source === sourceFilter);

    return {
      total: sourceScoped.length,
      approved: sourceScoped.filter((item) => item.decision === 'approved').length,
      denied: sourceScoped.filter((item) => item.decision === 'denied').length,
    };
  }, [allResolvedItems, sourceFilter]);

  const filteredItems = useMemo(() => {
    const q = search.trim().toLowerCase();
    return allResolvedItems.filter((item) => {
      if (sourceFilter !== 'all' && item.source !== sourceFilter) return false;
      if (decisionFilter !== 'all' && item.decision !== decisionFilter) return false;
      if (q) {
        const hit =
          item.title.toLowerCase().includes(q) ||
          item.staffName.toLowerCase().includes(q) ||
          item.kindLabel.toLowerCase().includes(q) ||
          item.reviewedByName.toLowerCase().includes(q) ||
          item.scheduleSummary.toLowerCase().includes(q) ||
          item.reason.toLowerCase().includes(q) ||
          item.reviewNote.toLowerCase().includes(q);
        if (!hit) return false;
      }
      return true;
    });
  }, [allResolvedItems, sourceFilter, decisionFilter, search]);

  const handleExportCsv = () => {
    if (filteredItems.length === 0) {
      onNotifyBanner('No resolved shift history records match your current filter.');
      return;
    }

    const header = [
      'Request ID',
      'Category',
      'Staff Member',
      'Shift / Request',
      'Schedule Window',
      'Decision',
      'Reviewed By',
      'Decision Timestamp',
      'Submitted Timestamp',
      'Reason',
      'Review Note',
    ];

    const rows = filteredItems.map((item) => [
      item.id,
      item.kindLabel,
      item.staffName,
      item.title,
      item.scheduleSummary,
      item.decision === 'approved' ? 'Approved' : 'Rejected',
      item.reviewedByName,
      formatDateTimeCompact(item.decidedAt),
      formatDateTimeCompact(item.submittedAt),
      item.reason,
      item.reviewNote,
    ]);

    const csv = [header, ...rows]
      .map((row) => row.map((cell) => escapeCsvCell(cell)).join(','))
      .join('\n');

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `cadence-shift-history-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    onNotifyBanner(`Exported ${filteredItems.length} shift history record(s) to CSV.`);
  };

  const resetFilters = () => {
    setDecisionFilter('all');
    setSourceFilter('all');
    setSearch('');
  };

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900 tracking-tight">
            Shift History
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            Past approved and rejected shift requests with decision timestamps, synced in real time with Firebase and the Android app.
          </p>
        </div>

        <button
          type="button"
          onClick={handleExportCsv}
          className="inline-flex items-center gap-2 px-4 py-2 text-xs font-medium text-slate-800 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
        >
          <Download className="w-3.5 h-3.5" />
          Export History (.csv)
        </button>
      </div>

      {/* Summary Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-1.5">
          <div className="text-xs font-medium text-slate-500">Resolved Requests</div>
          <div className="text-2xl font-semibold font-mono tabular-nums text-slate-900">
            {counts.total}
          </div>
          <div className="text-xs text-slate-500">
            {isManager ? 'Across all team members' : 'Involving your shifts'}
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-1.5">
          <div className="text-xs font-medium text-slate-500">Approved</div>
          <div className="text-2xl font-semibold font-mono tabular-nums text-emerald-700">
            {counts.approved}
          </div>
          <div className="text-xs text-slate-500">
            Applied to active schedule
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-1.5">
          <div className="text-xs font-medium text-slate-500">Rejected</div>
          <div className="text-2xl font-semibold font-mono tabular-nums text-red-700">
            {counts.denied}
          </div>
          <div className="text-xs text-slate-500">
            Declined by manager review
          </div>
        </div>
      </div>

      {/* Toolbar: Decision Tabs, Type Tabs, Search */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <div className="inline-flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
            {(
              [
                { key: 'all', label: `All (${counts.total})` },
                { key: 'approved', label: `Approved (${counts.approved})` },
                { key: 'denied', label: `Rejected (${counts.denied})` },
              ] as const
            ).map((tab) => (
              <button
                key={tab.key}
                type="button"
                onClick={() => setDecisionFilter(tab.key)}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  decisionFilter === tab.key
                    ? 'bg-white text-slate-900 shadow-sm'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <div className="inline-flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
            {(
              [
                { key: 'all', label: 'All Requests' },
                { key: 'shift_change', label: 'Shift Changes' },
                { key: 'time_off', label: 'Time Off' },
              ] as const
            ).map((tab) => (
              <button
                key={tab.key}
                type="button"
                onClick={() => setSourceFilter(tab.key)}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  sourceFilter === tab.key
                    ? 'bg-white text-slate-900 shadow-sm'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search shift, staff, reviewer, or note..."
          className="w-full lg:w-72 px-3 py-1.5 text-sm bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
        />
      </div>

      {/* Resolved Requests Table */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        {filteredItems.length === 0 ? (
          <div className="p-10 text-center space-y-3">
            <History className="w-6 h-6 text-slate-300 mx-auto" />
            <div className="space-y-1">
              <p className="text-sm font-medium text-slate-700">
                {allResolvedItems.length === 0
                  ? 'No approved or rejected shift requests yet.'
                  : 'No shift history entries match your filters.'}
              </p>
              <p className="text-xs text-slate-500">
                {allResolvedItems.length === 0
                  ? 'Once a manager approves or rejects a shift request on Web or Android, it will appear here with its decision timestamp.'
                  : 'Adjust the decision tab, request type filter, or search text to view matching history.'}
              </p>
            </div>
            {allResolvedItems.length > 0 && (
              <button
                type="button"
                onClick={resetFilters}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-slate-800 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 cursor-pointer"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                Reset Filters
              </button>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/60 text-xs font-medium text-slate-500">
                  <th className="py-3 px-4">Request &amp; Staff</th>
                  <th className="py-3 px-4">Schedule Window</th>
                  <th className="py-3 px-4">Decision</th>
                  <th className="py-3 px-4">Reviewed By &amp; Note</th>
                  <th className="py-3 px-4 text-right">Decision Timestamp</th>
                  <th className="py-3 px-4 text-right">Submitted At</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-sm">
                {filteredItems.map((item) => (
                  <tr key={item.key} className="hover:bg-slate-50/70 transition-colors">
                    <td className="py-3.5 px-4 align-top">
                      <div className="font-medium text-slate-900">{item.title}</div>
                      <div className="text-xs text-slate-500 mt-0.5">
                        {item.kindLabel} · {item.staffName}
                        {item.department ? ` · ${item.department}` : ''}
                      </div>
                      {item.reason && (
                        <div className="text-xs text-slate-600 mt-1 max-w-sm">
                          {item.reason}
                        </div>
                      )}
                    </td>

                    <td className="py-3.5 px-4 align-top font-mono tabular-nums text-xs text-slate-700 whitespace-nowrap">
                      {item.scheduleSummary}
                    </td>

                    <td className="py-3.5 px-4 align-top whitespace-nowrap">
                      {item.decision === 'approved' ? (
                        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-700">
                          <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                          <span>Approved</span>
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-red-700">
                          <XCircle className="w-3.5 h-3.5 shrink-0" />
                          <span>Rejected</span>
                        </span>
                      )}
                    </td>

                    <td className="py-3.5 px-4 align-top max-w-xs">
                      <div className="text-xs font-medium text-slate-800">
                        {item.reviewedByName}
                      </div>
                      <div className="text-xs text-slate-500 mt-0.5">
                        {item.reviewNote || 'No review note'}
                      </div>
                    </td>

                    <td
                      className="py-3.5 px-4 align-top text-right font-mono tabular-nums text-xs text-slate-900 whitespace-nowrap"
                      title={formatTimestampHuman(item.decidedAt)}
                    >
                      {formatDateTimeCompact(item.decidedAt)}
                    </td>

                    <td
                      className="py-3.5 px-4 align-top text-right font-mono tabular-nums text-xs text-slate-500 whitespace-nowrap"
                      title={formatTimestampHuman(item.submittedAt)}
                    >
                      {formatDateTimeCompact(item.submittedAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
