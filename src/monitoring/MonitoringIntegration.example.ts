/**
 * Example integration of the comprehensive monitoring and compliance reporting system
 * This file demonstrates how to integrate monitoring into the DNC_VINNY workflow system
 */

import { Express } from 'express';
import { Server as HTTPServer } from 'http';
import {
  MonitoringServiceInstance,
  DashboardAPIInstance,
  DashboardWebSocket,
  MetricsCollectorInstance,
  ComplianceTrackerInstance,
  AlertManagerInstance,
  DataRetentionManagerInstance
} from './index';
import { MultiStoreWorkflowOrchestrator } from '../multi-store/MultiStoreWorkflowOrchestrator';
import { DncComplianceWorkflow } from '../workflows/dnc-compliance-workflow/DncComplianceWorkflow';
import { logger } from '../../priority5-compliance/logger';

export class MonitoringIntegration {
  private monitoringService = MonitoringServiceInstance;
  private dashboardWS: DashboardWebSocket;
  
  constructor(
    private app: Express,
    private server: HTTPServer,
    private orchestrator: MultiStoreWorkflowOrchestrator
  ) {
    // Initialize WebSocket dashboard
    this.dashboardWS = new DashboardWebSocket(server);
  }

  /**
   * Initialize and start the monitoring system
   */
  public async initialize(): Promise<void> {
    logger.info('Initializing monitoring system');

    // Configure monitoring service
    this.monitoringService.configure({
      metricsInterval: 60000, // Collect metrics every minute
      alertCheckInterval: 30000, // Check alerts every 30 seconds
      reportSchedule: {
        daily: '0 1 * * *', // 1 AM daily
        weekly: '0 2 * * 0', // 2 AM Sunday
        monthly: '0 3 1 * *' // 3 AM first day of month
      },
      retentionPolicy: {
        metrics: 90,
        compliance: 365,
        reports: 90
      },
      alerting: {
        email: {
          enabled: process.env.SMTP_HOST ? true : false,
          recipients: process.env.ALERT_EMAILS?.split(',') || []
        },
        webhook: {
          enabled: process.env.ALERT_WEBHOOK ? true : false,
          urls: process.env.ALERT_WEBHOOK ? [process.env.ALERT_WEBHOOK] : []
        }
      }
    });

    // Configure data retention
    DataRetentionManagerInstance.updatePolicy({
      metrics: { enabled: true, days: 90, compress: true },
      compliance: { enabled: true, days: 365 },
      reports: { enabled: true, days: 90, keepMonthly: true },
      logs: { enabled: true, days: 30, compress: true }
    });

    // Start retention management
    DataRetentionManagerInstance.startRetentionManagement();

    // Add API routes
    this.app.use('/api/monitoring', DashboardAPIInstance.getRouter());

    // Start monitoring service
    await this.monitoringService.start();

    // Set up workflow hooks
    this.setupWorkflowHooks();

    // Set up orchestrator hooks
    this.setupOrchestratorHooks();

    logger.info('Monitoring system initialized successfully');
  }

  /**
   * Set up hooks to track workflow events
   */
  private setupWorkflowHooks(): void {
    // Hook into workflow lifecycle events
    DncComplianceWorkflow.prototype.execute = new Proxy(DncComplianceWorkflow.prototype.execute, {
      apply: async (target, thisArg, args) => {
        const startTime = Date.now();
        
        // Record workflow start
        this.monitoringService.recordWorkflowStart();
        
        try {
          const result = await target.apply(thisArg, args);
          
          // Record successful completion
          this.monitoringService.recordWorkflowComplete(true);
          this.monitoringService.recordProcessingTime(Date.now() - startTime);
          
          // Track compliance action
          if (result.dncMarked) {
            this.monitoringService.trackComplianceAction({
              dealershipId: thisArg.config.dealershipId,
              dealershipName: thisArg.config.dealershipName,
              eventType: 'dnc_mark',
              action: 'mark_dnc',
              details: {
                customerPhone: result.customerPhone,
                customerName: result.customerName,
                vehicleVin: result.vehicleVin,
                result: 'success',
                source: 'vauto'
              }
            });
            
            this.monitoringService.recordTask('dnc_marked');
          } else {
            this.monitoringService.recordTask('dnc_checked');
          }
          
          return result;
        } catch (error) {
          // Record failure
          this.monitoringService.recordWorkflowComplete(false);
          this.monitoringService.recordTask('error');
          
          // Track error event
          this.monitoringService.trackComplianceAction({
            dealershipId: thisArg.config.dealershipId,
            dealershipName: thisArg.config.dealershipName,
            eventType: 'error',
            action: 'workflow_error',
            details: {
              result: 'failure',
              errorMessage: error.message,
              source: 'vauto'
            }
          });
          
          // Create alert for critical errors
          if (error.message.includes('timeout') || error.message.includes('browser')) {
            this.monitoringService.createAlert(
              'workflow_error',
              'Workflow Execution Error',
              `Workflow failed: ${error.message}`,
              'high',
              'workflow',
              { dealershipId: thisArg.config.dealershipId, error: error.message }
            );
          }
          
          throw error;
        }
      }
    });
  }

