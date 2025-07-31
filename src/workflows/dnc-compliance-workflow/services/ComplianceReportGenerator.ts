import * as fs from 'fs-extra';
import * as path from 'path';
import { format } from 'date-fns';
import * as ExcelJS from 'exceljs';
import * as PDFDocument from 'pdfkit';
import { ReportingConfig, DealershipConfig, TaskResult } from '../types';
import { Logger } from '../../../../utils/Logger';

/**
 * Compliance Report Generator
 * Generates comprehensive DNC compliance reports in multiple formats
 */
export class ComplianceReportGenerator {
  private logger: Logger;
  
  constructor(private config: ReportingConfig) {
    this.logger = new Logger('ComplianceReportGenerator');
  }

  /**
   * Generate comprehensive compliance report
   */
  async generateReport(data: {
    dealership: DealershipConfig;
    executionDate: Date;
    results: Map<string, TaskResult>;
    dncStats: {
      totalChecked: number;
      dncFound: number;
      successfullyMarked: number;
    };
  }): Promise<{ filePath: string; format: string }[]> {
    const reports: { filePath: string; format: string }[] = [];
    const timestamp = format(data.executionDate, 'yyyy-MM-dd_HH-mm-ss');
    const baseFileName = `dnc_compliance_report_${data.dealership.id}_${timestamp}`;

    // Ensure output directory exists
    await fs.ensureDir(this.config.outputDir);

    // Generate reports in requested formats
    for (const format of this.config.formats) {
      try {
        let filePath: string;
        
        switch (format) {
          case 'pdf':
            filePath = await this.generatePDFReport(data, baseFileName);
            break;
          case 'excel':
            filePath = await this.generateExcelReport(data, baseFileName);
            break;
          case 'json':
            filePath = await this.generateJSONReport(data, baseFileName);
            break;
          case 'html':
            filePath = await this.generateHTMLReport(data, baseFileName);
            break;
          default:
            continue;
        }
        
        reports.push({ filePath, format });
        this.logger.info(`Generated ${format.toUpperCase()} report: ${filePath}`);
        
      } catch (error) {
        this.logger.error(`Failed to generate ${format} report: ${error}`);
      }
    }

    // Send email notifications if configured
    if (this.config.emailOnCompletion && this.config.emailRecipients) {
      await this.sendReportEmail(data, reports);
    }

    // Clean up old reports
    await this.cleanupOldReports();

    return reports;
  }

  /**
   * Generate PDF report
   */
  private async generatePDFReport(data: any, baseFileName: string): Promise<string> {
    const filePath = path.join(this.config.outputDir, `${baseFileName}.pdf`);
    const doc = new PDFDocument({ margin: 50 });
    const stream = fs.createWriteStream(filePath);
    
    doc.pipe(stream);

    // Header
    doc.fontSize(20).text('DNC Compliance Report', { align: 'center' });
    doc.fontSize(12).text(`Generated: ${format(data.executionDate, 'PPP')}`, { align: 'center' });
    doc.moveDown(2);

    // Dealership Information
    doc.fontSize(16).text('Dealership Information', { underline: true });
    doc.fontSize(12);
    doc.text(`Name: ${data.dealership.name}`);
    doc.text(`ID: ${data.dealership.id}`);
    doc.moveDown();

    // Executive Summary
    doc.fontSize(16).text('Executive Summary', { underline: true });
    doc.fontSize(12);
    doc.text(`Total Customers Checked: ${data.dncStats.totalChecked}`);
    doc.text(`DNC Numbers Found: ${data.dncStats.dncFound}`);
    doc.text(`Successfully Marked: ${data.dncStats.successfullyMarked}`);
    doc.text(`Compliance Rate: ${((data.dncStats.successfullyMarked / data.dncStats.dncFound) * 100).toFixed(1)}%`);
    doc.moveDown();

    // Task Results
    doc.fontSize(16).text('Workflow Execution Details', { underline: true });
    doc.fontSize(10);
    
    const tasks = Array.from(data.results.values());
    for (const task of tasks) {
      doc.text(`• ${task.taskId}: ${task.success ? '✓' : '✗'} (${(task.duration / 1000).toFixed(1)}s)`);
      if (task.error) {
        doc.text(`  Error: ${task.error}`, { indent: 20 });
      }
    }
    doc.moveDown();

    // Compliance Actions Taken
    doc.fontSize(16).text('Compliance Actions', { underline: true });
    doc.fontSize(12);
    doc.text('1. Extracted customer data from VinSolutions');
    doc.text('2. Submitted phone numbers to PossibleNOW for DNC verification');
    doc.text('3. Marked DNC customers in CRM system');
    doc.text('4. Updated contact preferences for DNC customers');
    doc.text('5. Added compliance notes to customer records');
    doc.moveDown();

    // Recommendations
    doc.fontSize(16).text('Recommendations', { underline: true });
    doc.fontSize(12);
    doc.text('• Continue monthly DNC compliance checks');
    doc.text('• Train staff on DNC compliance procedures');
    doc.text('• Implement real-time DNC checking for new leads');
    doc.text('• Review and update contact preferences regularly');
    
    // Footer
    doc.fontSize(8);
    doc.text(`Report generated by DNC Compliance Workflow v1.0`, 50, doc.page.height - 50, {
      width: doc.page.width - 100,
      align: 'center'
    });

    doc.end();
    
    await new Promise((resolve) => stream.on('finish', resolve));
    return filePath;
  }

