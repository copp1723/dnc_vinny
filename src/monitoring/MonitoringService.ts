import { EventEmitter } from 'events';
import * as cron from 'node-cron';
import { MetricsCollector } from './MetricsCollector';
import { ComplianceTracker } from './ComplianceTracker';
import { AlertManager } from './AlertManager';
import { ReportEngine } from './ReportEngine';
import { logger } from '../../priority5-compliance/logger';

export interface MonitoringConfig {
  metricsInterval?: number; // milliseconds
  alertCheckInterval?: number; // milliseconds
  reportSchedule?: {
    daily?: string; // cron expression
    weekly?: string;
    monthly?: string;
  };
  retentionPolicy?: {
    metrics?: number; // days
    compliance?: number; // days
    reports?: number; // days
  };
  alerting?: {
    email?: {
      enabled: boolean;
      recipients: string[];
    };
    webhook?: {
      enabled: boolean;
      urls: string[];
    };
  };
}

export class MonitoringService extends EventEmitter {
  private static instance: MonitoringService;
  private metricsCollector: MetricsCollector;
  private complianceTracker: ComplianceTracker;
  private alertManager: AlertManager;
  private reportEngine: ReportEngine;
  private config: MonitoringConfig;
  private scheduledJobs: Map<string, cron.ScheduledTask> = new Map();
  private isRunning: boolean = false;

  private constructor() {
    super();
    this.metricsCollector = MetricsCollector.getInstance();
    this.complianceTracker = ComplianceTracker.getInstance();
    this.alertManager = AlertManager.getInstance();
    this.reportEngine = ReportEngine.getInstance();
    
    this.config = this.getDefaultConfig();
  }

  public static getInstance(): MonitoringService {
    if (!MonitoringService.instance) {
      MonitoringService.instance = new MonitoringService();
    }
    return MonitoringService.instance;
  }

  private getDefaultConfig(): MonitoringConfig {
    return {
      metricsInterval: 60000, // 1 minute
      alertCheckInterval: 30000, // 30 seconds
      reportSchedule: {
        daily: '0 0 * * *', // Midnight
        weekly: '0 0 * * 0', // Sunday midnight
        monthly: '0 0 1 * *' // First day of month
      },
      retentionPolicy: {
        metrics: 90,
        compliance: 365,
        reports: 90
      },
      alerting: {
        email: {
          enabled: false,
          recipients: []
        },
        webhook: {
          enabled: false,
          urls: []
        }
      }
    };
  }

  public configure(config: Partial<MonitoringConfig>): void {
    this.config = { ...this.config, ...config };
    logger.info('Monitoring service configured', { config: this.config });
    
    // Update alert notification settings
    if (config.alerting) {
      this.updateAlertingRules();
    }
    
    // Update retention policies
    if (config.retentionPolicy) {
      if (config.retentionPolicy.reports) {
        this.reportEngine.setRetentionDays(config.retentionPolicy.reports);
      }
    }
  }

  public async start(): Promise<void> {
    if (this.isRunning) {
      logger.warn('Monitoring service is already running');
      return;
    }

    logger.info('Starting monitoring service');
    this.isRunning = true;

    // Start metrics collection
    this.metricsCollector.startCollection(this.config.metricsInterval);

    // Set up event listeners
    this.setupEventListeners();

    // Schedule reports
    this.scheduleReports();

    // Start alert checking
    this.startAlertChecking();

    // Start cleanup jobs
    this.scheduleCleanupJobs();

    this.emit('service:started');
    logger.info('Monitoring service started successfully');
  }

  public stop(): void {
    if (!this.isRunning) {
      logger.warn('Monitoring service is not running');
      return;
    }

    logger.info('Stopping monitoring service');
    this.isRunning = false;

    // Stop metrics collection
    this.metricsCollector.stopCollection();

    // Stop scheduled jobs
    this.scheduledJobs.forEach((job, name) => {
      job.stop();
      logger.info(`Stopped scheduled job: ${name}`);
    });
    this.scheduledJobs.clear();

    this.emit('service:stopped');
    logger.info('Monitoring service stopped');
  }

  private setupEventListeners(): void {
    // Listen for workflow events to track compliance
    this.on('workflow:task:complete', (data) => {
      this.trackComplianceEvent(data);
    });

    this.on('workflow:task:error', (data) => {
      this.trackErrorEvent(data);
    });

    // Listen for metric threshold violations
    this.metricsCollector.on('metrics', (metrics) => {
      this.checkMetricThresholds(metrics);
    });

    // Listen for compliance violations
    this.complianceTracker.on('compliance:violation', (violation) => {
      this.handleComplianceViolation(violation);
    });
  }

