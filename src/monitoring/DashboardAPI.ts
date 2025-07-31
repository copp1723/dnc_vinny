import { Router } from 'express';
import { MetricsCollector } from './MetricsCollector';
import { ComplianceTracker } from './ComplianceTracker';
import { AlertManager } from './AlertManager';
import { ReportEngine } from './ReportEngine';
import { logger } from '../../priority5-compliance/logger';
import { validateNumber, validateDealershipId, validateAlertId, validateSeverity, validateUsername } from '../utils/validation';

export class DashboardAPI {
  private router: Router;
  private metricsCollector: MetricsCollector;
  private complianceTracker: ComplianceTracker;
  private alertManager: AlertManager;
  private reportEngine: ReportEngine;

  constructor() {
    this.router = Router();
    this.metricsCollector = MetricsCollector.getInstance();
    this.complianceTracker = ComplianceTracker.getInstance();
    this.alertManager = AlertManager.getInstance();
    this.reportEngine = ReportEngine.getInstance();
    
    this.setupRoutes();
  }

  private setupRoutes(): void {
    // Real-time metrics endpoint
    this.router.get('/metrics/realtime', (req, res) => {
      try {
        const metrics = this.metricsCollector.getLatestMetrics();
        res.json({
          success: true,
          data: metrics,
          timestamp: new Date()
        });
      } catch (error) {
        logger.error('Failed to get realtime metrics', { error });
        res.status(500).json({ success: false, error: 'Failed to retrieve metrics' });
      }
    });

    // Historical metrics endpoint
    this.router.get('/metrics/history', (req, res) => {
      try {
        const minutes = parseInt(req.query.minutes as string) || 60;
        const metrics = this.metricsCollector.getMetricsHistory(minutes);
        res.json({
          success: true,
          data: metrics,
          count: metrics.length,
          period: { minutes }
        });
      } catch (error) {
        logger.error('Failed to get metrics history', { error });
        res.status(500).json({ success: false, error: 'Failed to retrieve metrics history' });
      }
    });

    // Compliance dashboard endpoint
    this.router.get('/compliance/dashboard', async (req, res) => {
      try {
        const dealershipId = req.query.dealershipId as string;
        const summary = this.complianceTracker.getComplianceSummary();
        
        const response: any = {
          success: true,
          data: {
            summary,
            timestamp: new Date()
          }
        };

        if (dealershipId) {
          const stats = this.complianceTracker.getLatestStats(dealershipId, 'day');
          response.data.dealershipStats = stats;
        }

        res.json(response);
      } catch (error) {
        logger.error('Failed to get compliance dashboard', { error });
        res.status(500).json({ success: false, error: 'Failed to retrieve compliance data' });
      }
    });

    // Compliance history endpoint
    this.router.get('/compliance/history/:dealershipId', async (req, res) => {
      try {
        const { dealershipId } = req.params;
        const days = parseInt(req.query.days as string) || 30;
        const history = await this.complianceTracker.getComplianceHistory(dealershipId, days);
        
        res.json({
          success: true,
          data: history,
          count: history.length,
          period: { days }
        });
      } catch (error) {
        logger.error('Failed to get compliance history', { error });
        res.status(500).json({ success: false, error: 'Failed to retrieve compliance history' });
      }
    });

    // System health endpoint
    this.router.get('/health/system', (req, res) => {
      try {
        const metrics = this.metricsCollector.getLatestMetrics();
        const alerts = this.alertManager.getActiveAlerts();
        
        const health = {
          status: this.calculateHealthStatus(metrics, alerts),
          metrics: metrics?.system,
          activeAlerts: alerts.length,
          criticalAlerts: alerts.filter(a => a.severity === 'critical').length,
          timestamp: new Date()
        };

        res.json({
          success: true,
          data: health
        });
      } catch (error) {
        logger.error('Failed to get system health', { error });
        res.status(500).json({ success: false, error: 'Failed to retrieve system health' });
      }
    });

    // Alerts endpoint
    this.router.get('/alerts', (req, res) => {
      try {
        const severity = req.query.severity as string;
        const hours = parseInt(req.query.hours as string) || 24;
        
        const alerts = severity 
          ? this.alertManager.getActiveAlerts(severity as any)
          : this.alertManager.getAlertHistory(hours);

        res.json({
          success: true,
          data: alerts,
          count: alerts.length,
          stats: this.alertManager.getAlertStats()
        });
      } catch (error) {
        logger.error('Failed to get alerts', { error });
        res.status(500).json({ success: false, error: 'Failed to retrieve alerts' });
      }
    });

    // Alert management endpoints
    this.router.post('/alerts/:alertId/acknowledge', (req, res) => {
      try {
        const { alertId } = req.params;
        const { acknowledgedBy } = req.body;
        
        const alert = this.alertManager.acknowledgeAlert(alertId, acknowledgedBy || 'system');
        if (!alert) {
          return res.status(404).json({ success: false, error: 'Alert not found or already acknowledged' });
        }

        res.json({ success: true, data: alert });
      } catch (error) {
        logger.error('Failed to acknowledge alert', { error });
        res.status(500).json({ success: false, error: 'Failed to acknowledge alert' });
      }
    });

    this.router.post('/alerts/:alertId/resolve', (req, res) => {
      try {
        const { alertId } = req.params;
        const { resolvedBy } = req.body;
        
        const alert = this.alertManager.resolveAlert(alertId, resolvedBy || 'system');
        if (!alert) {
          return res.status(404).json({ success: false, error: 'Alert not found or already resolved' });
        }

        res.json({ success: true, data: alert });
      } catch (error) {
        logger.error('Failed to resolve alert', { error });
        res.status(500).json({ success: false, error: 'Failed to resolve alert' });
      }
    });

    // Report generation endpoint
    this.router.post('/reports/generate', async (req, res) => {
      try {
        const config = req.body;
        const report = await this.reportEngine.generateReport(config);
        
        res.json({
          success: true,
          data: report
        });
      } catch (error) {
        logger.error('Failed to generate report', { error });
        res.status(500).json({ success: false, error: 'Failed to generate report' });
      }
    });

    // Report history endpoint
    this.router.get('/reports/history', (req, res) => {
      try {
        const days = parseInt(req.query.days as string) || 30;
        const reports = this.reportEngine.getReportHistory(days);
        
        res.json({
          success: true,
          data: reports,
          count: reports.length
        });
      } catch (error) {
        logger.error('Failed to get report history', { error });
        res.status(500).json({ success: false, error: 'Failed to retrieve report history' });
      }
    });

    // Performance metrics endpoint
    this.router.get('/performance/summary', (req, res) => {
      try {
        const minutes = parseInt(req.query.minutes as string) || 60;
        const metrics = this.metricsCollector.getMetricsHistory(minutes);
        
        const summary = {
          avgProcessingTime: this.calculateAverage(metrics.map(m => m.workflow.performance.avgProcessingTime)),
          avgSuccessRate: this.calculateAverage(metrics.map(m => m.workflow.performance.successRate)),
          avgThroughput: this.calculateAverage(metrics.map(m => m.workflow.performance.throughput)),
          avgApiLatency: this.calculateAverage(metrics.map(m => m.api.latency.avg)),
          totalTasks: metrics[metrics.length - 1]?.workflow.tasks.total || 0,
          totalErrors: metrics[metrics.length - 1]?.workflow.tasks.errors || 0
        };

        res.json({
          success: true,
          data: summary,
          period: { minutes }
        });
      } catch (error) {
        logger.error('Failed to get performance summary', { error });
        res.status(500).json({ success: false, error: 'Failed to retrieve performance summary' });
      }
    });

    // Resource usage endpoint
    this.router.get('/resources/usage', (req, res) => {
      try {
        const metrics = this.metricsCollector.getLatestMetrics();
        
        if (!metrics) {
          return res.json({
            success: true,
            data: null,
            message: 'No metrics available yet'
          });
        }

        const usage = {
          cpu: {
            current: metrics.system.cpu.usage,
            cores: metrics.system.cpu.cores,
            loadAverage: metrics.system.cpu.loadAverage
          },
          memory: {
            used: metrics.system.memory.used,
            total: metrics.system.memory.total,
            percentage: metrics.system.memory.percentage
          },
          browsers: {
            active: metrics.browser.browsers.active,
            total: metrics.browser.browsers.total,
            memoryEstimate: metrics.browser.memory.estimated
          },
          api: {
            vauto: metrics.api.quotas.vauto,
            cdk: metrics.api.quotas.cdk
          }
        };

        res.json({
          success: true,
          data: usage,
          timestamp: metrics.system.timestamp
        });
      } catch (error) {
        logger.error('Failed to get resource usage', { error });
        res.status(500).json({ success: false, error: 'Failed to retrieve resource usage' });
      }
    });

    // Store performance endpoint
    this.router.get('/stores/performance', (req, res) => {
      try {
        const metrics = this.metricsCollector.getLatestMetrics();
        
        if (!metrics) {
          return res.json({
            success: true,
            data: null,
            message: 'No metrics available yet'
          });
        }

        const storePerformance = {
          total: metrics.workflow.stores.total,
          active: metrics.workflow.stores.active,
          completed: metrics.workflow.stores.completed,
          failed: metrics.workflow.stores.failed,
          successRate: metrics.workflow.stores.total > 0 
            ? ((metrics.workflow.stores.completed / metrics.workflow.stores.total) * 100).toFixed(2)
            : 0
        };

        res.json({
          success: true,
          data: storePerformance,
          timestamp: metrics.workflow.timestamp
        });
      } catch (error) {
        logger.error('Failed to get store performance', { error });
        res.status(500).json({ success: false, error: 'Failed to retrieve store performance' });
      }
    });

    // WebSocket endpoint info
    this.router.get('/websocket/info', (req, res) => {
      res.json({
        success: true,
        data: {
          url: '/ws',
          events: [
            'metrics:update',
            'compliance:event',
            'alert:created',
            'alert:resolved',
            'report:generated'
          ]
        }
      });
    });
  }

  private calculateHealthStatus(metrics: any, alerts: any[]): string {
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

  private calculateAverage(values: number[]): number {
    if (values.length === 0) return 0;
    return values.reduce((a, b) => a + b, 0) / values.length;
  }

  public getRouter(): Router {
    return this.router;
  }
}

export default new DashboardAPI();