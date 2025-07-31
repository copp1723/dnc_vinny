import { EventEmitter } from 'events';
import * as PDFDocument from 'pdfkit';
import * as ExcelJS from 'exceljs';
import * as fs from 'fs/promises';
import * as path from 'path';
import { Chart, ChartConfiguration } from 'chart.js';
import { createCanvas } from 'canvas';
import { logger } from '../../priority5-compliance/logger';
import { MetricsSummary } from './MetricsCollector';
import { ComplianceReport, ComplianceStats } from './ComplianceTracker';
import { Alert } from './AlertManager';

export type ReportType = 'compliance' | 'activity' | 'exception' | 'audit' | 'performance' | 'system-health';
export type ReportFormat = 'pdf' | 'excel' | 'json' | 'html';
export type ReportPeriod = 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'custom';

export interface ReportConfig {
  type: ReportType;
  format: ReportFormat;
  period: ReportPeriod;
  dealershipIds?: string[];
  startDate?: Date;
  endDate?: Date;
  includeCharts?: boolean;
  includeDetails?: boolean;
  emailRecipients?: string[];
  customFields?: Record<string, any>;
}

export interface GeneratedReport {
  id: string;
  type: ReportType;
  format: ReportFormat;
  generatedAt: Date;
  period: {
    start: Date;
    end: Date;
  };
  filePath: string;
  size: number;
  metadata?: Record<string, any>;
}

export class ReportEngine extends EventEmitter {
  private static instance: ReportEngine;
  private reportsPath: string;
  private reportHistory: GeneratedReport[] = [];
  private retentionDays: number = 90;
  
  private constructor() {
    super();
    this.reportsPath = path.join(process.cwd(), 'reports', 'generated');
    this.initializeStorage();
  }

  public static getInstance(): ReportEngine {
    if (!ReportEngine.instance) {
      ReportEngine.instance = new ReportEngine();
    }
    return ReportEngine.instance;
  }

  private async initializeStorage(): Promise<void> {
    try {
      await fs.mkdir(this.reportsPath, { recursive: true });
      logger.info('Report engine storage initialized', { path: this.reportsPath });
    } catch (error) {
      logger.error('Failed to initialize report storage', { error });
    }
  }

  public async generateReport(config: ReportConfig): Promise<GeneratedReport> {
    const reportId = this.generateReportId();
    const { startDate, endDate } = this.getReportPeriod(config);
    
    let filePath: string;
    let report: GeneratedReport;
    
    try {
      switch (config.type) {
        case 'compliance':
          filePath = await this.generateComplianceReport(reportId, config, startDate, endDate);
          break;
        case 'activity':
          filePath = await this.generateActivityReport(reportId, config, startDate, endDate);
          break;
        case 'exception':
          filePath = await this.generateExceptionReport(reportId, config, startDate, endDate);
          break;
        case 'audit':
          filePath = await this.generateAuditReport(reportId, config, startDate, endDate);
          break;
        case 'performance':
          filePath = await this.generatePerformanceReport(reportId, config, startDate, endDate);
          break;
        case 'system-health':
          filePath = await this.generateSystemHealthReport(reportId, config, startDate, endDate);
          break;
        default:
          throw new Error(`Unknown report type: ${config.type}`);
      }
      
      const stats = await fs.stat(filePath);
      
      report = {
        id: reportId,
        type: config.type,
        format: config.format,
        generatedAt: new Date(),
        period: { start: startDate, end: endDate },
        filePath,
        size: stats.size,
        metadata: config.customFields
      };
      
      this.reportHistory.push(report);
      this.emit('report:generated', report);
      
      // Clean up old reports
      await this.cleanupOldReports();
      
      logger.info('Report generated', { 
        reportId, 
        type: config.type, 
        format: config.format,
        size: stats.size 
      });
      
      return report;
    } catch (error) {
      logger.error('Failed to generate report', { error, config });
      throw error;
    }
  }