  private trackComplianceEvent(data: any): void {
    if (data.type === 'dnc_mark' || data.type === 'dnc_check') {
      this.complianceTracker.trackEvent({
        dealershipId: data.dealershipId,
        dealershipName: data.dealershipName,
        eventType: data.type,
        action: data.action,
        details: {
          customerPhone: data.customerPhone,
          customerName: data.customerName,
          vehicleVin: data.vehicleVin,
          result: 'success',
          source: data.source || 'vauto'
        }
      });
    }
  }

  private trackErrorEvent(data: any): void {
    this.complianceTracker.trackEvent({
      dealershipId: data.dealershipId,
      dealershipName: data.dealershipName,
      eventType: 'error',
      action: data.action,
      details: {
        result: 'failure',
        errorMessage: data.error,
        source: data.source || 'vauto'
      }
    });
  }

  private checkMetricThresholds(metrics: any): void {
    // System metrics
    this.alertManager.evaluateMetric('system.cpu.usage', metrics.system.cpu.usage, 'system');
    this.alertManager.evaluateMetric('system.memory.percentage', metrics.system.memory.percentage, 'system');
    
    // Workflow metrics
    const errorRate = metrics.workflow.tasks.errors / (metrics.workflow.tasks.total || 1) * 100;
    this.alertManager.evaluateMetric('workflow.performance.errorRate', errorRate, 'workflow');
    
    // API quotas
    const vautoQuotaPercentage = (metrics.api.quotas.vauto.remaining / metrics.api.quotas.vauto.limit) * 100;
    this.alertManager.evaluateMetric('api.quota.remaining.percentage', vautoQuotaPercentage, 'api-vauto');
    
    const cdkQuotaPercentage = (metrics.api.quotas.cdk.remaining / metrics.api.quotas.cdk.limit) * 100;
    this.alertManager.evaluateMetric('api.quota.remaining.percentage', cdkQuotaPercentage, 'api-cdk');
    
    // Browser pool
    const availableBrowsers = metrics.browser.browsers.idle;
    this.alertManager.evaluateMetric('browser.pool.available', availableBrowsers, 'browser');
    
    // Processing time
    this.alertManager.evaluateMetric('workflow.performance.avgProcessingTime', 
      metrics.workflow.performance.avgProcessingTime, 'workflow');
    
    // Queue size (if available)
    const queueSize = metrics.workflow.workflows.queued;
    this.alertManager.evaluateMetric('workflow.queue.size', queueSize, 'workflow');
  }

  private handleComplianceViolation(violation: any): void {
    const severity = violation.type === 'excessive_errors' ? 'high' : 'medium';
    
    this.alertManager.createAlert(
      'compliance_violation',
      `Compliance Violation: ${violation.type}`,
      `Dealership ${violation.dealershipId} has ${violation.type}`,
      severity,
      'compliance',
      violation.details
    );
  }

  private updateAlertingRules(): void {
    const rules = this.alertManager.getRules();
    
    rules.forEach(rule => {
      // Update email recipients
      if (this.config.alerting?.email?.enabled) {
        rule.notifications.email = this.config.alerting.email.recipients;
      } else {
        rule.notifications.email = [];
      }
      
      // Update webhook URLs
      if (this.config.alerting?.webhook?.enabled) {
        rule.notifications.webhook = this.config.alerting.webhook.urls;
      } else {
        rule.notifications.webhook = [];
      }
      
      this.alertManager.updateRule(rule.id, rule);
    });
  }

  private scheduleReports(): void {
    // Daily report
    if (this.config.reportSchedule?.daily) {
      const dailyJob = cron.schedule(this.config.reportSchedule.daily, async () => {
        await this.generateScheduledReport('daily');
      });
      this.scheduledJobs.set('daily-report', dailyJob);
      logger.info('Scheduled daily report', { cron: this.config.reportSchedule.daily });
    }

    // Weekly report
    if (this.config.reportSchedule?.weekly) {
      const weeklyJob = cron.schedule(this.config.reportSchedule.weekly, async () => {
        await this.generateScheduledReport('weekly');
      });
      this.scheduledJobs.set('weekly-report', weeklyJob);
      logger.info('Scheduled weekly report', { cron: this.config.reportSchedule.weekly });
    }

    // Monthly report
    if (this.config.reportSchedule?.monthly) {
      const monthlyJob = cron.schedule(this.config.reportSchedule.monthly, async () => {
        await this.generateScheduledReport('monthly');
      });
      this.scheduledJobs.set('monthly-report', monthlyJob);
      logger.info('Scheduled monthly report', { cron: this.config.reportSchedule.monthly });
    }
  }

