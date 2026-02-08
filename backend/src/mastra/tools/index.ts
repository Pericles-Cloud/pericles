/**
 * Mastra Tools Index
 *
 * This file exports all monitoring tools for use in the Monitoring Agent.
 *
 * Tool Categories:
 * 1. Critical Infrastructure Tools (_deduplication, ERP context)
 * 2. Data Source Monitoring Tools (10 risk categories)
 */

// ============================================================================
// Critical Infrastructure Tools
// ============================================================================

export { organizationLookupTool } from './organization-lookup-tool.js';
export { incidentLookupTool, generateEventHash } from './incident-lookup-tool.js';
export { erpContextTool } from './erp-context-tool.js';

// SAP S/4HANA Cloud ERP Data Tools (Real-time API access)
export {
  sapGetSuppliersT,
  sapGetPlantsT,
  sapGetMaterialStockTool,
  sapGetShippingLanesTool,
} from './sap-erp-data-tool.js';

// ============================================================================
// Data Source Monitoring Tools
// ============================================================================

// 1. Weather & Natural Disasters
export { weatherDisasterMonitorTool, calculateDistance } from './weather-disaster-monitor-tool.js';

// 2. Political Risk
export { politicalRiskMonitorTool } from './political-risk-monitor-tool.js';

// 3. Cybersecurity
export { cybersecurityMonitorTool } from './cybersecurity-monitor-tool.js';

// 4. Economic & Financial
export { economicFinancialMonitorTool } from './economic-financial-monitor-tool.js';

// 5. News & Social Media
export { newsSocialMediaMonitorTool } from './news-social-media-monitor-tool.js';

// 6. Maritime & Logistics
export { maritimeLogisticsMonitorTool } from './maritime-logistics-monitor-tool.js';

// 7. Labor & Social
export { laborSocialMonitorTool } from './labor-social-monitor-tool.js';

// 8. Regulatory & Trade
export { regulatoryTradeMonitorTool } from './regulatory-trade-monitor-tool.js';

// 9. Pandemic & Health
export { pandemicHealthMonitorTool } from './pandemic-health-monitor-tool.js';

// 10. Geopolitical & Conflict
export { geopoliticalConflictMonitorTool } from './geopolitical-conflict-monitor-tool.js';