  private generateReportId(): string {
    return `rpt_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private getReportPeriod(config: ReportConfig): { startDate: Date; endDate: Date } {
    if (config.startDate && config.endDate) {
      return { startDate: config.startDate, endDate: config.endDate };
    }
    
    const endDate = new Date();
    const startDate = new Date();
    
    switch (config.period) {
      case 'daily':
        startDate.setDate(endDate.getDate() - 1);
        break;
      case 'weekly':
        startDate.setDate(endDate.getDate() - 7);
        break;
      case 'monthly':
        startDate.setMonth(endDate.getMonth() - 1);
        break;
      case 'quarterly':
        startDate.setMonth(endDate.getMonth() - 3);
        break;
    }
    
    return { startDate, endDate };
  }

  private async generateComplianceReport(
    reportId: string,
    config: ReportConfig,
    startDate: Date,
    endDate: Date
  ): Promise<string> {
    // Get compliance data
    const complianceTracker = require('./ComplianceTracker').default;
    const dealershipIds = config.dealershipIds || ['all'];
    const complianceData = await complianceTracker.generateComplianceReport(
      dealershipIds,
      startDate,
      endDate
    );
    
    switch (config.format) {
      case 'pdf':
        return this.generateCompliancePDF(reportId, complianceData, config);
      case 'excel':
        return this.generateComplianceExcel(reportId, complianceData, config);
      case 'json':
        return this.generateJSON(reportId, complianceData, 'compliance');
      case 'html':
        return this.generateComplianceHTML(reportId, complianceData, config);
      default:
        throw new Error(`Unsupported format: ${config.format}`);
    }
  }

  private async generateCompliancePDF(
    reportId: string,
    data: ComplianceReport,
    config: ReportConfig
  ): Promise<string> {
    const filename = `compliance-${reportId}.pdf`;
    const filePath = path.join(this.reportsPath, filename);
    
    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ margin: 50 });
      const stream = fs.createWriteStream(filePath);
      
      doc.pipe(stream);
      
      // Header
      doc.fontSize(24).text('DNC Compliance Report', { align: 'center' });
      doc.fontSize(12).text(`Generated: ${new Date().toLocaleString()}`, { align: 'center' });
      doc.moveDown();
      
      // Executive Summary
      doc.fontSize(18).text('Executive Summary');
      doc.fontSize(10);
      doc.text(`Report Period: ${data.period.start.toLocaleDateString()} - ${data.period.end.toLocaleDateString()}`);
      doc.text(`Total Dealerships: ${data.summary.totalDealerships}`);
      doc.text(`Total Checks: ${data.summary.totalChecks.toLocaleString()}`);
      doc.text(`Total Marked: ${data.summary.totalMarked.toLocaleString()}`);
      doc.text(`Overall Compliance Rate: ${data.summary.overallComplianceRate.toFixed(2)}%`);
      doc.moveDown();
      
      // Trends
      doc.fontSize(14).text('Trends');
      doc.fontSize(10);
      doc.text(`Checks Trend: ${data.summary.trends.checksTrend}`);
      doc.text(`Compliance Trend: ${data.summary.trends.complianceTrend}`);
      doc.text(`Error Trend: ${data.summary.trends.errorTrend}`);
      doc.moveDown();
      
      // Dealership Details
      if (config.includeDetails) {
        doc.addPage();
        doc.fontSize(18).text('Dealership Details');
        
        data.dealerships.forEach(dealership => {
          doc.fontSize(14).text(dealership.name);
          doc.fontSize(10);
          doc.text(`Total Checks: ${dealership.stats.totalChecks.toLocaleString()}`);
          doc.text(`Compliance Rate: ${dealership.stats.complianceRate.toFixed(2)}%`);
          
          if (dealership.topIssues.length > 0) {
            doc.text('Top Issues:');
            dealership.topIssues.forEach(issue => {
              doc.text(`  - ${issue.issue} (${issue.count} occurrences, ${issue.impact} impact)`);
            });
          }
          
          if (dealership.recommendations.length > 0) {
            doc.text('Recommendations:');
            dealership.recommendations.forEach(rec => {
              doc.text(`  - ${rec}`);
            });
          }
          
          doc.moveDown();
        });
      }
      
      // Charts
      if (config.includeCharts) {
        // Would add charts here using canvas
      }
      
      doc.end();
      
      stream.on('finish', () => resolve(filePath));
      stream.on('error', reject);
    });
  }

  private async generateComplianceExcel(
    reportId: string,
    data: ComplianceReport,
    config: ReportConfig
  ): Promise<string> {
    const filename = `compliance-${reportId}.xlsx`;
    const filePath = path.join(this.reportsPath, filename);
    
    const workbook = new ExcelJS.Workbook();
    
    // Summary Sheet
    const summarySheet = workbook.addWorksheet('Summary');
    summarySheet.columns = [
      { header: 'Metric', key: 'metric', width: 30 },
      { header: 'Value', key: 'value', width: 20 }
    ];
    
    summarySheet.addRows([
      { metric: 'Report Period', value: `${data.period.start.toLocaleDateString()} - ${data.period.end.toLocaleDateString()}` },
      { metric: 'Total Dealerships', value: data.summary.totalDealerships },
      { metric: 'Total Checks', value: data.summary.totalChecks },
      { metric: 'Total Marked', value: data.summary.totalMarked },
      { metric: 'Overall Compliance Rate', value: `${data.summary.overallComplianceRate.toFixed(2)}%` },
      { metric: 'Checks Trend', value: data.summary.trends.checksTrend },
      { metric: 'Compliance Trend', value: data.summary.trends.complianceTrend },
      { metric: 'Error Trend', value: data.summary.trends.errorTrend }
    ]);
    
    // Dealership Details Sheet
    const detailsSheet = workbook.addWorksheet('Dealership Details');
    detailsSheet.columns = [
      { header: 'Dealership', key: 'name', width: 30 },
      { header: 'Total Checks', key: 'checks', width: 15 },
      { header: 'Total Marked', key: 'marked', width: 15 },
      { header: 'Total Errors', key: 'errors', width: 15 },
      { header: 'Compliance Rate', key: 'rate', width: 15 },
      { header: 'Top Issue', key: 'topIssue', width: 40 }
    ];
    
    data.dealerships.forEach(dealership => {
      detailsSheet.addRow({
        name: dealership.name,
        checks: dealership.stats.totalChecks,
        marked: dealership.stats.totalMarked,
        errors: dealership.stats.totalErrors,
        rate: `${dealership.stats.complianceRate.toFixed(2)}%`,
        topIssue: dealership.topIssues[0]?.issue || 'None'
      });
    });
    
    // Issues Sheet
    if (config.includeDetails) {
      const issuesSheet = workbook.addWorksheet('Issues & Recommendations');
      issuesSheet.columns = [
        { header: 'Dealership', key: 'dealership', width: 30 },
        { header: 'Issue', key: 'issue', width: 40 },
        { header: 'Count', key: 'count', width: 10 },
        { header: 'Impact', key: 'impact', width: 10 },
        { header: 'Recommendation', key: 'recommendation', width: 50 }
      ];
      
      data.dealerships.forEach(dealership => {
        dealership.topIssues.forEach((issue, index) => {
          issuesSheet.addRow({
            dealership: dealership.name,
            issue: issue.issue,
            count: issue.count,
            impact: issue.impact,
            recommendation: dealership.recommendations[index] || ''
          });
        });
      });
    }
    
    await workbook.xlsx.writeFile(filePath);
    return filePath;
  }

  private async generateActivityReport(
    reportId: string,
    config: ReportConfig,
    startDate: Date,
    endDate: Date
  ): Promise<string> {
    // Get activity data from MetricsCollector
    const metricsCollector = require('./MetricsCollector').default;
    const metricsHistory = metricsCollector.getMetricsHistory(
      Math.ceil((endDate.getTime() - startDate.getTime()) / 60000) // minutes
    );
    
    const activityData = {
      period: { start: startDate, end: endDate },
      summary: this.summarizeMetrics(metricsHistory),
      hourlyBreakdown: this.groupMetricsByHour(metricsHistory),
      topStores: this.getTopPerformingStores(metricsHistory),
      apiUsage: this.summarizeAPIUsage(metricsHistory)
    };
    
    switch (config.format) {
      case 'pdf':
        return this.generateActivityPDF(reportId, activityData, config);
      case 'excel':
        return this.generateActivityExcel(reportId, activityData, config);
      case 'json':
        return this.generateJSON(reportId, activityData, 'activity');
      case 'html':
        return this.generateActivityHTML(reportId, activityData, config);
      default:
        throw new Error(`Unsupported format: ${config.format}`);
    }
  }

  private async generateExceptionReport(
    reportId: string,
    config: ReportConfig,
    startDate: Date,
    endDate: Date
  ): Promise<string> {
    // Get exception data from AlertManager and ComplianceTracker
    const alertManager = require('./AlertManager').default;
    const complianceTracker = require('./ComplianceTracker').default;
    
    const alerts = alertManager.getAlertHistory(
      Math.ceil((endDate.getTime() - startDate.getTime()) / 3600000) // hours
    );
    
    const exceptionData = {
      period: { start: startDate, end: endDate },
      alerts: alerts.filter(a => a.timestamp >= startDate && a.timestamp <= endDate),
      failuresByType: this.categorizeFailures(alerts),
      timeoutAnalysis: this.analyzeTimeouts(alerts),
      recommendations: this.generateExceptionRecommendations(alerts)
    };
    
    switch (config.format) {
      case 'pdf':
        return this.generateExceptionPDF(reportId, exceptionData, config);
      case 'excel':
        return this.generateExceptionExcel(reportId, exceptionData, config);
      case 'json':
        return this.generateJSON(reportId, exceptionData, 'exception');
      case 'html':
        return this.generateExceptionHTML(reportId, exceptionData, config);
      default:
        throw new Error(`Unsupported format: ${config.format}`);
    }
  }

  private async generateAuditReport(
    reportId: string,
    config: ReportConfig,
    startDate: Date,
    endDate: Date
  ): Promise<string> {
    // Get audit trail from ComplianceTracker
    const complianceTracker = require('./ComplianceTracker').default;
    const dealershipIds = config.dealershipIds || ['all'];
    
    const auditData = {
      period: { start: startDate, end: endDate },
      events: [],
      userActivity: {},
      systemChanges: [],
      accessPatterns: {}
    };
    
    // Collect audit events for each dealership
    for (const dealershipId of dealershipIds) {
      const events = await complianceTracker.getComplianceHistory(
        dealershipId,
        Math.ceil((endDate.getTime() - startDate.getTime()) / 86400000) // days
      );
      auditData.events.push(...events);
    }
    
    switch (config.format) {
      case 'pdf':
        return this.generateAuditPDF(reportId, auditData, config);
      case 'excel':
        return this.generateAuditExcel(reportId, auditData, config);
      case 'json':
        return this.generateJSON(reportId, auditData, 'audit');
      case 'html':
        return this.generateAuditHTML(reportId, auditData, config);
      default:
        throw new Error(`Unsupported format: ${config.format}`);
    }
  }

  private async generatePerformanceReport(
    reportId: string,
    config: ReportConfig,
    startDate: Date,
    endDate: Date
  ): Promise<string> {
    const metricsCollector = require('./MetricsCollector').default;
    const metricsHistory = metricsCollector.getMetricsHistory(
      Math.ceil((endDate.getTime() - startDate.getTime()) / 60000) // minutes
    );
    
    const performanceData = {
      period: { start: startDate, end: endDate },
      processingSpeed: this.analyzeProcessingSpeed(metricsHistory),
      apiLatency: this.analyzeAPILatency(metricsHistory),
      resourceUsage: this.analyzeResourceUsage(metricsHistory),
      throughput: this.analyzeThroughput(metricsHistory),
      bottlenecks: this.identifyBottlenecks(metricsHistory)
    };
    
    switch (config.format) {
      case 'pdf':
        return this.generatePerformancePDF(reportId, performanceData, config);
      case 'excel':
        return this.generatePerformanceExcel(reportId, performanceData, config);
      case 'json':
        return this.generateJSON(reportId, performanceData, 'performance');
      case 'html':
        return this.generatePerformanceHTML(reportId, performanceData, config);
      default:
        throw new Error(`Unsupported format: ${config.format}`);
    }
  }

  private async generateSystemHealthReport(
    reportId: string,
    config: ReportConfig,
    startDate: Date,
    endDate: Date
  ): Promise<string> {
    const metricsCollector = require('./MetricsCollector').default;
    const alertManager = require('./AlertManager').default;
    
    const metricsHistory = metricsCollector.getMetricsHistory(
      Math.ceil((endDate.getTime() - startDate.getTime()) / 60000) // minutes
    );
    const alerts = alertManager.getAlertHistory(
      Math.ceil((endDate.getTime() - startDate.getTime()) / 3600000) // hours
    );
    
    const healthData = {
      period: { start: startDate, end: endDate },
      systemMetrics: this.analyzeSystemMetrics(metricsHistory),
      browserHealth: this.analyzeBrowserHealth(metricsHistory),
      alertSummary: this.summarizeAlerts(alerts),
      recommendations: this.generateHealthRecommendations(metricsHistory, alerts)
    };
    
    switch (config.format) {
      case 'pdf':
        return this.generateSystemHealthPDF(reportId, healthData, config);
      case 'excel':
        return this.generateSystemHealthExcel(reportId, healthData, config);
      case 'json':
        return this.generateJSON(reportId, healthData, 'system-health');
      case 'html':
        return this.generateSystemHealthHTML(reportId, healthData, config);
      default:
        throw new Error(`Unsupported format: ${config.format}`);
    }
  }

  // Helper methods for data analysis
  private summarizeMetrics(metrics: MetricsSummary[]): any {
    if (metrics.length === 0) return {};
    
    const totalTasks = metrics[metrics.length - 1].workflow.tasks.total - 
                      metrics[0].workflow.tasks.total;
    const totalErrors = metrics[metrics.length - 1].workflow.tasks.errors - 
                       metrics[0].workflow.tasks.errors;
    const avgSuccessRate = metrics.reduce((sum, m) => sum + m.workflow.performance.successRate, 0) / metrics.length;
    const avgProcessingTime = metrics.reduce((sum, m) => sum + m.workflow.performance.avgProcessingTime, 0) / metrics.length;
    
    return {
      totalTasks,
      totalErrors,
      avgSuccessRate,
      avgProcessingTime,
      totalStoresProcessed: metrics[metrics.length - 1].workflow.stores.completed
    };
  }

  private groupMetricsByHour(metrics: MetricsSummary[]): any {
    const hourly = {};
    
    metrics.forEach(m => {
      const hour = m.system.timestamp.toISOString().slice(0, 13);
      if (!hourly[hour]) {
        hourly[hour] = {
          tasks: 0,
          errors: 0,
          avgCpu: 0,
          avgMemory: 0,
          count: 0
        };
      }
      
      hourly[hour].tasks += m.workflow.tasks.total;
      hourly[hour].errors += m.workflow.tasks.errors;
      hourly[hour].avgCpu += m.system.cpu.usage;
      hourly[hour].avgMemory += m.system.memory.percentage;
      hourly[hour].count++;
    });
    
    // Calculate averages
    Object.keys(hourly).forEach(hour => {
      hourly[hour].avgCpu /= hourly[hour].count;
      hourly[hour].avgMemory /= hourly[hour].count;
    });
    
    return hourly;
  }

  private getTopPerformingStores(metrics: MetricsSummary[]): any[] {
    // This would analyze store-specific metrics if available
    return [];
  }

  private summarizeAPIUsage(metrics: MetricsSummary[]): any {
    if (metrics.length === 0) return {};
    
    const totalRequests = metrics[metrics.length - 1].api.requests.total - 
                         metrics[0].api.requests.total;
    const avgLatency = metrics.reduce((sum, m) => sum + m.api.latency.avg, 0) / metrics.length;
    
    return {
      totalRequests,
      avgLatency,
      vautoQuotaUsed: metrics[metrics.length - 1].api.quotas.vauto.used,
      cdkQuotaUsed: metrics[metrics.length - 1].api.quotas.cdk.used
    };
  }

  private categorizeFailures(alerts: Alert[]): any {
    const categories = {};
    
    alerts.filter(a => a.type.includes('error') || a.type.includes('fail'))
      .forEach(alert => {
        const category = alert.type;
        if (!categories[category]) {
          categories[category] = 0;
        }
        categories[category]++;
      });
    
    return categories;
  }

  private analyzeTimeouts(alerts: Alert[]): any {
    const timeouts = alerts.filter(a => 
      a.message.toLowerCase().includes('timeout') ||
      a.metadata?.error?.includes('timeout')
    );
    
    return {
      total: timeouts.length,
      byHour: this.groupByHour(timeouts),
      avgDuration: 0 // Would calculate if duration data available
    };
  }

  private groupByHour(items: any[]): any {
    const hourly = {};
    
    items.forEach(item => {
      const hour = item.timestamp.toISOString().slice(0, 13);
      hourly[hour] = (hourly[hour] || 0) + 1;
    });
    
    return hourly;
  }

  private generateExceptionRecommendations(alerts: Alert[]): string[] {
    const recommendations = [];
    
    const errorCount = alerts.filter(a => a.severity === 'critical' || a.severity === 'high').length;
    if (errorCount > 10) {
      recommendations.push('High number of critical errors detected. Review system logs and consider scaling resources.');
    }
    
    const timeoutCount = alerts.filter(a => a.message.includes('timeout')).length;
    if (timeoutCount > 5) {
      recommendations.push('Multiple timeout errors. Consider increasing timeout thresholds or optimizing slow operations.');
    }
    
    return recommendations;
  }

  private analyzeProcessingSpeed(metrics: MetricsSummary[]): any {
    const speeds = metrics.map(m => m.workflow.performance.avgProcessingTime);
    
    return {
      avg: speeds.reduce((a, b) => a + b, 0) / speeds.length,
      min: Math.min(...speeds),
      max: Math.max(...speeds),
      trend: this.calculateTrend(speeds)
    };
  }

  private analyzeAPILatency(metrics: MetricsSummary[]): any {
    return {
      avg: metrics.reduce((sum, m) => sum + m.api.latency.avg, 0) / metrics.length,
      p95: metrics.reduce((sum, m) => sum + m.api.latency.p95, 0) / metrics.length,
      p99: metrics.reduce((sum, m) => sum + m.api.latency.p99, 0) / metrics.length
    };
  }

  private analyzeResourceUsage(metrics: MetricsSummary[]): any {
    return {
      cpu: {
        avg: metrics.reduce((sum, m) => sum + m.system.cpu.usage, 0) / metrics.length,
        peak: Math.max(...metrics.map(m => m.system.cpu.usage))
      },
      memory: {
        avg: metrics.reduce((sum, m) => sum + m.system.memory.percentage, 0) / metrics.length,
        peak: Math.max(...metrics.map(m => m.system.memory.percentage))
      }
    };
  }

  private analyzeThroughput(metrics: MetricsSummary[]): any {
    const throughputs = metrics.map(m => m.workflow.performance.throughput);
    
    return {
      avg: throughputs.reduce((a, b) => a + b, 0) / throughputs.length,
      peak: Math.max(...throughputs),
      trend: this.calculateTrend(throughputs)
    };
  }

  private identifyBottlenecks(metrics: MetricsSummary[]): string[] {
    const bottlenecks = [];
    
    const avgCpu = metrics.reduce((sum, m) => sum + m.system.cpu.usage, 0) / metrics.length;
    if (avgCpu > 70) {
      bottlenecks.push('High CPU usage may be limiting performance');
    }
    
    const avgMemory = metrics.reduce((sum, m) => sum + m.system.memory.percentage, 0) / metrics.length;
    if (avgMemory > 80) {
      bottlenecks.push('High memory usage may cause performance degradation');
    }
    
    const avgQueueSize = metrics.reduce((sum, m) => sum + m.workflow.workflows.queued, 0) / metrics.length;
    if (avgQueueSize > 50) {
      bottlenecks.push('Large queue backlog indicates processing bottleneck');
    }
    
    return bottlenecks;
  }

  private analyzeSystemMetrics(metrics: MetricsSummary[]): any {
    return {
      uptime: metrics[metrics.length - 1]?.system.process.uptime || 0,
      cpu: this.analyzeResourceUsage(metrics).cpu,
      memory: this.analyzeResourceUsage(metrics).memory,
      loadAverage: metrics.reduce((sum, m) => sum + m.system.cpu.loadAverage[0], 0) / metrics.length
    };
  }

  private analyzeBrowserHealth(metrics: MetricsSummary[]): any {
    return {
      totalBrowsers: Math.max(...metrics.map(m => m.browser.browsers.total)),
      avgActive: metrics.reduce((sum, m) => sum + m.browser.browsers.active, 0) / metrics.length,
      memoryUsage: metrics.reduce((sum, m) => sum + m.browser.memory.estimated, 0) / metrics.length
    };
  }

  private summarizeAlerts(alerts: Alert[]): any {
    return {
      total: alerts.length,
      bySeverity: this.groupBySeverity(alerts),
      byStatus: this.groupByStatus(alerts),
      responseTime: this.calculateAlertResponseTime(alerts)
    };
  }

  private groupBySeverity(alerts: Alert[]): any {
    const severity = {};
    alerts.forEach(a => {
      severity[a.severity] = (severity[a.severity] || 0) + 1;
    });
    return severity;
  }

  private groupByStatus(alerts: Alert[]): any {
    const status = {};
    alerts.forEach(a => {
      status[a.status] = (status[a.status] || 0) + 1;
    });
    return status;
  }

  private calculateAlertResponseTime(alerts: Alert[]): number {
    const resolved = alerts.filter(a => a.resolvedAt && a.acknowledgedAt);
    if (resolved.length === 0) return 0;
    
    const totalTime = resolved.reduce((sum, a) => {
      return sum + (a.resolvedAt!.getTime() - a.acknowledgedAt!.getTime());
    }, 0);
    
    return totalTime / resolved.length / 60000; // Convert to minutes
  }

  private generateHealthRecommendations(metrics: MetricsSummary[], alerts: Alert[]): string[] {
    const recommendations = [];
    
    const systemHealth = this.analyzeSystemMetrics(metrics);
    if (systemHealth.cpu.avg > 70) {
      recommendations.push('Consider scaling CPU resources to improve performance');
    }
    
    if (systemHealth.memory.avg > 80) {
      recommendations.push('Memory usage is high. Consider increasing memory allocation');
    }
    
    const criticalAlerts = alerts.filter(a => a.severity === 'critical').length;
    if (criticalAlerts > 5) {
      recommendations.push('Multiple critical alerts detected. Immediate attention required');
    }
    
    return recommendations;
  }

  private calculateTrend(values: number[]): 'up' | 'down' | 'stable' {
    if (values.length < 2) return 'stable';
    
    const firstHalf = values.slice(0, Math.floor(values.length / 2));
    const secondHalf = values.slice(Math.floor(values.length / 2));
    
    const firstAvg = firstHalf.reduce((a, b) => a + b, 0) / firstHalf.length;
    const secondAvg = secondHalf.reduce((a, b) => a + b, 0) / secondHalf.length;
    
    const change = (secondAvg - firstAvg) / firstAvg * 100;
    
    if (change > 5) return 'up';
    if (change < -5) return 'down';
    return 'stable';
  }

  // Generic report generation methods
  private async generateJSON(reportId: string, data: any, type: string): Promise<string> {
    const filename = `${type}-${reportId}.json`;
    const filePath = path.join(this.reportsPath, filename);
    
    await fs.writeFile(filePath, JSON.stringify(data, null, 2));
    return filePath;
  }

  private async generateActivityPDF(reportId: string, data: any, config: ReportConfig): Promise<string> {
    // Similar structure to compliance PDF but with activity-specific data
    const filename = `activity-${reportId}.pdf`;
    const filePath = path.join(this.reportsPath, filename);
    
    // Implementation would follow similar pattern to generateCompliancePDF
    // For brevity, returning a placeholder
    await fs.writeFile(filePath, 'Activity Report PDF');
    return filePath;
  }

  private async generateActivityExcel(reportId: string, data: any, config: ReportConfig): Promise<string> {
    // Similar structure to compliance Excel but with activity-specific data
    const filename = `activity-${reportId}.xlsx`;
    const filePath = path.join(this.reportsPath, filename);
    
    // Implementation would follow similar pattern to generateComplianceExcel
    // For brevity, returning a placeholder
    await fs.writeFile(filePath, 'Activity Report Excel');
    return filePath;
  }

  private async generateActivityHTML(reportId: string, data: any, config: ReportConfig): Promise<string> {
    const filename = `activity-${reportId}.html`;
    const filePath = path.join(this.reportsPath, filename);
    
    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <title>Activity Report</title>
        <style>
          body { font-family: Arial, sans-serif; margin: 40px; }
          h1, h2 { color: #333; }
          table { border-collapse: collapse; width: 100%; margin: 20px 0; }
          th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
          th { background-color: #f2f2f2; }
          .metric { display: inline-block; margin: 10px 20px; }
          .metric-value { font-size: 24px; font-weight: bold; color: #0066cc; }
        </style>
      </head>
      <body>
        <h1>Activity Report</h1>
        <p>Period: ${data.period.start.toLocaleDateString()} - ${data.period.end.toLocaleDateString()}</p>
        
        <h2>Summary</h2>
        <div class="metric">
          <div>Total Tasks</div>
          <div class="metric-value">${data.summary.totalTasks || 0}</div>
        </div>
        <div class="metric">
          <div>Success Rate</div>
          <div class="metric-value">${(data.summary.avgSuccessRate || 0).toFixed(2)}%</div>
        </div>
        
        <!-- More content would be added here -->
      </body>
      </html>
    `;
    
    await fs.writeFile(filePath, html);
    return filePath;
  }

