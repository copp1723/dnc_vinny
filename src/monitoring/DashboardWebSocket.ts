import { Server as SocketIOServer } from 'socket.io';
import { Server as HTTPServer } from 'http';
import { MetricsCollector } from './MetricsCollector';
import { ComplianceTracker } from './ComplianceTracker';
import { AlertManager } from './AlertManager';
import { logger } from '../../priority5-compliance/logger';

export class DashboardWebSocket {
  private io: SocketIOServer;
  private metricsCollector: MetricsCollector;
  private complianceTracker: ComplianceTracker;
  private alertManager: AlertManager;
  private updateInterval: NodeJS.Timer | null = null;
  private connectedClients: Map<string, any> = new Map();

  constructor(server: HTTPServer) {
    this.io = new SocketIOServer(server, {
      cors: {
        origin: '*',
        methods: ['GET', 'POST']
      },
      path: '/ws'
    });

    this.metricsCollector = MetricsCollector.getInstance();
    this.complianceTracker = ComplianceTracker.getInstance();
    this.alertManager = AlertManager.getInstance();

    this.setupEventListeners();
    this.setupSocketHandlers();
  }

  private setupEventListeners(): void {
    // Listen to metrics updates
    this.metricsCollector.on('metrics', (metrics) => {
      this.broadcast('metrics:update', metrics);
    });

    this.metricsCollector.on('metrics:system', (metrics) => {
      this.broadcast('metrics:system', metrics);
    });

    this.metricsCollector.on('metrics:workflow', (metrics) => {
      this.broadcast('metrics:workflow', metrics);
    });

    this.metricsCollector.on('metrics:browser', (metrics) => {
      this.broadcast('metrics:browser', metrics);
    });

    this.metricsCollector.on('metrics:api', (metrics) => {
      this.broadcast('metrics:api', metrics);
    });

    // Listen to compliance events
    this.complianceTracker.on('compliance:event', (event) => {
      this.broadcast('compliance:event', event);
    });

    this.complianceTracker.on('compliance:violation', (violation) => {
      this.broadcast('compliance:violation', violation);
    });

    this.complianceTracker.on('compliance:report', (report) => {
      this.broadcast('compliance:report', report);
    });

    // Listen to alert events
    this.alertManager.on('alert:created', (alert) => {
      this.broadcast('alert:created', alert);
    });

    this.alertManager.on('alert:acknowledged', (alert) => {
      this.broadcast('alert:acknowledged', alert);
    });

    this.alertManager.on('alert:resolved', (alert) => {
      this.broadcast('alert:resolved', alert);
    });

    this.alertManager.on('alert:suppressed', (alert) => {
      this.broadcast('alert:suppressed', alert);
    });
  }

