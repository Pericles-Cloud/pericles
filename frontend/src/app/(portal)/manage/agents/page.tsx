'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/providers/auth-provider';
import {
  AgentStatus,
  MonitoringConfig,
  MonitoringAuditLog,
  getAgentStatus,
  getMonitoringConfig,
  getMonitoringLogs,
  updateMonitoringConfig,
} from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { MonitoringProgressDialog } from '@/components/monitoring/progress-dialog';
import { DataSourceSettingsDialog } from '@/components/monitoring/data-source-settings-dialog';
import { DataSourceCategory } from '@/lib/api-client';

// Data source categories with icons
const DATA_SOURCES: Array<{ key: DataSourceCategory; label: string; icon: string }> = [
  { key: 'weather', label: 'Weather & Natural Disasters', icon: 'Cloud' },
  { key: 'political', label: 'Political Risk', icon: 'Landmark' },
  { key: 'cybersecurity', label: 'Cybersecurity', icon: 'Shield' },
  { key: 'economic', label: 'Economic & Financial', icon: 'TrendingUp' },
  { key: 'news', label: 'News & Social Media', icon: 'Newspaper' },
  { key: 'maritime', label: 'Maritime & Logistics', icon: 'Anchor' },
  { key: 'labor', label: 'Labor & Social', icon: 'Users' },
  { key: 'regulatory', label: 'Regulatory & Trade', icon: 'Scale' },
  { key: 'pandemic', label: 'Pandemic & Health', icon: 'Heart' },
  { key: 'geopolitical', label: 'Geopolitical & Conflict', icon: 'Globe' },
];

// Risk types
const RISK_TYPES = [
  'natural_disaster',
  'political_instability',
  'cyber_attack',
  'supply_disruption',
  'port_closure',
  'labor_strike',
  'regulatory_change',
  'pandemic',
  'conflict',
  'economic_crisis',
];