  /**
   * Set up hooks to track orchestrator events
   */
  private setupOrchestratorHooks(): void {
    // Track store processing
    this.orchestrator.on('store:start', (data: any) => {
      this.monitoringService.recordStoreProcessing(data.storeId, 'start');
      
      logger.info('Store processing started', {
        storeId: data.storeId,
        dealershipName: data.dealershipName
      });
    });

    this.orchestrator.on('store:complete', (data: any) => {
      this.monitoringService.recordStoreProcessing(data.storeId, 'complete');
      
      logger.info('Store processing completed', {
        storeId: data.storeId,
        processingTime: data.processingTime
      });
    });

    this.orchestrator.on('store:error', (data: any) => {
      this.monitoringService.recordStoreProcessing(data.storeId, 'fail');
      
      logger.error('Store processing failed', {
        storeId: data.storeId,
        error: data.error
      });
    });

    // Track API usage
    this.orchestrator.on('api:request', (data: any) => {
      const startTime = Date.now();
      
      // Hook into response
      data.promise.then(() => {
        this.monitoringService.recordAPIRequest(true, Date.now() - startTime);
      }).catch((error: any) => {
        const rateLimited = error.message.includes('rate limit') || 
                          error.response?.status === 429;
        this.monitoringService.recordAPIRequest(false, Date.now() - startTime, rateLimited);
      });
    });

    // Track API quotas
    this.orchestrator.on('api:quota:update', (data: any) => {
      this.monitoringService.updateAPIQuota(
        data.service,
        data.used,
        data.limit,
        new Date(data.resetTime)
      );
    });

    // Track browser metrics
    this.orchestrator.on('browser:metrics', (data: any) => {
      this.monitoringService.updateBrowserMetrics(data);
    });
  }

