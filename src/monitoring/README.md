# DNC_VINNY Monitoring and Compliance Reporting System

A comprehensive monitoring and compliance reporting system for tracking DNC (Do Not Call) compliance workflows, system performance, and generating detailed reports.

## Overview

The monitoring system provides:
- Real-time metrics collection and visualization
- DNC compliance tracking and auditing
- Intelligent alerting with email and webhook notifications
- Automated report generation (PDF, Excel, JSON, HTML)
- WebSocket-based real-time dashboards
- Data retention and archival management

## Architecture

### Core Components

1. **MetricsCollector** - Collects system, workflow, browser, and API metrics
2. **ComplianceTracker** - Tracks DNC compliance events and violations
3. **AlertManager** - Manages alerts with configurable rules and notifications
4. **ReportEngine** - Generates comprehensive reports in multiple formats
5. **MonitoringService** - Orchestrates all monitoring components
6. **DashboardAPI** - REST API for dashboard data
7. **DashboardWebSocket** - Real-time WebSocket updates
8. **DataRetentionManager** - Manages data cleanup and archival

## Quick Start

```typescript
import { MonitoringServiceInstance } from './monitoring';

// Configure monitoring
MonitoringServiceInstance.configure({
  metricsInterval: 60000, // 1 minute
  alertCheckInterval: 30000, // 30 seconds
  reportSchedule: {
    daily: '0 1 * * *',
    weekly: '0 2 * * 0',
    monthly: '0 3 1 * *'
  },
  alerting: {
    email: {
      enabled: true,
      recipients: ['admin@example.com']
    }
  }
});

// Start monitoring
await MonitoringServiceInstance.start();
```

## Features

### 1. Real-time Metrics Collection

Automatically collects:
- **System Metrics**: CPU, memory, load average, uptime
- **Workflow Metrics**: Active/completed/failed workflows, success rates, throughput
- **Browser Metrics**: Active browsers, memory usage, pool status
- **API Metrics**: Request counts, quotas, latency (p95, p99)

```typescript
// Record workflow metrics
MonitoringServiceInstance.recordWorkflowStart();
MonitoringServiceInstance.recordWorkflowComplete(true);
MonitoringServiceInstance.recordProcessingTime(5000);

// Record API metrics
MonitoringServiceInstance.recordAPIRequest(true, 150);
MonitoringServiceInstance.updateAPIQuota('vauto', 450, 1000, new Date());
```

### 2. DNC Compliance Tracking

Track all compliance-related events:
- DNC checks and markings
- Customer exports
- Audit trail with 1-year retention
- Automatic compliance rate calculation

```typescript
MonitoringServiceInstance.trackComplianceAction({
  dealershipId: 'dealer123',
  dealershipName: 'Example Dealership',
  eventType: 'dnc_mark',
  action: 'mark_dnc',
  details: {
    customerPhone: '555-0123',
    customerName: 'John Doe',
    vehicleVin: '1234567890',
    result: 'success',
    source: 'vauto'
  }
});
```

### 3. Intelligent Alerting

Pre-configured alert rules:
- High CPU usage (>80%)
- High memory usage (>85%)
- High error rate (>5%)
- Low compliance rate (<95%)
- Low API quota (<10%)
- Browser pool exhaustion
- Slow processing (>5 minutes avg)
- Queue backlog (>100 items)

```typescript
// Create custom alert
MonitoringServiceInstance.createAlert(
  'custom_alert',
  'Custom Alert Title',
  'Alert message with details',
  'high', // severity: critical, high, medium, low, info
  'workflow',
  { customData: 'value' }
);

// Manage alerts
AlertManagerInstance.acknowledgeAlert(alertId, userId);
AlertManagerInstance.resolveAlert(alertId, userId);
AlertManagerInstance.suppressAlert(alertId, 60); // Suppress for 60 minutes
```

### 4. Comprehensive Reporting

Generate reports in multiple formats:

#### Report Types
- **Compliance Report**: DNC compliance rates, violations, recommendations
- **Activity Report**: Daily workflow activity, API usage, performance
- **Exception Report**: Failures, timeouts, error analysis
- **Audit Report**: Complete audit trail for compliance
- **Performance Report**: Processing speed, bottlenecks, trends
- **System Health Report**: Resource usage, stability metrics

#### Report Formats
- PDF (with charts and executive summary)
- Excel (detailed data with multiple sheets)
- JSON (for programmatic access)
- HTML (interactive dashboards)

```typescript
const report = await MonitoringServiceInstance.generateReport({
  type: 'compliance',
  format: 'pdf',
  period: 'monthly',
  dealershipIds: ['dealer1', 'dealer2'],
  includeCharts: true,
  includeDetails: true,
  emailRecipients: ['manager@example.com']
});
```

### 5. Real-time Dashboard

#### REST API Endpoints
- `GET /api/monitoring/metrics/realtime` - Current metrics
- `GET /api/monitoring/metrics/history` - Historical metrics
- `GET /api/monitoring/compliance/dashboard` - Compliance overview
- `GET /api/monitoring/alerts` - Active alerts
- `POST /api/monitoring/reports/generate` - Generate report

#### WebSocket Events
- `metrics:update` - Real-time metric updates
- `compliance:event` - Compliance actions
- `alert:created` - New alerts
- `alert:resolved` - Alert resolutions

```javascript
// Client-side WebSocket connection
const socket = io('/ws');

socket.on('metrics:update', (metrics) => {
  updateDashboard(metrics);
});

socket.on('alert:created', (alert) => {
  showNotification(alert);
});

// Request specific data
socket.emit('request:metrics:history', { minutes: 60 }, (response) => {
  renderChart(response.data);
});
```

