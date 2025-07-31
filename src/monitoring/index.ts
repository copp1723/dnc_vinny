// Export all monitoring components
export { MetricsCollector, MetricsSummary, SystemMetrics, WorkflowMetrics, BrowserMetrics, APIMetrics } from './MetricsCollector';
export { ComplianceTracker, ComplianceEvent, ComplianceStats, ComplianceReport } from './ComplianceTracker';
export { AlertManager, Alert, AlertRule, AlertSeverity, AlertStatus, AlertNotification } from './AlertManager';
export { ReportEngine, ReportConfig, ReportType, ReportFormat, ReportPeriod, GeneratedReport } from './ReportEngine';
export { MonitoringService, MonitoringConfig } from './MonitoringService';
export { DashboardAPI } from './DashboardAPI';
export { DashboardWebSocket } from './DashboardWebSocket';
export { DataRetentionManager, RetentionPolicy, CleanupResult } from './DataRetentionManager';
export { ChartGenerator } from './visualizations/ChartGenerator';

// Export singleton instances
import MetricsCollectorInstance from './MetricsCollector';
import ComplianceTrackerInstance from './ComplianceTracker';
import AlertManagerInstance from './AlertManager';
import ReportEngineInstance from './ReportEngine';
import MonitoringServiceInstance from './MonitoringService';
import DataRetentionManagerInstance from './DataRetentionManager';
import DashboardAPIInstance from './DashboardAPI';

export {
  MetricsCollectorInstance,
  ComplianceTrackerInstance,
  AlertManagerInstance,
  ReportEngineInstance,
  MonitoringServiceInstance,
  DataRetentionManagerInstance,
  DashboardAPIInstance
};