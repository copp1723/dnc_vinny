import { ChartConfiguration, ChartType } from 'chart.js';
import { createCanvas, Canvas } from 'canvas';
import { MetricsSummary } from '../MetricsCollector';
import { ComplianceStats } from '../ComplianceTracker';

export class ChartGenerator {
  private width: number = 800;
  private height: number = 400;

  constructor(width?: number, height?: number) {
    if (width) this.width = width;
    if (height) this.height = height;
  }

  public generateMetricsTrendChart(metrics: MetricsSummary[]): Canvas {
    const canvas = createCanvas(this.width, this.height);
    const ctx = canvas.getContext('2d');

    const labels = metrics.map(m => m.system.timestamp.toLocaleTimeString());
    const cpuData = metrics.map(m => m.system.cpu.usage);
    const memoryData = metrics.map(m => m.system.memory.percentage);
    const successRateData = metrics.map(m => m.workflow.performance.successRate);

    const config: ChartConfiguration = {
      type: 'line' as ChartType,
      data: {
        labels,
        datasets: [
          {
            label: 'CPU Usage %',
            data: cpuData,
            borderColor: 'rgb(255, 99, 132)',
            backgroundColor: 'rgba(255, 99, 132, 0.1)',
            tension: 0.1
          },
          {
            label: 'Memory Usage %',
            data: memoryData,
            borderColor: 'rgb(54, 162, 235)',
            backgroundColor: 'rgba(54, 162, 235, 0.1)',
            tension: 0.1
          },
          {
            label: 'Success Rate %',
            data: successRateData,
            borderColor: 'rgb(75, 192, 192)',
            backgroundColor: 'rgba(75, 192, 192, 0.1)',
            tension: 0.1
          }
        ]
      },
      options: {
        responsive: false,
        maintainAspectRatio: false,
        plugins: {
          title: {
            display: true,
            text: 'System Metrics Trend'
          },
          legend: {
            display: true,
            position: 'top'
          }
        },
        scales: {
          y: {
            beginAtZero: true,
            max: 100
          }
        }
      }
    };

    // Draw the chart
    this.drawChart(ctx, config);
    return canvas;
  }

  public generateComplianceRateChart(stats: ComplianceStats[]): Canvas {
    const canvas = createCanvas(this.width, this.height);
    const ctx = canvas.getContext('2d');

    const labels = stats.map(s => s.timestamp.toLocaleDateString());
    const complianceRates = stats.map(s => s.stats.complianceRate);
    const errorCounts = stats.map(s => s.stats.totalErrors);

    const config: ChartConfiguration = {
      type: 'bar' as ChartType,
      data: {
        labels,
        datasets: [
          {
            label: 'Compliance Rate %',
            data: complianceRates,
            backgroundColor: 'rgba(75, 192, 192, 0.6)',
            borderColor: 'rgb(75, 192, 192)',
            borderWidth: 1,
            yAxisID: 'y'
          },
          {
            label: 'Error Count',
            data: errorCounts,
            backgroundColor: 'rgba(255, 99, 132, 0.6)',
            borderColor: 'rgb(255, 99, 132)',
            borderWidth: 1,
            yAxisID: 'y1'
          }
        ]
      },
      options: {
        responsive: false,
        maintainAspectRatio: false,
        plugins: {
          title: {
            display: true,
            text: 'Compliance Rate vs Errors'
          }
        },
        scales: {
          y: {
            type: 'linear',
            display: true,
            position: 'left',
            beginAtZero: true,
            max: 100,
            title: {
              display: true,
              text: 'Compliance Rate %'
            }
          },
          y1: {
            type: 'linear',
            display: true,
            position: 'right',
            beginAtZero: true,
            title: {
              display: true,
              text: 'Error Count'
            },
            grid: {
              drawOnChartArea: false
            }
          }
        }
      }
    };

    this.drawChart(ctx, config);
    return canvas;
  }

