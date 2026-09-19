'use client';

import React from 'react';
import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/providers/auth-provider';
import {
  OrganizationSettings,
  OpenRouterModel,
  getOrganizationSettings,
  updateOrganizationSettings,
  testNotification,
  getOpenRouterModels,
  type SecretItem,
  listSecrets,
  createSecret,
  revealSecret,
  deleteSecret,
  testAIConnection,
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Separator } from '@/components/ui/separator';
import { AlertCircle, Check, Eye, EyeOff, Copy, Plus, Trash2, Edit2, Key, Globe, Server, Wrench, ChevronDown, ChevronUp } from 'lucide-react';

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
  { value: 'openrouter', label: 'OpenRouter' },
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

type TabKey = 'agents' | 'ai' | 'notifications' | 'integrations' | 'retention' | 'secrets';

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

  // OpenRouter model catalog (fetched on demand — free models first, then
  // cheapest-first; see backend/src/integrations/openrouter)
  const [openRouterModels, setOpenRouterModels] = useState<OpenRouterModel[]>([]);
  const [isLoadingOpenRouterModels, setIsLoadingOpenRouterModels] = useState(false);
  const [openRouterError, setOpenRouterError] = useState<string | null>(null);
  const [aiTestResult, setAiTestResult] = useState<{ status: string; message: string; keySource: string | null } | null>(null);
  const [isTestingAI, setIsTestingAI] = useState(false);

  const fetchOpenRouterModelsList = useCallback(async () => {
    if (!currentOrganization?.id) return;

    setIsLoadingOpenRouterModels(true);
    setOpenRouterError(null);
    try {
      const response = await getOpenRouterModels(currentOrganization.id);
      if (response.success && response.data) {
        const models = response.data.models;
        setOpenRouterModels(models);
        // Default to the top of the list (free/cheapest) if the currently
        // selected model isn't one OpenRouter actually offers.
        setFormData((prev) =>
          prev.aiModelProvider === 'openrouter' &&
          models.length > 0 &&
          !models.some((m) => m.id === prev.aiModelName)
            ? { ...prev, aiModelName: models[0].id }
            : prev
        );
      } else {
        setOpenRouterError(response.error?.message || 'Failed to load OpenRouter models');
      }
    } catch {
      setOpenRouterError('Failed to load OpenRouter models');
    } finally {
      setIsLoadingOpenRouterModels(false);
    }
  }, [currentOrganization?.id]);

  const handleTestAI = useCallback(async () => {
    if (!currentOrganization?.id) return;
    setIsTestingAI(true);
    setAiTestResult(null);
    try {
      const result = await testAIConnection(currentOrganization.id);
      if (result.success && result.data) {
        setAiTestResult(result.data);
      } else {
        setAiTestResult({ status: 'error', message: result.error?.message || 'Test failed', keySource: null });
      }
    } catch {
      setAiTestResult({ status: 'error', message: 'Failed to connect to server', keySource: null });
    } finally {
      setIsTestingAI(false);
    }
  }, [currentOrganization?.id]);

  // Fetch the OpenRouter catalog the first time that provider is selected
  // (including on load, if it was already saved as the org's provider).
  useEffect(() => {
    if (
      formData.aiModelProvider === 'openrouter' &&
      openRouterModels.length === 0 &&
      !isLoadingOpenRouterModels &&
      !openRouterError
    ) {
      fetchOpenRouterModelsList();
    }
  }, [formData.aiModelProvider, openRouterModels.length, isLoadingOpenRouterModels, openRouterError, fetchOpenRouterModelsList]);

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
    { key: 'secrets', label: 'Secrets' },
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
                    formData.monitoringAgentEnabled ? 'bg-primary border border-primary' : 'bg-muted ring-1 ring-muted-foreground/70'
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
                    // Reset model when provider changes. OpenRouter's model
                    // list is fetched dynamically, so it defaults its own
                    // selection once loaded (see fetchOpenRouterModelsList).
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
                {formData.aiModelProvider === 'openrouter' ? (
                  <>
                    {isLoadingOpenRouterModels && (
                      <p className="mt-2 text-sm text-muted-foreground">Loading OpenRouter models…</p>
                    )}
                    {openRouterError && !isLoadingOpenRouterModels && (
                      <div className="mt-2 flex items-center justify-between gap-2 rounded-md bg-risk-critical p-2 text-sm text-risk-critical-fg">
                        <span>{openRouterError}</span>
                        <Button type="button" variant="outline" size="sm" onClick={fetchOpenRouterModelsList}>
                          Retry
                        </Button>
                      </div>
                    )}
                    {!isLoadingOpenRouterModels && !openRouterError && (
                      <select
                        id="aiModel"
                        value={formData.aiModelName || ''}
                        onChange={(e) => updateField('aiModelName', e.target.value)}
                        className="mt-2 block w-full rounded-md border border-input bg-card px-3 py-2 text-foreground focus:border-ring focus:ring-ring"
                      >
                        {openRouterModels.map((model) => (
                          <option key={model.id} value={model.id}>
                            {model.isFree
                              ? `${model.name} — Free`
                              : `${model.name} — $${model.promptPricePerMillionTokens.toFixed(2)} / $${model.completionPricePerMillionTokens.toFixed(2)} per 1M tokens (in/out)`}
                          </option>
                        ))}
                      </select>
                    )}
                  </>
                ) : (
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
                )}
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

              {/* Test Connection */}
              <div className="border-t pt-4">
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleTestAI}
                  disabled={isTestingAI}
                >
                  {isTestingAI ? 'Testing...' : 'Test AI Connection'}
                </Button>
                <p className="text-sm text-muted-foreground mt-2">
                  Verifies the API key is configured and OpenRouter is reachable.
                </p>
                {aiTestResult && (
                  <div className={`mt-3 rounded-md p-3 text-sm flex items-center gap-2 ${
                    aiTestResult.status === 'ok'
                      ? 'bg-green-50 border border-green-200 text-green-800 dark:bg-green-950 dark:border-green-800 dark:text-green-200'
                      : aiTestResult.status === 'not_configured'
                      ? 'bg-yellow-50 border border-yellow-200 text-yellow-800 dark:bg-yellow-950 dark:border-yellow-800 dark:text-yellow-200'
                      : 'bg-destructive/10 border border-destructive/20 text-destructive'
                  }`}>
                    {aiTestResult.status === 'ok' ? (
                      <Check className="h-4 w-4 shrink-0" />
                    ) : aiTestResult.status === 'not_configured' ? (
                      <AlertCircle className="h-4 w-4 shrink-0" />
                    ) : (
                      <AlertCircle className="h-4 w-4 shrink-0" />
                    )}
                    <div>
                      <span>{aiTestResult.message}</span>
                      {aiTestResult.keySource && (
                        <span className="ml-1 text-xs opacity-70">
                          (source: {aiTestResult.keySource === 'secrets_manager' ? 'Secrets Manager' : 'Environment Variable'})
                        </span>
                      )}
                    </div>
                  </div>
                )}
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
                      formData.notificationsEmailEnabled ? 'bg-primary border border-primary' : 'bg-muted ring-1 ring-muted-foreground/70'
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
                      formData.notificationsSlackEnabled ? 'bg-primary border border-primary' : 'bg-muted ring-1 ring-muted-foreground/70'
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
                      formData.notificationsDigestEnabled ? 'bg-primary border border-primary' : 'bg-muted ring-1 ring-muted-foreground/70'
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

          {/* Secrets Tab */}
          {activeTab === 'secrets' && (
            <SecretsTab
              organizationId={currentOrganization?.id || ''}
              onRefresh={fetchSettings}
            />
          )}

          {/* Save Button */}
          <div className="flex justify-end pt-6 mt-6 border-t border-border">
            <Button
              onClick={handleSave}
              disabled={
                isSaving ||
                (formData.aiModelProvider === 'openrouter' &&
                  (isLoadingOpenRouterModels || !!openRouterError || openRouterModels.length === 0))
              }
            >
              {isSaving ? 'Saving...' : 'Save Settings'}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
} 