  // Similar placeholder methods for other report types
  private async generateExceptionPDF(reportId: string, data: any, config: ReportConfig): Promise<string> {
    const filename = `exception-${reportId}.pdf`;
    const filePath = path.join(this.reportsPath, filename);
    await fs.writeFile(filePath, 'Exception Report PDF');
    return filePath;
  }

  private async generateExceptionExcel(reportId: string, data: any, config: ReportConfig): Promise<string> {
    const filename = `exception-${reportId}.xlsx`;
    const filePath = path.join(this.reportsPath, filename);
    await fs.writeFile(filePath, 'Exception Report Excel');
    return filePath;
  }

  private async generateExceptionHTML(reportId: string, data: any, config: ReportConfig): Promise<string> {
    const filename = `exception-${reportId}.html`;
    const filePath = path.join(this.reportsPath, filename);
    await fs.writeFile(filePath, '<html><body>Exception Report</body></html>');
    return filePath;
  }

  private async generateAuditPDF(reportId: string, data: any, config: ReportConfig): Promise<string> {
    const filename = `audit-${reportId}.pdf`;
    const filePath = path.join(this.reportsPath, filename);
    await fs.writeFile(filePath, 'Audit Report PDF');
    return filePath;
  }

  private async generateAuditExcel(reportId: string, data: any, config: ReportConfig): Promise<string> {
    const filename = `audit-${reportId}.xlsx`;
    const filePath = path.join(this.reportsPath, filename);
    await fs.writeFile(filePath, 'Audit Report Excel');
    return filePath;
  }