### 6. Data Retention Management

Automatic data lifecycle management:
- **Metrics**: 90-day retention with compression
- **Compliance**: 1-year retention with archival
- **Reports**: 90-day retention (monthly reports kept)
- **Logs**: 30-day retention with compression

```typescript
// Configure retention
DataRetentionManagerInstance.updatePolicy({
  metrics: { enabled: true, days: 90, compress: true },
  compliance: { enabled: true, days: 365 },
  reports: { enabled: true, days: 90, keepMonthly: true }
});

// Manual cleanup
await DataRetentionManagerInstance.manualCleanup('metrics');

// Check storage usage
const usage = await DataRetentionManagerInstance.getStorageUsage();
console.log(`Total storage: ${(usage.total / 1024 / 1024).toFixed(2)} MB`);
```

## Integration Example

See `MonitoringIntegration.example.ts` for a complete integration example with the DNC workflow system.

## Configuration

### Environment Variables

```bash
# SMTP Configuration (for email alerts)
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_USER=alerts@example.com
SMTP_PASS=password
SMTP_FROM=alerts@dnc-vinny.com

# Alert Recipients
ALERT_EMAILS=admin@example.com,manager@example.com
ALERT_WEBHOOK=https://example.com/webhook/alerts

# Monitoring Configuration
METRICS_INTERVAL=60000
ALERT_CHECK_INTERVAL=30000
RETENTION_DAYS_METRICS=90
RETENTION_DAYS_COMPLIANCE=365
```

### Alert Rule Configuration

```typescript
// Add custom alert rule
AlertManagerInstance.addRule({
  id: 'custom_rule',
  name: 'Custom Alert Rule',
  description: 'Alert when custom metric exceeds threshold',
  enabled: true,
  conditions: {
    metric: 'custom.metric.path',
    operator: 'gt',
    threshold: 100,
    duration: 5 // minutes
  },
  severity: 'medium',
  notifications: {
    email: ['custom@example.com'],
    webhook: ['https://custom.webhook.com']
  },
  suppressionWindow: 60 // minutes
});
```

## Performance Considerations

1. **Metric Collection**: Collected at configurable intervals (default: 1 minute)
2. **History Retention**: In-memory history limited to 7 days (10,080 data points)
3. **WebSocket Updates**: Throttled to prevent overwhelming clients
4. **Report Generation**: Async with progress tracking for large datasets
5. **Data Compression**: Old metrics and logs compressed to save space

## Troubleshooting

### Common Issues

1. **High Memory Usage**
   - Reduce metric collection interval
   - Decrease history retention period
   - Enable data compression

2. **Missing Metrics**
   - Ensure MonitoringService is started
   - Check workflow hooks are properly set up
   - Verify metric collection interval

3. **Alerts Not Sending**
   - Verify SMTP configuration
   - Check webhook URLs are accessible
   - Review alert rule configurations

4. **Report Generation Failures**
   - Ensure sufficient disk space
   - Check file permissions in reports directory
   - Verify data exists for requested period

## API Reference

### MonitoringService

```typescript
interface MonitoringService {
  configure(config: MonitoringConfig): void;
  start(): Promise<void>;
  stop(): void;
  recordWorkflowStart(): void;
  recordWorkflowComplete(success: boolean): void;
  recordStoreProcessing(storeId: string, status: 'start' | 'complete' | 'fail'): void;
  recordTask(type: 'dnc_marked' | 'dnc_checked' | 'error'): void;
  recordAPIRequest(success: boolean, latency: number, rateLimited?: boolean): void;
  updateAPIQuota(service: 'vauto' | 'cdk', used: number, limit: number, resetTime: Date): void;
  trackComplianceAction(event: any): void;
  createAlert(type: string, title: string, message: string, severity: AlertSeverity, source: string, metadata?: any): void;
  generateReport(config: ReportConfig): Promise<GeneratedReport>;
  getStatus(): any;
}
```

### MetricsCollector

```typescript
interface MetricsCollector {
  startCollection(intervalMs: number): void;
  stopCollection(): void;
  getLatestMetrics(): MetricsSummary | null;
  getMetricsHistory(minutes: number): MetricsSummary[];
  reset(): void;
}
```

### ComplianceTracker

```typescript
interface ComplianceTracker {
  trackEvent(event: ComplianceEvent): Promise<void>;
  generateComplianceReport(dealershipIds: string[], startDate: Date, endDate: Date): Promise<ComplianceReport>;
  getLatestStats(dealershipId: string, period: 'hour' | 'day' | 'week' | 'month'): ComplianceStats | null;
  getComplianceHistory(dealershipId: string, days: number): Promise<ComplianceEvent[]>;
  getComplianceSummary(): any;
}
```

### AlertManager

```typescript
interface AlertManager {
  createAlert(type: string, title: string, message: string, severity: AlertSeverity, source: string, metadata?: any): Alert;
  acknowledgeAlert(alertId: string, acknowledgedBy: string): Alert | null;
  resolveAlert(alertId: string, resolvedBy: string): Alert | null;
  suppressAlert(alertId: string, minutes: number): Alert | null;
  getActiveAlerts(severity?: AlertSeverity): Alert[];
  getAlertHistory(hours: number): Alert[];
  addRule(rule: AlertRule): void;
  updateRule(ruleId: string, updates: Partial<AlertRule>): AlertRule | null;
  removeRule(ruleId: string): boolean;
}
```

## License

This monitoring system is part of the DNC_VINNY project and follows the same license terms.