  private async generateScheduledReport(period: 'daily' | 'weekly' | 'monthly'): Promise<void> {
    try {
      logger.info(`Generating scheduled ${period} report`);
      
      // Generate compliance report
      const complianceReport = await this.reportEngine.generateReport({
        type: 'compliance',
        format: 'pdf',
        period: period,
        includeCharts: true,
        includeDetails: true,
        emailRecipients: this.config.alerting?.email?.recipients
      });
      
      // Generate activity report
      const activityReport = await this.reportEngine.generateReport({
        type: 'activity',
        format: 'excel',
        period: period,
        includeCharts: true,
        includeDetails: true
      });
      
      // Generate system health report
      const healthReport = await this.reportEngine.generateReport({
        type: 'system-health',
        format: 'pdf',
        period: period,
        includeCharts: true
      });
      
      this.emit('reports:generated', {
        period,
        reports: [complianceReport, activityReport, healthReport]
      });
      
      logger.info(`${period} reports generated successfully`);
    } catch (error) {
      logger.error(`Failed to generate ${period} reports`, { error });
      
      this.alertManager.createAlert(
        'report_generation_failed',
        `${period} Report Generation Failed`,
        `Failed to generate scheduled ${period} reports: ${error.message}`,
        'medium',
        'reports',
        { period, error: error.message }
      );
    }
  }

  private startAlertChecking(): void {
    // Periodic alert cleanup
    const alertCleanupJob = cron.schedule('0 * * * *', () => {
      const cleared = this.alertManager.clearOldAlerts(7);
      if (cleared > 0) {
        logger.info('Cleared old alerts', { count: cleared });
      }
    });
    this.scheduledJobs.set('alert-cleanup', alertCleanupJob);
  }

  private scheduleCleanupJobs(): void {
    // Metrics cleanup (daily at 2 AM)
    const metricsCleanupJob = cron.schedule('0 2 * * *', () => {
      // Metrics are automatically trimmed in MetricsCollector
      logger.info('Metrics cleanup check completed');
    });
    this.scheduledJobs.set('metrics-cleanup', metricsCleanupJob);
    
    // Report cleanup (daily at 3 AM)
    const reportCleanupJob = cron.schedule('0 3 * * *', async () => {
      // Reports are automatically cleaned up after generation
      logger.info('Report cleanup check completed');
    });
    this.scheduledJobs.set('report-cleanup', reportCleanupJob);
  }

  // Public API for external components to report metrics
  public recordWorkflowStart(): void {
    this.metricsCollector.recordWorkflowStart();
  }

  public recordWorkflowComplete(success: boolean): void {
    this.metricsCollector.recordWorkflowComplete(success);
  }

  public recordStoreProcessing(storeId: string, status: 'start' | 'complete' | 'fail'): void {
    this.metricsCollector.recordStoreProcessing(storeId, status);
  }

  public recordTask(type: 'dnc_marked' | 'dnc_checked' | 'error'): void {
    this.metricsCollector.recordTask(type);
  }

  public recordAPIRequest(success: boolean, latency: number, rateLimited: boolean = false): void {
    this.metricsCollector.recordAPIRequest(success, latency, rateLimited);
  }

  public updateAPIQuota(service: 'vauto' | 'cdk', used: number, limit: number, resetTime: Date): void {
    this.metricsCollector.updateAPIQuota(service, used, limit, resetTime);
  }

  public updateBrowserMetrics(metrics: any): void {
    this.metricsCollector.updateBrowserMetrics(metrics);
  }

  public recordProcessingTime(timeMs: number): void {
    this.metricsCollector.recordProcessingTime(timeMs);
  }

  public trackComplianceAction(event: any): void {
    this.complianceTracker.trackEvent(event);
  }

  public createAlert(type: string, title: string, message: string, severity: any, source: string, metadata?: any): void {
    this.alertManager.createAlert(type, title, message, severity, source, metadata);
  }

  public async generateReport(config: any): Promise<any> {
    return this.reportEngine.generateReport(config);
  }

  public getStatus(): {
    running: boolean;
    metrics: any;
    compliance: any;
    alerts: any;
    scheduledJobs: string[];
  } {
    return {
      running: this.isRunning,
      metrics: this.metricsCollector.getLatestMetrics(),
      compliance: this.complianceTracker.getComplianceSummary(),
      alerts: this.alertManager.getAlertStats(),
      scheduledJobs: Array.from(this.scheduledJobs.keys())
    };
  }
}

export default MonitoringService.getInstance();