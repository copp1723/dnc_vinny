import { EventEmitter } from 'events';
import { logger } from '../../priority5-compliance/logger';
import * as nodemailer from 'nodemailer';
import axios from 'axios';

export type AlertSeverity = 'critical' | 'high' | 'medium' | 'low' | 'info';
export type AlertStatus = 'active' | 'acknowledged' | 'resolved' | 'suppressed';

export interface Alert {
  id: string;
  timestamp: Date;
  severity: AlertSeverity;
  status: AlertStatus;
  type: string;
  title: string;
  message: string;
  source: string;
  dealershipId?: string;
  metadata?: Record<string, any>;
  acknowledgedBy?: string;
  acknowledgedAt?: Date;
  resolvedAt?: Date;
  suppressedUntil?: Date;
}

export interface AlertRule {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  conditions: {
    metric: string;
    operator: 'gt' | 'lt' | 'eq' | 'gte' | 'lte';
    threshold: number;
    duration?: number; // in minutes
  };
  severity: AlertSeverity;
  notifications: {
    email?: string[];
    webhook?: string[];
  };
  suppressionWindow?: number; // minutes before re-alerting
  metadata?: Record<string, any>;
}

export interface AlertNotification {
  type: 'email' | 'webhook';
  recipient: string;
  alert: Alert;
  timestamp: Date;
  status: 'sent' | 'failed';
  error?: string;
}

export class AlertManager extends EventEmitter {
  private static instance: AlertManager;
  private alerts: Map<string, Alert> = new Map();
  private rules: Map<string, AlertRule> = new Map();
  private notificationHistory: AlertNotification[] = [];
  private emailTransporter?: nodemailer.Transporter;
  private suppressionCache: Map<string, Date> = new Map();
  
  private readonly defaultRules: AlertRule[] = [
    {
      id: 'cpu_high',
      name: 'High CPU Usage',
      description: 'CPU usage exceeds 80%',
      enabled: true,
      conditions: { metric: 'system.cpu.usage', operator: 'gt', threshold: 80, duration: 5 },
      severity: 'high',
      notifications: { email: [], webhook: [] },
      suppressionWindow: 30
    },
    {
      id: 'memory_high',
      name: 'High Memory Usage',
      description: 'Memory usage exceeds 85%',
      enabled: true,
      conditions: { metric: 'system.memory.percentage', operator: 'gt', threshold: 85, duration: 5 },
      severity: 'high',
      notifications: { email: [], webhook: [] },
      suppressionWindow: 30
    },
    {
      id: 'error_rate_high',
      name: 'High Error Rate',
      description: 'Error rate exceeds 5%',
      enabled: true,
      conditions: { metric: 'workflow.performance.errorRate', operator: 'gt', threshold: 5, duration: 10 },
      severity: 'medium',
      notifications: { email: [], webhook: [] },
      suppressionWindow: 60
    },
    {
      id: 'compliance_low',
      name: 'Low Compliance Rate',
      description: 'Compliance rate below 95%',
      enabled: true,
      conditions: { metric: 'compliance.rate', operator: 'lt', threshold: 95, duration: 15 },
      severity: 'high',
      notifications: { email: [], webhook: [] },
      suppressionWindow: 120
    },
    {
      id: 'api_quota_low',
      name: 'Low API Quota',
      description: 'API quota below 10%',
      enabled: true,
      conditions: { metric: 'api.quota.remaining.percentage', operator: 'lt', threshold: 10 },
      severity: 'medium',
      notifications: { email: [], webhook: [] },
      suppressionWindow: 60
    },
    {
      id: 'browser_pool_exhausted',
      name: 'Browser Pool Exhausted',
      description: 'No available browsers in pool',
      enabled: true,
      conditions: { metric: 'browser.pool.available', operator: 'eq', threshold: 0, duration: 2 },
      severity: 'critical',
      notifications: { email: [], webhook: [] },
      suppressionWindow: 15
    },
    {
      id: 'processing_slow',
      name: 'Slow Processing',
      description: 'Average processing time exceeds 5 minutes',
      enabled: true,
      conditions: { metric: 'workflow.performance.avgProcessingTime', operator: 'gt', threshold: 300000 },
      severity: 'medium',
      notifications: { email: [], webhook: [] },
      suppressionWindow: 60
    },
    {
      id: 'queue_backlog',
      name: 'Queue Backlog',
      description: 'Queue size exceeds 100 items',
      enabled: true,
      conditions: { metric: 'workflow.queue.size', operator: 'gt', threshold: 100 },
      severity: 'medium',
      notifications: { email: [], webhook: [] },
      suppressionWindow: 30
    }
  ];