const SecretsTab = React.memo(function SecretsTab({ organizationId, onRefresh }: { organizationId: string; onRefresh: () => void }) {
  const [secrets, setSecrets] = useState<SecretItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [revealTarget, setRevealTarget] = useState<SecretItem | null>(null);
  const [revealedValue, setRevealedValue] = useState<string | null>(null);
  const [revealing, setRevealing] = useState(false);
  const [filterScope, setFilterScope] = useState<string>('ALL');

  const fetchSecrets = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const result = await listSecrets(organizationId, filterScope !== 'ALL' ? { scope: filterScope } : undefined);
      if (result.success && result.data) {
        setSecrets(result.data);
      } else {
        setError(result.error?.message || 'Failed to load secrets');
      }
    } catch {
      setError('Failed to load secrets');
    } finally {
      setLoading(false);
    }
  }, [organizationId, filterScope]);

  useEffect(() => {
    fetchSecrets();
  }, [fetchSecrets]);

  const handleReveal = async (secret: SecretItem) => {
    setRevealTarget(secret);
    setRevealedValue(null);
    setRevealing(true);
    try {
      const result = await revealSecret(organizationId, secret.name, {
        scope: secret.scope,
        scopeRef: secret.scopeRef || undefined,
      });
      if (result.success && result.data) {
        setRevealedValue(result.data.value);
      } else {
        setError(result.error?.message || 'Failed to reveal secret');
      }
    } catch {
      setError('Failed to reveal secret');
    } finally {
      setRevealing(false);
    }
  };

  const handleDelete = async (secret: SecretItem) => {
    if (!confirm(`Delete secret "${secret.name}"? This cannot be undone.`)) return;
    try {
      const result = await deleteSecret(organizationId, secret.name, {
        scope: secret.scope,
        scopeRef: secret.scopeRef || undefined,
      });
      if (result.success) {
        fetchSecrets();
      } else {
        setError(result.error?.message || 'Failed to delete secret');
      }
    } catch {
      setError('Failed to delete secret');
    }
  };

  const handleCopyValue = async (secret: SecretItem) => {
    try {
      const result = await revealSecret(organizationId, secret.name, {
        scope: secret.scope,
        scopeRef: secret.scopeRef || undefined,
      });
      if (result.success && result.data) {
        await navigator.clipboard.writeText(result.data.value);
      }
    } catch {
      // Silent fail for copy
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-medium">Secrets Manager</h3>
          <p className="text-sm text-muted-foreground">
            Manage API keys, tokens, and configuration values for your integrations.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={filterScope} onValueChange={setFilterScope}>
            <SelectTrigger className="w-[160px]">
              <SelectValue placeholder="Filter by scope" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All Scopes</SelectItem>
              <SelectItem value="ORGANIZATION">Organization</SelectItem>
              <SelectItem value="INTEGRATION">Integration</SelectItem>
              <SelectItem value="TOOL">Tool</SelectItem>
            </SelectContent>
          </Select>
          <Button onClick={() => setShowCreateDialog(true)}>
            <Plus className="h-4 w-4 mr-1" />
            Add Secret
          </Button>
        </div>
      </div>

      {error && (
        <div className="bg-destructive/10 border border-destructive/20 rounded-md p-3 text-sm text-destructive flex items-center gap-2">
          <AlertCircle className="h-4 w-4 shrink-0" />
          {error}
          <Button variant="ghost" size="sm" className="ml-auto" onClick={() => setError(null)}>Dismiss</Button>
        </div>
      )}

      {loading ? (
        <div className="text-center py-8 text-muted-foreground">Loading secrets...</div>
      ) : secrets.length === 0 ? (
        <div className="text-center py-8 border rounded-lg border-dashed">
          <Key className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
          <p className="text-muted-foreground">No secrets configured yet.</p>
          <Button variant="outline" className="mt-2" onClick={() => setShowCreateDialog(true)}>
            <Plus className="h-4 w-4 mr-1" />
            Add your first secret
          </Button>
        </div>
      ) : (
        <div className="border rounded-lg divide-y">
          {secrets.map((secret) => (
            <div key={`${secret.scope}-${secret.scopeRef}-${secret.name}`} className="flex items-center justify-between p-4 hover:bg-muted/50">
              <div className="flex items-center gap-3 min-w-0">
                <Key className="h-4 w-4 text-muted-foreground shrink-0" />
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-sm truncate">{secret.name}</span>
                    <Badge variant={secret.secretType === 'SECRET' ? 'destructive' : 'secondary'} className="text-xs">
                      {secret.secretType === 'SECRET' ? 'Secret' : 'Variable'}
                    </Badge>
                    <Badge variant="outline" className="text-xs">
                      {secret.scope}
                    </Badge>
                    {secret.scopeRef && (
                      <Badge variant="outline" className="text-xs">
                        {secret.scopeRef}
                      </Badge>
                    )}
                  </div>
                  {secret.description && (
                    <p className="text-xs text-muted-foreground mt-0.5 truncate">{secret.description}</p>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handleReveal(secret)}
                  title="Reveal value"
                >
                  <Eye className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handleCopyValue(secret)}
                  title="Copy value"
                >
                  <Copy className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handleDelete(secret)}
                  title="Delete secret"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Reveal Dialog */}
      {revealTarget && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={() => { setRevealTarget(null); setRevealedValue(null); }}>
          <div className="bg-background rounded-lg shadow-lg max-w-md w-full p-6" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-medium mb-2">Reveal Secret</h3>
            <p className="text-sm text-muted-foreground mb-4">
              Showing value for <strong>{revealTarget.name}</strong>. This value is sensitive — do not share it.
            </p>
            <div className="bg-muted rounded-md p-3 font-mono text-sm break-all">
              {revealing ? 'Decrypting...' : revealedValue || '••••••••'}
            </div>
            <div className="flex justify-end gap-2 mt-4">
              <Button variant="outline" onClick={() => { setRevealTarget(null); setRevealedValue(null); }}>
                Close
              </Button>
              {revealedValue && (
                <Button onClick={async () => {
                  await navigator.clipboard.writeText(revealedValue);
                }}>
                  <Copy className="h-4 w-4 mr-1" />
                  Copy
                </Button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Create Dialog */}
      {showCreateDialog && (
        <CreateSecretDialog
          organizationId={organizationId}
          onClose={() => setShowCreateDialog(false)}
          onCreated={() => {
            setShowCreateDialog(false);
            fetchSecrets();
          }}
        />
      )}
    </div>
  );
});

function CreateSecretDialog({ organizationId, onClose, onCreated }: {
  organizationId: string;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [name, setName] = useState('');
  const [value, setValue] = useState('');
  const [secretType, setSecretType] = useState<'SECRET' | 'VARIABLE'>('SECRET');
  const [scope, setScope] = useState<'ORGANIZATION' | 'INTEGRATION' | 'TOOL'>('ORGANIZATION');
  const [scopeRef, setScopeRef] = useState('');
  const [description, setDescription] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showValue, setShowValue] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !value.trim()) {
      setError('Name and value are required');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const result = await createSecret(organizationId, {
        name: name.trim(),
        scope,
        scopeRef: scopeRef.trim() || undefined,
        secretType,
        value: value.trim(),
        description: description.trim() || undefined,
      });
      if (result.success) {
        onCreated();
      } else {
        setError(result.error?.message || 'Failed to create secret');
      }
    } catch {
      setError('Failed to create secret');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-background rounded-lg shadow-lg max-w-lg w-full p-6" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-lg font-medium mb-4">Add New Secret</h3>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="secret-name">Name</Label>
              <Input
                id="secret-name"
                placeholder="e.g., openrouter_api_key"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="secret-type">Type</Label>
              <Select value={secretType} onValueChange={(v) => setSecretType(v as 'SECRET' | 'VARIABLE')}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="SECRET">Secret (sensitive)</SelectItem>
                  <SelectItem value="VARIABLE">Variable (non-sensitive)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="secret-value">Value</Label>
            <div className="relative">
              <Input
                id="secret-value"
                type={showValue ? 'text' : 'password'}
                placeholder="Enter secret value"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                required
                className="font-mono"
              />
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="absolute right-0 top-0 h-full px-3"
                onClick={() => setShowValue(!showValue)}
              >
                {showValue ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </Button>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="secret-scope">Scope</Label>
              <Select value={scope} onValueChange={(v) => setScope(v as typeof scope)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ORGANIZATION">
                    <div className="flex items-center gap-1">
                      <Globe className="h-3 w-3" /> Organization
                    </div>
                  </SelectItem>
                  <SelectItem value="INTEGRATION">
                    <div className="flex items-center gap-1">
                      <Server className="h-3 w-3" /> Integration
                    </div>
                  </SelectItem>
                  <SelectItem value="TOOL">
                    <div className="flex items-center gap-1">
                      <Wrench className="h-3 w-3" /> Tool
                    </div>
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
            {scope !== 'ORGANIZATION' && (
              <div className="space-y-2">
                <Label htmlFor="secret-scope-ref">Scope Reference</Label>
                <Input
                  id="secret-scope-ref"
                  placeholder={scope === 'INTEGRATION' ? 'e.g., sap-prod' : 'e.g., monitoring-agent'}
                  value={scopeRef}
                  onChange={(e) => setScopeRef(e.target.value)}
                />
              </div>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="secret-desc">Description (optional)</Label>
            <Textarea
              id="secret-desc"
              placeholder="What is this secret used for?"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
            />
          </div>

          {error && (
            <div className="bg-destructive/10 border border-destructive/20 rounded-md p-3 text-sm text-destructive flex items-center gap-2">
              <AlertCircle className="h-4 w-4 shrink-0" />
              {error}
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={onClose} disabled={saving}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving || !name.trim() || !value.trim()}>
              {saving ? 'Creating...' : 'Create Secret'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