  public generateThroughputChart(metrics: MetricsSummary[]): Canvas {
    const canvas = createCanvas(this.width, this.height);
    const ctx = canvas.getContext('2d');

    const labels = metrics.map(m => m.workflow.timestamp.toLocaleTimeString());
    const throughputData = metrics.map(m => m.workflow.performance.throughput);
    const avgProcessingTime = metrics.map(m => m.workflow.performance.avgProcessingTime / 1000); // Convert to seconds

    const config: ChartConfiguration = {
      type: 'line' as ChartType,
      data: {
        labels,
        datasets: [
          {
            label: 'Throughput (tasks/min)',
            data: throughputData,
            borderColor: 'rgb(54, 162, 235)',
            backgroundColor: 'rgba(54, 162, 235, 0.1)',
            tension: 0.1,
            yAxisID: 'y'
          },
          {
            label: 'Avg Processing Time (s)',
            data: avgProcessingTime,
            borderColor: 'rgb(255, 159, 64)',
            backgroundColor: 'rgba(255, 159, 64, 0.1)',
            tension: 0.1,
            yAxisID: 'y1'
          }
        ]
      },
      options: {
        responsive: false,
        maintainAspectRatio: false,
        plugins: {
          title: {
            display: true,
            text: 'Processing Performance'
          }
        },
        scales: {
          y: {
            type: 'linear',
            display: true,
            position: 'left',
            beginAtZero: true,
            title: {
              display: true,
              text: 'Throughput'
            }
          },
          y1: {
            type: 'linear',
            display: true,
            position: 'right',
            beginAtZero: true,
            title: {
              display: true,
              text: 'Time (seconds)'
            },
            grid: {
              drawOnChartArea: false
            }
          }
        }
      }
    };

    this.drawChart(ctx, config);
    return canvas;
  }

  public generateAPIUsageChart(metrics: MetricsSummary[]): Canvas {
    const canvas = createCanvas(this.width, this.height);
    const ctx = canvas.getContext('2d');

    const labels = metrics.map(m => m.api.timestamp.toLocaleTimeString());
    const vautoUsage = metrics.map(m => (m.api.quotas.vauto.used / m.api.quotas.vauto.limit) * 100);
    const cdkUsage = metrics.map(m => (m.api.quotas.cdk.used / m.api.quotas.cdk.limit) * 100);
    const apiLatency = metrics.map(m => m.api.latency.avg);

    const config: ChartConfiguration = {
      type: 'line' as ChartType,
      data: {
        labels,
        datasets: [
          {
            label: 'vAuto Quota Usage %',
            data: vautoUsage,
            borderColor: 'rgb(255, 99, 132)',
            backgroundColor: 'rgba(255, 99, 132, 0.1)',
            tension: 0.1
          },
          {
            label: 'CDK Quota Usage %',
            data: cdkUsage,
            borderColor: 'rgb(54, 162, 235)',
            backgroundColor: 'rgba(54, 162, 235, 0.1)',
            tension: 0.1
          },
          {
            label: 'API Latency (ms)',
            data: apiLatency,
            borderColor: 'rgb(255, 206, 86)',
            backgroundColor: 'rgba(255, 206, 86, 0.1)',
            tension: 0.1,
            yAxisID: 'y1'
          }
        ]
      },
      options: {
        responsive: false,
        maintainAspectRatio: false,
        plugins: {
          title: {
            display: true,
            text: 'API Usage & Performance'
          }
        },
        scales: {
          y: {
            type: 'linear',
            display: true,
            position: 'left',
            beginAtZero: true,
            max: 100,
            title: {
              display: true,
              text: 'Quota Usage %'
            }
          },
          y1: {
            type: 'linear',
            display: true,
            position: 'right',
            beginAtZero: true,
            title: {
              display: true,
              text: 'Latency (ms)'
            },
            grid: {
              drawOnChartArea: false
            }
          }
        }
      }
    };

    this.drawChart(ctx, config);
    return canvas;
  }

  public generateStorePerformanceHeatmap(storeData: any[]): Canvas {
    const canvas = createCanvas(this.width, this.height);
    const ctx = canvas.getContext('2d');

    // This would create a heatmap showing store performance
    // For now, we'll create a simple bar chart
    const labels = storeData.map(s => s.name || `Store ${s.id}`);
    const successRates = storeData.map(s => s.successRate || 0);
    const processingTimes = storeData.map(s => s.avgProcessingTime || 0);

    const config: ChartConfiguration = {
      type: 'bar' as ChartType,
      data: {
        labels,
        datasets: [
          {
            label: 'Success Rate %',
            data: successRates,
            backgroundColor: successRates.map(rate => 
              rate >= 95 ? 'rgba(75, 192, 192, 0.6)' :
              rate >= 90 ? 'rgba(255, 206, 86, 0.6)' :
              'rgba(255, 99, 132, 0.6)'
            ),
            borderWidth: 1
          }
        ]
      },
      options: {
        responsive: false,
        maintainAspectRatio: false,
        plugins: {
          title: {
            display: true,
            text: 'Store Performance'
          }
        },
        scales: {
          y: {
            beginAtZero: true,
            max: 100
          }
        }
      }
    };

    this.drawChart(ctx, config);
    return canvas;
  }