  private async generateAuditHTML(reportId: string, data: any, config: ReportConfig): Promise<string> {
    const filename = `audit-${reportId}.html`;
    const filePath = path.join(this.reportsPath, filename);
    await fs.writeFile(filePath, '<html><body>Audit Report</body></html>');
    return filePath;
  }

  private async generatePerformancePDF(reportId: string, data: any, config: ReportConfig): Promise<string> {
    const filename = `performance-${reportId}.pdf`;
    const filePath = path.join(this.reportsPath, filename);
    await fs.writeFile(filePath, 'Performance Report PDF');
    return filePath;
  }

  private async generatePerformanceExcel(reportId: string, data: any, config: ReportConfig): Promise<string> {
    const filename = `performance-${reportId}.xlsx`;
    const filePath = path.join(this.reportsPath, filename);
    await fs.writeFile(filePath, 'Performance Report Excel');
    return filePath;
  }

  private async generatePerformanceHTML(reportId: string, data: any, config: ReportConfig): Promise<string> {
    const filename = `performance-${reportId}.html`;
    const filePath = path.join(this.reportsPath, filename);
    await fs.writeFile(filePath, '<html><body>Performance Report</body></html>');
    return filePath;
  }

  private async generateSystemHealthPDF(reportId: string, data: any, config: ReportConfig): Promise<string> {
    const filename = `system-health-${reportId}.pdf`;
    const filePath = path.join(this.reportsPath, filename);
    await fs.writeFile(filePath, 'System Health Report PDF');
    return filePath;
  }