  /**
   * Example: Generate an on-demand compliance report
   */
  public async generateComplianceReport(
    dealershipIds: string[],
    startDate?: Date,
    endDate?: Date
  ): Promise<any> {
    return await this.monitoringService.generateReport({
      type: 'compliance',
      format: 'pdf',
      period: 'custom',
      dealershipIds,
      startDate: startDate || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000), // 30 days ago
      endDate: endDate || new Date(),
      includeCharts: true,
      includeDetails: true
    });
  }

  /**
   * Example: Get real-time dashboard data
   */
  public getDashboardData(): any {
    const metrics = MetricsCollectorInstance.getLatestMetrics();
    const compliance = ComplianceTrackerInstance.getComplianceSummary();
    const alerts = AlertManagerInstance.getActiveAlerts();
    
    return {
      system: {
        status: this.calculateSystemStatus(metrics, alerts),
        uptime: metrics?.system.process.uptime || 0,
        cpu: metrics?.system.cpu.usage || 0,
        memory: metrics?.system.memory.percentage || 0
      },
      workflow: {
        active: metrics?.workflow.workflows.active || 0,
        completed: metrics?.workflow.workflows.completed || 0,
        failed: metrics?.workflow.workflows.failed || 0,
        successRate: metrics?.workflow.performance.successRate || 0,
        avgProcessingTime: metrics?.workflow.performance.avgProcessingTime || 0
      },
      compliance: {
        totalEvents: compliance.totalEvents,
        complianceRate: compliance.complianceRate,
        recentActions: compliance.eventsByType
      },
      alerts: {
        active: alerts.length,
        bySeverity: this.groupAlertsBySeverity(alerts)
      },
      api: {
        vauto: metrics?.api.quotas.vauto || { used: 0, limit: 0, remaining: 0 },
        cdk: metrics?.api.quotas.cdk || { used: 0, limit: 0, remaining: 0 }
      }
    };
  }

  /**
   * Example: Handle alert acknowledgement
   */
  public acknowledgeAlert(alertId: string, userId: string): any {
    return AlertManagerInstance.acknowledgeAlert(alertId, userId);
  }

  /**
   * Example: Get historical metrics for charts
   */
  public getMetricsHistory(minutes: number = 60): any[] {
    return MetricsCollectorInstance.getMetricsHistory(minutes);
  }

  /**
   * Example: Get compliance history for a dealership
   */
  public async getComplianceHistory(dealershipId: string, days: number = 30): Promise<any[]> {
    return await ComplianceTrackerInstance.getComplianceHistory(dealershipId, days);
  }

  /**
   * Example: Manual cleanup trigger
   */
  public async triggerCleanup(type?: 'metrics' | 'compliance' | 'reports' | 'logs'): Promise<any> {
    return await DataRetentionManagerInstance.manualCleanup(type);
  }

  /**
   * Example: Get storage usage statistics
   */
  public async getStorageUsage(): Promise<any> {
    return await DataRetentionManagerInstance.getStorageUsage();
  }

  /**
   * Helper methods
   */
  private calculateSystemStatus(metrics: any, alerts: any[]): string {
    if (!metrics) return 'unknown';
    
    const criticalAlerts = alerts.filter(a => a.severity === 'critical').length;
    if (criticalAlerts > 0) return 'critical';
    
    const highAlerts = alerts.filter(a => a.severity === 'high').length;
    if (highAlerts > 2) return 'warning';
    
    if (metrics.system.cpu.usage > 90 || metrics.system.memory.percentage > 90) {
      return 'warning';
    }
    
    return 'healthy';
  }

  private groupAlertsBySeverity(alerts: any[]): Record<string, number> {
    return alerts.reduce((acc, alert) => {
      acc[alert.severity] = (acc[alert.severity] || 0) + 1;
      return acc;
    }, {});
  }

  /**
   * Shutdown monitoring system
   */
  public async shutdown(): Promise<void> {
    logger.info('Shutting down monitoring system');
    
    this.monitoringService.stop();
    DataRetentionManagerInstance.stopRetentionManagement();
    this.dashboardWS.stop();
    
    logger.info('Monitoring system shut down complete');
  }
}

// Example usage in main application
export async function setupMonitoring(
  app: Express,
  server: HTTPServer,
  orchestrator: MultiStoreWorkflowOrchestrator
): Promise<MonitoringIntegration> {
  const monitoring = new MonitoringIntegration(app, server, orchestrator);
  await monitoring.initialize();
  
  // Add example API endpoints
  app.get('/api/dashboard', (req, res) => {
    res.json(monitoring.getDashboardData());
  });
  
  app.post('/api/alerts/:alertId/acknowledge', (req, res) => {
    const { alertId } = req.params;
    const { userId } = req.body;
    const result = monitoring.acknowledgeAlert(alertId, userId);
    res.json({ success: !!result, data: result });
  });
  
  app.get('/api/metrics/history', (req, res) => {
    const minutes = parseInt(req.query.minutes as string) || 60;
    const history = monitoring.getMetricsHistory(minutes);
    res.json({ success: true, data: history });
  });
  
  app.post('/api/reports/compliance', async (req, res) => {
    try {
      const { dealershipIds, startDate, endDate } = req.body;
      const report = await monitoring.generateComplianceReport(
        dealershipIds,
        startDate ? new Date(startDate) : undefined,
        endDate ? new Date(endDate) : undefined
      );
      res.json({ success: true, data: report });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });
  
  return monitoring;
}