  public generateBrowserResourceChart(metrics: MetricsSummary[]): Canvas {
    const canvas = createCanvas(this.width, this.height);
    const ctx = canvas.getContext('2d');

    const labels = metrics.map(m => m.browser.timestamp.toLocaleTimeString());
    const activeBrowsers = metrics.map(m => m.browser.browsers.active);
    const totalBrowsers = metrics.map(m => m.browser.browsers.total);
    const memoryUsage = metrics.map(m => m.browser.memory.estimated / (1024 * 1024)); // Convert to MB

    const config: ChartConfiguration = {
      type: 'line' as ChartType,
      data: {
        labels,
        datasets: [
          {
            label: 'Active Browsers',
            data: activeBrowsers,
            borderColor: 'rgb(75, 192, 192)',
            backgroundColor: 'rgba(75, 192, 192, 0.1)',
            tension: 0.1
          },
          {
            label: 'Total Browsers',
            data: totalBrowsers,
            borderColor: 'rgb(54, 162, 235)',
            backgroundColor: 'rgba(54, 162, 235, 0.1)',
            tension: 0.1
          },
          {
            label: 'Memory Usage (MB)',
            data: memoryUsage,
            borderColor: 'rgb(255, 99, 132)',
            backgroundColor: 'rgba(255, 99, 132, 0.1)',
            tension: 0.1,
            yAxisID: 'y1'
          }
        ]
      },
      options: {
        responsive: false,
        maintainAspectRatio: false,
        plugins: {
          title: {
            display: true,
            text: 'Browser Resource Usage'
          }
        },
        scales: {
          y: {
            type: 'linear',
            display: true,
            position: 'left',
            beginAtZero: true,
            title: {
              display: true,
              text: 'Browser Count'
            }
          },
          y1: {
            type: 'linear',
            display: true,
            position: 'right',
            beginAtZero: true,
            title: {
              display: true,
              text: 'Memory (MB)'
            },
            grid: {
              drawOnChartArea: false
            }
          }
        }
      }
    };

    this.drawChart(ctx, config);
    return canvas;
  }

  public generateAlertDistributionChart(alerts: any[]): Canvas {
    const canvas = createCanvas(this.width, this.height);
    const ctx = canvas.getContext('2d');

    // Count alerts by severity
    const severityCounts = {
      critical: 0,
      high: 0,
      medium: 0,
      low: 0,
      info: 0
    };

    alerts.forEach(alert => {
      severityCounts[alert.severity]++;
    });

    const config: ChartConfiguration = {
      type: 'doughnut' as ChartType,
      data: {
        labels: ['Critical', 'High', 'Medium', 'Low', 'Info'],
        datasets: [{
          data: [
            severityCounts.critical,
            severityCounts.high,
            severityCounts.medium,
            severityCounts.low,
            severityCounts.info
          ],
          backgroundColor: [
            'rgba(255, 99, 132, 0.8)',
            'rgba(255, 159, 64, 0.8)',
            'rgba(255, 206, 86, 0.8)',
            'rgba(54, 162, 235, 0.8)',
            'rgba(153, 153, 153, 0.8)'
          ],
          borderWidth: 1
        }]
      },
      options: {
        responsive: false,
        maintainAspectRatio: false,
        plugins: {
          title: {
            display: true,
            text: 'Alert Distribution by Severity'
          },
          legend: {
            display: true,
            position: 'right'
          }
        }
      }
    };

    this.drawChart(ctx, config);
    return canvas;
  }

  private drawChart(ctx: any, config: ChartConfiguration): void {
    // In a real implementation, we would use Chart.js to draw the chart
    // For now, we'll draw a placeholder
    ctx.fillStyle = '#f0f0f0';
    ctx.fillRect(0, 0, this.width, this.height);
    
    ctx.fillStyle = '#333';
    ctx.font = '16px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(config.options?.plugins?.title?.text || 'Chart', this.width / 2, this.height / 2);
  }

  public async saveChart(canvas: Canvas, filePath: string): Promise<void> {
    const buffer = canvas.toBuffer('image/png');
    const fs = require('fs').promises;
    await fs.writeFile(filePath, buffer);
  }

  public getChartAsBase64(canvas: Canvas): string {
    return canvas.toDataURL();
  }
}

export default ChartGenerator;