  /**
   * Generate Excel report
   */
  private async generateExcelReport(data: any, baseFileName: string): Promise<string> {
    const filePath = path.join(this.config.outputDir, `${baseFileName}.xlsx`);
    const workbook = new ExcelJS.Workbook();

    // Summary sheet
    const summarySheet = workbook.addWorksheet('Summary');
    summarySheet.columns = [
      { header: 'Metric', key: 'metric', width: 30 },
      { header: 'Value', key: 'value', width: 20 }
    ];

    summarySheet.addRows([
      { metric: 'Dealership Name', value: data.dealership.name },
      { metric: 'Dealership ID', value: data.dealership.id },
      { metric: 'Report Date', value: format(data.executionDate, 'PPP') },
      { metric: 'Total Customers Checked', value: data.dncStats.totalChecked },
      { metric: 'DNC Numbers Found', value: data.dncStats.dncFound },
      { metric: 'Successfully Marked', value: data.dncStats.successfullyMarked },
      { metric: 'Failed to Mark', value: data.dncStats.dncFound - data.dncStats.successfullyMarked },
      { metric: 'Compliance Rate', value: `${((data.dncStats.successfullyMarked / data.dncStats.dncFound) * 100).toFixed(1)}%` }
    ]);

    // Style the header row
    summarySheet.getRow(1).font = { bold: true };
    summarySheet.getRow(1).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF4472C4' }
    };

    // Task Details sheet
    const taskSheet = workbook.addWorksheet('Task Details');
    taskSheet.columns = [
      { header: 'Task ID', key: 'taskId', width: 20 },
      { header: 'Status', key: 'status', width: 10 },
      { header: 'Duration (s)', key: 'duration', width: 15 },
      { header: 'Start Time', key: 'startTime', width: 20 },
      { header: 'End Time', key: 'endTime', width: 20 },
      { header: 'Error', key: 'error', width: 50 }
    ];

    const tasks = Array.from(data.results.values());
    taskSheet.addRows(tasks.map(task => ({
      taskId: task.taskId,
      status: task.success ? 'Success' : 'Failed',
      duration: (task.duration / 1000).toFixed(1),
      startTime: format(task.startTime, 'PPP HH:mm:ss'),
      endTime: format(task.endTime, 'PPP HH:mm:ss'),
      error: task.error || ''
    })));