export default function AgentsPage() {
  const { currentOrganization } = useAuth();

  const [status, setStatus] = useState<AgentStatus | null>(null);
  const [config, setConfig] = useState<MonitoringConfig | null>(null);
  const [logs, setLogs] = useState<MonitoringAuditLog[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Local config state for editing
  const [radiusKm, setRadiusKm] = useState(100);
  const [severityThreshold, setSeverityThreshold] = useState(0.5);
  const [monitoredRiskTypes, setMonitoredRiskTypes] = useState<string[]>([]);
  const [activeTab, setActiveTab] = useState<'overview' | 'config' | 'logs'>('overview');
  const [showHelpDialog, setShowHelpDialog] = useState(false);
  const [showProgressDialog, setShowProgressDialog] = useState(false);
  const [showSettingsDialog, setShowSettingsDialog] = useState(false);
  const [selectedDataSource, setSelectedDataSource] = useState<DataSourceCategory | null>(null);

  const fetchData = useCallback(async () => {
    if (!currentOrganization?.id) return;

    setIsLoading(true);
    try {
      const [statusRes, configRes, logsRes] = await Promise.all([
        getAgentStatus(currentOrganization.id),
        getMonitoringConfig(currentOrganization.id),
        getMonitoringLogs(currentOrganization.id, 20),
      ]);

      if (statusRes.success && statusRes.data) {
        setStatus(statusRes.data);
      }
      if (configRes.success && configRes.data) {
        setConfig(configRes.data);
        setRadiusKm(configRes.data.geographicFilter.radiusKm);
        setSeverityThreshold(configRes.data.riskFilter.severityThreshold);
        setMonitoredRiskTypes(configRes.data.riskFilter.monitoredRiskTypes);
      }
      if (logsRes.success && logsRes.data) {
        setLogs(logsRes.data);
      }
    } catch (error) {
      console.error('Failed to fetch agent data:', error);
    } finally {
      setIsLoading(false);
    }
  }, [currentOrganization?.id]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Auto-refresh status every 30 seconds
  useEffect(() => {
    if (!currentOrganization?.id) return;

    const interval = setInterval(async () => {
      const statusRes = await getAgentStatus(currentOrganization.id);
      if (statusRes.success && statusRes.data) {
        setStatus(statusRes.data);
      }
    }, 30000);

    return () => clearInterval(interval);
  }, [currentOrganization?.id]);

  const handleTriggerCycle = () => {
    if (!currentOrganization?.id) return;
    setMessage(null);
    setShowProgressDialog(true);
  };

  const handleProgressComplete = (metrics: {
    durationMs: number;
    eventsDetected: number;
    eventsPublished: number;
  } | undefined) => {
    if (metrics) {
      setMessage({
        type: 'success',
        text: `Monitoring cycle completed. Detected ${metrics.eventsDetected} events, published ${metrics.eventsPublished}.`,
      });
    }
    fetchData();
  };

  const handleProgressClose = () => {
    setShowProgressDialog(false);
  };

  const handleOpenSettings = (dataSource: DataSourceCategory) => {
    setSelectedDataSource(dataSource);
    setShowSettingsDialog(true);
  };

  const handleSettingsClose = () => {
    setShowSettingsDialog(false);
    setSelectedDataSource(null);
  };

  const handleSettingsSave = () => {
    // Refresh data after settings change
    fetchData();
  };

  const handleSaveConfig = async () => {
    if (!currentOrganization?.id) return;

    setIsSaving(true);
    setMessage(null);

    try {
      const response = await updateMonitoringConfig(currentOrganization.id, {
        geographicFilter: {
          radiusKm,
          strictMode: false,
        },
        riskFilter: {
          severityThreshold,
          confidenceThreshold: 0.3,
          monitoredRiskTypes,
        },
      });

      if (response.success && response.data) {
        setConfig(response.data);
        setMessage({ type: 'success', text: 'Configuration saved successfully' });
      } else {
        setMessage({
          type: 'error',
          text: response.error?.message || 'Failed to save configuration',
        });
      }
    } catch {
      setMessage({ type: 'error', text: 'Failed to save configuration' });
    } finally {
      setIsSaving(false);
    }
  };

  const toggleRiskType = (type: string) => {
    setMonitoredRiskTypes(prev =>
      prev.includes(type)
        ? prev.filter(t => t !== type)
        : [...prev, type]
    );
  };

  const getStatusColor = (s: AgentStatus['status']) => {
    switch (s) {
      case 'active':
        return 'bg-green-500';
      case 'idle':
        return 'bg-yellow-500';
      case 'error':
        return 'bg-red-500';
      case 'stopped':
        return 'bg-gray-400';
      default:
        return 'bg-gray-400';
    }
  };

  const getStatusText = (s: AgentStatus['status']) => {
    switch (s) {
      case 'active':
        return 'Active';
      case 'idle':
        return 'Idle';
      case 'error':
        return 'Error';
      case 'stopped':
        return 'Stopped';
      default:
        return 'Unknown';
    }
  };

  const getLogStatusBadge = (s: string) => {
    switch (s) {
      case 'success':
        return 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400';
      case 'partial_success':
        return 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400';
      case 'failure':
        return 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400';
      default:
        return 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-400';
    }
  };

  const formatDuration = (ms: number) => {
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
  };

  const formatTimeAgo = (dateStr: string) => {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffSec = Math.floor(diffMs / 1000);
    const diffMin = Math.floor(diffSec / 60);
    const diffHour = Math.floor(diffMin / 60);
    const diffDay = Math.floor(diffHour / 24);

    if (diffSec < 60) return `${diffSec}s ago`;
    if (diffMin < 60) return `${diffMin}m ago`;
    if (diffHour < 24) return `${diffHour}h ago`;
    return `${diffDay}d ago`;
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-900 dark:text-white">Agents</h2>
          <p className="text-gray-600 dark:text-gray-400">
            Configure and monitor AI agents for your organization
          </p>
        </div>
        <Button onClick={handleTriggerCycle}>
          <svg className="size-4 mr-2" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M5.25 5.653c0-.856.917-1.398 1.667-.986l11.54 6.347a1.125 1.125 0 0 1 0 1.972l-11.54 6.347a1.125 1.125 0 0 1-1.667-.986V5.653Z" />
          </svg>
          Run Cycle
        </Button>
      </div>

      {/* Message */}
      {message && (
        <div
          className={`p-3 rounded-md text-sm ${
            message.type === 'success'
              ? 'bg-green-50 text-green-800 dark:bg-green-900/20 dark:text-green-400'
              : 'bg-red-50 text-red-800 dark:bg-red-900/20 dark:text-red-400'
          }`}
        >
          {message.text}
          <button onClick={() => setMessage(null)} className="float-right font-bold">&times;</button>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Agent List (Left Sidebar) */}
        <div className="space-y-4">
          <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">
            Available Agents
          </h3>
          <div className="space-y-2">
            {/* Monitoring Agent */}
            <button
              className="w-full text-left p-4 rounded-lg border border-blue-500 bg-blue-50 dark:bg-blue-900/20 transition-colors"
            >
              <div className="flex items-center gap-3">
                <div className="size-10 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center shrink-0">
                  <svg className="size-5 text-white" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9.75 3.104v5.714a2.25 2.25 0 0 1-.659 1.591L5 14.5M9.75 3.104c-.251.023-.501.05-.75.082m.75-.082a24.301 24.301 0 0 1 4.5 0m0 0v5.714c0 .597.237 1.17.659 1.591L19.8 15.3M14.25 3.104c.251.023.501.05.75.082M19.8 15.3l-1.57.393A9.065 9.065 0 0 1 12 15a9.065 9.065 0 0 0-6.23-.693L5 14.5m14.8.8 1.402 1.402c1.232 1.232.65 3.318-1.067 3.611A48.309 48.309 0 0 1 12 21c-2.773 0-5.491-.235-8.135-.687-1.718-.293-2.3-2.379-1.067-3.61L5 14.5" />
                  </svg>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-gray-900 dark:text-white">Monitoring Agent</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    Risk event detection & analysis
                  </p>
                </div>
                {status && (
                  <div className="flex items-center gap-1.5">
                    <span className={`size-2 rounded-full ${getStatusColor(status.status)}`} />
                    <span className="text-xs text-gray-500 dark:text-gray-400">
                      {getStatusText(status.status)}
                    </span>
                  </div>
                )}
              </div>
            </button>

            {/* Placeholder for future agents */}
            <div className="p-4 rounded-lg border border-dashed border-gray-300 dark:border-gray-700">
              <div className="flex items-center gap-3 opacity-50">
                <div className="size-10 rounded-full bg-gray-200 dark:bg-gray-700 flex items-center justify-center">
                  <svg className="size-5 text-gray-400" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                  </svg>
                </div>
                <div>
                  <p className="font-medium text-gray-500 dark:text-gray-400">More agents coming soon</p>
                  <p className="text-xs text-gray-400 dark:text-gray-500">Validation, Impact Assessment...</p>
                </div>
              </div>
            </div>
          </div>

          {/* Quick Stats */}
          {status && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Quick Stats</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex justify-between">
                  <span className="text-sm text-gray-500 dark:text-gray-400">Total Cycles</span>
                  <span className="font-medium">{status.totalCycles.toLocaleString()}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm text-gray-500 dark:text-gray-400">Events Detected</span>
                  <span className="font-medium">{status.totalEventsDetected.toLocaleString()}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm text-gray-500 dark:text-gray-400">Events Published</span>
                  <span className="font-medium">{status.totalEventsPublished.toLocaleString()}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm text-gray-500 dark:text-gray-400">Last Run</span>
                  <span className="font-medium">{status.lastRunAt ? formatTimeAgo(status.lastRunAt) : 'Never'}</span>
                </div>
              </CardContent>
            </Card>
          )}
        </div>

        {/* Agent Details (Right Side) */}
        <div className="lg:col-span-2 space-y-6">
          <Card>
            <CardHeader className="flex flex-row items-start justify-between">
              <div>
                <CardTitle className="flex items-center gap-3">
                  <div className="size-10 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center">
                    <svg className="size-5 text-white" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9.75 3.104v5.714a2.25 2.25 0 0 1-.659 1.591L5 14.5M9.75 3.104c-.251.023-.501.05-.75.082m.75-.082a24.301 24.301 0 0 1 4.5 0m0 0v5.714c0 .597.237 1.17.659 1.591L19.8 15.3M14.25 3.104c.251.023.501.05.75.082M19.8 15.3l-1.57.393A9.065 9.065 0 0 1 12 15a9.065 9.065 0 0 0-6.23-.693L5 14.5m14.8.8 1.402 1.402c1.232 1.232.65 3.318-1.067 3.611A48.309 48.309 0 0 1 12 21c-2.773 0-5.491-.235-8.135-.687-1.718-.293-2.3-2.379-1.067-3.61L5 14.5" />
                    </svg>
                  </div>
                  Monitoring Agent
                </CardTitle>
                <CardDescription className="mt-2">
                  Real-time supply chain risk event detection and analysis
                </CardDescription>
              </div>
              <button
                onClick={() => setShowHelpDialog(true)}
                className="p-2 rounded-full text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                title="How does this work?"
              >
                <svg className="size-5" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9.879 7.519c1.171-1.025 3.071-1.025 4.242 0 1.172 1.025 1.172 2.687 0 3.712-.203.179-.43.326-.67.442-.745.361-1.45.999-1.45 1.827v.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 5.25h.008v.008H12v-.008Z" />
                </svg>
              </button>
            </CardHeader>
            <CardContent>
              {/* Tabs */}
              <div className="border-b border-gray-200 dark:border-gray-700 mb-6">
                <nav className="flex gap-4 -mb-px">
                  {(['overview', 'config', 'logs'] as const).map((tab) => (
                    <button
                      key={tab}
                      onClick={() => setActiveTab(tab)}
                      className={`pb-3 px-1 text-sm font-medium border-b-2 transition-colors ${
                        activeTab === tab
                          ? 'border-blue-500 text-blue-600 dark:text-blue-400'
                          : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
                      }`}
                    >
                      {tab.charAt(0).toUpperCase() + tab.slice(1)}
                    </button>
                  ))}
                </nav>
              </div>

              {/* Overview Tab */}
              {activeTab === 'overview' && (
                <div className="space-y-6">
                  {/* Data Sources */}
                  <div>
                    <Label className="text-gray-500 dark:text-gray-400 mb-3 block">Monitoring Data Sources</Label>
                    <div className="grid grid-cols-2 gap-2">
                      {DATA_SOURCES.map((source) => {
                        const isEnabled =
                          config?.enabledSources?.[
                            source.key as keyof typeof config.enabledSources
                          ] ?? true;
                        return (
                          <div
                            key={source.key}
                            className={`p-3 rounded-lg border ${
                              isEnabled
                                ? 'border-green-200 bg-green-50 dark:border-green-800 dark:bg-green-900/20'
                                : 'border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-800 opacity-50'
                            }`}
                          >
                            <div className="flex items-center justify-between mb-2">
                              <span className="text-sm font-medium text-gray-900 dark:text-white">
                                {source.label}
                              </span>
                              <span
                                className={`text-xs px-2 py-0.5 rounded ${
                                  isEnabled
                                    ? 'bg-green-100 text-green-700 dark:bg-green-900/50 dark:text-green-400'
                                    : 'bg-gray-200 text-gray-500 dark:bg-gray-700 dark:text-gray-400'
                                }`}
                              >
                                {isEnabled ? 'Active' : 'Off'}
                              </span>
                            </div>
                            <button
                              onClick={() => handleOpenSettings(source.key)}
                              className="text-xs text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 inline-flex items-center gap-1"
                            >
                              <svg className="size-3.5" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.325.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 0 1 1.37.49l1.296 2.247a1.125 1.125 0 0 1-.26 1.431l-1.003.827c-.293.241-.438.613-.43.992a7.723 7.723 0 0 1 0 .255c-.008.378.137.75.43.991l1.004.827c.424.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 0 1-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.47 6.47 0 0 1-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.94-1.11.94h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 0 1-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 0 1-1.369-.49l-1.297-2.247a1.125 1.125 0 0 1 .26-1.431l1.004-.827c.292-.24.437-.613.43-.991a6.932 6.932 0 0 1 0-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 0 1-.26-1.43l1.297-2.247a1.125 1.125 0 0 1 1.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.086.22-.128.332-.183.582-.495.644-.869l.214-1.28Z" />
                                <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
                              </svg>
                              Settings
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* Current Config Summary */}
                  {config && (
                    <div>
                      <Label className="text-gray-500 dark:text-gray-400 mb-3 block">Current Configuration</Label>
                      <div className="grid grid-cols-2 gap-4">
                        <div className="p-3 rounded-lg bg-gray-50 dark:bg-gray-800">
                          <p className="text-xs text-gray-500 dark:text-gray-400">Polling Interval</p>
                          <p className="text-lg font-semibold text-gray-900 dark:text-white">
                            {(config.pollingIntervalMs / 1000).toFixed(0)}s
                          </p>
                        </div>
                        <div className="p-3 rounded-lg bg-gray-50 dark:bg-gray-800">
                          <p className="text-xs text-gray-500 dark:text-gray-400">Geographic Radius</p>
                          <p className="text-lg font-semibold text-gray-900 dark:text-white">
                            {config.geographicFilter.radiusKm}km
                          </p>
                        </div>
                        <div className="p-3 rounded-lg bg-gray-50 dark:bg-gray-800">
                          <p className="text-xs text-gray-500 dark:text-gray-400">Severity Threshold</p>
                          <p className="text-lg font-semibold text-gray-900 dark:text-white">
                            {(config.riskFilter.severityThreshold * 100).toFixed(0)}%
                          </p>
                        </div>
                        <div className="p-3 rounded-lg bg-gray-50 dark:bg-gray-800">
                          <p className="text-xs text-gray-500 dark:text-gray-400">Deduplication</p>
                          <p className="text-lg font-semibold text-gray-900 dark:text-white">
                            {config.deduplication.lookbackWindowHours}h
                          </p>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Config Tab */}
              {activeTab === 'config' && (
                <div className="space-y-6">
                  {/* Geographic Filter */}
                  <div className="space-y-4">
                    <div>
                      <Label htmlFor="radiusKm">Geographic Radius (km)</Label>
                      <p className="text-sm text-gray-500 dark:text-gray-400 mb-2">
                        Events within this radius of your supply chain locations will be monitored
                      </p>
                      <div className="flex items-center gap-4">
                        <Input
                          id="radiusKm"
                          type="range"
                          min={10}
                          max={1000}
                          step={10}
                          value={radiusKm}
                          onChange={(e) => setRadiusKm(parseInt(e.target.value, 10))}
                          className="flex-1"
                        />
                        <Input
                          type="number"
                          value={radiusKm}
                          onChange={(e) => setRadiusKm(parseInt(e.target.value, 10) || 0)}
                          className="w-24"
                        />
                      </div>
                    </div>

                    <div>
                      <Label htmlFor="severityThreshold">Severity Threshold</Label>
                      <p className="text-sm text-gray-500 dark:text-gray-400 mb-2">
                        Minimum severity (0-1) to publish events. Current: {(severityThreshold * 100).toFixed(0)}%
                      </p>
                      <div className="flex items-center gap-4">
                        <Input
                          id="severityThreshold"
                          type="range"
                          min={0}
                          max={1}
                          step={0.05}
                          value={severityThreshold}
                          onChange={(e) => setSeverityThreshold(parseFloat(e.target.value))}
                          className="flex-1"
                        />
                        <Input
                          type="number"
                          value={severityThreshold}
                          onChange={(e) => setSeverityThreshold(parseFloat(e.target.value) || 0)}
                          step={0.05}
                          min={0}
                          max={1}
                          className="w-24"
                        />
                      </div>
                    </div>

                    <div>
                      <Label>Monitored Risk Types</Label>
                      <p className="text-sm text-gray-500 dark:text-gray-400 mb-2">
                        Leave empty to monitor all types
                      </p>
                      <div className="flex flex-wrap gap-2">
                        {RISK_TYPES.map((type) => (
                          <button
                            key={type}
                            onClick={() => toggleRiskType(type)}
                            className={`px-3 py-1.5 rounded-full text-sm transition-colors ${
                              monitoredRiskTypes.includes(type)
                                ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-300'
                                : 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700'
                            }`}
                          >
                            {type.replace(/_/g, ' ')}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>

                  <div className="flex justify-end pt-4 border-t border-gray-200 dark:border-gray-700">
                    <Button onClick={handleSaveConfig} disabled={isSaving}>
                      {isSaving ? 'Saving...' : 'Save Configuration'}
                    </Button>
                  </div>
                </div>
              )}

              {/* Logs Tab */}
              {activeTab === 'logs' && (
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <p className="text-sm text-gray-500 dark:text-gray-400">
                      Recent monitoring cycle logs
                    </p>
                    <Button variant="outline" size="sm" onClick={fetchData}>
                      Refresh
                    </Button>
                  </div>

                  {logs.length === 0 ? (
                    <div className="text-center py-8">
                      <svg className="mx-auto h-12 w-12 text-gray-300 dark:text-gray-600" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" />
                      </svg>
                      <p className="mt-4 text-gray-500 dark:text-gray-400">No logs yet</p>
                      <p className="text-sm text-gray-400 dark:text-gray-500">Run a monitoring cycle to generate logs</p>
                    </div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b border-gray-200 dark:border-gray-700">
                            <th className="text-left py-2 font-medium text-gray-500 dark:text-gray-400">Time</th>
                            <th className="text-left py-2 font-medium text-gray-500 dark:text-gray-400">Status</th>
                            <th className="text-right py-2 font-medium text-gray-500 dark:text-gray-400">Detected</th>
                            <th className="text-right py-2 font-medium text-gray-500 dark:text-gray-400">Published</th>
                            <th className="text-right py-2 font-medium text-gray-500 dark:text-gray-400">Duration</th>
                          </tr>
                        </thead>
                        <tbody>
                          {logs.map((log) => (
                            <tr key={log.id} className="border-b border-gray-100 dark:border-gray-800">
                              <td className="py-3">
                                <div className="text-gray-900 dark:text-white">{formatTimeAgo(log.createdAt)}</div>
                                <div className="text-xs text-gray-500 dark:text-gray-400">
                                  {new Date(log.createdAt).toLocaleString()}
                                </div>
                              </td>
                              <td className="py-3">
                                <span className={`px-2 py-1 rounded text-xs font-medium ${getLogStatusBadge(log.status)}`}>
                                  {log.status.replace('_', ' ')}
                                </span>
                              </td>
                              <td className="py-3 text-right text-gray-900 dark:text-white">
                                {log.eventsDetected}
                              </td>
                              <td className="py-3 text-right text-gray-900 dark:text-white">
                                {log.eventsPublished}
                              </td>
                              <td className="py-3 text-right text-gray-500 dark:text-gray-400">
                                {formatDuration(log.durationMs)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

        </div>
      </div>

      {/* Help Dialog */}
      {showHelpDialog && (
        <div className="fixed inset-0 z-50 overflow-y-auto">
          <div className="flex min-h-full items-center justify-center p-4">
            {/* Backdrop */}
            <div
              className="fixed inset-0 bg-black/50 transition-opacity"
              onClick={() => setShowHelpDialog(false)}
            />

            {/* Dialog */}
            <div className="relative bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-lg w-full p-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
                  How the Monitoring Agent Works
                </h3>
                <button
                  onClick={() => setShowHelpDialog(false)}
                  className="p-1 rounded-full text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                >
                  <svg className="size-5" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              <div className="space-y-4">
                <div>
                  <h4 className="font-medium text-gray-900 dark:text-white mb-2">What it does</h4>
                  <p className="text-sm text-gray-500 dark:text-gray-400">
                    Continuously scans multiple data sources to detect supply chain risk events. Uses AI to analyze news, weather, maritime data, and more to identify potential disruptions.
                  </p>
                </div>
                <div>
                  <h4 className="font-medium text-gray-900 dark:text-white mb-2">Processing Pipeline</h4>
                  <ul className="text-sm text-gray-500 dark:text-gray-400 space-y-1">
                    <li>1. Polls data sources every {config?.pollingIntervalMs ? config.pollingIntervalMs / 1000 : 15}s</li>
                    <li>2. Filters by geographic proximity</li>
                    <li>3. Deduplicates via content hashing</li>
                    <li>4. Scores severity & confidence</li>
                    <li>5. Publishes validated events</li>
                  </ul>
                </div>
                <div>
                  <h4 className="font-medium text-gray-900 dark:text-white mb-2">Data Sources</h4>
                  <p className="text-sm text-gray-500 dark:text-gray-400">
                    The agent monitors 10 categories: weather & natural disasters, political risk, cybersecurity, economic & financial markets, news & social media, maritime & logistics, labor & social events, regulatory & trade, pandemic & health, and geopolitical conflicts.
                  </p>
                </div>
              </div>

              <div className="mt-6 flex justify-end">
                <Button onClick={() => setShowHelpDialog(false)}>
                  Got it
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Progress Dialog */}
      {currentOrganization && (
        <MonitoringProgressDialog
          isOpen={showProgressDialog}
          organizationId={currentOrganization.id}
          onClose={handleProgressClose}
          onComplete={handleProgressComplete}
        />
      )}

      {/* Data Source Settings Dialog */}
      {currentOrganization && selectedDataSource && (
        <DataSourceSettingsDialog
          isOpen={showSettingsDialog}
          organizationId={currentOrganization.id}
          dataSourceId={selectedDataSource}
          onClose={handleSettingsClose}
          onSave={handleSettingsSave}
        />
      )}
    </div>
  );
}