  private constructor() {
    super();
    this.initializeDefaultRules();
    this.initializeEmailTransporter();
  }

  public static getInstance(): AlertManager {
    if (!AlertManager.instance) {
      AlertManager.instance = new AlertManager();
    }
    return AlertManager.instance;
  }

  private initializeDefaultRules(): void {
    this.defaultRules.forEach(rule => {
      this.rules.set(rule.id, rule);
    });
    logger.info('Alert rules initialized', { count: this.rules.size });
  }

  private initializeEmailTransporter(): void {
    if (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS) {
      this.emailTransporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: parseInt(process.env.SMTP_PORT || '587'),
        secure: process.env.SMTP_SECURE === 'true',
        auth: {
          user: process.env.SMTP_USER,
          pass: process.env.SMTP_PASS
        }
      });
      logger.info('Email transporter initialized');
    } else {
      logger.warn('Email notifications disabled - SMTP configuration missing');
    }
  }

  public createAlert(
    type: string,
    title: string,
    message: string,
    severity: AlertSeverity,
    source: string,
    metadata?: Record<string, any>
  ): Alert {
    const alert: Alert = {
      id: this.generateAlertId(),
      timestamp: new Date(),
      severity,
      status: 'active',
      type,
      title,
      message,
      source,
      metadata
    };

    // Check if this alert should be suppressed
    const suppressionKey = this.getSuppressionKey(alert);
    const suppressedUntil = this.suppressionCache.get(suppressionKey);
    
    if (suppressedUntil && suppressedUntil > new Date()) {
      alert.status = 'suppressed';
      alert.suppressedUntil = suppressedUntil;
    } else {
      // Remove from suppression cache if expired
      this.suppressionCache.delete(suppressionKey);
    }

    this.alerts.set(alert.id, alert);
    this.emit('alert:created', alert);
    
    // Send notifications if not suppressed
    if (alert.status === 'active') {
      this.sendNotifications(alert);
    }
    
    // Auto-resolve low severity alerts after 1 hour
    if (severity === 'low' || severity === 'info') {
      setTimeout(() => {
        if (this.alerts.get(alert.id)?.status === 'active') {
          this.resolveAlert(alert.id, 'auto-resolved');
        }
      }, 3600000); // 1 hour
    }
    
    logger.info('Alert created', { 
      id: alert.id, 
      type, 
      severity, 
      status: alert.status 
    });
    
    return alert;
  }

  private generateAlertId(): string {
    return `alert_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private getSuppressionKey(alert: Alert): string {
    return `${alert.type}_${alert.source}_${alert.severity}`;
  }

  public evaluateMetric(metricPath: string, value: number, source?: string): void {
    this.rules.forEach(rule => {
      if (!rule.enabled) return;
      
      if (rule.conditions.metric === metricPath) {
        const shouldAlert = this.evaluateCondition(value, rule.conditions.operator, rule.conditions.threshold);
        
        if (shouldAlert) {
          // Check if we have duration requirement
          if (rule.conditions.duration) {
            // Would need to track metric history for duration-based alerts
            // For now, just alert immediately
          }
          
          const alert = this.createAlert(
            rule.id,
            rule.name,
            `${rule.description}: ${metricPath} = ${value}`,
            rule.severity,
            source || 'metrics',
            { rule: rule.id, metric: metricPath, value, threshold: rule.conditions.threshold }
          );
          
          // Set suppression if configured
          if (rule.suppressionWindow && alert.status === 'active') {
            const suppressionKey = this.getSuppressionKey(alert);
            const suppressUntil = new Date();
            suppressUntil.setMinutes(suppressUntil.getMinutes() + rule.suppressionWindow);
            this.suppressionCache.set(suppressionKey, suppressUntil);
          }
        }
      }
    });
  }

  private evaluateCondition(value: number, operator: string, threshold: number): boolean {
    switch (operator) {
      case 'gt': return value > threshold;
      case 'lt': return value < threshold;
      case 'eq': return value === threshold;
      case 'gte': return value >= threshold;
      case 'lte': return value <= threshold;
      default: return false;
    }
  }

  private async sendNotifications(alert: Alert): Promise<void> {
    // Find rules that might have notification settings
    const rule = this.rules.get(alert.type);
    if (!rule || !rule.notifications) return;
    
    // Send email notifications
    if (rule.notifications.email && rule.notifications.email.length > 0) {
      for (const email of rule.notifications.email) {
        await this.sendEmailNotification(alert, email);
      }
    }
    
    // Send webhook notifications
    if (rule.notifications.webhook && rule.notifications.webhook.length > 0) {
      for (const webhook of rule.notifications.webhook) {
        await this.sendWebhookNotification(alert, webhook);
      }
    }
  }

  private async sendEmailNotification(alert: Alert, recipient: string): Promise<void> {
    if (!this.emailTransporter) {
      logger.warn('Email notification skipped - no transporter configured');
      return;
    }

    const notification: AlertNotification = {
      type: 'email',
      recipient,
      alert,
      timestamp: new Date(),
      status: 'sent'
    };

    try {
      const mailOptions = {
        from: process.env.SMTP_FROM || 'alerts@dnc-vinny.com',
        to: recipient,
        subject: `[${alert.severity.toUpperCase()}] ${alert.title}`,
        html: this.generateEmailBody(alert)
      };

      await this.emailTransporter.sendMail(mailOptions);
      logger.info('Email notification sent', { alertId: alert.id, recipient });
    } catch (error) {
      notification.status = 'failed';
      notification.error = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Failed to send email notification', { error, alertId: alert.id });
    }

    this.notificationHistory.push(notification);
    this.emit('notification:sent', notification);
  }

  private generateEmailBody(alert: Alert): string {
    const severityColor = {
      critical: '#FF0000',
      high: '#FF6600',
      medium: '#FFAA00',
      low: '#0066FF',
      info: '#999999'
    };

    return `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <div style="background-color: ${severityColor[alert.severity]}; color: white; padding: 10px;">
          <h2 style="margin: 0;">${alert.title}</h2>
        </div>
        <div style="padding: 20px; background-color: #f5f5f5;">
          <p><strong>Severity:</strong> ${alert.severity.toUpperCase()}</p>
          <p><strong>Time:</strong> ${alert.timestamp.toISOString()}</p>
          <p><strong>Source:</strong> ${alert.source}</p>
          <p><strong>Message:</strong> ${alert.message}</p>
          ${alert.metadata ? `<p><strong>Details:</strong> <pre>${JSON.stringify(alert.metadata, null, 2)}</pre></p>` : ''}
        </div>
        <div style="padding: 10px; background-color: #333; color: white; text-align: center;">
          <small>DNC VINNY Monitoring System</small>
        </div>
      </div>
    `;
  }

  private async sendWebhookNotification(alert: Alert, webhook: string): Promise<void> {
    const notification: AlertNotification = {
      type: 'webhook',
      recipient: webhook,
      alert,
      timestamp: new Date(),
      status: 'sent'
    };

    try {
      await axios.post(webhook, {
        id: alert.id,
        timestamp: alert.timestamp,
        severity: alert.severity,
        type: alert.type,
        title: alert.title,
        message: alert.message,
        source: alert.source,
        metadata: alert.metadata
      }, {
        timeout: 5000,
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'DNC-VINNY-Monitoring/1.0'
        }
      });
      
      logger.info('Webhook notification sent', { alertId: alert.id, webhook });
    } catch (error) {
      notification.status = 'failed';
      notification.error = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Failed to send webhook notification', { error, alertId: alert.id });
    }

    this.notificationHistory.push(notification);
    this.emit('notification:sent', notification);
  }

  public acknowledgeAlert(alertId: string, acknowledgedBy: string): Alert | null {
    const alert = this.alerts.get(alertId);
    if (!alert || alert.status !== 'active') {
      return null;
    }

    alert.status = 'acknowledged';
    alert.acknowledgedBy = acknowledgedBy;
    alert.acknowledgedAt = new Date();
    
    this.emit('alert:acknowledged', alert);
    logger.info('Alert acknowledged', { alertId, acknowledgedBy });
    
    return alert;
  }

  public resolveAlert(alertId: string, resolvedBy: string): Alert | null {
    const alert = this.alerts.get(alertId);
    if (!alert || alert.status === 'resolved') {
      return null;
    }

    alert.status = 'resolved';
    alert.resolvedAt = new Date();
    if (!alert.acknowledgedBy) {
      alert.acknowledgedBy = resolvedBy;
    }
    
    this.emit('alert:resolved', alert);
    logger.info('Alert resolved', { alertId, resolvedBy });
    
    return alert;
  }

  public suppressAlert(alertId: string, minutes: number): Alert | null {
    const alert = this.alerts.get(alertId);
    if (!alert) {
      return null;
    }

    const suppressUntil = new Date();
    suppressUntil.setMinutes(suppressUntil.getMinutes() + minutes);
    
    alert.status = 'suppressed';
    alert.suppressedUntil = suppressUntil;
    
    // Add to suppression cache
    const suppressionKey = this.getSuppressionKey(alert);
    this.suppressionCache.set(suppressionKey, suppressUntil);
    
    this.emit('alert:suppressed', alert);
    logger.info('Alert suppressed', { alertId, suppressUntil });
    
    return alert;
  }

  public getActiveAlerts(severity?: AlertSeverity): Alert[] {
    return Array.from(this.alerts.values())
      .filter(alert => 
        alert.status === 'active' &&
        (!severity || alert.severity === severity)
      )
      .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
  }

  public getAlertHistory(hours: number = 24): Alert[] {
    const cutoff = new Date();
    cutoff.setHours(cutoff.getHours() - hours);
    
    return Array.from(this.alerts.values())
      .filter(alert => alert.timestamp >= cutoff)
      .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
  }

  public updateRule(ruleId: string, updates: Partial<AlertRule>): AlertRule | null {
    const rule = this.rules.get(ruleId);
    if (!rule) {
      return null;
    }

    Object.assign(rule, updates);
    this.emit('rule:updated', rule);
    logger.info('Alert rule updated', { ruleId, updates });
    
    return rule;
  }

  public addRule(rule: AlertRule): void {
    this.rules.set(rule.id, rule);
    this.emit('rule:added', rule);
    logger.info('Alert rule added', { ruleId: rule.id });
  }

  public removeRule(ruleId: string): boolean {
    const deleted = this.rules.delete(ruleId);
    if (deleted) {
      this.emit('rule:removed', ruleId);
      logger.info('Alert rule removed', { ruleId });
    }
    return deleted;
  }

  public getRules(): AlertRule[] {
    return Array.from(this.rules.values());
  }

  public getNotificationHistory(hours: number = 24): AlertNotification[] {
    const cutoff = new Date();
    cutoff.setHours(cutoff.getHours() - hours);
    
    return this.notificationHistory
      .filter(n => n.timestamp >= cutoff)
      .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
  }

  public clearOldAlerts(days: number = 7): number {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);
    
    let cleared = 0;
    this.alerts.forEach((alert, id) => {
      if (alert.timestamp < cutoff && alert.status === 'resolved') {
        this.alerts.delete(id);
        cleared++;
      }
    });
    
    if (cleared > 0) {
      logger.info('Cleared old alerts', { count: cleared });
    }
    
    return cleared;
  }

  public getAlertStats(): {
    total: number;
    active: number;
    acknowledged: number;
    resolved: number;
    suppressed: number;
    bySeverity: Record<AlertSeverity, number>;
  } {
    const stats = {
      total: this.alerts.size,
      active: 0,
      acknowledged: 0,
      resolved: 0,
      suppressed: 0,
      bySeverity: {
        critical: 0,
        high: 0,
        medium: 0,
        low: 0,
        info: 0
      } as Record<AlertSeverity, number>
    };
    
    this.alerts.forEach(alert => {
      stats[alert.status]++;
      stats.bySeverity[alert.severity]++;
    });
    
    return stats;
  }
}

export default AlertManager.getInstance();