import { EventEmitter } from 'events';
import { logger } from '../../priority5-compliance/logger';
import * as fs from 'fs/promises';
import * as path from 'path';

export interface ComplianceEvent {
  id: string;
  timestamp: Date;
  dealershipId: string;
  dealershipName: string;
  eventType: 'dnc_check' | 'dnc_mark' | 'dnc_unmark' | 'export' | 'audit' | 'error';
  action: string;
  details: {
    customerPhone?: string;
    customerName?: string;
    vehicleVin?: string;
    reason?: string;
    result?: 'success' | 'failure';
    errorMessage?: string;
    userId?: string;
    source?: 'vauto' | 'cdk' | 'manual';
  };
  metadata?: Record<string, any>;
}

export interface ComplianceStats {
  timestamp: Date;
  period: 'hour' | 'day' | 'week' | 'month';
  dealershipId?: string;
  stats: {
    totalChecks: number;
    totalMarked: number;
    totalUnmarked: number;
    totalExports: number;
    totalErrors: number;
    complianceRate: number;
    processingTime: {
      avg: number;
      min: number;
      max: number;
    };
    bySource: {
      vauto: number;
      cdk: number;
      manual: number;
    };
  };
}

export interface ComplianceReport {
  id: string;
  generatedAt: Date;
  period: {
    start: Date;
    end: Date;
  };
  dealerships: Array<{
    id: string;
    name: string;
    stats: ComplianceStats['stats'];
    topIssues: Array<{
      issue: string;
      count: number;
      impact: 'high' | 'medium' | 'low';
    }>;
    recommendations: string[];
  }>;
  summary: {
    totalDealerships: number;
    totalChecks: number;
    totalMarked: number;
    overallComplianceRate: number;
    trends: {
      checksTrend: 'up' | 'down' | 'stable';
      complianceTrend: 'up' | 'down' | 'stable';
      errorTrend: 'up' | 'down' | 'stable';
    };
  };
}

export class ComplianceTracker extends EventEmitter {
  private static instance: ComplianceTracker;
  private events: ComplianceEvent[] = [];
  private stats: Map<string, ComplianceStats[]> = new Map();
  private auditLogPath: string;
  private maxEventsInMemory: number = 10000;
  private archiveThreshold: number = 90; // days
  
  private constructor() {
    super();
    this.auditLogPath = path.join(process.cwd(), 'logs', 'compliance-audit');
    this.initializeStorage();
  }

  public static getInstance(): ComplianceTracker {
    if (!ComplianceTracker.instance) {
      ComplianceTracker.instance = new ComplianceTracker();
    }
    return ComplianceTracker.instance;
  }

  private async initializeStorage(): Promise<void> {
    try {
      await fs.mkdir(this.auditLogPath, { recursive: true });
      logger.info('Compliance tracker storage initialized', { path: this.auditLogPath });
    } catch (error) {
      logger.error('Failed to initialize compliance storage', { error });
    }
  }

  public async trackEvent(event: Omit<ComplianceEvent, 'id' | 'timestamp'>): Promise<void> {
    const completeEvent: ComplianceEvent = {
      id: this.generateEventId(),
      timestamp: new Date(),
      ...event
    };

    // Add to memory
    this.events.push(completeEvent);
    
    // Trim if needed
    if (this.events.length > this.maxEventsInMemory) {
      await this.archiveOldEvents();
    }

    // Update stats
    this.updateStats(completeEvent);
    
    // Emit event
    this.emit('compliance:event', completeEvent);
    
    // Log audit event
    await this.logAuditEvent(completeEvent);
    
    // Check for compliance violations
    this.checkComplianceViolations(completeEvent);
  }

