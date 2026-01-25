'use client';

import { useState, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  DataSourceCategory,
  DataSourceDefinition,
  ToolConfig,
  ToolDefinition,
  ApiKeyStatus,
  getDataSourceToolConfigs,
  updateToolConfig,
  deleteToolConfig,
  getApiKeyStatus,
  saveApiKey,
  testApiKey,
} from '@/lib/api-client';

interface DataSourceSettingsDialogProps {
  isOpen: boolean;
  organizationId: string;
  dataSourceId: DataSourceCategory;
  onClose: () => void;
  onSave: () => void;
}

export function DataSourceSettingsDialog({
  isOpen,
  organizationId,
  dataSourceId,
  onClose,
  onSave,
}: DataSourceSettingsDialogProps) {
  const [dataSource, setDataSource] = useState<DataSourceDefinition | null>(null);
  const [configs, setConfigs] = useState<ToolConfig[]>([]);
  const [selectedTool, setSelectedTool] = useState<ToolDefinition | null>(null);
  const [selectedConfig, setSelectedConfig] = useState<ToolConfig | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Form state for editing
  const [formEnabled, setFormEnabled] = useState(true);
  const [formTimeoutMs, setFormTimeoutMs] = useState(15000);
  const [formSeverityThreshold, setFormSeverityThreshold] = useState(0.5);
  const [formLookbackHours, setFormLookbackHours] = useState(24);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [formConfig, setFormConfig] = useState<Record<string, any>>({});

  // API Key state
  const [apiKeyStatus, setApiKeyStatus] = useState<ApiKeyStatus | null>(null);
  const [apiKeyInput, setApiKeyInput] = useState('');
  const [useEnvVar, setUseEnvVar] = useState(true);
  const [isSavingApiKey, setIsSavingApiKey] = useState(false);
  const [isTestingApiKey, setIsTestingApiKey] = useState(false);
  const [apiKeyMessage, setApiKeyMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const fetchData = useCallback(async () => {
    if (!organizationId || !dataSourceId) return;

    setIsLoading(true);
    setApiKeyStatus(null);
    setApiKeyInput('');
    setApiKeyMessage(null);

    try {
      const response = await getDataSourceToolConfigs(organizationId, dataSourceId);
      if (response.success && response.data) {
        setDataSource(response.data.dataSource);
        setConfigs(response.data.configs);

        // Select first tool by default
        if (response.data.dataSource.tools.length > 0) {
          const firstTool = response.data.dataSource.tools[0];
          setSelectedTool(firstTool);

          // Find existing config or use defaults
          const existingConfig = response.data.configs.find(c => c.toolId === firstTool.id);
          if (existingConfig) {
            setSelectedConfig(existingConfig);
            setFormEnabled(existingConfig.enabled);
            setFormTimeoutMs(existingConfig.apiTimeoutMs);
            setFormSeverityThreshold(existingConfig.severityThreshold);
            setFormLookbackHours(existingConfig.lookbackHours);
            setFormConfig(existingConfig.config as Record<string, unknown>);
          } else {
            setSelectedConfig(null);
            setFormEnabled(firstTool.defaultEnabled);
            setFormTimeoutMs(firstTool.defaultTimeoutMs);
            setFormSeverityThreshold(firstTool.defaultSeverityThreshold);
            setFormLookbackHours(firstTool.defaultLookbackHours);
            setFormConfig(getDefaultConfig(firstTool));
          }

          // Fetch API key status if tool has an API key option
          if (firstTool.apiKeyEnvVar || firstTool.requiresApiKey) {
            try {
              const statusResponse = await getApiKeyStatus(organizationId, dataSourceId, firstTool.id);
              if (statusResponse.success && statusResponse.data) {
                setApiKeyStatus(statusResponse.data);
                setUseEnvVar(statusResponse.data.status === 'env_var' || statusResponse.data.status === 'not_configured');
              }
            } catch (error) {
              console.error('Failed to fetch API key status:', error);
            }
          }
        }
      }
    } catch (error) {
      console.error('Failed to fetch tool configs:', error);
    } finally {
      setIsLoading(false);
    }
  }, [organizationId, dataSourceId]);

  useEffect(() => {
    if (isOpen) {
      fetchData();
    }
  }, [isOpen, fetchData]);

  const getDefaultConfig = (tool: ToolDefinition): Record<string, unknown> => {
    const config: Record<string, unknown> = {};
    for (const field of tool.configFields) {
      config[field.key] = field.default;
    }
    return config;
  };

  const handleToolSelect = async (tool: ToolDefinition) => {
    setSelectedTool(tool);
    setMessage(null);
    setApiKeyMessage(null);
    setApiKeyInput('');
    setApiKeyStatus(null);

    // Find existing config or use defaults
    const existingConfig = configs.find(c => c.toolId === tool.id);
    if (existingConfig) {
      setSelectedConfig(existingConfig);
      setFormEnabled(existingConfig.enabled);
      setFormTimeoutMs(existingConfig.apiTimeoutMs);
      setFormSeverityThreshold(existingConfig.severityThreshold);
      setFormLookbackHours(existingConfig.lookbackHours);
      setFormConfig(existingConfig.config as Record<string, unknown>);
    } else {
      setSelectedConfig(null);
      setFormEnabled(tool.defaultEnabled);
      setFormTimeoutMs(tool.defaultTimeoutMs);
      setFormSeverityThreshold(tool.defaultSeverityThreshold);
      setFormLookbackHours(tool.defaultLookbackHours);
      setFormConfig(getDefaultConfig(tool));
    }

    // Fetch API key status if tool has an API key option
    if (tool.apiKeyEnvVar || tool.requiresApiKey) {
      try {
        const response = await getApiKeyStatus(organizationId, dataSourceId, tool.id);
        if (response.success && response.data) {
          setApiKeyStatus(response.data);
          setUseEnvVar(response.data.status === 'env_var' || response.data.status === 'not_configured');
        }
      } catch (error) {
        console.error('Failed to fetch API key status:', error);
      }
    }
  };

  const handleSave = async () => {
    if (!selectedTool) return;

    setIsSaving(true);
    setMessage(null);

    try {
      const response = await updateToolConfig(
        organizationId,
        dataSourceId,
        selectedTool.id,
        {
          enabled: formEnabled,
          apiTimeoutMs: formTimeoutMs,
          severityThreshold: formSeverityThreshold,
          lookbackHours: formLookbackHours,
          config: formConfig,
        }
      );

      if (response.success && response.data) {
        // Update local state
        setConfigs(prev => {
          const idx = prev.findIndex(c => c.toolId === selectedTool.id);
          if (idx >= 0) {
            const updated = [...prev];
            updated[idx] = response.data!;
            return updated;
          }
          return [...prev, response.data!];
        });
        setSelectedConfig(response.data);
        setMessage({ type: 'success', text: 'Tool configuration saved successfully' });
        onSave();
      } else {
        setMessage({ type: 'error', text: response.error?.message || 'Failed to save configuration' });
      }
    } catch {
      setMessage({ type: 'error', text: 'Failed to save configuration' });
    } finally {
      setIsSaving(false);
    }
  };

  const handleReset = async () => {
    if (!selectedTool) return;

    setIsSaving(true);
    setMessage(null);

    try {
      const response = await deleteToolConfig(organizationId, dataSourceId, selectedTool.id);

      if (response.success) {
        // Reset to defaults
        setConfigs(prev => prev.filter(c => c.toolId !== selectedTool.id));
        setSelectedConfig(null);
        setFormEnabled(selectedTool.defaultEnabled);
        setFormTimeoutMs(selectedTool.defaultTimeoutMs);
        setFormSeverityThreshold(selectedTool.defaultSeverityThreshold);
        setFormLookbackHours(selectedTool.defaultLookbackHours);
        setFormConfig(getDefaultConfig(selectedTool));
        setMessage({ type: 'success', text: 'Configuration reset to defaults' });
        onSave();
      } else {
        setMessage({ type: 'error', text: response.error?.message || 'Failed to reset configuration' });
      }
    } catch {
      setMessage({ type: 'error', text: 'Failed to reset configuration' });
    } finally {
      setIsSaving(false);
    }
  };

  const handleConfigFieldChange = (key: string, value: unknown) => {
    setFormConfig(prev => ({ ...prev, [key]: value }));
  };

  const handleSaveApiKey = async () => {
    if (!selectedTool) return;

    setIsSavingApiKey(true);
    setApiKeyMessage(null);

    try {
      const response = await saveApiKey(
        organizationId,
        dataSourceId,
        selectedTool.id,
        useEnvVar ? { useEnvVar: true } : { apiKey: apiKeyInput }
      );

      if (response.success && response.data) {
        setApiKeyMessage({ type: 'success', text: response.data.message });
        setApiKeyInput('');
        // Refresh API key status
        const statusResponse = await getApiKeyStatus(organizationId, dataSourceId, selectedTool.id);
        if (statusResponse.success && statusResponse.data) {
          setApiKeyStatus(statusResponse.data);
        }
      } else {
        setApiKeyMessage({ type: 'error', text: response.error?.message || 'Failed to save API key' });
      }
    } catch {
      setApiKeyMessage({ type: 'error', text: 'Failed to save API key' });
    } finally {
      setIsSavingApiKey(false);
    }
  };

  const handleTestApiKey = async () => {
    if (!selectedTool) return;

    setIsTestingApiKey(true);
    setApiKeyMessage(null);

    try {
      // If user has entered a key but not saved, test that key directly
      const keyToTest = !useEnvVar && apiKeyInput ? apiKeyInput : undefined;
      const response = await testApiKey(organizationId, dataSourceId, selectedTool.id, keyToTest);

      if (response.success && response.data) {
        if (response.data.success) {
          setApiKeyMessage({ type: 'success', text: response.data.message });
        } else {
          setApiKeyMessage({
            type: 'error',
            text: response.data.details ? `${response.data.message}: ${response.data.details}` : response.data.message,
          });
        }
        // Refresh API key status to get updated last_success_at/last_error_at
        const statusResponse = await getApiKeyStatus(organizationId, dataSourceId, selectedTool.id);
        if (statusResponse.success && statusResponse.data) {
          setApiKeyStatus(statusResponse.data);
        }
      } else {
        setApiKeyMessage({ type: 'error', text: response.error?.message || 'Failed to test API key' });
      }
    } catch {
      setApiKeyMessage({ type: 'error', text: 'Failed to test API key' });
    } finally {
      setIsTestingApiKey(false);
    }
  };

  const handleClearApiKey = async () => {
    if (!selectedTool) return;

    setIsSavingApiKey(true);
    setApiKeyMessage(null);

    try {
      const response = await saveApiKey(organizationId, dataSourceId, selectedTool.id, {});

      if (response.success) {
        setApiKeyMessage({ type: 'success', text: 'API key cleared' });
        setApiKeyInput('');
        // Refresh API key status
        const statusResponse = await getApiKeyStatus(organizationId, dataSourceId, selectedTool.id);
        if (statusResponse.success && statusResponse.data) {
          setApiKeyStatus(statusResponse.data);
        }
      } else {
        setApiKeyMessage({ type: 'error', text: response.error?.message || 'Failed to clear API key' });
      }
    } catch {
      setApiKeyMessage({ type: 'error', text: 'Failed to clear API key' });
    } finally {
      setIsSavingApiKey(false);
    }
  };

  const renderConfigField = (field: ToolDefinition['configFields'][0]) => {
    const value = formConfig[field.key] ?? field.default;

    switch (field.type) {
      case 'number':
        return (
          <div key={field.key} className="space-y-1">
            <Label htmlFor={field.key} className="text-sm">
              {field.label}
            </Label>
            <p className="text-xs text-gray-500 dark:text-gray-400">{field.description}</p>
            <Input
              id={field.key}
              type="number"
              value={value as number}
              onChange={(e) => handleConfigFieldChange(field.key, parseFloat(e.target.value) || 0)}
              min={field.min}
              max={field.max}
              className="w-full"
            />
          </div>
        );

      case 'boolean':
        return (
          <div key={field.key} className="flex items-center justify-between">
            <div>
              <Label htmlFor={field.key} className="text-sm">
                {field.label}
              </Label>
              <p className="text-xs text-gray-500 dark:text-gray-400">{field.description}</p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={value as boolean}
              onClick={() => handleConfigFieldChange(field.key, !value)}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                value ? 'bg-blue-600' : 'bg-gray-200 dark:bg-gray-700'
              }`}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                  value ? 'translate-x-6' : 'translate-x-1'
                }`}
              />
            </button>
          </div>
        );

      case 'string':
        return (
          <div key={field.key} className="space-y-1">
            <Label htmlFor={field.key} className="text-sm">
              {field.label}
            </Label>
            <p className="text-xs text-gray-500 dark:text-gray-400">{field.description}</p>
            <Input
              id={field.key}
              type="text"
              value={value as string}
              onChange={(e) => handleConfigFieldChange(field.key, e.target.value)}
              className="w-full"
            />
          </div>
        );

      case 'string[]':
        return (
          <div key={field.key} className="space-y-1">
            <Label htmlFor={field.key} className="text-sm">
              {field.label}
            </Label>
            <p className="text-xs text-gray-500 dark:text-gray-400">{field.description}</p>
            <textarea
              id={field.key}
              value={(value as string[]).join('\n')}
              onChange={(e) =>
                handleConfigFieldChange(
                  field.key,
                  e.target.value.split('\n').filter((s) => s.trim())
                )
              }
              rows={4}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-800 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="One item per line"
            />
          </div>
        );

      case 'select':
        return (
          <div key={field.key} className="space-y-1">
            <Label htmlFor={field.key} className="text-sm">
              {field.label}
            </Label>
            <p className="text-xs text-gray-500 dark:text-gray-400">{field.description}</p>
            <select
              id={field.key}
              value={value as string}
              onChange={(e) => handleConfigFieldChange(field.key, e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-800 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {field.options?.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
        );

      default:
        return null;
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div className="flex min-h-full items-center justify-center p-4">
        {/* Backdrop */}
        <div
          className="fixed inset-0 bg-black/50 transition-opacity"
          onClick={onClose}
        />

        {/* Dialog */}
        <div className="relative bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-4xl w-full max-h-[90vh] overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between p-6 border-b border-gray-200 dark:border-gray-700">
            <div className="flex items-center gap-3">
              <div className="size-10 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center">
                <svg
                  className="size-5 text-white"
                  fill="none"
                  viewBox="0 0 24 24"
                  strokeWidth="1.5"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.325.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 0 1 1.37.49l1.296 2.247a1.125 1.125 0 0 1-.26 1.431l-1.003.827c-.293.241-.438.613-.43.992a7.723 7.723 0 0 1 0 .255c-.008.378.137.75.43.991l1.004.827c.424.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 0 1-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.47 6.47 0 0 1-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.94-1.11.94h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 0 1-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 0 1-1.369-.49l-1.297-2.247a1.125 1.125 0 0 1 .26-1.431l1.004-.827c.292-.24.437-.613.43-.991a6.932 6.932 0 0 1 0-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 0 1-.26-1.43l1.297-2.247a1.125 1.125 0 0 1 1.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.086.22-.128.332-.183.582-.495.644-.869l.214-1.28Z"
                  />
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z"
                  />
                </svg>
              </div>
              <div>
                <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
                  {dataSource?.name || 'Data Source'} Settings
                </h3>
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  Configure tools for this data source
                </p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="p-2 rounded-full text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
            >
              <svg
                className="size-5"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth="1.5"
                stroke="currentColor"
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {isLoading ? (
            <div className="flex items-center justify-center h-64">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
            </div>
          ) : (
            <div className="flex h-[calc(90vh-180px)]">
              {/* Tool List (Left Sidebar) */}
              <div className="w-64 border-r border-gray-200 dark:border-gray-700 overflow-y-auto p-4">
                <h4 className="text-sm font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-3">
                  Available Tools
                </h4>
                <div className="space-y-2">
                  {dataSource?.tools.map((tool) => {
                    const config = configs.find((c) => c.toolId === tool.id);
                    const isSelected = selectedTool?.id === tool.id;
                    const isEnabled = config?.enabled ?? tool.defaultEnabled;

                    return (
                      <button
                        key={tool.id}
                        onClick={() => handleToolSelect(tool)}
                        className={`w-full text-left p-3 rounded-lg border transition-colors ${
                          isSelected
                            ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
                            : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600'
                        }`}
                      >
                        <div className="flex items-center justify-between mb-1">
                          <span
                            className={`font-medium text-sm ${
                              isSelected
                                ? 'text-blue-600 dark:text-blue-400'
                                : 'text-gray-900 dark:text-white'
                            }`}
                          >
                            {tool.name}
                          </span>
                          <span
                            className={`text-xs px-2 py-0.5 rounded ${
                              isEnabled
                                ? 'bg-green-100 text-green-700 dark:bg-green-900/50 dark:text-green-400'
                                : 'bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400'
                            }`}
                          >
                            {isEnabled ? 'On' : 'Off'}
                          </span>
                        </div>
                        <p className="text-xs text-gray-500 dark:text-gray-400 line-clamp-2">
                          {tool.description}
                        </p>
                        {config && !config.isDefault && (
                          <p className="text-xs text-blue-500 dark:text-blue-400 mt-1">
                            Customized
                          </p>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Tool Configuration (Right Side) */}
              <div className="flex-1 overflow-y-auto p-6">
                {selectedTool ? (
                  <div className="space-y-6">
                    {/* Tool Header */}
                    <div>
                      <h4 className="text-lg font-medium text-gray-900 dark:text-white">
                        {selectedTool.name}
                      </h4>
                      <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                        {selectedTool.description}
                      </p>
                      {selectedTool.documentationUrl && (
                        <a
                          href={selectedTool.documentationUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-sm text-blue-500 hover:text-blue-600 inline-flex items-center gap-1 mt-2"
                        >
                          View Documentation
                          <svg
                            className="size-4"
                            fill="none"
                            viewBox="0 0 24 24"
                            strokeWidth="1.5"
                            stroke="currentColor"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              d="M13.5 6H5.25A2.25 2.25 0 0 0 3 8.25v10.5A2.25 2.25 0 0 0 5.25 21h10.5A2.25 2.25 0 0 0 18 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25"
                            />
                          </svg>
                        </a>
                      )}
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
                      </div>
                    )}

                    {/* Common Settings */}
                    <div className="space-y-4 border-b border-gray-200 dark:border-gray-700 pb-6">
                      <h5 className="text-sm font-medium text-gray-700 dark:text-gray-300">
                        Common Settings
                      </h5>

                      {/* Enabled Toggle */}
                      <div className="flex items-center justify-between">
                        <div>
                          <Label className="text-sm">Enabled</Label>
                          <p className="text-xs text-gray-500 dark:text-gray-400">
                            Enable or disable this tool
                          </p>
                        </div>
                        <button
                          type="button"
                          role="switch"
                          aria-checked={formEnabled}
                          onClick={() => setFormEnabled(!formEnabled)}
                          className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                            formEnabled ? 'bg-blue-600' : 'bg-gray-200 dark:bg-gray-700'
                          }`}
                        >
                          <span
                            className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                              formEnabled ? 'translate-x-6' : 'translate-x-1'
                            }`}
                          />
                        </button>
                      </div>

                      {/* API Timeout */}
                      <div className="space-y-1">
                        <Label htmlFor="apiTimeoutMs" className="text-sm">
                          API Timeout (ms)
                        </Label>
                        <p className="text-xs text-gray-500 dark:text-gray-400">
                          Maximum time to wait for API responses
                        </p>
                        <Input
                          id="apiTimeoutMs"
                          type="number"
                          value={formTimeoutMs}
                          onChange={(e) => setFormTimeoutMs(parseInt(e.target.value, 10) || 15000)}
                          min={1000}
                          max={60000}
                          step={1000}
                        />
                      </div>

                      {/* Severity Threshold */}
                      <div className="space-y-1">
                        <Label htmlFor="severityThreshold" className="text-sm">
                          Severity Threshold ({(formSeverityThreshold * 100).toFixed(0)}%)
                        </Label>
                        <p className="text-xs text-gray-500 dark:text-gray-400">
                          Minimum severity level to report events
                        </p>
                        <div className="flex items-center gap-4">
                          <Input
                            id="severityThreshold"
                            type="range"
                            min={0}
                            max={1}
                            step={0.05}
                            value={formSeverityThreshold}
                            onChange={(e) => setFormSeverityThreshold(parseFloat(e.target.value))}
                            className="flex-1"
                          />
                          <span className="text-sm text-gray-600 dark:text-gray-400 w-12 text-right">
                            {(formSeverityThreshold * 100).toFixed(0)}%
                          </span>
                        </div>
                      </div>

                      {/* Lookback Hours */}
                      <div className="space-y-1">
                        <Label htmlFor="lookbackHours" className="text-sm">
                          Lookback Hours
                        </Label>
                        <p className="text-xs text-gray-500 dark:text-gray-400">
                          How far back to search for events
                        </p>
                        <Input
                          id="lookbackHours"
                          type="number"
                          value={formLookbackHours}
                          onChange={(e) => setFormLookbackHours(parseInt(e.target.value, 10) || 24)}
                          min={1}
                          max={168}
                        />
                      </div>
                    </div>

                    {/* API Key Settings */}
                    {(selectedTool.apiKeyEnvVar || selectedTool.requiresApiKey) && (
                      <div className="space-y-4 border-b border-gray-200 dark:border-gray-700 pb-6">
                        <div className="flex items-center justify-between">
                          <h5 className="text-sm font-medium text-gray-700 dark:text-gray-300">
                            API Key Configuration
                          </h5>
                          {apiKeyStatus && (
                            <span
                              className={`text-xs px-2 py-1 rounded ${
                                apiKeyStatus.status === 'configured' || apiKeyStatus.status === 'env_var'
                                  ? 'bg-green-100 text-green-700 dark:bg-green-900/50 dark:text-green-400'
                                  : apiKeyStatus.status === 'not_required'
                                    ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-400'
                                    : 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/50 dark:text-yellow-400'
                              }`}
                            >
                              {apiKeyStatus.status === 'configured'
                                ? 'API Key Configured'
                                : apiKeyStatus.status === 'env_var'
                                  ? `Using ${apiKeyStatus.envVarName}`
                                  : apiKeyStatus.status === 'not_required'
                                    ? 'No Key Required'
                                    : 'Not Configured'}
                            </span>
                          )}
                        </div>

                        {/* API Key Message */}
                        {apiKeyMessage && (
                          <div
                            className={`p-3 rounded-md text-sm ${
                              apiKeyMessage.type === 'success'
                                ? 'bg-green-50 text-green-800 dark:bg-green-900/20 dark:text-green-400'
                                : 'bg-red-50 text-red-800 dark:bg-red-900/20 dark:text-red-400'
                            }`}
                          >
                            {apiKeyMessage.text}
                          </div>
                        )}

                        {/* Key Source Toggle */}
                        <div className="space-y-3">
                          <Label className="text-sm">Key Source</Label>
                          <div className="flex gap-4">
                            <label className="flex items-center gap-2 cursor-pointer">
                              <input
                                type="radio"
                                name="keySource"
                                checked={useEnvVar}
                                onChange={() => setUseEnvVar(true)}
                                className="w-4 h-4 text-blue-600"
                              />
                              <span className="text-sm text-gray-700 dark:text-gray-300">
                                Use environment variable
                              </span>
                            </label>
                            <label className="flex items-center gap-2 cursor-pointer">
                              <input
                                type="radio"
                                name="keySource"
                                checked={!useEnvVar}
                                onChange={() => setUseEnvVar(false)}
                                className="w-4 h-4 text-blue-600"
                              />
                              <span className="text-sm text-gray-700 dark:text-gray-300">
                                Enter API key manually
                              </span>
                            </label>
                          </div>
                        </div>

                        {useEnvVar ? (
                          <div className="space-y-2">
                            <div className="flex items-center gap-2 p-3 bg-gray-50 dark:bg-gray-900 rounded-md">
                              <svg
                                className="size-5 text-gray-500"
                                fill="none"
                                viewBox="0 0 24 24"
                                strokeWidth="1.5"
                                stroke="currentColor"
                              >
                                <path
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                  d="M4.5 12a7.5 7.5 0 0 0 15 0m-15 0a7.5 7.5 0 1 1 15 0m-15 0H3m16.5 0H21m-1.5 0H12m-8.457 3.077 1.41-.513m14.095-5.13 1.41-.513M5.106 17.785l1.15-.964m11.49-9.642 1.149-.964M7.501 19.795l.75-1.3m7.5-12.99.75-1.3m-6.063 16.658.26-1.477m2.605-14.772.26-1.477m0 17.726-.26-1.477M10.698 4.614l-.26-1.477M16.5 19.794l-.75-1.299M7.5 4.205 12 12m6.894 5.785-1.149-.964M6.256 7.178l-1.15-.964m15.352 8.864-1.41-.513M4.954 9.435l-1.41-.514M12.002 12l-3.75 6.495"
                                />
                              </svg>
                              <div>
                                <p className="text-sm font-medium text-gray-700 dark:text-gray-300">
                                  Environment Variable: <code className="bg-gray-200 dark:bg-gray-700 px-1 rounded">{selectedTool.apiKeyEnvVar}</code>
                                </p>
                                {apiKeyStatus?.envVarConfigured ? (
                                  <p className="text-xs text-green-600 dark:text-green-400">
                                    ✓ Environment variable is set
                                  </p>
                                ) : (
                                  <p className="text-xs text-yellow-600 dark:text-yellow-400">
                                    ⚠ Environment variable not found. Add it to your .env file.
                                  </p>
                                )}
                              </div>
                            </div>
                            <div className="flex gap-2">
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={handleSaveApiKey}
                                disabled={isSavingApiKey}
                              >
                                {isSavingApiKey ? 'Saving...' : 'Use Env Var'}
                              </Button>
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={handleTestApiKey}
                                disabled={isTestingApiKey || !apiKeyStatus?.envVarConfigured}
                              >
                                {isTestingApiKey ? 'Testing...' : 'Test Connection'}
                              </Button>
                            </div>
                          </div>
                        ) : (
                          <div className="space-y-2">
                            <Label htmlFor="apiKey" className="text-sm">
                              {apiKeyStatus?.apiKeyLabel || 'API Key'}
                            </Label>
                            <div className="flex gap-2">
                              <Input
                                id="apiKey"
                                type="password"
                                value={apiKeyInput}
                                onChange={(e) => setApiKeyInput(e.target.value)}
                                placeholder="Enter your API key"
                                className="flex-1"
                              />
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={handleSaveApiKey}
                                disabled={isSavingApiKey || !apiKeyInput}
                              >
                                {isSavingApiKey ? 'Saving...' : 'Save'}
                              </Button>
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={handleTestApiKey}
                                disabled={isTestingApiKey}
                              >
                                {isTestingApiKey ? 'Testing...' : 'Test'}
                              </Button>
                            </div>
                            <p className="text-xs text-gray-500 dark:text-gray-400">
                              The API key will be stored securely and used for API requests.
                            </p>
                            {apiKeyStatus?.status === 'configured' && (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={handleClearApiKey}
                                disabled={isSavingApiKey}
                                className="text-red-600 hover:text-red-700 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-900/20"
                              >
                                Clear Stored API Key
                              </Button>
                            )}
                          </div>
                        )}

                        {/* Last test info */}
                        {apiKeyStatus?.lastSuccessAt && (
                          <p className="text-xs text-green-600 dark:text-green-400">
                            Last successful test: {new Date(apiKeyStatus.lastSuccessAt).toLocaleString()}
                          </p>
                        )}
                        {apiKeyStatus?.lastErrorAt && (
                          <p className="text-xs text-red-600 dark:text-red-400">
                            Last error: {apiKeyStatus.lastErrorMessage} ({new Date(apiKeyStatus.lastErrorAt).toLocaleString()})
                          </p>
                        )}
                      </div>
                    )}

                    {/* Tool-Specific Settings */}
                    {selectedTool.configFields.length > 0 && (
                      <div className="space-y-4">
                        <h5 className="text-sm font-medium text-gray-700 dark:text-gray-300">
                          Tool-Specific Settings
                        </h5>
                        {selectedTool.configFields.map(renderConfigField)}
                      </div>
                    )}

                    {/* Status Info */}
                    {selectedConfig && (
                      <div className="bg-gray-50 dark:bg-gray-900 rounded-lg p-4 text-sm space-y-2">
                        <h5 className="font-medium text-gray-700 dark:text-gray-300">Status</h5>
                        <div className="grid grid-cols-2 gap-4 text-xs">
                          <div>
                            <span className="text-gray-500 dark:text-gray-400">Last Success:</span>
                            <span className="ml-2 text-gray-700 dark:text-gray-300">
                              {selectedConfig.lastSuccessAt
                                ? new Date(selectedConfig.lastSuccessAt).toLocaleString()
                                : 'Never'}
                            </span>
                          </div>
                          <div>
                            <span className="text-gray-500 dark:text-gray-400">Total Events:</span>
                            <span className="ml-2 text-gray-700 dark:text-gray-300">
                              {selectedConfig.totalEventsFetched}
                            </span>
                          </div>
                          {selectedConfig.lastErrorAt && (
                            <div className="col-span-2">
                              <span className="text-red-500">Last Error:</span>
                              <span className="ml-2 text-red-600 dark:text-red-400">
                                {selectedConfig.lastErrorMessage || 'Unknown error'}
                              </span>
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="flex items-center justify-center h-full text-gray-500 dark:text-gray-400">
                    Select a tool to configure
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Footer */}
          <div className="flex items-center justify-between p-6 border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900">
            <div>
              {selectedConfig && !selectedConfig.isDefault && (
                <Button variant="outline" onClick={handleReset} disabled={isSaving}>
                  Reset to Defaults
                </Button>
              )}
            </div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <Button onClick={handleSave} disabled={isSaving || !selectedTool}>
                {isSaving ? 'Saving...' : 'Save Changes'}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