  private setupSocketHandlers(): void {
    this.io.on('connection', (socket) => {
      logger.info('Dashboard client connected', { id: socket.id });
      this.connectedClients.set(socket.id, {
        connectedAt: new Date(),
        subscriptions: new Set()
      });

      // Send initial data
      this.sendInitialData(socket);

      // Handle subscription requests
      socket.on('subscribe', (channels: string[]) => {
        const client = this.connectedClients.get(socket.id);
        if (client) {
          channels.forEach(channel => {
            client.subscriptions.add(channel);
            socket.join(channel);
          });
          logger.info('Client subscribed to channels', { id: socket.id, channels });
        }
      });

      socket.on('unsubscribe', (channels: string[]) => {
        const client = this.connectedClients.get(socket.id);
        if (client) {
          channels.forEach(channel => {
            client.subscriptions.delete(channel);
            socket.leave(channel);
          });
          logger.info('Client unsubscribed from channels', { id: socket.id, channels });
        }
      });

      // Handle metric requests
      socket.on('request:metrics', (params: any, callback: Function) => {
        try {
          const metrics = this.metricsCollector.getLatestMetrics();
          callback({ success: true, data: metrics });
        } catch (error) {
          callback({ success: false, error: error.message });
        }
      });

      socket.on('request:metrics:history', (params: any, callback: Function) => {
        try {
          const minutes = params.minutes || 60;
          const metrics = this.metricsCollector.getMetricsHistory(minutes);
          callback({ success: true, data: metrics, count: metrics.length });
        } catch (error) {
          callback({ success: false, error: error.message });
        }
      });

      // Handle compliance requests
      socket.on('request:compliance:summary', (params: any, callback: Function) => {
        try {
          const summary = this.complianceTracker.getComplianceSummary();
          callback({ success: true, data: summary });
        } catch (error) {
          callback({ success: false, error: error.message });
        }
      });

      socket.on('request:compliance:stats', (params: any, callback: Function) => {
        try {
          const { dealershipId, period } = params;
          const stats = this.complianceTracker.getLatestStats(dealershipId, period);
          callback({ success: true, data: stats });
        } catch (error) {
          callback({ success: false, error: error.message });
        }
      });

      // Handle alert requests
      socket.on('request:alerts:active', (params: any, callback: Function) => {
        try {
          const alerts = this.alertManager.getActiveAlerts(params.severity);
          callback({ success: true, data: alerts, count: alerts.length });
        } catch (error) {
          callback({ success: false, error: error.message });
        }
      });

      socket.on('request:alerts:stats', (params: any, callback: Function) => {
        try {
          const stats = this.alertManager.getAlertStats();
          callback({ success: true, data: stats });
        } catch (error) {
          callback({ success: false, error: error.message });
        }
      });

      // Handle alert actions
      socket.on('alert:acknowledge', (params: any, callback: Function) => {
        try {
          const { alertId, acknowledgedBy } = params;
          const alert = this.alertManager.acknowledgeAlert(alertId, acknowledgedBy);
          callback({ success: true, data: alert });
        } catch (error) {
          callback({ success: false, error: error.message });
        }
      });

      socket.on('alert:resolve', (params: any, callback: Function) => {
        try {
          const { alertId, resolvedBy } = params;
          const alert = this.alertManager.resolveAlert(alertId, resolvedBy);
          callback({ success: true, data: alert });
        } catch (error) {
          callback({ success: false, error: error.message });
        }
      });

      socket.on('alert:suppress', (params: any, callback: Function) => {
        try {
          const { alertId, minutes } = params;
          const alert = this.alertManager.suppressAlert(alertId, minutes);
          callback({ success: true, data: alert });
        } catch (error) {
          callback({ success: false, error: error.message });
        }
      });

      // Handle disconnection
      socket.on('disconnect', () => {
        logger.info('Dashboard client disconnected', { id: socket.id });
        this.connectedClients.delete(socket.id);
      });
    });

    // Start periodic updates
    this.startPeriodicUpdates();
  }

  private sendInitialData(socket: any): void {
    // Send current metrics
    const metrics = this.metricsCollector.getLatestMetrics();
    if (metrics) {
      socket.emit('initial:metrics', metrics);
    }

    // Send active alerts
    const alerts = this.alertManager.getActiveAlerts();
    socket.emit('initial:alerts', alerts);

    // Send compliance summary
    const compliance = this.complianceTracker.getComplianceSummary();
    socket.emit('initial:compliance', compliance);

    // Send system info
    socket.emit('initial:system', {
      version: process.env.npm_package_version || '1.0.0',
      uptime: process.uptime(),
      connectedClients: this.connectedClients.size,
      timestamp: new Date()
    });
  }

  private startPeriodicUpdates(): void {
    // Send heartbeat every 30 seconds
    this.updateInterval = setInterval(() => {
      this.io.emit('heartbeat', {
        timestamp: new Date(),
        clients: this.connectedClients.size
      });
    }, 30000);
  }

  private broadcast(event: string, data: any): void {
    // Broadcast to all connected clients
    this.io.emit(event, data);

    // Also broadcast to specific channels if applicable
    const channel = event.split(':')[0];
    this.io.to(channel).emit(event, data);
  }

  public getConnectedClients(): number {
    return this.connectedClients.size;
  }

  public getClientInfo(): Array<{ id: string; connectedAt: Date; subscriptions: string[] }> {
    return Array.from(this.connectedClients.entries()).map(([id, info]) => ({
      id,
      connectedAt: info.connectedAt,
      subscriptions: Array.from(info.subscriptions)
    }));
  }

  public stop(): void {
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
      this.updateInterval = null;
    }
    
    this.io.close();
    logger.info('Dashboard WebSocket server stopped');
  }
}

export default DashboardWebSocket;