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

export { organizationLookupTool } from './organization-lookup-tool';
export { incidentLookupTool, generateEventHash } from './incident-lookup-tool';
export { erpContextTool } from './erp-context-tool';

// SAP S/4HANA Cloud ERP Data Tools (Real-time API access)
export {
  sapGetSuppliersT,
  sapGetPlantsT,
  sapGetMaterialStockTool,
  sapGetShippingLanesTool,
} from './sap-erp-data-tool';

// ============================================================================
// Data Source Monitoring Tools
// ============================================================================

// 1. Weather & Natural Disasters
export { weatherDisasterMonitorTool, calculateDistance } from './weather-disaster-monitor-tool';

// 2. Political Risk
export { politicalRiskMonitorTool } from './political-risk-monitor-tool';

// 3. Cybersecurity
export { cybersecurityMonitorTool } from './cybersecurity-monitor-tool';

// 4. Economic & Financial
export { economicFinancialMonitorTool } from './economic-financial-monitor-tool';

// 5. News & Social Media
export { newsSocialMediaMonitorTool } from './news-social-media-monitor-tool';

// 6. Maritime & Logistics
export { maritimeLogisticsMonitorTool } from './maritime-logistics-monitor-tool';

// 7. Labor & Social
export { laborSocialMonitorTool } from './labor-social-monitor-tool';

// 8. Regulatory & Trade
export { regulatoryTradeMonitorTool } from './regulatory-trade-monitor-tool';

// 9. Pandemic & Health
export { pandemicHealthMonitorTool } from './pandemic-health-monitor-tool';

// 10. Geopolitical & Conflict
export { geopoliticalConflictMonitorTool } from './geopolitical-conflict-monitor-tool';
