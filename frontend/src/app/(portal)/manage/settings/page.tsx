'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/providers/auth-provider';
import {
  OrganizationSettings,
  getOrganizationSettings,
  updateOrganizationSettings,
  testNotification,
} from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Fillet } from '@/components/ui/fillet';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

// Data source categories
const DATA_SOURCES = [
  { key: 'weather', label: 'Weather & Natural Disasters' },
  { key: 'political', label: 'Political Risk' },
  { key: 'cybersecurity', label: 'Cybersecurity' },
  { key: 'economic', label: 'Economic & Financial' },
  { key: 'news', label: 'News & Social Media' },
  { key: 'maritime', label: 'Maritime & Logistics' },
  { key: 'labor', label: 'Labor & Social' },
  { key: 'regulatory', label: 'Regulatory & Trade' },
  { key: 'pandemic', label: 'Pandemic & Health' },
  { key: 'geopolitical', label: 'Geopolitical & Conflict' },
] as const;

type DataSourceKey = (typeof DATA_SOURCES)[number]['key'];

// AI Model options
const AI_PROVIDERS = [
  { value: 'openai', label: 'OpenAI' },
  { value: 'anthropic', label: 'Anthropic' },
];

const AI_MODELS: Record<string, { value: string; label: string }[]> = {
  openai: [
    { value: 'gpt-4o', label: 'GPT-4o' },
    { value: 'gpt-4o-mini', label: 'GPT-4o Mini' },
    { value: 'gpt-4-turbo', label: 'GPT-4 Turbo' },
  ],
  anthropic: [
    { value: 'claude-sonnet-4-5', label: 'Claude Sonnet 4.5' },
    { value: 'claude-3-5-sonnet-latest', label: 'Claude 3.5 Sonnet' },
    { value: 'claude-3-5-haiku-latest', label: 'Claude 3.5 Haiku' },
  ],
};

// Digest frequency options
const DIGEST_FREQUENCIES = [
  { value: 'daily', label: 'Daily' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'monthly', label: 'Monthly' },
];

// SAP sync frequency options
const SAP_SYNC_FREQUENCIES = [
  { value: 'hourly', label: 'Hourly' },
  { value: 'daily', label: 'Daily' },
  { value: 'weekly', label: 'Weekly' },
];

type TabKey = 'agents' | 'ai' | 'notifications' | 'integrations' | 'retention';