  private async generateSystemHealthExcel(reportId: string, data: any, config: ReportConfig): Promise<string> {
    const filename = `system-health-${reportId}.xlsx`;
    const filePath = path.join(this.reportsPath, filename);
    await fs.writeFile(filePath, 'System Health Report Excel');
    return filePath;
  }

  private async generateSystemHealthHTML(reportId: string, data: any, config: ReportConfig): Promise<string> {
    const filename = `system-health-${reportId}.html`;
    const filePath = path.join(this.reportsPath, filename);
    await fs.writeFile(filePath, '<html><body>System Health Report</body></html>');
    return filePath;
  }

  private async generateComplianceHTML(reportId: string, data: ComplianceReport, config: ReportConfig): Promise<string> {
    const filename = `compliance-${reportId}.html`;
    const filePath = path.join(this.reportsPath, filename);
    
    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <title>DNC Compliance Report</title>
        <style>
          body { font-family: Arial, sans-serif; margin: 40px; }
          h1, h2 { color: #333; }
          table { border-collapse: collapse; width: 100%; margin: 20px 0; }
          th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
          th { background-color: #f2f2f2; }
          .summary-box { background-color: #f9f9f9; padding: 20px; margin: 20px 0; border-radius: 5px; }
          .metric { display: inline-block; margin: 10px 20px; }
          .metric-value { font-size: 24px; font-weight: bold; color: #0066cc; }
          .trend-up { color: green; }
          .trend-down { color: red; }
          .trend-stable { color: gray; }
        </style>
      </head>
      <body>
        <h1>DNC Compliance Report</h1>
        <p>Generated: ${new Date().toLocaleString()}</p>
        <p>Period: ${data.period.start.toLocaleDateString()} - ${data.period.end.toLocaleDateString()}</p>
        
        <div class="summary-box">
          <h2>Executive Summary</h2>
          <div class="metric">
            <div>Total Dealerships</div>
            <div class="metric-value">${data.summary.totalDealerships}</div>
          </div>
          <div class="metric">
            <div>Total Checks</div>
            <div class="metric-value">${data.summary.totalChecks.toLocaleString()}</div>
          </div>
          <div class="metric">
            <div>Compliance Rate</div>
            <div class="metric-value">${data.summary.overallComplianceRate.toFixed(2)}%</div>
          </div>
        </div>
        
        <h2>Trends</h2>
        <ul>
          <li>Checks: <span class="trend-${data.summary.trends.checksTrend}">${data.summary.trends.checksTrend}</span></li>
          <li>Compliance: <span class="trend-${data.summary.trends.complianceTrend}">${data.summary.trends.complianceTrend}</span></li>
          <li>Errors: <span class="trend-${data.summary.trends.errorTrend}">${data.summary.trends.errorTrend}</span></li>
        </ul>
        
        ${config.includeDetails ? `
          <h2>Dealership Details</h2>
          <table>
            <tr>
              <th>Dealership</th>
              <th>Total Checks</th>
              <th>Compliance Rate</th>
              <th>Top Issue</th>
            </tr>
            ${data.dealerships.map(d => `
              <tr>
                <td>${d.name}</td>
                <td>${d.stats.totalChecks.toLocaleString()}</td>
                <td>${d.stats.complianceRate.toFixed(2)}%</td>
                <td>${d.topIssues[0]?.issue || 'None'}</td>
              </tr>
            `).join('')}
          </table>
        ` : ''}
      </body>
      </html>
    `;
    
    await fs.writeFile(filePath, html);
    return filePath;
  }

  private async cleanupOldReports(): Promise<void> {
    try {
      const files = await fs.readdir(this.reportsPath);
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - this.retentionDays);
      
      for (const file of files) {
        const filePath = path.join(this.reportsPath, file);
        const stats = await fs.stat(filePath);
        
        if (stats.mtime < cutoffDate) {
          await fs.unlink(filePath);
          logger.info('Deleted old report', { file, age: Date.now() - stats.mtime.getTime() });
        }
      }
    } catch (error) {
      logger.error('Failed to cleanup old reports', { error });
    }
  }

  public async scheduleReport(config: ReportConfig & { schedule: string }): Promise<void> {
    // Would integrate with cron service to schedule regular reports
    logger.info('Report scheduled', { config });
  }

  public getReportHistory(days: number = 30): GeneratedReport[] {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);
    
    return this.reportHistory
      .filter(r => r.generatedAt >= cutoff)
      .sort((a, b) => b.generatedAt.getTime() - a.generatedAt.getTime());
  }

  public async getReport(reportId: string): Promise<GeneratedReport | null> {
    return this.reportHistory.find(r => r.id === reportId) || null;
  }

  public setRetentionDays(days: number): void {
    this.retentionDays = days;
    logger.info('Report retention updated', { days });
  }
}

export default ReportEngine.getInstance();