    // Style the task sheet
    taskSheet.getRow(1).font = { bold: true };
    taskSheet.getRow(1).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF4472C4' }
    };

    // Color code status column
    taskSheet.getColumn('status').eachCell((cell, rowNumber) => {
      if (rowNumber > 1) {
        if (cell.value === 'Success') {
          cell.font = { color: { argb: 'FF008000' } };
        } else if (cell.value === 'Failed') {
          cell.font = { color: { argb: 'FFFF0000' } };
        }
      }
    });

    await workbook.xlsx.writeFile(filePath);
    return filePath;
  }

  /**
   * Generate JSON report
   */
  private async generateJSONReport(data: any, baseFileName: string): Promise<string> {
    const filePath = path.join(this.config.outputDir, `${baseFileName}.json`);
    
    const report = {
      metadata: {
        reportType: 'DNC Compliance Report',
        generatedAt: data.executionDate,
        version: '1.0'
      },
      dealership: {
        id: data.dealership.id,
        name: data.dealership.name
      },
      summary: data.dncStats,
      tasks: Array.from(data.results.values()),
      compliance: {
        rate: (data.dncStats.successfullyMarked / data.dncStats.dncFound) * 100,
        status: data.dncStats.successfullyMarked === data.dncStats.dncFound ? 'COMPLIANT' : 'PARTIAL'
      }
    };

    await fs.writeJson(filePath, report, { spaces: 2 });
    return filePath;
  }

  /**
   * Generate HTML report
   */
  private async generateHTMLReport(data: any, baseFileName: string): Promise<string> {
    const filePath = path.join(this.config.outputDir, `${baseFileName}.html`);
    
    const html = `
<!DOCTYPE html>
<html>
<head>
    <title>DNC Compliance Report - ${data.dealership.name}</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 40px; background: #f5f5f5; }
        .container { max-width: 1200px; margin: 0 auto; background: white; padding: 30px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
        h1 { color: #333; border-bottom: 3px solid #4472C4; padding-bottom: 10px; }
        h2 { color: #4472C4; margin-top: 30px; }
        .summary { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 20px; margin: 20px 0; }
        .metric { background: #f8f9fa; padding: 20px; border-radius: 8px; text-align: center; }
        .metric-value { font-size: 2em; font-weight: bold; color: #4472C4; }
        .metric-label { color: #666; margin-top: 5px; }
        table { width: 100%; border-collapse: collapse; margin: 20px 0; }
        th, td { padding: 12px; text-align: left; border-bottom: 1px solid #ddd; }
        th { background: #4472C4; color: white; }
        tr:hover { background: #f5f5f5; }
        .success { color: #28a745; }
        .failed { color: #dc3545; }
        .footer { margin-top: 50px; text-align: center; color: #666; font-size: 0.9em; }
    </style>
</head>
<body>
    <div class="container">
        <h1>DNC Compliance Report</h1>
        <p><strong>Dealership:</strong> ${data.dealership.name} (${data.dealership.id})</p>
        <p><strong>Generated:</strong> ${format(data.executionDate, 'PPP HH:mm:ss')}</p>
        
        <h2>Executive Summary</h2>
        <div class="summary">
            <div class="metric">
                <div class="metric-value">${data.dncStats.totalChecked}</div>
                <div class="metric-label">Customers Checked</div>
            </div>
            <div class="metric">
                <div class="metric-value">${data.dncStats.dncFound}</div>
                <div class="metric-label">DNC Numbers Found</div>
            </div>
            <div class="metric">
                <div class="metric-value">${data.dncStats.successfullyMarked}</div>
                <div class="metric-label">Successfully Marked</div>
            </div>
            <div class="metric">
                <div class="metric-value">${((data.dncStats.successfullyMarked / data.dncStats.dncFound) * 100).toFixed(1)}%</div>
                <div class="metric-label">Compliance Rate</div>
            </div>
        </div>
        
        <h2>Workflow Execution Details</h2>
        <table>
            <thead>
                <tr>
                    <th>Task</th>
                    <th>Status</th>
                    <th>Duration</th>
                    <th>Details</th>
                </tr>
            </thead>
            <tbody>
                ${Array.from(data.results.values()).map(task => `
                    <tr>
                        <td>${task.taskId}</td>
                        <td class="${task.success ? 'success' : 'failed'}">${task.success ? '✓ Success' : '✗ Failed'}</td>
                        <td>${(task.duration / 1000).toFixed(1)}s</td>
                        <td>${task.error || 'Completed successfully'}</td>
                    </tr>
                `).join('')}
            </tbody>
        </table>
        
        <h2>Compliance Actions Taken</h2>
        <ol>
            <li>Extracted customer data from VinSolutions</li>
            <li>Submitted phone numbers to PossibleNOW for DNC verification</li>
            <li>Marked DNC customers in CRM system</li>
            <li>Updated contact preferences for DNC customers</li>
            <li>Added compliance notes to customer records</li>
        </ol>
        
        <div class="footer">
            <p>Report generated by DNC Compliance Workflow v1.0</p>
        </div>
    </div>
</body>
</html>`;

    await fs.writeFile(filePath, html);
    return filePath;
  }

  /**
   * Send report email
   */
  private async sendReportEmail(data: any, reports: any[]): Promise<void> {
    // This is a placeholder - implement with your email service
    this.logger.info(`Email notification would be sent to: ${this.config.emailRecipients?.join(', ')}`);
    this.logger.info(`Reports attached: ${reports.map(r => r.format).join(', ')}`);
  }

  /**
   * Clean up old reports based on retention policy
   */
  private async cleanupOldReports(): Promise<void> {
    if (!this.config.retentionDays) return;

    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - this.config.retentionDays);

    const files = await fs.readdir(this.config.outputDir);
    
    for (const file of files) {
      const filePath = path.join(this.config.outputDir, file);
      const stats = await fs.stat(filePath);
      
      if (stats.mtime < cutoffDate && file.startsWith('dnc_compliance_report_')) {
        await fs.remove(filePath);
        this.logger.info(`Removed old report: ${file}`);
      }
    }
  }
}