export default function SettingsPage() {
  const { currentOrganization } = useAuth();

  const [settings, setSettings] = useState<OrganizationSettings | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [activeTab, setActiveTab] = useState<TabKey>('agents');

  // Local form state
  const [formData, setFormData] = useState<Partial<OrganizationSettings>>({});

  const fetchSettings = useCallback(async () => {
    if (!currentOrganization?.id) return;

    setIsLoading(true);
    try {
      const response = await getOrganizationSettings(currentOrganization.id);
      if (response.success && response.data) {
        setSettings(response.data);
        setFormData(response.data);
      }
    } catch (error) {
      console.error('Failed to fetch settings:', error);
    } finally {
      setIsLoading(false);
    }
  }, [currentOrganization?.id]);

  useEffect(() => {
    fetchSettings();
  }, [fetchSettings]);

  const handleSave = async () => {
    if (!currentOrganization?.id) return;

    setIsSaving(true);
    setMessage(null);

    try {
      const response = await updateOrganizationSettings(currentOrganization.id, formData);
      if (response.success && response.data) {
        setSettings(response.data);
        setFormData(response.data);
        setMessage({ type: 'success', text: 'Settings saved successfully' });
      } else {
        setMessage({ type: 'error', text: response.error?.message || 'Failed to save settings' });
      }
    } catch {
      setMessage({ type: 'error', text: 'Failed to save settings' });
    } finally {
      setIsSaving(false);
    }
  };

  const handleTestNotification = async (type: 'email' | 'slack') => {
    if (!currentOrganization?.id) return;

    setIsTesting(true);
    setMessage(null);

    try {
      const response = await testNotification(currentOrganization.id, type);
      if (response.success) {
        setMessage({ type: 'success', text: response.data?.message || 'Test notification sent' });
      } else {
        setMessage({ type: 'error', text: response.error?.message || 'Failed to send test notification' });
      }
    } catch {
      setMessage({ type: 'error', text: 'Failed to send test notification' });
    } finally {
      setIsTesting(false);
    }
  };

  const toggleDataSource = (key: DataSourceKey) => {
    const currentSources = (formData.monitoringEnabledSources || {}) as Record<string, boolean>;
    const newSources = {
      ...currentSources,
      [key]: currentSources[key] !== undefined ? !currentSources[key] : false,
    };
    // Cast to MonitoringEnabledSources since we're building it dynamically
    setFormData({
      ...formData,
      monitoringEnabledSources: newSources as unknown as OrganizationSettings['monitoringEnabledSources'],
    });
  };

  const updateField = <K extends keyof OrganizationSettings>(
    key: K,
    value: OrganizationSettings[K]
  ) => {
    setFormData({ ...formData, [key]: value });
  };

  const addEmailRecipient = (email: string) => {
    const current = (formData.notificationsEmailRecipients || []) as string[];
    if (email && !current.includes(email)) {
      setFormData({ ...formData, notificationsEmailRecipients: [...current, email] });
    }
  };

  const removeEmailRecipient = (email: string) => {
    const current = (formData.notificationsEmailRecipients || []) as string[];
    setFormData({ ...formData, notificationsEmailRecipients: current.filter(e => e !== email) });
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  const tabs: { key: TabKey; label: string }[] = [
    { key: 'agents', label: 'Agents' },
    { key: 'ai', label: 'AI' },
    { key: 'notifications', label: 'Notifications' },
    { key: 'integrations', label: 'Integrations' },
    { key: 'retention', label: 'Data Retention' },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h2 className="font-display text-3xl font-semibold text-foreground">Settings</h2>
        <Fillet className="my-2" />
        <p className="text-muted-foreground">
          Configure organization settings for agents, AI, notifications, and more.
        </p>
      </div>

      {/* Message */}
      {message && (
        <div
          className={`p-3 rounded-md text-sm ${
            message.type === 'success'
              ? 'bg-risk-low text-risk-low-fg'
              : 'bg-risk-critical text-risk-critical-fg'
          }`}
        >
          {message.text}
          <button onClick={() => setMessage(null)} className="float-right font-bold">&times;</button>
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Organization Settings</CardTitle>
          <CardDescription>
            Manage settings for {currentOrganization?.name || 'your organization'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {/* Tabs */}
          <div className="border-b border-border mb-6">
            <nav className="flex gap-4 -mb-px overflow-x-auto">
              {tabs.map((tab) => (
                <button
                  key={tab.key}
                  onClick={() => setActiveTab(tab.key)}
                  className={`pb-3 px-1 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                    activeTab === tab.key
                      ? 'border-primary text-primary'
                      : 'border-transparent text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </nav>
          </div>

          {/* Agents Tab */}
          {activeTab === 'agents' && (
            <div className="space-y-6">
              {/* Enable/Disable Agent */}
              <div className="flex items-center justify-between">
                <div>
                  <Label>Monitoring Agent</Label>
                  <p className="text-sm text-muted-foreground">
                    Enable or disable the monitoring agent for this organization
                  </p>
                </div>
                <button
                  onClick={() => updateField('monitoringAgentEnabled', !formData.monitoringAgentEnabled)}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                    formData.monitoringAgentEnabled ? 'bg-primary border border-primary' : 'bg-muted border border-muted-foreground/70'
                  }`}
                >
                  <span
                    className={`inline-block h-4 w-4 transform rounded-full ${formData.monitoringAgentEnabled ? 'bg-primary-foreground' : 'bg-muted-foreground'} transition-transform ${
                      formData.monitoringAgentEnabled ? 'translate-x-6' : 'translate-x-1'
                    }`}
                  />
                </button>
              </div>

              {/* Polling Interval */}
              <div>
                <Label htmlFor="pollingInterval">Polling Interval (seconds)</Label>
                <p className="text-sm text-muted-foreground mb-2">
                  How often the agent checks for new events
                </p>
                <div className="flex items-center gap-4">
                  <Input
                    id="pollingInterval"
                    type="range"
                    min={5}
                    max={300}
                    step={5}
                    value={(formData.monitoringPollingIntervalMs || 15000) / 1000}
                    onChange={(e) => updateField('monitoringPollingIntervalMs', parseInt(e.target.value) * 1000)}
                    className="flex-1"
                  />
                  <Input
                    type="number"
                    value={(formData.monitoringPollingIntervalMs || 15000) / 1000}
                    onChange={(e) => updateField('monitoringPollingIntervalMs', (parseInt(e.target.value) || 15) * 1000)}
                    className="w-24"
                    min={5}
                    max={300}
                  />
                </div>
              </div>

              {/* Data Sources */}
              <div>
                <Label>Enabled Data Sources</Label>
                <p className="text-sm text-muted-foreground mb-3">
                  Select which data sources the agent should monitor
                </p>
                <div className="grid grid-cols-2 gap-2">
                  {DATA_SOURCES.map((source) => {
                    const sources = (formData.monitoringEnabledSources || {}) as Record<string, boolean>;
                    const isEnabled = sources[source.key] ?? true;
                    return (
                      <button
                        key={source.key}
                        onClick={() => toggleDataSource(source.key)}
                        className={`p-3 rounded-lg border text-left transition-colors ${
                          isEnabled
                            ? 'border-risk-low-accent/40 bg-risk-low'
                            : 'border-border bg-muted opacity-50'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <span className="text-sm font-medium text-foreground">
                            {source.label}
                          </span>
                          <span
                            className={`text-xs px-2 py-0.5 rounded ${
                              isEnabled
                                ? 'bg-risk-low-accent/25 text-risk-low-fg'
                                : 'bg-muted-foreground/20 text-muted-foreground'
                            }`}
                          >
                            {isEnabled ? 'On' : 'Off'}
                          </span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {/* AI Tab */}
          {activeTab === 'ai' && (
            <div className="space-y-6">
              {/* AI Provider */}
              <div>
                <Label htmlFor="aiProvider">AI Provider</Label>
                <select
                  id="aiProvider"
                  value={formData.aiModelProvider || 'openai'}
                  onChange={(e) => {
                    updateField('aiModelProvider', e.target.value);
                    // Reset model when provider changes
                    const newModels = AI_MODELS[e.target.value];
                    if (newModels && newModels.length > 0) {
                      updateField('aiModelName', newModels[0].value);
                    }
                  }}
                  className="mt-2 block w-full rounded-md border border-input bg-card px-3 py-2 text-foreground focus:border-ring focus:ring-ring"
                >
                  {AI_PROVIDERS.map((provider) => (
                    <option key={provider.value} value={provider.value}>
                      {provider.label}
                    </option>
                  ))}
                </select>
              </div>

              {/* AI Model */}
              <div>
                <Label htmlFor="aiModel">AI Model</Label>
                <select
                  id="aiModel"
                  value={formData.aiModelName || 'gpt-4o'}
                  onChange={(e) => updateField('aiModelName', e.target.value)}
                  className="mt-2 block w-full rounded-md border border-input bg-card px-3 py-2 text-foreground focus:border-ring focus:ring-ring"
                >
                  {(AI_MODELS[formData.aiModelProvider || 'openai'] || []).map((model) => (
                    <option key={model.value} value={model.value}>
                      {model.label}
                    </option>
                  ))}
                </select>
              </div>

              {/* Temperature */}
              <div>
                <Label htmlFor="temperature">Temperature</Label>
                <p className="text-sm text-muted-foreground mb-2">
                  Controls randomness in AI responses. Lower = more focused, Higher = more creative.
                </p>
                <div className="flex items-center gap-4">
                  <Input
                    id="temperature"
                    type="range"
                    min={0}
                    max={1}
                    step={0.1}
                    value={formData.aiModelTemperature ?? 0.7}
                    onChange={(e) => updateField('aiModelTemperature', parseFloat(e.target.value))}
                    className="flex-1"
                  />
                  <span className="text-sm font-medium w-12 text-right">
                    {(formData.aiModelTemperature ?? 0.7).toFixed(1)}
                  </span>
                </div>
              </div>

              {/* Max Tokens */}
              <div>
                <Label htmlFor="maxTokens">Max Tokens</Label>
                <p className="text-sm text-muted-foreground mb-2">
                  Maximum number of tokens in AI responses
                </p>
                <Input
                  id="maxTokens"
                  type="number"
                  value={formData.aiMaxTokens ?? 4096}
                  onChange={(e) => updateField('aiMaxTokens', parseInt(e.target.value) || 4096)}
                  min={256}
                  max={128000}
                  step={256}
                  className="w-40"
                />
              </div>
            </div>
          )}

          {/* Notifications Tab */}
          {activeTab === 'notifications' && (
            <div className="space-y-6">
              {/* Email Notifications */}
              <div className="p-4 rounded-lg border border-border">
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <Label>Email Notifications</Label>
                    <p className="text-sm text-muted-foreground">
                      Send email alerts for high-severity events
                    </p>
                  </div>
                  <button
                    onClick={() => updateField('notificationsEmailEnabled', !formData.notificationsEmailEnabled)}
                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                      formData.notificationsEmailEnabled ? 'bg-primary border border-primary' : 'bg-muted border border-muted-foreground/70'
                    }`}
                  >
                    <span
                      className={`inline-block h-4 w-4 transform rounded-full ${formData.notificationsEmailEnabled ? 'bg-primary-foreground' : 'bg-muted-foreground'} transition-transform ${
                        formData.notificationsEmailEnabled ? 'translate-x-6' : 'translate-x-1'
                      }`}
                    />
                  </button>
                </div>

                {formData.notificationsEmailEnabled && (
                  <div className="space-y-4">
                    <div>
                      <Label>Email Recipients</Label>
                      <div className="flex gap-2 mt-2">
                        <Input
                          type="email"
                          placeholder="email@example.com"
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              addEmailRecipient((e.target as HTMLInputElement).value);
                              (e.target as HTMLInputElement).value = '';
                            }
                          }}
                          className="flex-1"
                        />
                        <Button
                          variant="outline"
                          onClick={(e) => {
                            const input = (e.target as HTMLElement).parentElement?.querySelector('input');
                            if (input) {
                              addEmailRecipient(input.value);
                              input.value = '';
                            }
                          }}
                        >
                          Add
                        </Button>
                      </div>
                      <div className="flex flex-wrap gap-2 mt-2">
                        {((formData.notificationsEmailRecipients || []) as string[]).map((email) => (
                          <span
                            key={email}
                            className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-muted text-sm"
                          >
                            {email}
                            <button
                              onClick={() => removeEmailRecipient(email)}
                              className="text-muted-foreground hover:text-foreground"
                            >
                              &times;
                            </button>
                          </span>
                        ))}
                      </div>
                    </div>

                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleTestNotification('email')}
                      disabled={isTesting}
                    >
                      {isTesting ? 'Sending...' : 'Send Test Email'}
                    </Button>
                  </div>
                )}
              </div>

              {/* Slack Notifications */}
              <div className="p-4 rounded-lg border border-border">
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <Label>Slack Notifications</Label>
                    <p className="text-sm text-muted-foreground">
                      Send alerts to a Slack channel
                    </p>
                  </div>
                  <button
                    onClick={() => updateField('notificationsSlackEnabled', !formData.notificationsSlackEnabled)}
                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                      formData.notificationsSlackEnabled ? 'bg-primary border border-primary' : 'bg-muted border border-muted-foreground/70'
                    }`}
                  >
                    <span
                      className={`inline-block h-4 w-4 transform rounded-full ${formData.notificationsSlackEnabled ? 'bg-primary-foreground' : 'bg-muted-foreground'} transition-transform ${
                        formData.notificationsSlackEnabled ? 'translate-x-6' : 'translate-x-1'
                      }`}
                    />
                  </button>
                </div>

                {formData.notificationsSlackEnabled && (
                  <div className="space-y-4">
                    <div>
                      <Label htmlFor="slackWebhook">Webhook URL</Label>
                      <Input
                        id="slackWebhook"
                        type="url"
                        placeholder="https://hooks.slack.com/services/..."
                        value={formData.notificationsSlackWebhookUrl || ''}
                        onChange={(e) => updateField('notificationsSlackWebhookUrl', e.target.value || null)}
                        className="mt-2"
                      />
                    </div>

                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleTestNotification('slack')}
                      disabled={isTesting || !formData.notificationsSlackWebhookUrl}
                    >
                      {isTesting ? 'Sending...' : 'Send Test Message'}
                    </Button>
                  </div>
                )}
              </div>

              {/* Severity Threshold */}
              <div>
                <Label htmlFor="severityThreshold">Notification Severity Threshold</Label>
                <p className="text-sm text-muted-foreground mb-2">
                  Only send notifications for events above this severity level ({((formData.notificationsSeverityThreshold ?? 0.7) * 100).toFixed(0)}%)
                </p>
                <div className="flex items-center gap-4">
                  <Input
                    id="severityThreshold"
                    type="range"
                    min={0}
                    max={1}
                    step={0.05}
                    value={formData.notificationsSeverityThreshold ?? 0.7}
                    onChange={(e) => updateField('notificationsSeverityThreshold', parseFloat(e.target.value))}
                    className="flex-1"
                  />
                  <span className="text-sm font-medium w-12 text-right">
                    {((formData.notificationsSeverityThreshold ?? 0.7) * 100).toFixed(0)}%
                  </span>
                </div>
              </div>

              {/* Digest Settings */}
              <div className="p-4 rounded-lg border border-border">
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <Label>Email Digest</Label>
                    <p className="text-sm text-muted-foreground">
                      Send periodic summary digests
                    </p>
                  </div>
                  <button
                    onClick={() => updateField('notificationsDigestEnabled', !formData.notificationsDigestEnabled)}
                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                      formData.notificationsDigestEnabled ? 'bg-primary border border-primary' : 'bg-muted border border-muted-foreground/70'
                    }`}
                  >
                    <span
                      className={`inline-block h-4 w-4 transform rounded-full ${formData.notificationsDigestEnabled ? 'bg-primary-foreground' : 'bg-muted-foreground'} transition-transform ${
                        formData.notificationsDigestEnabled ? 'translate-x-6' : 'translate-x-1'
                      }`}
                    />
                  </button>
                </div>

                {formData.notificationsDigestEnabled && (
                  <div>
                    <Label htmlFor="digestFrequency">Digest Frequency</Label>
                    <select
                      id="digestFrequency"
                      value={formData.notificationsDigestFrequency || 'weekly'}
                      onChange={(e) => updateField('notificationsDigestFrequency', e.target.value)}
                      className="mt-2 block w-full rounded-md border border-input bg-card px-3 py-2 text-foreground focus:border-ring focus:ring-ring"
                    >
                      {DIGEST_FREQUENCIES.map((freq) => (
                        <option key={freq.value} value={freq.value}>
                          {freq.label}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Integrations Tab */}
          {activeTab === 'integrations' && (
            <div className="space-y-6">
              {/* SAP Integration */}
              <div className="p-4 rounded-lg border border-border">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-3">
                    <div className="size-10 rounded-lg bg-risk-monitoring flex items-center justify-center">
                      <svg className="size-6 text-primary" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 6.375c0 2.278-3.694 4.125-8.25 4.125S3.75 8.653 3.75 6.375m16.5 0c0-2.278-3.694-4.125-8.25-4.125S3.75 4.097 3.75 6.375m16.5 0v11.25c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125V6.375m16.5 0v3.75m-16.5-3.75v3.75m16.5 0v3.75C20.25 16.153 16.556 18 12 18s-8.25-1.847-8.25-4.125v-3.75m16.5 0c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125" />
                      </svg>
                    </div>
                    <div>
                      <h4 className="font-medium text-foreground">SAP ERP Integration</h4>
                      <p className="text-sm text-muted-foreground">
                        Sync supply chain data from SAP
                      </p>
                    </div>
                  </div>
                  <span
                    className={`px-2 py-1 rounded text-xs font-medium ${
                      formData.integrationSapConfigured
                        ? 'bg-risk-low-accent/25 text-risk-low-fg'
                        : 'bg-muted-foreground/20 text-muted-foreground'
                    }`}
                  >
                    {formData.integrationSapConfigured ? 'Connected' : 'Not Configured'}
                  </span>
                </div>

                {formData.integrationSapConfigured && (
                  <div className="space-y-4">
                    <div>
                      <Label>Last Sync</Label>
                      <p className="text-sm text-foreground">
                        {settings?.integrationSapLastSync
                          ? new Date(settings.integrationSapLastSync).toLocaleString()
                          : 'Never'}
                      </p>
                    </div>

                    <div>
                      <Label htmlFor="sapSyncFrequency">Sync Frequency</Label>
                      <select
                        id="sapSyncFrequency"
                        value={formData.integrationSapSyncFrequency || 'daily'}
                        onChange={(e) => updateField('integrationSapSyncFrequency', e.target.value)}
                        className="mt-2 block w-full rounded-md border border-input bg-card px-3 py-2 text-foreground focus:border-ring focus:ring-ring"
                      >
                        {SAP_SYNC_FREQUENCIES.map((freq) => (
                          <option key={freq.value} value={freq.value}>
                            {freq.label}
                          </option>
                        ))}
                      </select>
                    </div>

                    <Button variant="outline" size="sm">
                      Sync Now
                    </Button>
                  </div>
                )}

                {!formData.integrationSapConfigured && (
                  <p className="text-sm text-muted-foreground">
                    Contact your administrator to set up SAP integration.
                  </p>
                )}
              </div>
            </div>
          )}

          {/* Data Retention Tab */}
          {activeTab === 'retention' && (
            <div className="space-y-6">
              <p className="text-sm text-muted-foreground">
                Configure how long data is retained before automatic deletion.
              </p>

              {/* Events Retention */}
              <div>
                <Label htmlFor="eventRetention">Events Retention (days)</Label>
                <p className="text-sm text-muted-foreground mb-2">
                  How long to keep detected events
                </p>
                <Input
                  id="eventRetention"
                  type="number"
                  value={formData.retentionEventsDays ?? 365}
                  onChange={(e) => updateField('retentionEventsDays', parseInt(e.target.value) || 365)}
                  min={30}
                  max={3650}
                  className="w-40"
                />
              </div>

              {/* Incidents Retention */}
              <div>
                <Label htmlFor="incidentRetention">Incidents Retention (days)</Label>
                <p className="text-sm text-muted-foreground mb-2">
                  How long to keep validated incidents
                </p>
                <Input
                  id="incidentRetention"
                  type="number"
                  value={formData.retentionIncidentsDays ?? 730}
                  onChange={(e) => updateField('retentionIncidentsDays', parseInt(e.target.value) || 730)}
                  min={90}
                  max={3650}
                  className="w-40"
                />
              </div>

              {/* Audit Logs Retention */}
              <div>
                <Label htmlFor="auditRetention">Audit Logs Retention (days)</Label>
                <p className="text-sm text-muted-foreground mb-2">
                  How long to keep monitoring audit logs
                </p>
                <Input
                  id="auditRetention"
                  type="number"
                  value={formData.retentionAuditLogsDays ?? 90}
                  onChange={(e) => updateField('retentionAuditLogsDays', parseInt(e.target.value) || 90)}
                  min={30}
                  max={365}
                  className="w-40"
                />
              </div>
            </div>
          )}

          {/* Save Button */}
          <div className="flex justify-end pt-6 mt-6 border-t border-border">
            <Button onClick={handleSave} disabled={isSaving}>
              {isSaving ? 'Saving...' : 'Save Settings'}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