  private generateEventId(): string {
    return `evt_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private async logAuditEvent(event: ComplianceEvent): Promise<void> {
    try {
      const dateStr = new Date().toISOString().split('T')[0];
      const filename = `audit-${dateStr}.jsonl`;
      const filepath = path.join(this.auditLogPath, filename);
      
      const logEntry = JSON.stringify({
        ...event,
        loggedAt: new Date().toISOString()
      }) + '\n';
      
      await fs.appendFile(filepath, logEntry);
    } catch (error) {
      logger.error('Failed to log audit event', { error, event });
    }
  }

  private updateStats(event: ComplianceEvent): void {
    const hourKey = this.getStatsKey(event.dealershipId, 'hour');
    const dayKey = this.getStatsKey(event.dealershipId, 'day');
    const weekKey = this.getStatsKey(event.dealershipId, 'week');
    const monthKey = this.getStatsKey(event.dealershipId, 'month');
    
    [hourKey, dayKey, weekKey, monthKey].forEach(key => {
      const stats = this.getOrCreateStats(key, event.dealershipId);
      this.updateStatsForEvent(stats, event);
    });
  }

  private getStatsKey(dealershipId: string, period: ComplianceStats['period']): string {
    const now = new Date();
    let periodKey = '';
    
    switch (period) {
      case 'hour':
        periodKey = now.toISOString().slice(0, 13);
        break;
      case 'day':
        periodKey = now.toISOString().slice(0, 10);
        break;
      case 'week':
        const weekNumber = this.getWeekNumber(now);
        periodKey = `${now.getFullYear()}-W${weekNumber}`;
        break;
      case 'month':
        periodKey = now.toISOString().slice(0, 7);
        break;
    }
    
    return `${dealershipId}_${period}_${periodKey}`;
  }

  private getWeekNumber(date: Date): number {
    const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
    const dayNum = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    return Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  }

  private getOrCreateStats(key: string, dealershipId: string): ComplianceStats {
    if (!this.stats.has(key)) {
      const [, period] = key.split('_') as [string, ComplianceStats['period']];
      this.stats.set(key, [{
        timestamp: new Date(),
        period,
        dealershipId,
        stats: {
          totalChecks: 0,
          totalMarked: 0,
          totalUnmarked: 0,
          totalExports: 0,
          totalErrors: 0,
          complianceRate: 100,
          processingTime: { avg: 0, min: 0, max: 0 },
          bySource: { vauto: 0, cdk: 0, manual: 0 }
        }
      }]);
    }
    
    const statsArray = this.stats.get(key)!;
    return statsArray[statsArray.length - 1];
  }

  private updateStatsForEvent(stats: ComplianceStats, event: ComplianceEvent): void {
    switch (event.eventType) {
      case 'dnc_check':
        stats.stats.totalChecks++;
        break;
      case 'dnc_mark':
        stats.stats.totalMarked++;
        break;
      case 'dnc_unmark':
        stats.stats.totalUnmarked++;
        break;
      case 'export':
        stats.stats.totalExports++;
        break;
      case 'error':
        stats.stats.totalErrors++;
        break;
    }
    
    // Update source stats
    if (event.details.source) {
      stats.stats.bySource[event.details.source]++;
    }
    
    // Update compliance rate
    const totalActions = stats.stats.totalChecks + stats.stats.totalMarked;
    if (totalActions > 0) {
      stats.stats.complianceRate = ((totalActions - stats.stats.totalErrors) / totalActions) * 100;
    }
  }

  private checkComplianceViolations(event: ComplianceEvent): void {
    // Check for repeated errors
    if (event.eventType === 'error') {
      const recentErrors = this.events.filter(e => 
        e.eventType === 'error' &&
        e.dealershipId === event.dealershipId &&
        e.timestamp.getTime() > Date.now() - 3600000 // Last hour
      );
      
      if (recentErrors.length >= 10) {
        this.emit('compliance:violation', {
          type: 'excessive_errors',
          dealershipId: event.dealershipId,
          details: {
            errorCount: recentErrors.length,
            timeframe: 'hour'
          }
        });
      }
    }
    
    // Check for low compliance rate
    const stats = this.getLatestStats(event.dealershipId, 'day');
    if (stats && stats.stats.complianceRate < 95) {
      this.emit('compliance:violation', {
        type: 'low_compliance_rate',
        dealershipId: event.dealershipId,
        details: {
          complianceRate: stats.stats.complianceRate,
          threshold: 95
        }
      });
    }
  }

  public async generateComplianceReport(
    dealershipIds: string[],
    startDate: Date,
    endDate: Date
  ): Promise<ComplianceReport> {
    const report: ComplianceReport = {
      id: `rpt_${Date.now()}`,
      generatedAt: new Date(),
      period: { start: startDate, end: endDate },
      dealerships: [],
      summary: {
        totalDealerships: dealershipIds.length,
        totalChecks: 0,
        totalMarked: 0,
        overallComplianceRate: 0,
        trends: {
          checksTrend: 'stable',
          complianceTrend: 'stable',
          errorTrend: 'stable'
        }
      }
    };

    for (const dealershipId of dealershipIds) {
      const dealershipStats = await this.getDealershipStats(dealershipId, startDate, endDate);
      const issues = this.analyzeDealershipIssues(dealershipId, startDate, endDate);
      const recommendations = this.generateRecommendations(dealershipStats, issues);
      
      report.dealerships.push({
        id: dealershipId,
        name: `Dealership ${dealershipId}`, // Would be fetched from DB
        stats: dealershipStats,
        topIssues: issues,
        recommendations
      });
      
      // Update summary
      report.summary.totalChecks += dealershipStats.totalChecks;
      report.summary.totalMarked += dealershipStats.totalMarked;
    }
    
    // Calculate overall compliance rate
    if (report.summary.totalChecks > 0) {
      const totalErrors = report.dealerships.reduce((sum, d) => sum + d.stats.totalErrors, 0);
      report.summary.overallComplianceRate = 
        ((report.summary.totalChecks - totalErrors) / report.summary.totalChecks) * 100;
    }
    
    // Analyze trends
    report.summary.trends = this.analyzeTrends(dealershipIds, startDate, endDate);
    
    this.emit('compliance:report', report);
    return report;
  }

  private async getDealershipStats(
    dealershipId: string,
    startDate: Date,
    endDate: Date
  ): Promise<ComplianceStats['stats']> {
    const events = await this.getEventsInRange(dealershipId, startDate, endDate);
    
    const stats: ComplianceStats['stats'] = {
      totalChecks: 0,
      totalMarked: 0,
      totalUnmarked: 0,
      totalExports: 0,
      totalErrors: 0,
      complianceRate: 100,
      processingTime: { avg: 0, min: 0, max: 0 },
      bySource: { vauto: 0, cdk: 0, manual: 0 }
    };
    
    events.forEach(event => {
      switch (event.eventType) {
        case 'dnc_check':
          stats.totalChecks++;
          break;
        case 'dnc_mark':
          stats.totalMarked++;
          break;
        case 'dnc_unmark':
          stats.totalUnmarked++;
          break;
        case 'export':
          stats.totalExports++;
          break;
        case 'error':
          stats.totalErrors++;
          break;
      }
      
      if (event.details.source) {
        stats.bySource[event.details.source]++;
      }
    });
    
    // Calculate compliance rate
    const totalActions = stats.totalChecks + stats.totalMarked;
    if (totalActions > 0) {
      stats.complianceRate = ((totalActions - stats.totalErrors) / totalActions) * 100;
    }
    
    return stats;
  }

  private async getEventsInRange(
    dealershipId: string,
    startDate: Date,
    endDate: Date
  ): Promise<ComplianceEvent[]> {
    // Get from memory first
    let events = this.events.filter(e =>
      e.dealershipId === dealershipId &&
      e.timestamp >= startDate &&
      e.timestamp <= endDate
    );
    
    // If date range extends beyond memory, load from archive
    if (startDate.getTime() < this.events[0]?.timestamp.getTime()) {
      const archivedEvents = await this.loadArchivedEvents(dealershipId, startDate, endDate);
      events = [...archivedEvents, ...events];
    }
    
    return events;
  }

  private async loadArchivedEvents(
    dealershipId: string,
    startDate: Date,
    endDate: Date
  ): Promise<ComplianceEvent[]> {
    const events: ComplianceEvent[] = [];
    
    try {
      const files = await fs.readdir(this.auditLogPath);
      const relevantFiles = files.filter(file => {
        const match = file.match(/audit-(\d{4}-\d{2}-\d{2})\.jsonl/);
        if (!match) return false;
        
        const fileDate = new Date(match[1]);
        return fileDate >= startDate && fileDate <= endDate;
      });
      
      for (const file of relevantFiles) {
        const content = await fs.readFile(path.join(this.auditLogPath, file), 'utf-8');
        const lines = content.trim().split('\n');
        
        for (const line of lines) {
          try {
            const event = JSON.parse(line) as ComplianceEvent;
            if (event.dealershipId === dealershipId) {
              events.push(event);
            }
          } catch (error) {
            logger.error('Failed to parse audit log line', { file, error });
          }
        }
      }
    } catch (error) {
      logger.error('Failed to load archived events', { error });
    }
    
    return events;
  }

  private analyzeDealershipIssues(
    dealershipId: string,
    startDate: Date,
    endDate: Date
  ): Array<{ issue: string; count: number; impact: 'high' | 'medium' | 'low' }> {
    const issues: Map<string, number> = new Map();
    
    const events = this.events.filter(e =>
      e.dealershipId === dealershipId &&
      e.timestamp >= startDate &&
      e.timestamp <= endDate &&
      e.eventType === 'error'
    );
    
    events.forEach(event => {
      const issue = event.details.errorMessage || 'Unknown error';
      issues.set(issue, (issues.get(issue) || 0) + 1);
    });
    
    return Array.from(issues.entries())
      .map(([issue, count]) => ({
        issue,
        count,
        impact: count > 50 ? 'high' : count > 10 ? 'medium' : 'low'
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);
  }

  private generateRecommendations(
    stats: ComplianceStats['stats'],
    issues: Array<{ issue: string; count: number; impact: 'high' | 'medium' | 'low' }>
  ): string[] {
    const recommendations: string[] = [];
    
    if (stats.complianceRate < 95) {
      recommendations.push('Compliance rate is below 95%. Review error logs and address system issues.');
    }
    
    if (stats.totalErrors > stats.totalChecks * 0.05) {
      recommendations.push('Error rate exceeds 5%. Consider system maintenance or staff training.');
    }
    
    const highImpactIssues = issues.filter(i => i.impact === 'high');
    if (highImpactIssues.length > 0) {
      recommendations.push(`Address high-impact issues: ${highImpactIssues.map(i => i.issue).join(', ')}`);
    }
    
    if (stats.bySource.manual > stats.totalChecks * 0.2) {
      recommendations.push('High manual intervention rate. Consider automation improvements.');
    }
    
    return recommendations;
  }

  private analyzeTrends(
    dealershipIds: string[],
    startDate: Date,
    endDate: Date
  ): ComplianceReport['summary']['trends'] {
    // This would analyze historical data to determine trends
    // For now, returning stable trends
    return {
      checksTrend: 'stable',
      complianceTrend: 'stable',
      errorTrend: 'stable'
    };
  }

  private async archiveOldEvents(): Promise<void> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - this.archiveThreshold);
    
    const eventsToKeep = this.events.filter(e => e.timestamp > cutoffDate);
    const eventsToArchive = this.events.filter(e => e.timestamp <= cutoffDate);
    
    if (eventsToArchive.length > 0) {
      // Archive events are already written to daily files
      this.events = eventsToKeep;
      logger.info('Archived old compliance events', { 
        archived: eventsToArchive.length, 
        kept: eventsToKeep.length 
      });
    }
  }

  public getLatestStats(dealershipId: string, period: ComplianceStats['period']): ComplianceStats | null {
    const key = this.getStatsKey(dealershipId, period);
    const statsArray = this.stats.get(key);
    return statsArray ? statsArray[statsArray.length - 1] : null;
  }

  public async getComplianceHistory(
    dealershipId: string,
    days: number = 30
  ): Promise<ComplianceEvent[]> {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);
    return this.getEventsInRange(dealershipId, startDate, new Date());
  }

  public getComplianceSummary(): {
    totalEvents: number;
    eventsByType: Record<ComplianceEvent['eventType'], number>;
    complianceRate: number;
    activeStats: number;
  } {
    const eventsByType: Record<ComplianceEvent['eventType'], number> = {
      dnc_check: 0,
      dnc_mark: 0,
      dnc_unmark: 0,
      export: 0,
      audit: 0,
      error: 0
    };
    
    this.events.forEach(e => {
      eventsByType[e.eventType]++;
    });
    
    const totalActions = eventsByType.dnc_check + eventsByType.dnc_mark;
    const complianceRate = totalActions > 0 
      ? ((totalActions - eventsByType.error) / totalActions) * 100
      : 100;
    
    return {
      totalEvents: this.events.length,
      eventsByType,
      complianceRate,
      activeStats: this.stats.size
    };
  }
}

export default ComplianceTracker.getInstance();